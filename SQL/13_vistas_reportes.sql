-- =====================================================================
-- 13_vistas_reportes.sql
-- Vistas de lectura (respetan RLS: security_invoker) y funciones de
-- reportes para Dashboard y Reportes.
-- =====================================================================

-- Stock por producto y sede con su estado
create or replace view public.v_stock with (security_invoker = true) as
select
  ss.producto_id, ss.sede_id,
  s.nombre  as sede_nombre, s.codigo as sede_codigo,
  p.codigo, p.nombre as producto, c.nombre as categoria, p.unidad, p.activo,
  p.precio_venta, p.precio_compra,
  ss.stock,
  coalesce(ss.stock_minimo, p.stock_minimo) as stock_minimo,
  case when ss.stock <= 0 then 'agotado'
       when ss.stock <= coalesce(ss.stock_minimo, p.stock_minimo) then 'bajo'
       else 'ok' end as estado
from public.stock_sede ss
join public.productos p on p.id = ss.producto_id
join public.sedes s     on s.id = ss.sede_id
left join public.categorias c on c.id = p.categoria_id;

-- Historial de almacén listo para mostrar
create or replace view public.v_movimientos with (security_invoker = true) as
select
  m.id, m.numero, m.fecha, m.sede_id, s.nombre as sede_nombre,
  m.producto_id, p.codigo as producto_codigo, p.nombre as producto, p.unidad,
  m.tipo, m.operacion, m.cantidad, m.stock_antes, m.stock_despues,
  m.motivo, m.referencia, m.usuario_id, m.usuario_nombre,
  m.sede_contraparte_id, sc.nombre as contraparte_nombre,
  m.venta_id, m.compra_id, m.traspaso_id
from public.movimientos_almacen m
join public.productos p on p.id = m.producto_id
join public.sedes s     on s.id = m.sede_id
left join public.sedes sc on sc.id = m.sede_contraparte_id;

-- Cajas con los totales de su último turno
create or replace view public.v_cajas with (security_invoker = true) as
select
  c.id, c.nombre, c.sede_id, s.nombre as sede_nombre, c.estado, c.activa,
  ls.id as sesion_id, ls.usuario_id, ls.usuario_nombre, ls.fecha_apertura, ls.monto_apertura,
  coalesce(t.ingresos, 0) as ingresos,
  coalesce(t.egresos, 0)  as egresos,
  coalesce(t.ventas, 0)   as ventas
from public.cajas c
join public.sedes s on s.id = c.sede_id
left join lateral (
  select cs.* from public.caja_sesiones cs where cs.caja_id = c.id order by cs.fecha_apertura desc limit 1
) ls on true
left join lateral (select * from public.caja_totales(ls.id)) t on ls.id is not null;

-- Clientes con sus compras acumuladas
create or replace view public.v_clientes with (security_invoker = true) as
select
  c.*,
  coalesce(v.compras, 0)       as compras,
  coalesce(v.total_gastado, 0) as total_gastado
from public.clientes c
left join (
  select cliente_id, count(*) as compras, sum(total) as total_gastado
    from public.ventas where estado = 'pagado' and cliente_id is not null group by cliente_id
) v on v.cliente_id = c.id;

-- Resumen por sede (tarjetas de la pantalla SEDES)
create or replace view public.v_sedes_resumen with (security_invoker = true) as
select
  s.id, s.numero, s.codigo, s.nombre, s.direccion, s.telefono, s.ciudad, s.activa, s.created_at,
  (select count(*) from public.usuario_sedes us join public.perfiles p on p.id = us.usuario_id
    where us.sede_id = s.id and p.estado = 'activo')                                   as usuarios,
  (select count(*) from public.cajas c where c.sede_id = s.id and c.activa)           as cajas,
  (select count(*) from public.cajas c where c.sede_id = s.id and c.estado = 'abierta') as cajas_abiertas,
  (select coalesce(sum(ss.stock), 0) from public.stock_sede ss where ss.sede_id = s.id) as unidades_stock,
  (select coalesce(sum(v.total), 0) from public.ventas v
    where v.sede_id = s.id and v.estado = 'pagado'
      and v.fecha >= (public.fecha_negocio()::timestamp at time zone public.zona_negocio())) as ventas_hoy
from public.sedes s;

