-- =====================================================================
-- 26_ventas_concurrentes_offline.sql  (idempotente; requiere SQL 01-25)
--
-- Ventas simultáneas sin sobreventa, con o sin internet:
--  1) registrar_venta: bloquea el stock con FOR UPDATE en orden de producto_id
--     (sin deadlocks entre ventas), valida precio esperado y puede consumir una
--     RESERVA OFFLINE (lease) de la caja. Nunca deja stock negativo.
--  2) Leases offline: crear_lease_offline() descuenta stock del pool y lo reserva
--     para UNA caja; liquidar_lease() devuelve lo no usado; los leases vencidos
--     devuelven su stock solos (_expirar_leases). Todo queda en el historial de
--     movimientos, así stock = suma de movimientos siempre.
--  3) ejecutar_idempotente reintenta automáticamente los deadlocks (40P01) con
--     la misma request_id.
-- No cambia permisos, RLS ni datos existentes.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0) Nuevas operaciones permitidas en el historial de movimientos
-- ---------------------------------------------------------------------
alter table public.movimientos_almacen drop constraint if exists mov_operacion_valida;
alter table public.movimientos_almacen add constraint mov_operacion_valida check (operacion = any (array[
  'stock_inicial','compra','anulacion_compra','venta','anulacion_venta','traspaso_salida','traspaso_entrada',
  'ingreso_manual','ajuste_manual','conteo_fisico','merma','devolucion','correccion_producto','desde_almacen','a_almacen',
  'reserva_offline','consumo_reserva','devolucion_lease']));

-- ---------------------------------------------------------------------
-- 1) Reservas de stock para venta offline
-- ---------------------------------------------------------------------
create table if not exists public.stock_leases_offline (
  id            uuid primary key default gen_random_uuid(),
  lease_id      uuid not null,                                   -- agrupa los productos de una misma reserva
  sede_id       uuid not null references public.sedes(id) on delete restrict,
  caja_id       uuid not null references public.cajas(id) on delete restrict,
  usuario_id    uuid not null,
  dispositivo   text,
  producto_id   uuid not null references public.productos(id) on delete restrict,
  cantidad      numeric(12,3) not null check (cantidad > 0),     -- reservada
  usada         numeric(12,3) not null default 0 check (usada >= 0),
  devuelta      numeric(12,3) not null default 0 check (devuelta >= 0),
  estado        text not null default 'activo' check (estado in ('activo','liquidado','vencido')),
  creado        timestamptz not null default now(),
  expira        timestamptz not null,
  cerrado_at    timestamptz,
  check (usada + devuelta <= cantidad),
  unique (lease_id, producto_id)
);
create index if not exists stock_leases_activos_idx on public.stock_leases_offline (expira) where estado = 'activo';
create index if not exists stock_leases_prod_idx    on public.stock_leases_offline (sede_id, producto_id) where estado = 'activo';
alter table public.stock_leases_offline enable row level security;
revoke all on public.stock_leases_offline from anon, authenticated;   -- solo se toca vía funciones

-- Devuelve al stock lo no usado de los leases vencidos (opcionalmente de una sede / sin tocar un lease).
create or replace function public._expirar_leases(p_sede uuid default null, p_excepto uuid default null)
returns int
language plpgsql security definer set search_path = public
as $$
declare r record; v_sobra numeric; v_n int := 0;
begin
  for r in
    select id, lease_id, sede_id, producto_id, cantidad, usada, devuelta
      from public.stock_leases_offline
     where estado = 'activo' and expira <= now()
       and (p_sede is null or sede_id = p_sede)
       and (p_excepto is null or lease_id <> p_excepto)
     order by producto_id, id
       for update skip locked
  loop
    v_sobra := r.cantidad - r.usada - r.devuelta;
    if v_sobra > 0 then
      perform public.registrar_movimiento(r.sede_id, r.producto_id, v_sobra, 'entrada', 'devolucion_lease',
                'Reserva offline vencida: stock devuelto', left(r.lease_id::text, 8));
    end if;
    update public.stock_leases_offline
       set estado = 'vencido', devuelta = devuelta + greatest(v_sobra, 0), cerrado_at = now()
     where id = r.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- Reserva stock del pool para UNA caja abierta del usuario. Otras cajas ya no pueden venderlo.
