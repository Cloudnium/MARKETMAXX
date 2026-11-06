-- =====================================================================
-- 24_resiliencia_idempotencia.sql  (idempotente, se puede ejecutar varias veces)
--
-- Resiliencia ante fallas de red:
--  1) operaciones_idempotentes + ejecutar_idempotente(request_id, funcion, args)
--     Toda mutación del sistema se ejecuta con un request_id generado por el
--     formulario. Si la respuesta se pierde (timeout, corte de red, doble clic,
--     otra pestaña) y se REPITE la misma operación, la base devuelve la MISMA
--     respuesta y no vuelve a escribir. Mismo request_id con datos distintos
--     se rechaza (P0409).  consultar_operacion() dice si una operación llegó a
--     completarse ("verificar estado").
--  2) Flujos de varios pasos hechos atómicos: registrar_compra_completa
--     (proveedor + productos nuevos + compra), guardar_cliente, crear_proveedor,
--     guardar_permisos_rol, crear_rol.
--  3) Correcciones: abrir_mi_caja (doble caja por clics/pestañas simultáneas) y
--     egresos que dicen "descontar de mi caja" sin tener caja abierta.
--
-- No toca datos existentes. Después de desplegar el frontend nuevo se puede
-- ejecutar 25_forzar_idempotencia.sql (opcional) para cerrar las llamadas directas.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Registro de operaciones idempotentes
-- ---------------------------------------------------------------------
create table if not exists public.operaciones_idempotentes (
  usuario_id   uuid        not null,
  request_id   uuid        not null,
  funcion      text        not null,
  payload_hash text        not null,
  respuesta    jsonb,
  creado       timestamptz not null default now(),
  primary key (usuario_id, request_id)
);
create index if not exists operaciones_idempotentes_creado_idx on public.operaciones_idempotentes (creado);
alter table public.operaciones_idempotentes enable row level security;
revoke all on public.operaciones_idempotentes from anon, authenticated;

-- Funciones que pueden ejecutarse a través del envoltorio (lista cerrada)
create or replace function public._mutaciones_permitidas()
returns text[] language sql immutable as $$
  select array[
    'registrar_venta','anular_venta','cambiar_metodo_pago',
    'abrir_caja','abrir_mi_caja','crear_caja','cerrar_caja','registrar_egreso',
    'registrar_egreso_general','actualizar_egreso',
    'registrar_compra','registrar_compra_completa','recibir_compra','anular_compra',
    'crear_producto','actualizar_producto','ajustar_stock_producto',
    'ajustar_almacen','fijar_almacen','mover_almacen_tienda','enviar_a_sede',
    'crear_sede','actualizar_sede',
    'guardar_cliente','desactivar_cliente','crear_proveedor','guardar_permisos_rol','crear_rol',
    'backup_registrar','backup_aplicar','backup_cancelar'
  ]
$$;

