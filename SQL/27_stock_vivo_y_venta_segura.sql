-- =====================================================================
-- 27_stock_vivo_y_venta_segura.sql
-- Ventas seguras ante cortes de red + stock en tiempo real.
--   1) registrar_venta: una venta ONLINE también puede consumir primero la reserva de SU caja (p_lease),
--      de modo que el mismo pedido (misma request_id y mismos datos) sirva tanto en línea como al
--      reenviarse desde el dispositivo: un corte justo en medio de la venta ya no puede duplicarla.
--   2) mis_leases_offline: ahora incluye el dispositivo, para que cada equipo reconcilie sus reservas
--      (si se perdió la respuesta al reservar, la reserva "huérfana" se devuelve sola).
--   3) stock_sede_vivo(sede): stock disponible + reservado por producto, liviano para consultar cada pocos segundos.
--   4) stock_sede entra a la publicación Realtime (solo si existe) para avisar los cambios al instante.
-- Idempotente. No toca migraciones anteriores, permisos ni RLS.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) registrar_venta (misma firma que en 26; cambia solo el uso de la reserva)
-- ---------------------------------------------------------------------
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
    if p_lease is not null then
      select * into v_lease from public.stock_leases_offline
       where lease_id = p_lease and producto_id = v_row.producto_id and estado = 'activo'
         and coalesce(p_fecha_offline, now()) <= expira + interval '1 minute'
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
-- 2) Reservas activas del usuario, con el dispositivo que las creó
-- ---------------------------------------------------------------------
create or replace function public.mis_leases_offline()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'lease_id', lease_id, 'sede_id', sede_id, 'caja_id', caja_id, 'producto_id', producto_id,
      'cantidad', cantidad, 'usada', usada, 'devuelta', devuelta, 'estado', estado, 'expira', expira,
      'dispositivo', dispositivo, 'creado', creado)), '[]'::jsonb)
    from public.stock_leases_offline where usuario_id = auth.uid() and estado = 'activo';
$$;

-- ---------------------------------------------------------------------
-- 3) Stock en vivo de una sede: disponible (lo que se puede vender), reservado en cajas y lo reservado por mí
-- ---------------------------------------------------------------------
create or replace function public.stock_sede_vivo(p_sede uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
begin
  perform public.exigir_sede(p_sede);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'producto_id', ss.producto_id,
             'stock', ss.stock,
             'reservado', coalesce(r.total, 0),
             'mio', coalesce(r.mio, 0)))
      from public.stock_sede ss
      left join (
        select producto_id,
               sum(cantidad - usada - devuelta) as total,
               sum(case when usuario_id = auth.uid() then cantidad - usada - devuelta else 0 end) as mio
          from public.stock_leases_offline
         where sede_id = p_sede and estado = 'activo' and expira > now()
         group by producto_id
      ) r on r.producto_id = ss.producto_id
     where ss.sede_id = p_sede
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.stock_sede_vivo(uuid) from public, anon;
grant execute on function public.stock_sede_vivo(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4) Realtime: avisar al instante los cambios de stock (si la publicación existe, p. ej. en Supabase)
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'stock_sede') then
    alter publication supabase_realtime add table public.stock_sede;
  end if;
end $$;
