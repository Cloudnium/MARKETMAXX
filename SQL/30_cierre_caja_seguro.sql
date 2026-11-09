-- =====================================================================
-- 30_cierre_caja_seguro.sql  (idempotente; requiere SQL 01-29)
-- Endurece el cierre de caja:
--  1) Carrera cierre/venta/egreso: registrar_venta, registrar_egreso y el egreso automático de una compra
--     toman la sesión de caja con FOR SHARE; cerrar_caja la toma con FOR UPDATE. Así una venta o un gasto
--     nunca se guardan DESPUÉS del cierre (esperan al cierre y son rechazados) y el cierre espera a los que
--     están guardándose, de modo que sus totales siempre los incluyen.
--  2) Tras el cierre, anular una venta o cambiar su método de pago ya actualiza la tarjeta del turno:
--     v_caja_sesiones calcula siempre con los datos vigentes (ingresos, egresos, ventas, efectivo esperado y diferencia).
--  3) cerrar_caja devuelve al stock las reservas offline que quedaran de esa caja (p. ej. cierra un supervisor
--     desde otro equipo).
--  4) abrir_mi_caja reutiliza una caja cerrada de la sede en vez de crear una nueva en cada apertura.
--  5) caja_totales ya no entrega totales de turnos de sedes que el usuario no puede ver.
-- No cambia firmas, permisos ni datos existentes.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 5) caja_totales: solo de turnos de sedes visibles para el usuario
-- ---------------------------------------------------------------------
create or replace function public.caja_totales(p_sesion uuid)
returns table (ingresos numeric, ingresos_efectivo numeric, egresos numeric, ventas bigint)
language sql stable security definer set search_path = public
as $$
  with s as (
    select cs.id from public.caja_sesiones cs where cs.id = p_sesion and public.puede_ver_sede(cs.sede_id)
  )
  select
    coalesce((select sum(v.total) from public.ventas v join s on s.id = v.caja_sesion_id where v.estado = 'pagado'), 0),
    coalesce((select sum(v.total) from public.ventas v join s on s.id = v.caja_sesion_id where v.estado = 'pagado' and v.metodo_pago = 'Efectivo'), 0),
    coalesce((select sum(e.monto) from public.caja_egresos e join s on s.id = e.sesion_id where not e.anulado), 0),
    (select count(*) from public.ventas v join s on s.id = v.caja_sesion_id where v.estado = 'pagado');
$$;

-- ---------------------------------------------------------------------
-- 2) Tarjetas de turno: siempre con los datos vigentes (también tras anular o cambiar el método de pago)
-- ---------------------------------------------------------------------
create or replace view public.v_caja_sesiones with (security_invoker = true) as
select
  s.id as sesion_id, s.caja_id, c.nombre as caja_nombre, s.sede_id, sd.nombre as sede_nombre,
  s.usuario_id, s.usuario_nombre, s.fecha_apertura, s.fecha_cierre, s.estado,
  public.fecha_negocio(s.fecha_apertura) as dia,
  s.monto_apertura,
  case when s.estado = 'cerrada'
       then (s.monto_apertura + t.ingresos_efectivo - t.egresos)::numeric(12,2)
       else s.monto_sistema end as monto_sistema,
  s.monto_contado,
  case when s.estado = 'cerrada' and s.monto_contado is not null
       then (s.monto_contado - (s.monto_apertura + t.ingresos_efectivo - t.egresos))::numeric(12,2)
       else s.diferencia end as diferencia,
  s.observaciones,
  t.ingresos,
  t.ingresos_efectivo,
  t.egresos,
  t.ventas
from public.caja_sesiones s
join public.cajas c  on c.id  = s.caja_id
join public.sedes sd on sd.id = s.sede_id
left join lateral public.caja_totales(s.id) t on true;