-- ---------------------------------------------------------------------
-- 2) Envoltorio: ejecuta UNA vez por (usuario, request_id)
-- ---------------------------------------------------------------------
create or replace function public.ejecutar_idempotente(p_request_id uuid, p_fn text, p_args jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_hash  text;
  v_prev  public.operaciones_idempotentes%rowtype;
  v_proc  record;
  v_lista text := '';
  v_k     text;
  v_idx   int;
  v_sql   text;
  v_res   jsonb;
  v_val   text;
begin
  if v_uid is null then
    raise exception 'Sesión no válida. Vuelve a iniciar sesión.' using errcode = '42501';
  end if;
  if p_request_id is null then raise exception 'Falta el identificador de la operación (request_id).' using errcode = '22023'; end if;
  if not (p_fn = any (public._mutaciones_permitidas())) then
    raise exception 'Operación no permitida: %.', p_fn using errcode = '42501';
  end if;
  p_args := coalesce(p_args, '{}'::jsonb);
  if jsonb_typeof(p_args) <> 'object' then raise exception 'Los argumentos deben ser un objeto.' using errcode = '22023'; end if;

  v_hash := md5(p_fn || '|' || p_args::text);

  -- Serializa llamadas simultáneas con el mismo request_id (doble clic, otra pestaña, reintento)
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':' || p_request_id::text, 0));

  select * into v_prev from public.operaciones_idempotentes where usuario_id = v_uid and request_id = p_request_id;
  if found then
    if v_prev.payload_hash <> v_hash then
      raise exception 'Este identificador de operación ya se usó con datos distintos.' using errcode = 'P0409';
    end if;
    return jsonb_build_object('repetida', true, 'respuesta', v_prev.respuesta);
  end if;

  -- Resuelve la función (única sobrecarga con más parámetros)
  select p.oid, p.proargnames, p.proargtypes::oid[] as tipos, p.prorettype, p.pronargs
    into v_proc
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = p_fn
   order by p.pronargs desc limit 1;
  if v_proc.oid is null then raise exception 'La operación % no existe.', p_fn using errcode = '42883'; end if;

  for v_k in select jsonb_object_keys(p_args) loop
    v_idx := array_position(v_proc.proargnames, v_k);
    if v_idx is null or v_idx > v_proc.pronargs then
      raise exception 'Argumento desconocido "%" para %.', v_k, p_fn using errcode = '22023';
    end if;
    v_val := p_args ->> v_k;
    -- los arreglos JSON ([..]) se convierten a arreglos de Postgres ({..}) cuando el parámetro es text[], uuid[], etc.
    if jsonb_typeof(p_args -> v_k) = 'array' and format_type(v_proc.tipos[v_idx - 1], null) like '%[]' then
      select coalesce('{' || string_agg('"' || replace(replace(x, '\', '\\'), '"', '\"') || '"', ',') || '}', '{}')
        into v_val from jsonb_array_elements_text(p_args -> v_k) x;
    end if;
    v_lista := v_lista || case when v_lista = '' then '' else ', ' end
      || format('%I := %L::%s', v_k, v_val, format_type(v_proc.tipos[v_idx - 1], null));
  end loop;

  if v_proc.prorettype = 'void'::regtype then
    execute format('select public.%I(%s)', p_fn, v_lista);
    v_res := null;
  else
    execute format('select to_jsonb(public.%I(%s))', p_fn, v_lista) into v_res;
  end if;

  insert into public.operaciones_idempotentes (usuario_id, request_id, funcion, payload_hash, respuesta)
  values (v_uid, p_request_id, p_fn, v_hash, v_res);

  -- limpieza oportunista (>30 días)
  delete from public.operaciones_idempotentes where creado < now() - interval '30 days';

  return jsonb_build_object('repetida', false, 'respuesta', v_res);
end;
$$;

-- "Verificar estado": ¿esta operación llegó a completarse?
create or replace function public.consultar_operacion(p_request_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare v_uid uuid := auth.uid(); r public.operaciones_idempotentes%rowtype;
begin
  if v_uid is null then raise exception 'Sesión no válida. Vuelve a iniciar sesión.' using errcode = '42501'; end if;
  select * into r from public.operaciones_idempotentes where usuario_id = v_uid and request_id = p_request_id;
  if not found then return jsonb_build_object('estado', 'no_encontrada'); end if;
  return jsonb_build_object('estado', 'completada', 'funcion', r.funcion, 'respuesta', r.respuesta, 'creado', r.creado);
end;
$$;

-- ---------------------------------------------------------------------
-- 3) Pasos sueltos que ahora son una sola transacción
-- ---------------------------------------------------------------------
create or replace function public.crear_proveedor(p_nombre text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_id uuid; v_n text := trim(coalesce(p_nombre, ''));
begin
  perform public.exigir_permiso('compras.crear');
  if length(v_n) < 2 then raise exception 'Escribe el nombre del proveedor.'; end if;
  select id into v_id from public.proveedores where lower(trim(nombre)) = lower(v_n) order by activo desc limit 1;
  if v_id is not null then
    update public.proveedores set activo = true where id = v_id and not activo;
    return v_id;
  end if;
  insert into public.proveedores (nombre) values (v_n) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.guardar_cliente(p_id uuid, p_datos jsonb)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid := p_id;
  v_nombre text := trim(coalesce(p_datos ->> 'nombre', ''));
  v_tipo text := coalesce(nullif(p_datos ->> 'tipo', ''), 'regular');
begin
  if length(v_nombre) < 2 then raise exception 'El nombre del cliente es obligatorio.'; end if;
  if v_tipo not in ('regular','vip') then raise exception 'Tipo de cliente no válido.'; end if;
  if v_id is null then
    perform public.exigir_permiso('clientes.crear');
    insert into public.clientes (nombre, documento, telefono, email, direccion, tipo, created_by)
    values (v_nombre, nullif(trim(p_datos ->> 'documento'), ''), nullif(trim(p_datos ->> 'telefono'), ''),
            nullif(trim(p_datos ->> 'email'), ''), nullif(trim(p_datos ->> 'direccion'), ''), v_tipo, auth.uid())
    returning id into v_id;
  else
    if not public.tiene_algun_permiso(array['clientes.editar','clientes.eliminar']) then
      raise exception 'No tienes permiso para editar clientes.' using errcode = '42501';
    end if;
    update public.clientes set nombre = v_nombre, documento = nullif(trim(p_datos ->> 'documento'), ''),
           telefono = nullif(trim(p_datos ->> 'telefono'), ''), email = nullif(trim(p_datos ->> 'email'), ''),
           direccion = nullif(trim(p_datos ->> 'direccion'), ''), tipo = v_tipo, updated_at = now()
     where id = v_id;
    if not found then raise exception 'El cliente no existe.'; end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.desactivar_cliente(p_id uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
begin
  if not public.tiene_algun_permiso(array['clientes.eliminar']) then
    raise exception 'No tienes permiso para eliminar clientes.' using errcode = '42501';
  end if;
  update public.clientes set activo = false, updated_at = now() where id = p_id;
  return p_id;
end;
$$;

create or replace function public.crear_rol(p_nombre text, p_descripcion text, p_nivel int)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  perform public.exigir_permiso('roles.gestionar');
  if p_nivel is null or p_nivel > public.nivel_usuario() then
    raise exception 'No puedes crear un rol de nivel superior al tuyo.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_nombre, ''))) < 2 then raise exception 'El nombre del rol es obligatorio.'; end if;
  insert into public.roles (nombre, descripcion, nivel, es_sistema) values (trim(p_nombre), p_descripcion, p_nivel, false)
  returning id into v_id;
  return v_id;
end;
$$;

-- Reemplaza los permisos del rol en UNA transacción (antes: delete + insert separados)
create or replace function public.guardar_permisos_rol(p_rol uuid, p_permisos text[])
returns int
language plpgsql security definer set search_path = public
as $$
declare r public.roles%rowtype;
begin
  perform public.exigir_permiso('roles.gestionar');
  select * into r from public.roles where id = p_rol for update;
  if not found then raise exception 'El rol no existe.'; end if;
  if r.nombre = 'Administrador' or r.nivel > public.nivel_usuario() then
    raise exception 'No puedes modificar los permisos de este rol.' using errcode = '42501';
  end if;
  delete from public.rol_permisos where rol_id = p_rol and not (permiso_codigo = any (coalesce(p_permisos, '{}')));
  insert into public.rol_permisos (rol_id, permiso_codigo)
  select p_rol, p.codigo from public.permisos p where p.codigo = any (coalesce(p_permisos, '{}'))
  on conflict do nothing;
  return coalesce(array_length(p_permisos, 1), 0);
end;
$$;

-- Compra completa: proveedor (existente o nuevo) + productos nuevos + compra, TODO o NADA.
--   p_items: [{producto_id?, nombre, cantidad, precio}]  (sin producto_id => se busca por nombre o se crea)
drop function if exists public.registrar_compra_completa(uuid, uuid, text, text, timestamptz, jsonb, boolean, text);
create or replace function public.registrar_compra_completa(
  p_sede            uuid,
  p_proveedor_nombre text,
  p_comprobante     text,
  p_fecha           timestamptz,
  p_items           jsonb,
  p_proveedor_id    uuid default null,
  p_recibida        boolean default true,
  p_observaciones   text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_prov uuid := p_proveedor_id; e jsonb; v_prod uuid; v_nombre text; v_precio numeric;
  v_items jsonb := '[]'::jsonb; v_cod text;
begin
  perform public.exigir_permiso('compras.crear');
  perform public.exigir_sede(p_sede);
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Agrega al menos un producto a la compra.';
  end if;
  if v_prov is null then v_prov := public.crear_proveedor(p_proveedor_nombre); end if;

  for e in select * from jsonb_array_elements(p_items) loop
    v_prod := nullif(e ->> 'producto_id', '')::uuid;
    v_nombre := trim(coalesce(e ->> 'nombre', ''));
    v_precio := coalesce((e ->> 'precio')::numeric, (e ->> 'precio_compra')::numeric);
    if v_prod is null then
      if length(v_nombre) < 2 then raise exception 'Hay un producto sin nombre en la compra.'; end if;
      select id into v_prod from public.productos
       where sede_id = p_sede and lower(trim(nombre)) = lower(v_nombre) order by activo desc limit 1;
      if v_prod is null then
        loop
          v_cod := 'N' || upper(substr(md5(gen_random_uuid()::text), 1, 8));
          exit when not exists (select 1 from public.productos where sede_id = p_sede and codigo = v_cod);
        end loop;
        v_prod := public.crear_producto(
          jsonb_build_object('codigo', v_cod, 'nombre', v_nombre, 'precio_venta', coalesce(v_precio, 0),
                             'precio_compra', coalesce(v_precio, 0), 'unidad', 'Unidad', 'stock_minimo', 0, 'activo', true),
          p_sede, 0);
      end if;
    end if;
    v_items := v_items || jsonb_build_object('producto_id', v_prod, 'cantidad', e -> 'cantidad', 'precio_compra', v_precio);
  end loop;

  return public.registrar_compra(p_sede, v_prov, p_comprobante, p_fecha, v_items, coalesce(p_recibida, true), p_observaciones);
end;
$$;

-- ---------------------------------------------------------------------
-- 4) Corrección: abrir_mi_caja (doble caja)
--    Dos clics / dos pestañas / un reintento simultáneo podían pasar la
--    verificación "ya tengo una abierta" a la vez y crear dos cajas.
--    Ahora se serializa por usuario+sede.
-- ---------------------------------------------------------------------
create or replace function public.abrir_mi_caja(p_sede uuid, p_monto_apertura numeric default 0)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_n int; v_caja uuid; v_abierta text;
begin
  perform public.exigir_permiso('cajas.abrir');
  perform public.exigir_sede(p_sede);
  if coalesce(p_monto_apertura, 0) < 0 then raise exception 'El monto de apertura no puede ser negativo.'; end if;

  perform pg_advisory_xact_lock(hashtextextended('abrir_mi_caja:' || v_uid::text || ':' || p_sede::text, 0));

  select c.nombre into v_abierta
    from public.caja_sesiones s join public.cajas c on c.id = s.caja_id
   where s.sede_id = p_sede and s.usuario_id = v_uid and s.estado = 'abierta' limit 1;
  if found then
    raise exception 'Ya tienes abierta la %. Ciérrala antes de abrir otra.', v_abierta;
  end if;

  insert into public.caja_correlativos (sede_id, ultimo)
  select p_sede, coalesce(max((substring(nombre from '(\d{1,6})\s*$'))::int), 0)
    from public.cajas where sede_id = p_sede
  on conflict (sede_id) do nothing;

  loop
    update public.caja_correlativos set ultimo = ultimo + 1 where sede_id = p_sede returning ultimo into v_n;
    exit when not exists (select 1 from public.cajas where sede_id = p_sede and lower(nombre) = lower('Caja ' || v_n));
  end loop;

  insert into public.cajas (sede_id, nombre) values (p_sede, 'Caja ' || v_n) returning id into v_caja;
  return public.abrir_caja(v_caja, coalesce(p_monto_apertura, 0));
end;
$$;

-- Red de seguridad en BD: un usuario no puede tener 2 cajas abiertas en la misma sede.
-- (solo se crea si hoy no hay usuarios con dos abiertas; si las hay, se avisa y se omite)
do $$
begin
  if exists (select 1 from public.caja_sesiones where estado = 'abierta' group by usuario_id, sede_id having count(*) > 1) then
    raise notice 'Hay usuarios con más de una caja abierta en la misma sede: cierra las sobrantes y vuelve a ejecutar este script para activar el índice único.';
  else
    create unique index if not exists caja_sesion_abierta_usuario_sede_uq
      on public.caja_sesiones (usuario_id, sede_id) where estado = 'abierta';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 5) Corrección: egreso "descontar de mi caja" sin caja abierta
--    Antes se guardaba igual, sin descontar de ninguna caja, y el usuario
--    creía que sí. Ahora se rechaza con un mensaje claro.
-- ---------------------------------------------------------------------
create or replace function public.registrar_egreso_general(
  p_sede                uuid,
  p_fecha               date,
  p_categoria           text,
  p_concepto            text,
  p_proveedor           text,
  p_monto               numeric,
  p_tipo_documento      text default null,
  p_numero_documento    text default null,
  p_observaciones       text default null,
  p_descontar_caja      boolean default true,
  p_proveedor_documento text default null,
  p_foto                text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_ses public.caja_sesiones%rowtype; v_id uuid;
begin
  if not public.tiene_algun_permiso(array['compras.crear','cajas.egresos']) then
    raise exception 'No tienes permiso para registrar egresos.' using errcode = '42501';
  end if;
  perform public.exigir_sede(p_sede);
  if length(trim(coalesce(p_concepto, ''))) < 2 and length(trim(coalesce(p_proveedor, ''))) < 2 then
    raise exception 'Escribe la descripción o el proveedor del egreso.';
  end if;
  if p_monto is null or p_monto <= 0 then raise exception 'El monto del egreso debe ser mayor a cero.'; end if;
  if p_categoria is null then raise exception 'Elige la categoría del egreso.'; end if;
  if p_categoria = 'Compra de insumos' then
    raise exception 'Las compras de insumos se registran en la pestaña "Compras de insumos".';
  end if;

  if coalesce(p_descontar_caja, false) then
    select * into v_ses from public.caja_sesiones
     where sede_id = p_sede and usuario_id = v_uid and estado = 'abierta'
     order by fecha_apertura desc limit 1 for share;
    if not found then
      raise exception 'No tienes una caja abierta en esta sede. Abre tu caja o desmarca "Descontar de mi caja abierta".'
        using errcode = 'P0422';
    end if;
  end if;

  insert into public.caja_egresos (sesion_id, caja_id, sede_id, concepto, monto, usuario_id, usuario_nombre,
                                   categoria, proveedor, tipo_documento, numero_documento, observaciones, fecha_egreso,
                                   proveedor_documento, foto_comprobante)
  values (v_ses.id, v_ses.caja_id, p_sede, coalesce(nullif(trim(p_concepto), ''), trim(p_proveedor)), p_monto, v_uid,
          public.nombre_usuario(v_uid), p_categoria, nullif(trim(p_proveedor), ''), nullif(trim(p_tipo_documento), ''),
          nullif(trim(p_numero_documento), ''), nullif(trim(p_observaciones), ''),
          coalesce(p_fecha, public.fecha_negocio(now())), nullif(trim(p_proveedor_documento), ''), nullif(p_foto, ''))
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 5b) El registro de request_id NO forma parte del backup: es un libro operativo.
--     Así las copias anteriores a este script siguen siendo restaurables y una
--     restauración no borra los request_id (un reintento tardío sigue sin duplicar).
-- ---------------------------------------------------------------------
create or replace function public._backup_lista()
returns text[]
language sql stable security definer set search_path = public
as $$
  select coalesce(array_agg(c.relname::text order by c.relname), '{}')
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and c.relname not in ('backup_historial', 'backup_staging', 'operaciones_idempotentes');
$$;

-- ---------------------------------------------------------------------
-- 6) Permisos de ejecución
-- ---------------------------------------------------------------------
revoke all on function
  public._mutaciones_permitidas(),
  public.ejecutar_idempotente(uuid, text, jsonb),
  public.consultar_operacion(uuid),
  public.crear_proveedor(text),
  public.guardar_cliente(uuid, jsonb),
  public.desactivar_cliente(uuid),
  public.crear_rol(text, text, int),
  public.guardar_permisos_rol(uuid, text[]),
  public.registrar_compra_completa(uuid, text, text, timestamptz, jsonb, uuid, boolean, text),
  public.abrir_mi_caja(uuid, numeric),
  public.registrar_egreso_general(uuid, date, text, text, text, numeric, text, text, text, boolean, text, text)
  from public;
grant execute on function
  public.ejecutar_idempotente(uuid, text, jsonb),
  public.consultar_operacion(uuid),
  public.crear_proveedor(text),
  public.guardar_cliente(uuid, jsonb),
  public.desactivar_cliente(uuid),
  public.crear_rol(text, text, int),
  public.guardar_permisos_rol(uuid, text[]),
  public.registrar_compra_completa(uuid, text, text, timestamptz, jsonb, uuid, boolean, text),
  public.abrir_mi_caja(uuid, numeric),
  public.registrar_egreso_general(uuid, date, text, text, text, numeric, text, text, text, boolean, text, text)
  to authenticated;