--   p_items: [{producto_id, cantidad}]   Devuelve {lease_id, expira, servidor_ahora, items:[{producto_id, solicitado, otorgado}]}
create or replace function public.crear_lease_offline(
  p_sede uuid, p_caja uuid, p_items jsonb, p_ttl_min int default 480, p_dispositivo text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid(); v_ses public.caja_sesiones%rowtype; v_caja_nombre text;
  v_lease uuid := gen_random_uuid(); v_exp timestamptz; v_row record; v_stock numeric; v_dar numeric;
  v_out jsonb := '[]'::jsonb; v_total numeric := 0;
begin
  perform public.exigir_permiso('ventas.crear');
  perform public.exigir_sede(p_sede);
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Elige al menos un producto para reservar.';
  end if;
  select nombre into v_caja_nombre from public.cajas where id = p_caja and sede_id = p_sede and activa;
  if not found then raise exception 'La caja no pertenece a la sede seleccionada.'; end if;
  select * into v_ses from public.caja_sesiones where caja_id = p_caja and estado = 'abierta';
  if not found then raise exception 'La caja seleccionada no esta abierta. Abrela para reservar stock offline.'; end if;
  if v_ses.usuario_id is distinct from v_uid then
    raise exception 'Solo quien tiene abierta la caja puede reservar stock para ella.' using errcode = '42501';
  end if;

  perform public._expirar_leases(p_sede);
  v_exp := now() + make_interval(mins => least(greatest(coalesce(p_ttl_min, 480), 5), 1440));

  for v_row in
    select (e ->> 'producto_id')::uuid as producto_id, sum((e ->> 'cantidad')::numeric) as cantidad
      from jsonb_array_elements(p_items) e group by 1 order by 1          -- orden fijo: sin deadlocks
  loop
    if v_row.cantidad is null or v_row.cantidad <= 0 then raise exception 'Cantidad no valida en la reserva.'; end if;
    if not exists (select 1 from public.productos where id = v_row.producto_id and sede_id = p_sede and activo) then
      raise exception 'Hay un producto no disponible en la reserva.';
    end if;
    select stock into v_stock from public.stock_sede where producto_id = v_row.producto_id and sede_id = p_sede for update;
    v_dar := least(v_row.cantidad, coalesce(v_stock, 0));
    if v_dar > 0 then
      perform public.registrar_movimiento(p_sede, v_row.producto_id, -v_dar, 'salida', 'reserva_offline',
                'Reserva offline para ' || v_caja_nombre, left(v_lease::text, 8));
      insert into public.stock_leases_offline (lease_id, sede_id, caja_id, usuario_id, dispositivo, producto_id, cantidad, expira)
      values (v_lease, p_sede, p_caja, v_uid, p_dispositivo, v_row.producto_id, v_dar, v_exp);
      v_total := v_total + v_dar;
    end if;
    v_out := v_out || jsonb_build_object('producto_id', v_row.producto_id, 'solicitado', v_row.cantidad, 'otorgado', v_dar);
  end loop;

  if v_total <= 0 then
    raise exception 'No hay stock disponible para reservar.' using errcode = '23514';
  end if;
  return jsonb_build_object('lease_id', v_lease, 'caja_id', p_caja, 'sede_id', p_sede, 'expira', v_exp,
                            'servidor_ahora', now(), 'items', v_out);
end;
$$;

-- Cierra la reserva y devuelve al stock lo que no se vendió. Se puede repetir sin efecto.
create or replace function public.liquidar_lease(p_lease uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid(); r record; v_sobra numeric; v_dev jsonb := '[]'::jsonb; v_usado numeric := 0; v_n int := 0; v_estado text;
begin
  perform public.exigir_permiso('ventas.crear');
  if not exists (select 1 from public.stock_leases_offline where lease_id = p_lease) then
    raise exception 'La reserva offline no existe.';
  end if;
  if not exists (select 1 from public.stock_leases_offline where lease_id = p_lease and usuario_id = v_uid)
     and not public.tiene_permiso('cajas.supervisar') then
    raise exception 'La reserva pertenece a otro usuario.' using errcode = '42501';
  end if;

  for r in
    select id, sede_id, producto_id, cantidad, usada, devuelta, estado
      from public.stock_leases_offline where lease_id = p_lease
     order by producto_id for update
  loop
    v_usado := v_usado + r.usada; v_n := v_n + 1;
    if r.estado = 'activo' then
      v_sobra := r.cantidad - r.usada - r.devuelta;
      if v_sobra > 0 then
        perform public.registrar_movimiento(r.sede_id, r.producto_id, v_sobra, 'entrada', 'devolucion_lease',
                  'Reserva offline liquidada: stock no vendido', left(p_lease::text, 8));
        v_dev := v_dev || jsonb_build_object('producto_id', r.producto_id, 'cantidad', v_sobra);
      end if;
      update public.stock_leases_offline
         set estado = 'liquidado', devuelta = devuelta + greatest(v_sobra, 0), cerrado_at = now() where id = r.id;
    end if;
  end loop;
  select min(estado) into v_estado from public.stock_leases_offline where lease_id = p_lease;
  return jsonb_build_object('lease_id', p_lease, 'estado', v_estado, 'usado', v_usado, 'devuelto', v_dev);
end;
$$;

-- Reservas activas del usuario (para que el dispositivo se re-sincronice)
create or replace function public.mis_leases_offline()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'lease_id', lease_id, 'sede_id', sede_id, 'caja_id', caja_id, 'producto_id', producto_id,
      'cantidad', cantidad, 'usada', usada, 'devuelta', devuelta, 'estado', estado, 'expira', expira)), '[]'::jsonb)
    from public.stock_leases_offline where usuario_id = auth.uid() and estado = 'activo';
