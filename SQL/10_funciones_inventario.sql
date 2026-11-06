-- =====================================================================
-- 10_funciones_inventario.sql
-- ÚNICO punto de entrada para modificar stock: registrar_movimiento().
-- Sobre él se construyen ajustes, traspasos, alta/edición de productos.
-- =====================================================================

-- ---------------------------------------------------------------------
-- registrar_movimiento (INTERNA): cambia el stock y deja el historial.
-- No es invocable por usuarios; la usan las demás funciones del sistema.
-- ---------------------------------------------------------------------
create or replace function public.registrar_movimiento(
  p_sede         uuid,
  p_producto     uuid,
  p_delta        numeric,           -- + entra / - sale
  p_tipo         text,              -- entrada | salida | traspaso | ajuste
  p_operacion    text,
  p_motivo       text    default null,
  p_referencia   text    default null,
  p_contraparte  uuid    default null,
  p_venta        uuid    default null,
  p_compra       uuid    default null,
  p_traspaso     uuid    default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_antes   numeric;
  v_despues numeric;
  v_id      uuid;
  v_prod    text;
  v_uid     uuid := auth.uid();
begin
  if p_delta is null or p_delta = 0 then
    raise exception 'La cantidad del movimiento no puede ser cero.';
  end if;

  perform set_config('app.mov_ok', 'on', true);

  select stock into v_antes
    from public.stock_sede
   where producto_id = p_producto and sede_id = p_sede
   for update;

  if not found then
    insert into public.stock_sede (producto_id, sede_id, stock) values (p_producto, p_sede, 0);
    v_antes := 0;
  end if;

  v_despues := v_antes + p_delta;
  if v_despues < 0 then
    select nombre into v_prod from public.productos where id = p_producto;
    raise exception 'Stock insuficiente de "%": disponible %, solicitado %.',
      v_prod, v_antes, abs(p_delta) using errcode = '23514';
  end if;

  update public.stock_sede
     set stock = v_despues, updated_at = now()
   where producto_id = p_producto and sede_id = p_sede;

  insert into public.movimientos_almacen (
    sede_id, producto_id, tipo, operacion, cantidad, stock_antes, stock_despues,
    motivo, referencia, usuario_id, usuario_nombre, sede_contraparte_id,
    venta_id, compra_id, traspaso_id)
  values (
    p_sede, p_producto, p_tipo, p_operacion, p_delta, v_antes, v_despues,
    nullif(trim(p_motivo), ''), p_referencia, v_uid, public.nombre_usuario(v_uid), p_contraparte,
    p_venta, p_compra, p_traspaso)
  returning id into v_id;

  perform set_config('app.mov_ok', 'off', true);
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- ajustar_stock: agregar / descontar stock manualmente CON MOTIVO.
--   p_operacion: ingreso_manual | ajuste_manual | merma | devolucion
--   p_delta: positivo suma, negativo resta (merma siempre resta)
-- ---------------------------------------------------------------------
create or replace function public.ajustar_stock(
  p_sede      uuid,
  p_producto  uuid,
  p_delta     numeric,
  p_operacion text,
  p_motivo    text
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_ref text; v_serie text; v_corr int; v_tipo text; v_delta numeric := p_delta;
begin
  perform public.exigir_permiso('almacen.ajustar');
  perform public.exigir_sede(p_sede);

  if p_operacion not in ('ingreso_manual','ajuste_manual','merma','devolucion') then
    raise exception 'Operación de ajuste no válida: %', p_operacion;
  end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Debes indicar el motivo del ajuste.';
  end if;
  if p_delta is null or p_delta = 0 then
    raise exception 'La cantidad debe ser distinta de cero.';
  end if;
  if p_operacion in ('ingreso_manual','devolucion') and p_delta < 0 then
    raise exception 'Para esta operación la cantidad debe ser positiva.';
  end if;
  if p_operacion = 'merma' then v_delta := -abs(p_delta); end if;

  v_tipo := case when p_operacion in ('ingreso_manual','devolucion') then 'entrada' else 'ajuste' end;
  select o_serie, o_correlativo into v_serie, v_corr from public.siguiente_correlativo(p_sede, 'ajuste');
  v_ref := v_serie || '-' || lpad(v_corr::text, 6, '0');

  return public.registrar_movimiento(p_sede, p_producto, v_delta, v_tipo, p_operacion, p_motivo, v_ref);
end;
$$;

-- ---------------------------------------------------------------------
-- fijar_stock: conteo físico. Deja el stock exactamente en p_nuevo_stock.
-- ---------------------------------------------------------------------
create or replace function public.fijar_stock(
  p_sede        uuid,
  p_producto    uuid,
  p_nuevo_stock numeric,
  p_motivo      text
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_actual numeric; v_serie text; v_corr int;
begin
  perform public.exigir_permiso('almacen.ajustar');
  perform public.exigir_sede(p_sede);

  if p_nuevo_stock is null or p_nuevo_stock < 0 then
    raise exception 'El stock contado no puede ser negativo.';
  end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Debes indicar el motivo del ajuste.';
  end if;

  select stock into v_actual from public.stock_sede
   where producto_id = p_producto and sede_id = p_sede for update;
  v_actual := coalesce(v_actual, 0);
  if p_nuevo_stock = v_actual then return null; end if;

  select o_serie, o_correlativo into v_serie, v_corr from public.siguiente_correlativo(p_sede, 'ajuste');
  return public.registrar_movimiento(p_sede, p_producto, p_nuevo_stock - v_actual, 'ajuste',
           'conteo_fisico', p_motivo, v_serie || '-' || lpad(v_corr::text, 6, '0'));
end;
$$;

-- ---------------------------------------------------------------------
-- traspasar: mueve stock de una sede a otra (2 movimientos enlazados).
--   p_items: [{"producto_id": "...", "cantidad": 5}, ...]
-- ---------------------------------------------------------------------
create or replace function public.traspasar(
  p_origen  uuid,
  p_destino uuid,
  p_items   jsonb,
  p_observaciones text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid; v_serie text; v_corr int; v_num text;
  r record; v_uid uuid := auth.uid();
begin
  perform public.exigir_permiso('almacen.traspasar');
  perform public.exigir_sede(p_origen);
  if p_origen = p_destino then raise exception 'La sede de origen y destino deben ser distintas.'; end if;
  if not exists (select 1 from public.sedes where id = p_destino and activa) then
    raise exception 'La sede de destino no existe o está inactiva.';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Agrega al menos un producto al traspaso.';
  end if;

  select o_serie, o_correlativo into v_serie, v_corr from public.siguiente_correlativo(p_origen, 'traspaso');
  v_num := v_serie || '-' || lpad(v_corr::text, 6, '0');

  insert into public.traspasos (numero, sede_origen_id, sede_destino_id, usuario_id, usuario_nombre, observaciones)
  values (v_num, p_origen, p_destino, v_uid, public.nombre_usuario(v_uid), nullif(trim(p_observaciones), ''))
  returning id into v_id;

  for r in
    select (e ->> 'producto_id')::uuid as producto_id, sum((e ->> 'cantidad')::numeric) as cantidad
      from jsonb_array_elements(p_items) e
     group by 1 order by 1
  loop
    if r.cantidad is null or r.cantidad <= 0 then raise exception 'Cantidad de traspaso no válida.'; end if;

    insert into public.traspaso_items (traspaso_id, producto_id, cantidad) values (v_id, r.producto_id, r.cantidad);

    perform public.registrar_movimiento(p_origen,  r.producto_id, -r.cantidad, 'traspaso', 'traspaso_salida',
              nullif(trim(p_observaciones), ''), v_num, p_destino, null, null, v_id);
    perform public.registrar_movimiento(p_destino, r.producto_id,  r.cantidad, 'traspaso', 'traspaso_entrada',
              nullif(trim(p_observaciones), ''), v_num, p_origen,  null, null, v_id);
  end loop;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- crear_producto: alta del producto + stock inicial (con movimiento)
--   p_datos: {codigo, nombre, descripcion, categoria_id, precio_venta,
--             precio_compra, unidad, stock_minimo, activo}
-- ---------------------------------------------------------------------
create or replace function public.crear_producto(
  p_datos         jsonb,
  p_sede          uuid    default null,
  p_stock_inicial numeric default 0
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  perform public.exigir_permiso('productos.crear');

  if length(trim(coalesce(p_datos ->> 'codigo', ''))) = 0 then raise exception 'El código es obligatorio.'; end if;
  if length(trim(coalesce(p_datos ->> 'nombre', ''))) < 2 then raise exception 'El nombre es obligatorio.'; end if;
  if exists (select 1 from public.productos where codigo = trim(p_datos ->> 'codigo')) then
    raise exception 'Ya existe un producto con el código %.', trim(p_datos ->> 'codigo');
  end if;

  insert into public.productos (codigo, nombre, descripcion, categoria_id, precio_venta, precio_compra,
                                unidad, stock_minimo, activo, created_by)
  values (trim(p_datos ->> 'codigo'), trim(p_datos ->> 'nombre'), nullif(trim(p_datos ->> 'descripcion'), ''),
          nullif(p_datos ->> 'categoria_id', '')::uuid,
          coalesce((p_datos ->> 'precio_venta')::numeric, 0),
          coalesce((p_datos ->> 'precio_compra')::numeric, 0),
          coalesce(nullif(p_datos ->> 'unidad', ''), 'Unidad'),
          coalesce((p_datos ->> 'stock_minimo')::numeric, 0),
          coalesce((p_datos ->> 'activo')::boolean, true),
          auth.uid())
  returning id into v_id;

  if coalesce(p_stock_inicial, 0) > 0 then
    perform public.exigir_sede(p_sede);
    perform public.exigir_permiso('almacen.ajustar');
    perform public.registrar_movimiento(p_sede, v_id, p_stock_inicial, 'entrada', 'stock_inicial',
              'Stock inicial al registrar el producto', 'INICIAL');
  end if;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- actualizar_producto: edita datos. Cambiar precios exige permiso propio;
-- cambiar el stock de una sede exige permiso + MOTIVO y queda en el historial.
-- ---------------------------------------------------------------------
create or replace function public.actualizar_producto(
  p_id          uuid,
  p_datos       jsonb,
  p_sede        uuid    default null,
  p_nuevo_stock numeric default null,
  p_motivo      text    default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_old public.productos%rowtype;
  v_actual numeric;
  v_nuevo_pv numeric; v_nuevo_pc numeric;
begin
  perform public.exigir_permiso('productos.editar');

  select * into v_old from public.productos where id = p_id for update;
  if not found then raise exception 'El producto no existe.'; end if;

  v_nuevo_pv := coalesce((p_datos ->> 'precio_venta')::numeric,  v_old.precio_venta);
  v_nuevo_pc := coalesce((p_datos ->> 'precio_compra')::numeric, v_old.precio_compra);
  if v_nuevo_pv is distinct from v_old.precio_venta or v_nuevo_pc is distinct from v_old.precio_compra then
    perform public.exigir_permiso('productos.editar_precio');
  end if;
  if p_datos ? 'activo' and (p_datos ->> 'activo')::boolean is distinct from v_old.activo then
    perform public.exigir_permiso('productos.eliminar');
  end if;
  if p_datos ? 'codigo' and trim(p_datos ->> 'codigo') <> v_old.codigo
     and exists (select 1 from public.productos where codigo = trim(p_datos ->> 'codigo') and id <> p_id) then
    raise exception 'Ya existe otro producto con el código %.', trim(p_datos ->> 'codigo');
  end if;

  update public.productos set
    codigo        = case when p_datos ? 'codigo'       then trim(p_datos ->> 'codigo')       else codigo end,
    nombre        = case when p_datos ? 'nombre'       then trim(p_datos ->> 'nombre')       else nombre end,
    descripcion   = case when p_datos ? 'descripcion'  then nullif(trim(p_datos ->> 'descripcion'), '') else descripcion end,
    categoria_id  = case when p_datos ? 'categoria_id' then nullif(p_datos ->> 'categoria_id', '')::uuid else categoria_id end,
    precio_venta  = v_nuevo_pv,
    precio_compra = v_nuevo_pc,
    unidad        = case when p_datos ? 'unidad'       then p_datos ->> 'unidad'             else unidad end,
    stock_minimo  = case when p_datos ? 'stock_minimo' then (p_datos ->> 'stock_minimo')::numeric else stock_minimo end,
    activo        = case when p_datos ? 'activo'       then (p_datos ->> 'activo')::boolean  else activo end
  where id = p_id;

  if p_nuevo_stock is not null and p_sede is not null then
    perform public.exigir_sede(p_sede);
    select stock into v_actual from public.stock_sede where producto_id = p_id and sede_id = p_sede for update;
    v_actual := coalesce(v_actual, 0);
    if p_nuevo_stock <> v_actual then
      perform public.exigir_permiso('almacen.ajustar');
      if length(trim(coalesce(p_motivo, ''))) < 3 then
        raise exception 'Para modificar el stock debes indicar el motivo del cambio.';
      end if;
      if p_nuevo_stock < 0 then raise exception 'El stock no puede ser negativo.'; end if;
      perform public.registrar_movimiento(p_sede, p_id, p_nuevo_stock - v_actual, 'ajuste',
                'correccion_producto', p_motivo, 'EDICION');
    end if;
  end if;

  return p_id;
end;
$$;