-- Control de consistencia: el stock siempre debe igualar la suma de movimientos.
-- Esta consulta debe devolver 0 filas.
create or replace view public.v_control_stock with (security_invoker = true) as
select ss.producto_id, ss.sede_id, ss.stock as stock_actual,
       coalesce(m.suma, 0) as suma_movimientos,
       ss.stock - coalesce(m.suma, 0) as diferencia
from public.stock_sede ss
left join (select producto_id, sede_id, sum(cantidad) as suma
             from public.movimientos_almacen group by 1, 2) m
       on m.producto_id = ss.producto_id and m.sede_id = ss.sede_id
where ss.stock <> coalesce(m.suma, 0);

-- ---------------------------------------------------------------------
-- DASHBOARD: p_sede NULL = todas las sedes a las que el usuario tiene acceso
-- ---------------------------------------------------------------------
create or replace function public.dashboard_resumen(p_sede uuid default null)
returns jsonb
language plpgsql stable
as $$
declare
  v_zona   text := public.zona_negocio();
  v_hoy    date := public.fecha_negocio();
  v_ini_hoy  timestamptz := v_hoy::timestamp at time zone v_zona;
  v_ini_ayer timestamptz := (v_hoy - 1)::timestamp at time zone v_zona;
  v_ini_sem  timestamptz := (v_hoy - 6)::timestamp at time zone v_zona;
  v_ini_mes  timestamptz := (date_trunc('month', v_hoy::timestamp) - interval '5 months') at time zone v_zona;
  v_ini_30   timestamptz := (v_hoy - 29)::timestamp at time zone v_zona;
  v_hoy_j jsonb; v_ayer_j jsonb; v_sem jsonb; v_meses jsonb; v_cat jsonb; v_rec jsonb;
  dias text[] := array['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
  meses text[] := array['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
begin
  select jsonb_build_object(
      'ventas',       coalesce(sum(v.total), 0),
      'comprobantes', count(*),
      'clientes',     count(distinct v.cliente_nombre),
      'productos',    coalesce((select sum(i.cantidad) from public.venta_items i
                                 where i.venta_id = any (array_agg(v.id))), 0))
    into v_hoy_j
    from public.ventas v
   where v.estado = 'pagado' and v.fecha >= v_ini_hoy and (p_sede is null or v.sede_id = p_sede);

  select jsonb_build_object(
      'ventas',       coalesce(sum(v.total), 0),
      'comprobantes', count(*),
      'clientes',     count(distinct v.cliente_nombre),
      'productos',    coalesce((select sum(i.cantidad) from public.venta_items i
                                 where i.venta_id = any (array_agg(v.id))), 0))
    into v_ayer_j
    from public.ventas v
   where v.estado = 'pagado' and v.fecha >= v_ini_ayer and v.fecha < v_ini_hoy
     and (p_sede is null or v.sede_id = p_sede);

  select coalesce(jsonb_agg(jsonb_build_object('dia', dias[extract(dow from d)::int + 1], 'fecha', d,
                    'ventas', coalesce(x.total, 0), 'comprobantes', coalesce(x.n, 0)) order by d), '[]')
    into v_sem
    from generate_series(v_hoy - 6, v_hoy, interval '1 day') g(d)
    left join (select public.fecha_negocio(v.fecha) as f, sum(v.total) as total, count(*) as n
                 from public.ventas v
                where v.estado = 'pagado' and v.fecha >= v_ini_sem and (p_sede is null or v.sede_id = p_sede)
                group by 1) x on x.f = g.d::date;

  select coalesce(jsonb_agg(jsonb_build_object('mes', meses[extract(month from m)::int], 'ventas', coalesce(x.total, 0))
                            order by m), '[]')
    into v_meses
    from generate_series(date_trunc('month', v_hoy::timestamp) - interval '5 months',
                         date_trunc('month', v_hoy::timestamp), interval '1 month') g(m)
    left join (select date_trunc('month', v.fecha at time zone v_zona) as mes, sum(v.total) as total
                 from public.ventas v
                where v.estado = 'pagado' and v.fecha >= v_ini_mes and (p_sede is null or v.sede_id = p_sede)
                group by 1) x on x.mes = g.m;

  select coalesce(jsonb_agg(jsonb_build_object('nombre', nombre, 'total', total) order by total desc), '[]')
    into v_cat
    from (select coalesce(c.nombre, 'Sin categoría') as nombre, sum(i.subtotal) as total
            from public.venta_items i
            join public.ventas v on v.id = i.venta_id
            join public.productos p on p.id = i.producto_id
            left join public.categorias c on c.id = p.categoria_id
           where v.estado = 'pagado' and v.fecha >= v_ini_30 and (p_sede is null or v.sede_id = p_sede)
           group by 1) q;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.fecha desc), '[]')
    into v_rec
    from (select v.id, v.numero, v.cliente_nombre as cliente, v.fecha, v.total, v.tipo_comprobante as tipo,
                 v.metodo_pago, v.estado, v.sede_id
            from public.ventas v
           where (p_sede is null or v.sede_id = p_sede)
           order by v.fecha desc limit 6) r;

  return jsonb_build_object('hoy', v_hoy_j, 'ayer', v_ayer_j, 'semana', v_sem, 'meses', v_meses,
                            'categorias', v_cat, 'recientes', v_rec);
