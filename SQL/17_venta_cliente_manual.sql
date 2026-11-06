-- =====================================================================
-- 17_venta_cliente_manual.sql
-- Permite registrar una venta con los datos del comprador escritos a mano
-- (DNI/RUC + nombre o razon social), sin necesidad de crear un cliente.
-- Ejecutar sobre una base ya creada con 01..16.
-- =====================================================================

drop function if exists public.registrar_venta(uuid, uuid, text, uuid, text, numeric, jsonb, text);

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
  p_cliente_documento  text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ses public.caja_sesiones%rowtype;
  v_cli public.clientes%rowtype;
  v_prod public.productos%rowtype;
  v_row record;
  v_pct numeric := coalesce(p_descuento_pct, 0);
  v_bruto numeric := 0; v_desc numeric; v_total numeric; v_sub numeric; v_igv numeric;
  v_serie text; v_corr int; v_num text; v_venta uuid; v_linea numeric;
  v_cli_nombre text;
  v_cli_doc text;
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
    raise exception 'La caja no pertenece a la sede seleccionada.';
  end if;
  select * into v_ses from public.caja_sesiones where caja_id = p_caja and estado = 'abierta';
  if not found then raise exception 'La caja seleccionada no esta abierta. Abrela para vender.'; end if;

  if p_cliente is not null then
    select * into v_cli from public.clientes where id = p_cliente and activo;
    if not found then raise exception 'El cliente no existe o esta inactivo.'; end if;
  end if;

  -- Los datos escritos en la venta tienen prioridad sobre el cliente elegido.
  v_cli_nombre := nullif(trim(coalesce(p_cliente_nombre, '')), '');
  v_cli_doc := nullif(trim(coalesce(p_cliente_documento, '')), '');
  if v_cli_nombre is null and p_cliente is not null then v_cli_nombre := v_cli.nombre; end if;
  if v_cli_doc is null and p_cliente is not null then v_cli_doc := v_cli.documento; end if;
  v_cli_nombre := coalesce(v_cli_nombre, 'Cliente Varios');

  if p_tipo = 'factura' then
    if coalesce(v_cli_doc, '') = '' then
      raise exception 'La factura requiere el RUC del comprador.';
    end if;
    if v_cli_nombre = 'Cliente Varios' then
      raise exception 'La factura requiere el nombre o razon social del comprador.';
    end if;
  end if;

  -- 1) Validar productos y calcular total (precios SIEMPRE desde la BD)
  for v_row in
    select (e ->> 'producto_id')::uuid as producto_id, sum((e ->> 'cantidad')::numeric) as cantidad
      from jsonb_array_elements(p_items) e group by 1 order by 1
  loop
    if v_row.cantidad is null or v_row.cantidad <= 0 then raise exception 'Cantidad no valida en la venta.'; end if;
    select * into v_prod from public.productos where id = v_row.producto_id;
    if not found or not v_prod.activo then raise exception 'Hay un producto no disponible en la venta.'; end if;
    v_bruto := v_bruto + round(v_prod.precio_venta * v_row.cantidad, 2);
  end loop;

  v_desc  := round(v_bruto * v_pct / 100, 2);
  v_total := v_bruto - v_desc;
  v_sub   := round(v_total / 1.18, 2);
  v_igv   := v_total - v_sub;

  -- 2) Cabecera
  select o_serie, o_correlativo into v_serie, v_corr from public.siguiente_correlativo(p_sede, p_tipo);
  v_num := v_serie || '-' || lpad(v_corr::text, 7, '0');

  insert into public.ventas (
    sede_id, caja_id, caja_sesion_id, tipo_comprobante, serie, correlativo, numero,
    cliente_id, cliente_nombre, cliente_documento, subtotal, igv, descuento_pct, descuento_monto,
    total, metodo_pago, estado, usuario_id, usuario_nombre, notas)
  values (
    p_sede, p_caja, v_ses.id, p_tipo, v_serie, v_corr, v_num,
    p_cliente, v_cli_nombre, v_cli_doc, v_sub, v_igv, v_pct, v_desc,
    v_total, p_metodo_pago, 'pagado', v_uid, public.nombre_usuario(v_uid), nullif(trim(p_notas), ''))
  returning id into v_venta;

  -- 3) Items + salida de stock (cada una queda en el historial de almacen)
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

    perform public.registrar_movimiento(p_sede, v_prod.id, -v_row.cantidad, 'salida', 'venta',
              null, v_num, null, v_venta);
  end loop;

  return jsonb_build_object('id', v_venta, 'numero', v_num, 'total', v_total);
end;
$$;

revoke all on function public.registrar_venta(uuid, uuid, text, uuid, text, numeric, jsonb, text, text, text) from public;
grant execute on function public.registrar_venta(uuid, uuid, text, uuid, text, numeric, jsonb, text, text, text) to authenticated;
