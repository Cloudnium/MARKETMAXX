-- =====================================================================
-- 22_egresos_compras_reportes.sql  (idempotente)
--  * Cada compra de insumos genera un egreso (descuenta de la caja abierta del
--    usuario si tiene una; si no, queda como egreso sin caja). Al anular la
--    compra, el egreso se anula. Las compras ya existentes se pasan a egresos.
--  * Egresos con RUC/DNI del proveedor y foto del comprobante.
--  * reporte_egresos(): datos para REPORTES → Egresos.
-- =====================================================================
alter table public.caja_egresos
  add column if not exists compra_id           uuid references public.compras(id) on delete restrict,
  add column if not exists anulado             boolean not null default false,
  add column if not exists proveedor_documento text,
  add column if not exists foto_comprobante    text;

alter table public.caja_egresos add column if not exists tiene_foto boolean
  generated always as (foto_comprobante is not null) stored;

create unique index if not exists caja_egresos_compra_uq on public.caja_egresos (compra_id) where compra_id is not null;

-- Los egresos anulados no cuentan en la caja
create or replace function public.caja_totales(p_sesion uuid)
returns table (ingresos numeric, ingresos_efectivo numeric, egresos numeric, ventas bigint)
language sql stable security definer set search_path = public
as $$
  select
    coalesce((select sum(v.total) from public.ventas v where v.caja_sesion_id = p_sesion and v.estado = 'pagado'), 0),
    coalesce((select sum(v.total) from public.ventas v where v.caja_sesion_id = p_sesion and v.estado = 'pagado' and v.metodo_pago = 'Efectivo'), 0),
    coalesce((select sum(e.monto) from public.caja_egresos e where e.sesion_id = p_sesion and not e.anulado), 0),
    (select count(*) from public.ventas v where v.caja_sesion_id = p_sesion and v.estado = 'pagado');
$$;