-- ---------------------------------------------------------------------
-- 1) registrar_venta: la sesión de caja se toma FOR SHARE (misma función que 29)
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
  select * into v_ses from public.caja_sesiones where caja_id = p_caja and estado = 'abierta' for share;  -- bloquea el cierre mientras esta venta se guarda
  if not found then raise exception 'La caja seleccionada no esta abierta. Abrela para vender.' using errcode = 'P0422'; end if;
  -- Una caja abierta por otro usuario solo la opera su cajero o quien tenga permiso de supervisar cajas
  if v_ses.usuario_id is distinct from v_uid and not public.tiene_permiso('cajas.supervisar') then
    raise exception 'Esta caja la abrio otro usuario. Solo su cajero o un supervisor puede vender en ella.' using errcode = 'P0422';
  end if;

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
-- 1) registrar_egreso: la sesión de caja se toma FOR SHARE
-- ---------------------------------------------------------------------
create or replace function public.registrar_egreso(p_caja uuid, p_concepto text, p_monto numeric)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_ses public.caja_sesiones%rowtype; v_id uuid; v_uid uuid := auth.uid();
begin
  perform public.exigir_permiso('cajas.egresos');
  select * into v_ses from public.caja_sesiones where caja_id = p_caja and estado = 'abierta' for share;
  if not found then raise exception 'La caja no está abierta.'; end if;
  perform public.exigir_sede(v_ses.sede_id);
  if v_ses.usuario_id is distinct from v_uid then perform public.exigir_permiso('cajas.supervisar'); end if;
  if length(trim(coalesce(p_concepto, ''))) < 2 then raise exception 'Indica el concepto del egreso.'; end if;
  if p_monto is null or p_monto <= 0 then raise exception 'El monto del egreso debe ser mayor a cero.'; end if;

  insert into public.caja_egresos (sesion_id, caja_id, sede_id, concepto, monto, usuario_id, usuario_nombre)
  values (v_ses.id, p_caja, v_ses.sede_id, trim(p_concepto), p_monto, v_uid, public.nombre_usuario(v_uid))
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 1) Egreso automático de una compra: la sesión de caja se toma FOR SHARE
-- ---------------------------------------------------------------------
create or replace function public.trg_compra_a_egreso()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_ses public.caja_sesiones%rowtype;
begin
  if tg_op = 'UPDATE' and new.estado = 'anulada' and old.estado <> 'anulada' then
    update public.caja_egresos set anulado = true where compra_id = new.id;
    return new;
  end if;
  -- el total se calcula después del insert: el egreso nace cuando la compra ya tiene importe
  if tg_op = 'UPDATE' and old.total = 0 and new.total > 0 and new.estado <> 'anulada'
     and not exists (select 1 from public.caja_egresos where compra_id = new.id) then
    select * into v_ses from public.caja_sesiones
     where sede_id = new.sede_id and usuario_id = new.usuario_id and estado = 'abierta'
     order by fecha_apertura desc limit 1 for share;

    insert into public.caja_egresos (sesion_id, caja_id, sede_id, concepto, monto, usuario_id, usuario_nombre,
                                     categoria, proveedor, numero_documento, fecha_egreso, compra_id)
    values (v_ses.id, v_ses.caja_id, new.sede_id, 'Compra ' || new.numero || ' - ' || new.proveedor_nombre, new.total,
            new.usuario_id, new.usuario_nombre, 'Compra de insumos', new.proveedor_nombre,
            new.comprobante_proveedor, public.fecha_negocio(new.fecha), new.id);
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 3) Devuelve al stock lo que quede reservado (offline) para una caja
-- ---------------------------------------------------------------------
create or replace function public._liquidar_leases_de_caja(p_caja uuid)
returns int
language plpgsql security definer set search_path = public
as $$
declare r record; v_sobra numeric; v_n int := 0;
begin
  for r in
    select id, lease_id, sede_id, producto_id, cantidad, usada, devuelta
      from public.stock_leases_offline
     where caja_id = p_caja and estado = 'activo'
     order by producto_id, id
       for update
  loop
    v_sobra := r.cantidad - r.usada - r.devuelta;
    if v_sobra > 0 then
      perform public.registrar_movimiento(r.sede_id, r.producto_id, v_sobra, 'entrada', 'devolucion_lease',
                'Reserva offline liquidada: caja cerrada', left(r.lease_id::text, 8));
    end if;
    update public.stock_leases_offline
       set estado = 'liquidado', devuelta = devuelta + greatest(v_sobra, 0), cerrado_at = now()
     where id = r.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function public._liquidar_leases_de_caja(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 1) y 3) cerrar_caja: toma la sesión FOR UPDATE (espera a las ventas/egresos en curso) y libera las reservas
-- ---------------------------------------------------------------------
create or replace function public.cerrar_caja(p_caja uuid, p_monto_contado numeric default null, p_observaciones text default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_ses public.caja_sesiones%rowtype; t record; v_sistema numeric;
begin
  perform public.exigir_permiso('cajas.cerrar');
  select * into v_ses from public.caja_sesiones where caja_id = p_caja and estado = 'abierta' for update;
  if not found then raise exception 'La caja no tiene un turno abierto.'; end if;
  perform public.exigir_sede(v_ses.sede_id);
  if v_ses.usuario_id is distinct from auth.uid() then
    perform public.exigir_permiso('cajas.supervisar');
  end if;

  select * into t from public.caja_totales(v_ses.id);
  v_sistema := v_ses.monto_apertura + t.ingresos_efectivo - t.egresos;

  update public.caja_sesiones set
    estado = 'cerrada', fecha_cierre = now(),
    ingresos_cierre = t.ingresos, egresos_cierre = t.egresos, ventas_cierre = t.ventas,
    monto_sistema = v_sistema, monto_contado = p_monto_contado,
    diferencia = case when p_monto_contado is null then null else p_monto_contado - v_sistema end,
    observaciones = nullif(trim(p_observaciones), '')
  where id = v_ses.id;

  update public.cajas set estado = 'cerrada' where id = p_caja;

  -- el stock reservado para vender sin internet en esta caja vuelve al stock general
  perform public._liquidar_leases_de_caja(p_caja);
  return v_ses.id;
end;
$$;

-- ---------------------------------------------------------------------
-- 4) abrir_mi_caja: reutiliza una caja cerrada de la sede antes de crear una nueva
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

  -- primero se reutiliza la caja cerrada de menor número (otro cajero que abra a la vez toma otra distinta)
  select c.id into v_caja
    from public.cajas c
   where c.sede_id = p_sede and c.activa and c.estado = 'cerrada'
     and not exists (select 1 from public.caja_sesiones s where s.caja_id = c.id and s.estado = 'abierta')
   order by coalesce((substring(c.nombre from '(\d{1,6})\s*$'))::int, 2147483647), c.nombre
   limit 1
     for update skip locked;
  if v_caja is not null then
    return public.abrir_caja(v_caja, coalesce(p_monto_apertura, 0));
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
