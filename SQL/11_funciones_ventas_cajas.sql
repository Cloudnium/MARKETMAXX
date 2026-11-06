-- =====================================================================
-- 11_funciones_ventas_cajas.sql
-- Cajas (crear/abrir/cerrar/egresos) y ventas (registrar/anular).
-- Toda la lógica crítica corre en la BD: el precio y el stock se leen
-- aquí, nunca se confía en lo que envía el navegador.
-- =====================================================================

-- Totales de una sesión de caja
create or replace function public.caja_totales(p_sesion uuid)
returns table (ingresos numeric, ingresos_efectivo numeric, egresos numeric, ventas bigint)
language sql stable security definer set search_path = public
as $$
  select
    coalesce((select sum(v.total) from public.ventas v where v.caja_sesion_id = p_sesion and v.estado = 'pagado'), 0),
    coalesce((select sum(v.total) from public.ventas v where v.caja_sesion_id = p_sesion and v.estado = 'pagado' and v.metodo_pago = 'Efectivo'), 0),
    coalesce((select sum(e.monto) from public.caja_egresos e where e.sesion_id = p_sesion), 0),
    (select count(*) from public.ventas v where v.caja_sesion_id = p_sesion and v.estado = 'pagado');
$$;

-- ---------------------------------------------------------------------
-- abrir_caja: inicia un turno
-- ---------------------------------------------------------------------
create or replace function public.abrir_caja(p_caja uuid, p_monto_apertura numeric default 0)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_caja public.cajas%rowtype; v_id uuid; v_uid uuid := auth.uid();
begin
  perform public.exigir_permiso('cajas.abrir');
  select * into v_caja from public.cajas where id = p_caja for update;
  if not found then raise exception 'La caja no existe.'; end if;
  perform public.exigir_sede(v_caja.sede_id);
  if not v_caja.activa then raise exception 'La caja está desactivada.'; end if;
  if v_caja.estado = 'abierta' then raise exception 'La caja ya está abierta.'; end if;
  if coalesce(p_monto_apertura, 0) < 0 then raise exception 'El monto de apertura no puede ser negativo.'; end if;

  insert into public.caja_sesiones (caja_id, sede_id, usuario_id, usuario_nombre, monto_apertura)
  values (p_caja, v_caja.sede_id, v_uid, public.nombre_usuario(v_uid), coalesce(p_monto_apertura, 0))
  returning id into v_id;

  update public.cajas set estado = 'abierta' where id = p_caja;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- crear_caja: crea una caja en la sede (y opcionalmente la abre)
-- ---------------------------------------------------------------------
create or replace function public.crear_caja(p_sede uuid, p_nombre text, p_monto_apertura numeric default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  perform public.exigir_permiso('cajas.crear');
  perform public.exigir_sede(p_sede);
  if length(trim(coalesce(p_nombre, ''))) = 0 then raise exception 'El nombre de la caja es obligatorio.'; end if;
  if exists (select 1 from public.cajas where sede_id = p_sede and lower(nombre) = lower(trim(p_nombre))) then
    raise exception 'Ya existe una caja con ese nombre en la sede.';
  end if;

  insert into public.cajas (sede_id, nombre) values (p_sede, trim(p_nombre)) returning id into v_id;
  if p_monto_apertura is not null then
    perform public.abrir_caja(v_id, p_monto_apertura);
  end if;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- cerrar_caja: cierra el turno y guarda el resumen
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
  return v_ses.id;
end;
$$;

-- ---------------------------------------------------------------------
-- registrar_egreso: salida de dinero de la caja abierta
-- ---------------------------------------------------------------------
create or replace function public.registrar_egreso(p_caja uuid, p_concepto text, p_monto numeric)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_ses public.caja_sesiones%rowtype; v_id uuid; v_uid uuid := auth.uid();
begin
  perform public.exigir_permiso('cajas.egresos');
  select * into v_ses from public.caja_sesiones where caja_id = p_caja and estado = 'abierta';
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
-- registrar_venta
--   p_items: [{"producto_id": "...", "cantidad": 2}, ...]
--   Devuelve {id, numero, total}
-- ---------------------------------------------------------------------
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

  if p_tipo not in ('factura','boleta','nota_venta') then raise exception 'Tipo de comprobante no válido.'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta no tiene productos.';
  end if;
  if v_pct < 0 or v_pct > 100 then raise exception 'El descuento debe estar entre 0 y 100.'; end if;
  if v_pct > 0 then perform public.exigir_permiso('ventas.descuentos'); end if;
  if not exists (select 1 from public.metodos_pago where nombre = p_metodo_pago and activo) then
    raise exception 'Método de pago no válido.';
  end if;

  if not exists (select 1 from public.cajas where id = p_caja and sede_id = p_sede and activa) then
    raise exception 'La caja no pertenece a la sede seleccionada.';
  end if;
  select * into v_ses from public.caja_sesiones where caja_id = p_caja and estado = 'abierta';
  if not found then raise exception 'La caja seleccionada no está abierta. Ábrela para vender.'; end if;

  if p_cliente is not null then
    select * into v_cli from public.clientes where id = p_cliente and activo;
    if not found then raise exception 'El cliente no existe o está inactivo.'; end if;
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
      raise exception 'La factura requiere el nombre o razón social del comprador.';
    end if;
  end if;

  -- 1) Validar productos y calcular total (precios SIEMPRE desde la BD)
  for v_row in
    select (e ->> 'producto_id')::uuid as producto_id, sum((e ->> 'cantidad')::numeric) as cantidad
      from jsonb_array_elements(p_items) e group by 1 order by 1
  loop
    if v_row.cantidad is null or v_row.cantidad <= 0 then raise exception 'Cantidad no válida en la venta.'; end if;
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

  -- 3) Ítems + salida de stock (cada una queda en el historial de almacén)
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

-- ---------------------------------------------------------------------
-- anular_venta: devuelve el stock y registra quién y por qué
-- ---------------------------------------------------------------------
create or replace function public.anular_venta(p_venta uuid, p_motivo text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v public.ventas%rowtype; v_ses_estado text; it record; v_uid uuid := auth.uid();
begin
  perform public.exigir_permiso('ventas.anular');
  select * into v from public.ventas where id = p_venta for update;
  if not found then raise exception 'La venta no existe.'; end if;
  perform public.exigir_sede(v.sede_id);
  if v.estado = 'anulado' then raise exception 'La venta ya está anulada.'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 5 then
    raise exception 'Indica el motivo de la anulación (mínimo 5 caracteres).';
  end if;

  select estado into v_ses_estado from public.caja_sesiones where id = v.caja_sesion_id;
  if v_ses_estado = 'cerrada' then
    perform public.exigir_permiso('cajas.supervisar');   -- afecta un turno ya cerrado
  end if;

  update public.ventas set
    estado = 'anulado', anulada_at = now(), anulada_por = v_uid,
    anulada_por_nombre = public.nombre_usuario(v_uid), motivo_anulacion = trim(p_motivo)
  where id = p_venta;

  for it in select producto_id, cantidad from public.venta_items where venta_id = p_venta order by producto_id loop
    perform public.registrar_movimiento(v.sede_id, it.producto_id, it.cantidad, 'entrada', 'anulacion_venta',
              'Anulación de ' || v.numero || ': ' || trim(p_motivo), v.numero, null, p_venta);
  end loop;

  return p_venta;
end;
$$;
