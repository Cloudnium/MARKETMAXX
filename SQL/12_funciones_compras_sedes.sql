-- =====================================================================
-- 12_funciones_compras_sedes.sql
-- Compras a proveedores y administración de sedes.
-- =====================================================================

-- Interna: ingresa al stock los ítems de una compra
create or replace function public._recibir_compra(p_compra uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare c public.compras%rowtype; it record; v_uid uuid := auth.uid();
begin
  select * into c from public.compras where id = p_compra for update;
  if c.estado <> 'pendiente' then raise exception 'La compra % no está pendiente.', c.numero; end if;

  for it in select producto_id, cantidad, precio_compra from public.compra_items
             where compra_id = p_compra order by producto_id loop
    perform public.registrar_movimiento(c.sede_id, it.producto_id, it.cantidad, 'entrada', 'compra',
              null, c.numero, null, null, p_compra);
    update public.productos set precio_compra = it.precio_compra where id = it.producto_id;   -- último costo
  end loop;

  update public.compras set estado = 'recibida', recibida_at = now(), recibida_por = v_uid where id = p_compra;
end;
$$;

-- ---------------------------------------------------------------------
-- registrar_compra
--   p_items: [{"producto_id":"...","cantidad":10,"precio_compra":3.5}]
--   p_recibida: true => ingresa stock de inmediato; false => queda pendiente
-- ---------------------------------------------------------------------
create or replace function public.registrar_compra(
  p_sede        uuid,
  p_proveedor   uuid,
  p_comprobante text,
  p_fecha       timestamptz,
  p_items       jsonb,
  p_recibida    boolean default true,
  p_observaciones text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid(); v_prov public.proveedores%rowtype; v_id uuid;
  v_serie text; v_corr int; v_num text; v_total numeric := 0; v_sub numeric; r record; v_prod public.productos%rowtype;
begin
  perform public.exigir_permiso('compras.crear');
  perform public.exigir_sede(p_sede);
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Agrega al menos un producto a la compra.';
  end if;

  select * into v_prov from public.proveedores where id = p_proveedor and activo;
  if not found then raise exception 'Selecciona un proveedor válido.'; end if;

  select o_serie, o_correlativo into v_serie, v_corr from public.siguiente_correlativo(p_sede, 'compra');
  v_num := v_serie || '-' || lpad(v_corr::text, 6, '0');

  insert into public.compras (sede_id, numero, comprobante_proveedor, proveedor_id, proveedor_nombre, fecha,
                              usuario_id, usuario_nombre, observaciones)
  values (p_sede, v_num, nullif(trim(p_comprobante), ''), v_prov.id, v_prov.nombre,
          coalesce(p_fecha, now()), v_uid, public.nombre_usuario(v_uid), nullif(trim(p_observaciones), ''))
  returning id into v_id;

  for r in
    select (e ->> 'producto_id')::uuid as producto_id,
           sum((e ->> 'cantidad')::numeric) as cantidad,
           max((e ->> 'precio_compra')::numeric) as precio
      from jsonb_array_elements(p_items) e group by 1 order by 1
  loop
    if r.cantidad is null or r.cantidad <= 0 then raise exception 'Cantidad no válida en la compra.'; end if;
    if r.precio is null or r.precio < 0 then raise exception 'Precio de compra no válido.'; end if;
    select * into v_prod from public.productos where id = r.producto_id;
    if not found then raise exception 'Hay un producto inexistente en la compra.'; end if;

    insert into public.compra_items (compra_id, producto_id, producto_nombre, cantidad, precio_compra, subtotal)
    values (v_id, v_prod.id, v_prod.nombre, r.cantidad, r.precio, round(r.cantidad * r.precio, 2));
    v_total := v_total + round(r.cantidad * r.precio, 2);
  end loop;

  v_sub := round(v_total / 1.18, 2);
  update public.compras set total = v_total, subtotal = v_sub, igv = v_total - v_sub where id = v_id;

  if p_recibida then perform public._recibir_compra(v_id); end if;
  return v_id;
end;
$$;

create or replace function public.recibir_compra(p_compra uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_sede uuid;
begin
  perform public.exigir_permiso('compras.crear');
  select sede_id into v_sede from public.compras where id = p_compra;
  if v_sede is null then raise exception 'La compra no existe.'; end if;
  perform public.exigir_sede(v_sede);
  perform public._recibir_compra(p_compra);
  return p_compra;
end;
$$;

-- Anular compra: si ya ingresó stock, lo descuenta (debe haber stock suficiente)
create or replace function public.anular_compra(p_compra uuid, p_motivo text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare c public.compras%rowtype; it record; v_uid uuid := auth.uid();
begin
  perform public.exigir_permiso('compras.anular');
  select * into c from public.compras where id = p_compra for update;
  if not found then raise exception 'La compra no existe.'; end if;
  perform public.exigir_sede(c.sede_id);
  if c.estado = 'anulada' then raise exception 'La compra ya está anulada.'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 5 then
    raise exception 'Indica el motivo de la anulación (mínimo 5 caracteres).';
  end if;

  if c.estado = 'recibida' then
    for it in select producto_id, cantidad from public.compra_items where compra_id = p_compra order by producto_id loop
      perform public.registrar_movimiento(c.sede_id, it.producto_id, -it.cantidad, 'salida', 'anulacion_compra',
                'Anulación de ' || c.numero || ': ' || trim(p_motivo), c.numero, null, null, p_compra);
    end loop;
  end if;

  update public.compras set estado = 'anulada', anulada_at = now(), anulada_por = v_uid,
         motivo_anulacion = trim(p_motivo) where id = p_compra;
  return p_compra;
end;
$$;

-- ---------------------------------------------------------------------
-- SEDES
-- ---------------------------------------------------------------------
create or replace function public.crear_sede(
  p_nombre    text,
  p_codigo    text,
  p_direccion text default null,
  p_telefono  text default null,
  p_ciudad    text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_id uuid; v_uid uuid := auth.uid(); v_cod text := upper(trim(coalesce(p_codigo, '')));
begin
  perform public.exigir_permiso('sedes.crear');
  if length(trim(coalesce(p_nombre, ''))) < 2 then raise exception 'El nombre de la sede es obligatorio.'; end if;
  if v_cod = '' or length(v_cod) > 10 then raise exception 'El código debe tener entre 1 y 10 caracteres.'; end if;
  if exists (select 1 from public.sedes where codigo = v_cod) then raise exception 'Ya existe una sede con el código %.', v_cod; end if;
  if exists (select 1 from public.sedes where lower(nombre) = lower(trim(p_nombre))) then
    raise exception 'Ya existe una sede con ese nombre.';
  end if;

  insert into public.sedes (codigo, nombre, direccion, telefono, ciudad, created_by)
  values (v_cod, trim(p_nombre), nullif(trim(p_direccion), ''), nullif(trim(p_telefono), ''),
          nullif(trim(p_ciudad), ''), v_uid)
  returning id into v_id;

  -- El creador puede trabajar de inmediato en la nueva sede
  insert into public.usuario_sedes (usuario_id, sede_id) values (v_uid, v_id) on conflict do nothing;
  return v_id;
end;
$$;

create or replace function public.actualizar_sede(
  p_id        uuid,
  p_nombre    text,
  p_direccion text,
  p_telefono  text,
  p_ciudad    text,
  p_activa    boolean
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_old public.sedes%rowtype;
begin
  perform public.exigir_permiso('sedes.editar');
  select * into v_old from public.sedes where id = p_id for update;
  if not found then raise exception 'La sede no existe.'; end if;
  if length(trim(coalesce(p_nombre, ''))) < 2 then raise exception 'El nombre de la sede es obligatorio.'; end if;
  if exists (select 1 from public.sedes where lower(nombre) = lower(trim(p_nombre)) and id <> p_id) then
    raise exception 'Ya existe otra sede con ese nombre.';
  end if;

  if v_old.activa and not p_activa then
    if exists (select 1 from public.cajas where sede_id = p_id and estado = 'abierta') then
      raise exception 'No puedes desactivar la sede: tiene cajas abiertas.';
    end if;
    if (select count(*) from public.sedes where activa and id <> p_id) = 0 then
      raise exception 'Debe existir al menos una sede activa.';
    end if;
  end if;

  update public.sedes set nombre = trim(p_nombre), direccion = nullif(trim(p_direccion), ''),
         telefono = nullif(trim(p_telefono), ''), ciudad = nullif(trim(p_ciudad), ''), activa = p_activa
   where id = p_id;
  return p_id;
end;
$$;

-- El usuario elige su sede por defecto (solo entre las que tiene asignadas)
create or replace function public.elegir_sede_predeterminada(p_sede uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.puede_ver_sede(p_sede) then
    raise exception 'No tienes acceso a esa sede.' using errcode = '42501';
  end if;
  update public.perfiles set sede_predeterminada_id = p_sede, ultimo_acceso = now() where id = auth.uid();
end;
$$;

-- Registra el acceso del usuario (se llama al iniciar sesión)
create or replace function public.registrar_acceso()
returns void
language sql security definer set search_path = public
as $$
  update public.perfiles set ultimo_acceso = now() where id = auth.uid();
$$;

-- Asignación de sedes a un usuario (la usa el API de usuarios)
create or replace function public.asignar_sedes_usuario(p_usuario uuid, p_sedes uuid[])
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not (public.tiene_permiso('usuarios.editar') or public.tiene_permiso('usuarios.crear')) then
    raise exception 'No tienes permiso para asignar sedes.' using errcode = '42501';
  end if;
  if not public.validar_gestion_usuario('usuarios.editar', null, p_usuario)
     and not public.validar_gestion_usuario('usuarios.crear', null, p_usuario) then
    raise exception 'No puedes gestionar a un usuario de rango superior al tuyo.' using errcode = '42501';
  end if;

  delete from public.usuario_sedes where usuario_id = p_usuario and not (sede_id = any (coalesce(p_sedes, '{}')));
  insert into public.usuario_sedes (usuario_id, sede_id)
  select p_usuario, s.id from public.sedes s
   where s.id = any (coalesce(p_sedes, '{}'))
  on conflict do nothing;
end;
$$;

-- ---------------------------------------------------------------------
-- actualizar_usuario: edita perfil/rol/estado respetando el rango.
-- (La contraseña y el bloqueo en Auth los maneja el API de servidor.)
-- ---------------------------------------------------------------------
create or replace function public.actualizar_usuario(
  p_id       uuid,
  p_nombre   text,
  p_telefono text,
  p_rol      uuid,
  p_estado   text
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_old public.perfiles%rowtype;
begin
  perform public.exigir_permiso('usuarios.editar');
  select * into v_old from public.perfiles where id = p_id for update;
  if not found then raise exception 'El usuario no existe.'; end if;

  if not public.validar_gestion_usuario('usuarios.editar', p_rol, p_id) then
    raise exception 'No puedes gestionar a un usuario o asignar un rol de rango superior al tuyo.' using errcode = '42501';
  end if;
  if p_estado not in ('activo','inactivo') then raise exception 'Estado no válido.'; end if;
  if length(trim(coalesce(p_nombre, ''))) < 2 then raise exception 'El nombre es obligatorio.'; end if;

  if p_id = auth.uid() and (p_rol is distinct from v_old.rol_id or p_estado <> v_old.estado) then
    raise exception 'No puedes cambiar tu propio rol ni tu estado.';
  end if;
  if p_estado = 'inactivo' and v_old.estado = 'activo' then
    perform public.exigir_permiso('usuarios.eliminar');
  end if;

  update public.perfiles
     set nombre = trim(p_nombre), telefono = nullif(trim(p_telefono), ''), rol_id = p_rol, estado = p_estado
   where id = p_id;
  return p_id;
end;
$$;