-- ---------------------------------------------------------------------
-- Compra -> egreso
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
     order by fecha_apertura desc limit 1;

    insert into public.caja_egresos (sesion_id, caja_id, sede_id, concepto, monto, usuario_id, usuario_nombre,
                                     categoria, proveedor, numero_documento, fecha_egreso, compra_id)
    values (v_ses.id, v_ses.caja_id, new.sede_id, 'Compra ' || new.numero || ' - ' || new.proveedor_nombre, new.total,
            new.usuario_id, new.usuario_nombre, 'Compra de insumos', new.proveedor_nombre,
            new.comprobante_proveedor, public.fecha_negocio(new.fecha), new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_compra_a_egreso on public.compras;
create trigger trg_compra_a_egreso after update on public.compras
  for each row execute function public.trg_compra_a_egreso();

-- Compras anteriores: pasan a la lista de egresos (sin caja)
insert into public.caja_egresos (sede_id, concepto, monto, usuario_id, usuario_nombre, categoria, proveedor,
                                 numero_documento, fecha, fecha_egreso, compra_id, anulado)
select c.sede_id, 'Compra ' || c.numero || ' - ' || c.proveedor_nombre, c.total, c.usuario_id, c.usuario_nombre,
       'Compra de insumos', c.proveedor_nombre, c.comprobante_proveedor, c.fecha, public.fecha_negocio(c.fecha),
       c.id, c.estado = 'anulada'
  from public.compras c
 where c.total > 0 and not exists (select 1 from public.caja_egresos e where e.compra_id = c.id);

-- ---------------------------------------------------------------------
-- Egreso general (nueva versión con RUC/DNI y foto)
-- ---------------------------------------------------------------------
drop function if exists public.registrar_egreso_general(uuid, date, text, text, text, numeric, text, text, text, boolean);

create or replace function public.registrar_egreso_general(
  p_sede               uuid,
  p_fecha              date,
  p_categoria          text,
  p_concepto           text,
  p_proveedor          text,
  p_monto              numeric,
  p_tipo_documento     text default null,
  p_numero_documento   text default null,
  p_observaciones      text default null,
  p_descontar_caja     boolean default true,
  p_proveedor_documento text default null,
  p_foto               text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_ses public.caja_sesiones%rowtype; v_id uuid; v_concepto text;
begin
  if not public.tiene_algun_permiso(array['compras.crear','cajas.egresos']) then
    raise exception 'No tienes permiso para registrar egresos.' using errcode = '42501';
  end if;
  perform public.exigir_sede(p_sede);
  if p_monto is null or p_monto <= 0 then raise exception 'El monto del egreso debe ser mayor a cero.'; end if;
  if p_categoria is null or p_categoria = 'Compra de insumos' then
    raise exception 'Elige una categoría válida (las compras de insumos se registran en la pestaña Compras).';
  end if;
  if p_foto is not null and length(p_foto) > 1500000 then raise exception 'La foto es demasiado pesada.'; end if;
  v_concepto := coalesce(nullif(trim(p_concepto), ''), p_categoria || coalesce(' - ' || nullif(trim(p_proveedor), ''), ''));

  if coalesce(p_descontar_caja, false) then
    select * into v_ses from public.caja_sesiones
     where sede_id = p_sede and usuario_id = v_uid and estado = 'abierta'
     order by fecha_apertura desc limit 1;
  end if;

  insert into public.caja_egresos (sesion_id, caja_id, sede_id, concepto, monto, usuario_id, usuario_nombre,
                                   categoria, proveedor, proveedor_documento, tipo_documento, numero_documento,
                                   observaciones, fecha_egreso, foto_comprobante)
  values (v_ses.id, v_ses.caja_id, p_sede, v_concepto, p_monto, v_uid, public.nombre_usuario(v_uid),
          p_categoria, nullif(trim(p_proveedor), ''), nullif(trim(p_proveedor_documento), ''),
          nullif(trim(p_tipo_documento), ''), nullif(trim(p_numero_documento), ''), nullif(trim(p_observaciones), ''),
          coalesce(p_fecha, public.fecha_negocio(now())), nullif(p_foto, ''))
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Reporte de egresos
-- ---------------------------------------------------------------------
create or replace function public.reporte_egresos(
  p_sede  uuid default null,
  p_desde date default null,
  p_hasta date default null,
  p_categoria text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_hasta date := coalesce(p_hasta, public.fecha_negocio());
  v_desde date := coalesce(p_desde, v_hasta - 29);
  v_zona text := public.zona_negocio();
  v_ini timestamptz := v_desde::timestamp at time zone v_zona;
  v_fin timestamptz := (v_hasta + 1)::timestamp at time zone v_zona;
  v_total numeric; v_n int; v_ventas numeric; v_comp int;
  v_cat jsonb; v_dia jsonb; v_prov jsonb; v_det jsonb;
begin
  perform public.exigir_permiso('reportes.ver');

  create temp table if not exists _eg on commit drop as select * from public.caja_egresos where false;
  truncate _eg;
  insert into _eg
    select e.* from public.caja_egresos e
     where not e.anulado and e.fecha_egreso between v_desde and v_hasta
       and public.puede_ver_sede(e.sede_id)
       and (p_sede is null or e.sede_id = p_sede)
       and (p_categoria is null or e.categoria = p_categoria);

  select coalesce(sum(monto), 0), count(*) into v_total, v_n from _eg;

  select coalesce(sum(v.total), 0), count(*) into v_ventas, v_comp
    from public.ventas v
   where v.estado = 'pagado' and v.fecha >= v_ini and v.fecha < v_fin
     and public.puede_ver_sede(v.sede_id) and (p_sede is null or v.sede_id = p_sede);

  select coalesce(jsonb_agg(jsonb_build_object('nombre', categoria, 'total', t, 'cantidad', n,
           'porcentaje', case when v_total > 0 then round(t * 100 / v_total, 1) else 0 end) order by t desc), '[]')
    into v_cat from (select categoria, sum(monto) t, count(*) n from _eg group by 1) q;

  select coalesce(jsonb_agg(jsonb_build_object('dia', d, 'total', t) order by d), '[]')
    into v_dia from (select fecha_egreso d, sum(monto) t from _eg group by 1) q;

  select coalesce(jsonb_agg(jsonb_build_object('nombre', coalesce(proveedor, 'Sin proveedor'), 'total', t, 'cantidad', n) order by t desc), '[]')
    into v_prov from (select proveedor, sum(monto) t, count(*) n from _eg group by 1 order by 2 desc limit 8) q;

  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'fecha', fecha_egreso, 'categoria', categoria, 'concepto', concepto,
           'proveedor', proveedor, 'documento', trim(coalesce(tipo_documento, '') || ' ' || coalesce(numero_documento, '')),
           'monto', monto, 'usuario', usuario_nombre, 'sede_id', sede_id, 'en_caja', sesion_id is not null)
           order by fecha_egreso desc, fecha desc), '[]')
    into v_det from (select * from _eg order by fecha_egreso desc, fecha desc limit 500) q;

  return jsonb_build_object('total', v_total, 'cantidad', v_n, 'ventas', v_ventas, 'comprobantes', v_comp,
           'diferencia', v_ventas - v_total, 'dias', (v_hasta - v_desde) + 1,
           'por_categoria', v_cat, 'por_dia', v_dia, 'top_proveedores', v_prov, 'detalle', v_det);
end;
$$;

revoke all on function
  public.registrar_egreso_general(uuid, date, text, text, text, numeric, text, text, text, boolean, text, text),
  public.reporte_egresos(uuid, date, date, text) from public;
grant execute on function
  public.registrar_egreso_general(uuid, date, text, text, text, numeric, text, text, text, boolean, text, text),
  public.reporte_egresos(uuid, date, date, text) to authenticated;