end;
$$;

-- ---------------------------------------------------------------------
-- REPORTES: ventas del periodo [p_desde, p_hasta] (fechas del negocio)
-- ---------------------------------------------------------------------
create or replace function public.reporte_ventas(
  p_sede  uuid default null,
  p_desde date default null,
  p_hasta date default null,
  p_tipo  text default null
) returns jsonb
language plpgsql stable
as $$
declare
  v_zona text := public.zona_negocio();
  v_hasta date := coalesce(p_hasta, public.fecha_negocio());
  v_desde date := coalesce(p_desde, v_hasta - 29);
  v_dias  int  := (v_hasta - v_desde) + 1;
  v_ini   timestamptz := v_desde::timestamp at time zone v_zona;
  v_fin   timestamptz := (v_hasta + 1)::timestamp at time zone v_zona;
  v_ini_prev timestamptz := (v_desde - v_dias)::timestamp at time zone v_zona;
  v_act jsonb; v_prev jsonb; v_sem jsonb; v_met jsonb; v_prod jsonb; v_cat jsonb; v_cli jsonb;
  v_caja jsonb; v_comp jsonb; v_det jsonb; v_total numeric;
  dias text[] := array['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
begin
  -- Resumen del periodo y del periodo anterior (misma duración)
  select jsonb_build_object('ventas', coalesce(sum(v.total), 0), 'comprobantes', count(*),
           'ticket', coalesce(round(avg(v.total), 2), 0),
           'utilidad', coalesce(sum(v.total), 0) - coalesce(sum(c.costo), 0))
    into v_act
    from public.ventas v
    left join lateral (select sum(i.cantidad * i.precio_compra) as costo from public.venta_items i where i.venta_id = v.id) c on true
   where v.estado = 'pagado' and v.fecha >= v_ini and v.fecha < v_fin
     and (p_sede is null or v.sede_id = p_sede) and (p_tipo is null or v.tipo_comprobante = p_tipo);

  select jsonb_build_object('ventas', coalesce(sum(v.total), 0), 'comprobantes', count(*),
           'ticket', coalesce(round(avg(v.total), 2), 0),
           'utilidad', coalesce(sum(v.total), 0) - coalesce(sum(c.costo), 0))
    into v_prev
    from public.ventas v
    left join lateral (select sum(i.cantidad * i.precio_compra) as costo from public.venta_items i where i.venta_id = v.id) c on true
   where v.estado = 'pagado' and v.fecha >= v_ini_prev and v.fecha < v_ini
     and (p_sede is null or v.sede_id = p_sede) and (p_tipo is null or v.tipo_comprobante = p_tipo);

  v_total := (v_act ->> 'ventas')::numeric;

  -- Últimos 7 días del periodo
  select coalesce(jsonb_agg(jsonb_build_object('dia', dias[extract(dow from d)::int + 1],
           'ventas', coalesce(x.total, 0), 'comprobantes', coalesce(x.n, 0)) order by d), '[]')
    into v_sem
    from generate_series(v_hasta - 6, v_hasta, interval '1 day') g(d)
    left join (select public.fecha_negocio(v.fecha) as f, sum(v.total) as total, count(*) as n
                 from public.ventas v
                where v.estado = 'pagado' and v.fecha >= ((v_hasta - 6)::timestamp at time zone v_zona) and v.fecha < v_fin
                  and (p_sede is null or v.sede_id = p_sede) and (p_tipo is null or v.tipo_comprobante = p_tipo)
                group by 1) x on x.f = g.d::date;

  select coalesce(jsonb_agg(jsonb_build_object('nombre', metodo_pago, 'total', total,
           'porcentaje', case when v_total > 0 then round(total * 100 / v_total, 1) else 0 end) order by total desc), '[]')
    into v_met
    from (select v.metodo_pago, sum(v.total) as total from public.ventas v
           where v.estado = 'pagado' and v.fecha >= v_ini and v.fecha < v_fin
             and (p_sede is null or v.sede_id = p_sede) and (p_tipo is null or v.tipo_comprobante = p_tipo)
           group by 1) q;

  select coalesce(jsonb_agg(to_jsonb(q) order by q.total desc), '[]') into v_prod
    from (select i.producto_nombre as nombre, sum(i.cantidad) as cantidad, sum(i.subtotal) as total
            from public.venta_items i join public.ventas v on v.id = i.venta_id
           where v.estado = 'pagado' and v.fecha >= v_ini and v.fecha < v_fin
             and (p_sede is null or v.sede_id = p_sede) and (p_tipo is null or v.tipo_comprobante = p_tipo)
           group by 1 order by sum(i.subtotal) desc limit 5) q;

  select coalesce(jsonb_agg(jsonb_build_object('nombre', nombre, 'total', total,
           'porcentaje', case when v_total > 0 then round(total * 100 / v_total, 1) else 0 end) order by total desc), '[]')
    into v_cat
    from (select coalesce(c.nombre, 'Sin categoría') as nombre, sum(i.subtotal) as total
            from public.venta_items i
            join public.ventas v on v.id = i.venta_id
            join public.productos p on p.id = i.producto_id
            left join public.categorias c on c.id = p.categoria_id
           where v.estado = 'pagado' and v.fecha >= v_ini and v.fecha < v_fin
             and (p_sede is null or v.sede_id = p_sede) and (p_tipo is null or v.tipo_comprobante = p_tipo)
           group by 1) q;

  select coalesce(jsonb_agg(to_jsonb(q) order by q.total desc), '[]') into v_cli
    from (select v.cliente_nombre as nombre, count(*) as compras, sum(v.total) as total
            from public.ventas v
           where v.estado = 'pagado' and v.cliente_id is not null and v.fecha >= v_ini and v.fecha < v_fin
             and (p_sede is null or v.sede_id = p_sede) and (p_tipo is null or v.tipo_comprobante = p_tipo)
           group by v.cliente_id, v.cliente_nombre order by sum(v.total) desc limit 5) q;

  select coalesce(jsonb_agg(to_jsonb(q) order by q.total desc), '[]') into v_caja
    from (select c.nombre || case when p_sede is null then ' · ' || s.codigo else '' end as caja,
                 sum(v.total) as total, count(*) as comprobantes
            from public.ventas v join public.cajas c on c.id = v.caja_id join public.sedes s on s.id = v.sede_id
           where v.estado = 'pagado' and v.fecha >= v_ini and v.fecha < v_fin
             and (p_sede is null or v.sede_id = p_sede) and (p_tipo is null or v.tipo_comprobante = p_tipo)
           group by c.id, c.nombre, s.codigo) q;

  select coalesce(jsonb_agg(to_jsonb(q) order by q.total desc), '[]') into v_comp
    from (select case v.tipo_comprobante when 'factura' then 'Factura' when 'boleta' then 'Boleta' else 'Nota de Venta' end as tipo,
                 sum(v.total) as total, count(*) as cantidad
            from public.ventas v
           where v.estado = 'pagado' and v.fecha >= v_ini and v.fecha < v_fin
             and (p_sede is null or v.sede_id = p_sede) and (p_tipo is null or v.tipo_comprobante = p_tipo)
           group by v.tipo_comprobante) q;

  select coalesce(jsonb_agg(to_jsonb(q) order by q.fecha desc), '[]') into v_det
    from (select v.id, v.numero, v.cliente_nombre as cliente, v.fecha, v.total, v.tipo_comprobante as tipo,
                 v.metodo_pago, v.estado, v.sede_id
            from public.ventas v
           where v.fecha >= v_ini and v.fecha < v_fin
             and (p_sede is null or v.sede_id = p_sede) and (p_tipo is null or v.tipo_comprobante = p_tipo)
           order by v.fecha desc limit 300) q;

  return jsonb_build_object('desde', v_desde, 'hasta', v_hasta, 'actual', v_act, 'anterior', v_prev,
    'semanal', v_sem, 'metodos_pago', v_met, 'top_productos', v_prod, 'top_categorias', v_cat,
    'top_clientes', v_cli, 'por_caja', v_caja, 'por_comprobante', v_comp, 'detalle', v_det);
end;
$$;