$$;

-- ---------------------------------------------------------------------
-- 2) registrar_venta: lock ordenado, precio esperado y consumo de lease
--    (reemplaza la versión de 10 parámetros; los parámetros nuevos son opcionales)
-- ---------------------------------------------------------------------
drop function if exists public.registrar_venta(uuid, uuid, text, uuid, text, numeric, jsonb, text, text, text);

create or replace function public.registrar_venta(
  p_sede               uuid,
  p_caja               uuid,
  p_tipo               text,
  p_cliente            uuid,
  p_metodo_pago        text,
  p_descuento_pct      numeric,
  p_items              jsonb,
  p_notas              text default null,
  p_cliente_nombre     text default null,
  p_cliente_documento  text default null,
  p_lease              uuid default null,          -- reserva offline desde la que se vendió
  p_fecha_offline      timestamptz default null,   -- cuándo se hizo la venta en el dispositivo
  p_aceptar_precio     boolean default false,      -- acepta el precio actual si cambió desde la venta offline
  p_numero_provisional text default null           -- ticket provisional entregado al cliente
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ses public.caja_sesiones%rowtype;
  v_cli public.clientes%rowtype;
  v_prod public.productos%rowtype;
  v_row record;
  v_lease public.stock_leases_offline%rowtype;
  v_pct numeric := coalesce(p_descuento_pct, 0);
  v_bruto numeric := 0; v_desc numeric; v_total numeric; v_sub numeric; v_igv numeric;
  v_serie text; v_corr int; v_num text; v_venta uuid; v_linea numeric;
  v_cli_nombre text; v_cli_doc text; v_fecha timestamptz; v_esperado numeric; v_notas text;
  v_de_lease numeric;
begin
  perform public.exigir_permiso('ventas.crear');
  perform public.exigir_sede(p_sede);

  if p_tipo not in ('factura','boleta','nota_venta') then raise exception 'Tipo de comprobante no valido.'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta no tiene productos.';
  end if;
  if v_pct < 0 or v_pct > 100 then raise exception 'El descuento debe estar entre 0 y 100.'; end if;
  if v_pct > 0 then perform public.exigir_permiso('ventas.descuentos'); end if;
  if not exists (select 1 from public.metodos_pago where nombre = p_metodo_pago and activo) then
    raise exception 'Metodo de pago no valido.';
  end if;

  if not exists (select 1 from public.cajas where id = p_caja and sede_id = p_sede and activa) then
    raise exception 'La caja no pertenece a la sede seleccionada.' using errcode = 'P0422';
  end if;
  select * into v_ses from public.caja_sesiones where caja_id = p_caja and estado = 'abierta';
  if not found then raise exception 'La caja seleccionada no esta abierta. Abrela para vender.' using errcode = 'P0422'; end if;

  if p_cliente is not null then
    select * into v_cli from public.clientes where id = p_cliente and activo;
    if not found then raise exception 'El cliente no existe o esta inactivo.'; end if;
  end if;

  v_cli_nombre := nullif(trim(coalesce(p_cliente_nombre, '')), '');
  v_cli_doc := nullif(trim(coalesce(p_cliente_documento, '')), '');
  if v_cli_nombre is null and p_cliente is not null then v_cli_nombre := v_cli.nombre; end if;
  if v_cli_doc is null and p_cliente is not null then v_cli_doc := v_cli.documento; end if;
  v_cli_nombre := coalesce(v_cli_nombre, 'Cliente Varios');

  if p_tipo = 'factura' then
    if coalesce(v_cli_doc, '') = '' then raise exception 'La factura requiere el RUC del comprador.'; end if;
    if v_cli_nombre = 'Cliente Varios' then raise exception 'La factura requiere el nombre o razon social del comprador.'; end if;
  end if;

  -- Reserva offline: debe ser de esta caja y de este usuario (si no, la venta no la usa)
  if p_lease is not null then
    if not exists (select 1 from public.stock_leases_offline where lease_id = p_lease and caja_id = p_caja and usuario_id = v_uid) then
      raise exception 'La reserva offline no corresponde a esta caja o usuario.' using errcode = 'P0426';
    end if;
  end if;

  -- Devuelve el stock de reservas vencidas (sin tocar la reserva de esta misma venta)
  if exists (select 1 from public.stock_leases_offline where estado = 'activo' and expira <= now() and sede_id = p_sede) then
    perform public._expirar_leases(p_sede, p_lease);
  end if;

  -- 0) BLOQUEO del stock de TODOS los productos, siempre en el mismo orden (producto_id): sin deadlocks entre ventas
  perform 1
    from public.stock_sede ss
   where ss.sede_id = p_sede
     and ss.producto_id in (select (e ->> 'producto_id')::uuid from jsonb_array_elements(p_items) e)
   order by ss.producto_id
     for update;

  -- 1) Validar productos y calcular total (precios SIEMPRE desde la BD)
  for v_row in
    select (e ->> 'producto_id')::uuid as producto_id, sum((e ->> 'cantidad')::numeric) as cantidad,
           max(nullif(e ->> 'precio_esperado', '')::numeric) as precio_esperado
      from jsonb_array_elements(p_items) e group by 1 order by 1
  loop
    if v_row.cantidad is null or v_row.cantidad <= 0 then raise exception 'Cantidad no valida en la venta.'; end if;
    select * into v_prod from public.productos where id = v_row.producto_id;
    if not found or not v_prod.activo then raise exception 'Hay un producto no disponible en la venta.'; end if;
    if v_row.precio_esperado is not null and not coalesce(p_aceptar_precio, false)
       and v_row.precio_esperado is distinct from v_prod.precio_venta then
      raise exception 'El precio de "%" cambio de % a %.', v_prod.nombre, v_row.precio_esperado, v_prod.precio_venta
        using errcode = 'P0424';
    end if;
    v_bruto := v_bruto + round(v_prod.precio_venta * v_row.cantidad, 2);
  end loop;

  v_desc  := round(v_bruto * v_pct / 100, 2);
  v_total := v_bruto - v_desc;
  v_sub   := round(v_total / 1.18, 2);
  v_igv   := v_total - v_sub;

  -- 2) Cabecera (el correlativo se toma al final, con el stock ya bloqueado)
  select o_serie, o_correlativo into v_serie, v_corr from public.siguiente_correlativo(p_sede, p_tipo);
  v_num := v_serie || '-' || lpad(v_corr::text, 7, '0');
  v_fecha := case when p_fecha_offline is null then now()
                  else least(now(), greatest(p_fecha_offline, v_ses.fecha_apertura)) end;
  v_notas := nullif(trim(concat_ws(' · ', nullif(trim(coalesce(p_notas, '')), ''),
                                   case when p_numero_provisional is not null then 'Venta offline ' || p_numero_provisional end)), '');

  insert into public.ventas (
    sede_id, caja_id, caja_sesion_id, tipo_comprobante, serie, correlativo, numero, fecha,
    cliente_id, cliente_nombre, cliente_documento, subtotal, igv, descuento_pct, descuento_monto,
    total, metodo_pago, estado, usuario_id, usuario_nombre, notas)
  values (
    p_sede, p_caja, v_ses.id, p_tipo, v_serie, v_corr, v_num, v_fecha,
    p_cliente, v_cli_nombre, v_cli_doc, v_sub, v_igv, v_pct, v_desc,
    v_total, p_metodo_pago, 'pagado', v_uid, public.nombre_usuario(v_uid), v_notas)
  returning id into v_venta;

  -- 3) Items + salida de stock (lease primero, luego el pool). stock_sede nunca baja de 0 (registrar_movimiento lo exige)
  for v_row in
    select (e ->> 'producto_id')::uuid as producto_id, sum((e ->> 'cantidad')::numeric) as cantidad
      from jsonb_array_elements(p_items) e group by 1 order by 1
  loop
    select * into v_prod from public.productos where id = v_row.producto_id;
    v_linea := round(v_prod.precio_venta * v_row.cantidad, 2);

    insert into public.venta_items (venta_id, producto_id, producto_codigo, producto_nombre, cantidad,
                                    precio_unitario, precio_compra, subtotal)
    values (v_venta, v_prod.id, v_prod.codigo, v_prod.nombre, v_row.cantidad,
            v_prod.precio_venta, v_prod.precio_compra, v_linea);

    v_de_lease := 0;
    if p_lease is not null and p_fecha_offline is not null then
      select * into v_lease from public.stock_leases_offline
       where lease_id = p_lease and producto_id = v_row.producto_id and estado = 'activo'
         and p_fecha_offline <= expira + interval '1 minute'
         for update;
      if found then v_de_lease := least(v_row.cantidad, v_lease.cantidad - v_lease.usada - v_lease.devuelta); end if;
    end if;

    if v_de_lease > 0 then
      -- el stock ya estaba reservado: se "consume la reserva" y se registra la venta (neto 0 en stock, ambos en el historial)
      perform public.registrar_movimiento(p_sede, v_prod.id, v_de_lease, 'entrada', 'consumo_reserva',
                null, v_num, null, v_venta);
      update public.stock_leases_offline set usada = usada + v_de_lease where id = v_lease.id;
    end if;
    perform public.registrar_movimiento(p_sede, v_prod.id, -v_row.cantidad, 'salida', 'venta',
              null, v_num, null, v_venta);
  end loop;

  return jsonb_build_object('id', v_venta, 'numero', v_num, 'total', v_total);
end;
$$;

-- ---------------------------------------------------------------------
-- 3) Lista de mutaciones y envoltorio idempotente con reintento de deadlock
-- ---------------------------------------------------------------------
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
    'backup_registrar','backup_aplicar','backup_cancelar',
    'crear_lease_offline','liquidar_lease'
  ]
$$;

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
  v_res   jsonb;
  v_val   text;
  v_sql   text;
  v_try   int := 0;
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
    if jsonb_typeof(p_args -> v_k) = 'array' and format_type(v_proc.tipos[v_idx - 1], null) like '%[]' then
      select coalesce('{' || string_agg('"' || replace(replace(x, '\', '\\'), '"', '\"') || '"', ',') || '}', '{}')
        into v_val from jsonb_array_elements_text(p_args -> v_k) x;
    end if;
    v_lista := v_lista || case when v_lista = '' then '' else ', ' end
      || format('%I := %L::%s', v_k, v_val, format_type(v_proc.tipos[v_idx - 1], null));
  end loop;

  if v_proc.prorettype = 'void'::regtype then
    v_sql := format('select public.%I(%s)', p_fn, v_lista);
  else
    v_sql := format('select to_jsonb(public.%I(%s))', p_fn, v_lista);
  end if;

  -- Deadlock (40P01): la transacción interna se deshace y se reintenta con la MISMA request_id
  loop
    v_try := v_try + 1;
    begin
      if v_proc.prorettype = 'void'::regtype then
        execute v_sql;
        v_res := null;
      else
        execute v_sql into v_res;
      end if;
      exit;
    exception when deadlock_detected then
      if v_try >= 4 then raise; end if;
      perform pg_sleep(0.05 * v_try + random() * 0.1);
    end;
  end loop;

  insert into public.operaciones_idempotentes (usuario_id, request_id, funcion, payload_hash, respuesta)
  values (v_uid, p_request_id, p_fn, v_hash, v_res);

  delete from public.operaciones_idempotentes where creado < now() - interval '30 days';

  return jsonb_build_object('repetida', false, 'respuesta', v_res);
end;
$$;

-- ---------------------------------------------------------------------
-- 4) Permisos de ejecución
-- ---------------------------------------------------------------------
revoke all on function
  public._expirar_leases(uuid, uuid),
  public.crear_lease_offline(uuid, uuid, jsonb, int, text),
  public.liquidar_lease(uuid),
  public.mis_leases_offline(),
  public.registrar_venta(uuid, uuid, text, uuid, text, numeric, jsonb, text, text, text, uuid, timestamptz, boolean, text),
  public.ejecutar_idempotente(uuid, text, jsonb)
  from public;
grant execute on function
  public.crear_lease_offline(uuid, uuid, jsonb, int, text),
  public.liquidar_lease(uuid),
  public.mis_leases_offline(),
  public.registrar_venta(uuid, uuid, text, uuid, text, numeric, jsonb, text, text, text, uuid, timestamptz, boolean, text),
  public.ejecutar_idempotente(uuid, text, jsonb)
  to authenticated;
