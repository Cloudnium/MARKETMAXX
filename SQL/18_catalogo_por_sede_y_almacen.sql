-- =====================================================================
-- 18_catalogo_por_sede_y_almacen.sql
--
-- 1) CATÁLOGO POR SEDE: cada sede es un negocio con sus propios productos.
--    Un producto pertenece a UNA sede (productos.sede_id). Nada se cruza
--    entre sedes en PRODUCTOS, ALMACÉN, VENTAS, COMPRAS ni alerta de stock.
--    Los productos que ya existían se reparten según dónde tienen stock /
--    movimientos (si estaban en varias sedes se duplican, cada copia con su
--    stock e historial).
--
-- 2) ALMACÉN (bodega) POR SEDE: cada sede tiene stock de TIENDA (stock_sede:
--    es lo que ven PRODUCTOS, VENTAS y la alerta) y stock de ALMACÉN
--    (almacen_sede). Desde el almacén se distribuye a la tienda de la misma
--    sede o se envía al almacén de otra sede.
--
-- 3) HISTORIAL DE ALMACÉN: movimientos_bodega (inmutable), separado del
--    historial de la tienda (movimientos_almacen, que ahora se ve en PRODUCTOS).
--
-- Idempotente: se puede volver a ejecutar. Requiere haber ejecutado 01..17.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Permiso nuevo: ver el historial de movimientos desde PRODUCTOS
-- ---------------------------------------------------------------------
insert into public.permisos (codigo, modulo, descripcion, orden) values
  ('productos.historial', 'Productos', 'Ver y descargar el historial de movimientos de productos', 45)
on conflict (codigo) do update
  set modulo = excluded.modulo, descripcion = excluded.descripcion, orden = excluded.orden;

-- Quien ya veía el historial en ALMACÉN, lo verá en PRODUCTOS
insert into public.rol_permisos (rol_id, permiso_codigo)
select rp.rol_id, 'productos.historial'
  from public.rol_permisos rp
 where rp.permiso_codigo = 'almacen.historial'
on conflict do nothing;

update public.permisos set descripcion = 'Ver y descargar el historial de traslados del almacén'
 where codigo = 'almacen.historial';
update public.permisos set descripcion = 'Enviar del almacén a la tienda o a otra sede'
 where codigo = 'almacen.traspasar';
update public.permisos set descripcion = 'Ver el stock del almacén por sede'
 where codigo = 'almacen.ver';

-- ---------------------------------------------------------------------
-- 1. Tablas nuevas del almacén (bodega)
-- ---------------------------------------------------------------------
create table if not exists public.almacen_sede (
  producto_id  uuid not null references public.productos(id) on delete restrict,
  sede_id      uuid not null references public.sedes(id)     on delete restrict,
  stock        numeric(12,3) not null default 0 check (stock >= 0),
  updated_at   timestamptz not null default now(),
  primary key (producto_id, sede_id)
);
create index if not exists almacen_sede_sede_idx on public.almacen_sede (sede_id);

create table if not exists public.movimientos_bodega (
  id                  uuid primary key default gen_random_uuid(),
  numero              bigint generated always as identity unique,
  fecha               timestamptz not null default now(),
  sede_id             uuid not null references public.sedes(id)     on delete restrict,
  producto_id         uuid not null references public.productos(id) on delete restrict,
  tipo                text not null check (tipo in ('entrada','salida','ajuste')),
  operacion           text not null check (operacion in (
                         'stock_inicial','ingreso_manual','ajuste_manual','conteo_fisico','merma',
                         'a_tienda','desde_tienda','envio_sede','recepcion_sede')),
  cantidad            numeric(12,3) not null check (cantidad <> 0),
  stock_antes         numeric(12,3) not null,
  stock_despues       numeric(12,3) not null check (stock_despues >= 0),
  motivo              text,
  referencia          text,
  usuario_id          uuid references public.perfiles(id) on delete set null,
  usuario_nombre      text not null default 'Sistema',
  sede_contraparte_id uuid references public.sedes(id) on delete restrict,
  traspaso_id         uuid references public.traspasos(id) on delete restrict,
  check (stock_despues = stock_antes + cantidad),
  check (operacion not in ('ingreso_manual','ajuste_manual','conteo_fisico','merma')
         or length(trim(coalesce(motivo,''))) >= 3)
);
create index if not exists mov_bodega_sede_fecha_idx on public.movimientos_bodega (sede_id, fecha desc);
create index if not exists mov_bodega_producto_idx   on public.movimientos_bodega (producto_id, sede_id, numero);

-- Los traspasos entre sedes ahora pueden ser de almacén a almacén
alter table public.traspasos add column if not exists ubicacion text not null default 'tienda';
alter table public.traspasos drop constraint if exists traspasos_ubicacion_check;
alter table public.traspasos add constraint traspasos_ubicacion_check check (ubicacion in ('tienda','almacen'));

-- El historial de la tienda también registra lo que entra/sale hacia el almacén
alter table public.movimientos_almacen drop constraint if exists movimientos_almacen_operacion_check;
alter table public.movimientos_almacen drop constraint if exists mov_operacion_valida;
alter table public.movimientos_almacen add constraint mov_operacion_valida check (operacion in (
  'stock_inicial','compra','anulacion_compra','venta','anulacion_venta',
  'traspaso_salida','traspaso_entrada',
  'ingreso_manual','ajuste_manual','conteo_fisico','merma','devolucion','correccion_producto',
  'desde_almacen','a_almacen'));

-- ---------------------------------------------------------------------
-- 2. Guardias: el stock del almacén solo cambia registrando un movimiento
-- ---------------------------------------------------------------------
create or replace function public.trg_almacen_guard()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('app.bod_ok', true), 'off') = 'on' then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' and new.stock = 0 then return new; end if;
  if tg_op = 'UPDATE' and new.stock = old.stock then return new; end if;
  if tg_op = 'DELETE' and old.stock = 0 then return old; end if;
  raise exception 'El stock del almacén solo puede modificarse registrando un movimiento.'
    using errcode = '42501';
end;
$$;

drop trigger if exists trg_almacen_guard on public.almacen_sede;
create trigger trg_almacen_guard
  before insert or update or delete on public.almacen_sede
  for each row execute function public.trg_almacen_guard();

drop trigger if exists trg_mov_bodega_inmutable on public.movimientos_bodega;
create trigger trg_mov_bodega_inmutable
  before update or delete on public.movimientos_bodega
  for each row execute function public.trg_solo_insertar();

-- ---------------------------------------------------------------------
-- 3. Catálogo por sede: productos.sede_id
-- ---------------------------------------------------------------------
alter table public.productos add column if not exists sede_id uuid references public.sedes(id) on delete restrict;

-- El código ya no es único en todo el sistema: es único dentro de cada sede
do $$
declare c record;
begin
  for c in
    select con.conname
      from pg_constraint con
      join pg_attribute a on a.attrelid = con.conrelid and a.attnum = any (con.conkey)
     where con.conrelid = 'public.productos'::regclass and con.contype = 'u'
       and array_length(con.conkey, 1) = 1 and a.attname = 'codigo'
  loop
    execute format('alter table public.productos drop constraint %I', c.conname);
  end loop;
end $$;

-- Triggers de alta: ya no se crean filas de stock en todas las sedes
create or replace function public.trg_sede_nueva()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_n text := lpad(new.numero::text, 3, '0');
begin
  insert into public.series_correlativos (sede_id, tipo, serie) values
    (new.id, 'factura',    'F'  || v_n),
    (new.id, 'boleta',     'B'  || v_n),
    (new.id, 'nota_venta', 'NV' || v_n),
    (new.id, 'compra',     'C'  || v_n),
    (new.id, 'traspaso',   'TR' || v_n),
    (new.id, 'ajuste',     'AJ' || v_n);

  insert into public.cajas (sede_id, nombre) values (new.id, 'Caja 1');
  return new;
end;
$$;

create or replace function public.trg_producto_nuevo()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.sede_id is not null then
    insert into public.stock_sede   (producto_id, sede_id, stock) values (new.id, new.sede_id, 0) on conflict do nothing;
    insert into public.almacen_sede (producto_id, sede_id, stock) values (new.id, new.sede_id, 0) on conflict do nothing;
  end if;
  return new;
end;
$$;

-- Migración de los productos existentes (solo si aún hay productos sin sede)
do $$
declare
  p record; s record;
  v_home uuid; v_primera uuid; v_clon uuid;
  v_clonados int := 0; v_asignados int := 0; v_limpiados int := 0; v_n int;
begin
  if not exists (select 1 from public.productos where sede_id is null) then
    return;
  end if;

  select id into v_primera from public.sedes order by numero limit 1;
  if v_primera is null then
    raise exception 'No hay sedes: crea al menos una sede antes de migrar el catálogo.';
  end if;

  -- Se desactivan solo durante la migración los bloqueos de tablas históricas
  alter table public.movimientos_almacen disable trigger trg_mov_inmutable;

  create temp table _usadas (sede_id uuid, peso bigint) on commit drop;

  for p in select * from public.productos where sede_id is null order by created_at, id loop
    -- sedes donde el producto "se usó": stock, movimientos, ventas, compras o traspasos
    truncate _usadas;

    insert into _usadas
    select sede_id, sum(peso) from (
      select ss.sede_id, 1::bigint as peso from public.stock_sede ss where ss.producto_id = p.id and ss.stock > 0
      union all
      select m.sede_id, 1 from public.movimientos_almacen m where m.producto_id = p.id
      union all
      select v.sede_id, 1 from public.venta_items vi join public.ventas v on v.id = vi.venta_id where vi.producto_id = p.id
      union all
      select c.sede_id, 1 from public.compra_items ci join public.compras c on c.id = ci.compra_id where ci.producto_id = p.id
      union all
      select t.sede_origen_id, 1 from public.traspaso_items ti join public.traspasos t on t.id = ti.traspaso_id where ti.producto_id = p.id
    ) x group by sede_id;

    -- sede principal = donde más se usó (empate: la de menor número); sin uso: la primera sede
    select u.sede_id into v_home
      from _usadas u join public.sedes se on se.id = u.sede_id
     order by u.peso desc, se.numero limit 1;
    v_home := coalesce(v_home, v_primera);

    update public.productos set sede_id = v_home where id = p.id;
    v_asignados := v_asignados + 1;

    -- el resto de sedes donde se usó recibe su propia copia del producto
    for s in select u.sede_id from _usadas u join public.sedes se on se.id = u.sede_id
              where u.sede_id <> v_home order by se.numero loop
      insert into public.productos (codigo, nombre, descripcion, categoria_id, precio_venta, precio_compra,
                                    unidad, stock_minimo, activo, created_by, sede_id)
      values (p.codigo, p.nombre, p.descripcion, p.categoria_id, p.precio_venta, p.precio_compra,
              p.unidad, p.stock_minimo, p.activo, p.created_by, s.sede_id)
      returning id into v_clon;
      v_clonados := v_clonados + 1;

      -- la copia ya tiene sus filas vacías (trigger): se reemplazan por las reales
      delete from public.stock_sede where producto_id = v_clon and sede_id = s.sede_id;
      update public.stock_sede set producto_id = v_clon where producto_id = p.id and sede_id = s.sede_id;

      update public.movimientos_almacen set producto_id = v_clon where producto_id = p.id and sede_id = s.sede_id;

      update public.venta_items vi set producto_id = v_clon
        from public.ventas v where v.id = vi.venta_id and v.sede_id = s.sede_id and vi.producto_id = p.id;

      update public.compra_items ci set producto_id = v_clon
        from public.compras c where c.id = ci.compra_id and c.sede_id = s.sede_id and ci.producto_id = p.id;

      update public.traspaso_items ti set producto_id = v_clon
        from public.traspasos t where t.id = ti.traspaso_id and t.sede_origen_id = s.sede_id and ti.producto_id = p.id;
    end loop;
  end loop;

  -- filas de stock vacías que quedaron en sedes ajenas al producto
  delete from public.stock_sede ss
   using public.productos pr
   where pr.id = ss.producto_id and pr.sede_id <> ss.sede_id and ss.stock = 0;
  get diagnostics v_limpiados = row_count;

  -- si aún quedara stock real en una sede ajena, es un dato inconsistente: se aborta
  select count(*) into v_n from public.stock_sede ss join public.productos pr on pr.id = ss.producto_id
   where pr.sede_id <> ss.sede_id;
  if v_n > 0 then
    raise exception 'Migración abortada: % filas de stock quedaron en sedes ajenas al producto.', v_n;
  end if;

  alter table public.movimientos_almacen enable trigger trg_mov_inmutable;

  raise notice 'Catálogo por sede: % productos asignados, % copias creadas, % filas de stock vacías eliminadas.',
               v_asignados, v_clonados, v_limpiados;
end $$;

alter table public.productos alter column sede_id set not null;
create unique index if not exists productos_sede_codigo_uq on public.productos (sede_id, codigo);
create index if not exists productos_sede_idx on public.productos (sede_id, lower(nombre));

-- Todo producto debe tener su fila de stock (tienda) y de almacén en su propia sede
insert into public.stock_sede   (producto_id, sede_id, stock) select id, sede_id, 0 from public.productos on conflict do nothing;
insert into public.almacen_sede (producto_id, sede_id, stock) select id, sede_id, 0 from public.productos on conflict do nothing;

-- Un ítem de venta/compra solo puede llevar productos de la sede del documento
create or replace function public.trg_item_misma_sede()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_sede_doc uuid; v_sede_prod uuid;
begin
  if tg_table_name = 'venta_items' then
    select sede_id into v_sede_doc from public.ventas where id = new.venta_id;
  else
    select sede_id into v_sede_doc from public.compras where id = new.compra_id;
  end if;
  select sede_id into v_sede_prod from public.productos where id = new.producto_id;
  if v_sede_doc is distinct from v_sede_prod then
    raise exception 'El producto no pertenece a la sede de este documento. Cada sede maneja sus propios productos.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_venta_items_sede on public.venta_items;
create trigger trg_venta_items_sede before insert on public.venta_items
  for each row execute function public.trg_item_misma_sede();
drop trigger if exists trg_compra_items_sede on public.compra_items;
create trigger trg_compra_items_sede before insert on public.compra_items
  for each row execute function public.trg_item_misma_sede();

-- ---------------------------------------------------------------------
-- 4. Funciones internas de stock
-- ---------------------------------------------------------------------

-- registrar_movimiento (TIENDA): ahora exige que el producto sea de la sede
create or replace function public.registrar_movimiento(
  p_sede         uuid,
  p_producto     uuid,
  p_delta        numeric,
  p_tipo         text,
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
  v_antes numeric; v_despues numeric; v_id uuid; v_prod text; v_sede_prod uuid;
  v_uid uuid := auth.uid();
begin
  if p_delta is null or p_delta = 0 then
    raise exception 'La cantidad del movimiento no puede ser cero.';
  end if;

  select nombre, sede_id into v_prod, v_sede_prod from public.productos where id = p_producto;
  if v_sede_prod is distinct from p_sede then
    raise exception 'El producto "%" no pertenece a esta sede. Cada sede maneja sus propios productos.', coalesce(v_prod, '?')
      using errcode = '23514';
  end if;

  perform set_config('app.mov_ok', 'on', true);

  select stock into v_antes from public.stock_sede
   where producto_id = p_producto and sede_id = p_sede for update;
  if not found then
    insert into public.stock_sede (producto_id, sede_id, stock) values (p_producto, p_sede, 0);
    v_antes := 0;
  end if;

  v_despues := v_antes + p_delta;
  if v_despues < 0 then
    raise exception 'Stock insuficiente de "%": disponible %, solicitado %.', v_prod, v_antes, abs(p_delta)
      using errcode = '23514';
  end if;

  update public.stock_sede set stock = v_despues, updated_at = now()
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

-- registrar_movimiento_bodega (ALMACÉN): mismo concepto, otro stock y otro historial
create or replace function public.registrar_movimiento_bodega(
  p_sede         uuid,
  p_producto     uuid,
  p_delta        numeric,
  p_tipo         text,
  p_operacion    text,
  p_motivo       text    default null,
  p_referencia   text    default null,
  p_contraparte  uuid    default null,
  p_traspaso     uuid    default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_antes numeric; v_despues numeric; v_id uuid; v_prod text; v_sede_prod uuid;
  v_uid uuid := auth.uid();
begin
  if p_delta is null or p_delta = 0 then
    raise exception 'La cantidad del movimiento no puede ser cero.';
  end if;

  select nombre, sede_id into v_prod, v_sede_prod from public.productos where id = p_producto;
  if v_sede_prod is distinct from p_sede then
    raise exception 'El producto "%" no pertenece a esta sede. Cada sede maneja sus propios productos.', coalesce(v_prod, '?')
      using errcode = '23514';
  end if;

  perform set_config('app.bod_ok', 'on', true);

  select stock into v_antes from public.almacen_sede
   where producto_id = p_producto and sede_id = p_sede for update;
  if not found then
    insert into public.almacen_sede (producto_id, sede_id, stock) values (p_producto, p_sede, 0);
    v_antes := 0;
  end if;

  v_despues := v_antes + p_delta;
  if v_despues < 0 then
    raise exception 'Stock insuficiente en el almacén de "%": disponible %, solicitado %.', v_prod, v_antes, abs(p_delta)
      using errcode = '23514';
  end if;

  update public.almacen_sede set stock = v_despues, updated_at = now()
   where producto_id = p_producto and sede_id = p_sede;

  insert into public.movimientos_bodega (
    sede_id, producto_id, tipo, operacion, cantidad, stock_antes, stock_despues,
    motivo, referencia, usuario_id, usuario_nombre, sede_contraparte_id, traspaso_id)
  values (
    p_sede, p_producto, p_tipo, p_operacion, p_delta, v_antes, v_despues,
    nullif(trim(p_motivo), ''), p_referencia, v_uid, public.nombre_usuario(v_uid), p_contraparte, p_traspaso)
  returning id into v_id;

  perform set_config('app.bod_ok', 'off', true);
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Funciones públicas del ALMACÉN
-- ---------------------------------------------------------------------

-- Ajustes manuales del almacén (con motivo): ingreso_manual | merma | ajuste_manual
create or replace function public.ajustar_almacen(
  p_sede      uuid,
  p_producto  uuid,
  p_delta     numeric,
  p_operacion text,
  p_motivo    text
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_serie text; v_corr int; v_delta numeric := p_delta; v_tipo text;
begin
  perform public.exigir_permiso('almacen.ajustar');
  perform public.exigir_sede(p_sede);
  if p_operacion not in ('ingreso_manual','ajuste_manual','merma') then
    raise exception 'Operación de ajuste no válida: %', p_operacion;
  end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Debes indicar el motivo del ajuste.'; end if;
  if p_delta is null or p_delta = 0 then raise exception 'La cantidad debe ser distinta de cero.'; end if;
  if p_operacion = 'ingreso_manual' and p_delta < 0 then raise exception 'Para un ingreso la cantidad debe ser positiva.'; end if;
  if p_operacion = 'merma' then v_delta := -abs(p_delta); end if;

  v_tipo := case when p_operacion = 'ingreso_manual' then 'entrada' else 'ajuste' end;
  select o_serie, o_correlativo into v_serie, v_corr from public.siguiente_correlativo(p_sede, 'ajuste');
  return public.registrar_movimiento_bodega(p_sede, p_producto, v_delta, v_tipo, p_operacion, p_motivo,
           v_serie || '-' || lpad(v_corr::text, 6, '0'));
end;
$$;

-- Conteo físico del almacén: deja el stock exactamente en p_nuevo_stock
create or replace function public.fijar_almacen(
  p_sede uuid, p_producto uuid, p_nuevo_stock numeric, p_motivo text
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_actual numeric; v_serie text; v_corr int;
begin
  perform public.exigir_permiso('almacen.ajustar');
  perform public.exigir_sede(p_sede);
  if p_nuevo_stock is null or p_nuevo_stock < 0 then raise exception 'El stock contado no puede ser negativo.'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Debes indicar el motivo del ajuste.'; end if;

  select stock into v_actual from public.almacen_sede where producto_id = p_producto and sede_id = p_sede for update;
  v_actual := coalesce(v_actual, 0);
  if p_nuevo_stock = v_actual then return null; end if;

  select o_serie, o_correlativo into v_serie, v_corr from public.siguiente_correlativo(p_sede, 'ajuste');
  return public.registrar_movimiento_bodega(p_sede, p_producto, p_nuevo_stock - v_actual, 'ajuste', 'conteo_fisico',
           p_motivo, v_serie || '-' || lpad(v_corr::text, 6, '0'));
end;
$$;

-- Almacén <-> Tienda de la MISMA sede
--   p_sentido: 'a_tienda' (almacén -> tienda)  |  'a_almacen' (tienda -> almacén)
--   p_items:   [{"producto_id": "...", "cantidad": 5}, ...]
create or replace function public.mover_almacen_tienda(
  p_sede          uuid,
  p_sentido       text,
  p_items         jsonb,
  p_observaciones text default null
) returns text
language plpgsql security definer set search_path = public
as $$
declare r record; v_serie text; v_corr int; v_num text;
begin
  perform public.exigir_permiso('almacen.traspasar');
  perform public.exigir_sede(p_sede);
  if p_sentido not in ('a_tienda','a_almacen') then raise exception 'Sentido de traslado no válido.'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Agrega al menos un producto.';
  end if;

  select o_serie, o_correlativo into v_serie, v_corr from public.siguiente_correlativo(p_sede, 'traspaso');
  v_num := v_serie || '-' || lpad(v_corr::text, 6, '0');

  for r in
    select (e ->> 'producto_id')::uuid as producto_id, sum((e ->> 'cantidad')::numeric) as cantidad
      from jsonb_array_elements(p_items) e group by 1 order by 1
  loop
    if r.cantidad is null or r.cantidad <= 0 then raise exception 'Cantidad de traslado no válida.'; end if;

    if p_sentido = 'a_tienda' then
      perform public.registrar_movimiento_bodega(p_sede, r.producto_id, -r.cantidad, 'salida', 'a_tienda',
                nullif(trim(p_observaciones), ''), v_num);
      perform public.registrar_movimiento(p_sede, r.producto_id, r.cantidad, 'traspaso', 'desde_almacen',
                nullif(trim(p_observaciones), ''), v_num);
    else
      perform public.registrar_movimiento(p_sede, r.producto_id, -r.cantidad, 'traspaso', 'a_almacen',
                nullif(trim(p_observaciones), ''), v_num);
      perform public.registrar_movimiento_bodega(p_sede, r.producto_id, r.cantidad, 'entrada', 'desde_tienda',
                nullif(trim(p_observaciones), ''), v_num);
    end if;
  end loop;

  return v_num;
end;
$$;

-- Almacén de una sede -> almacén de OTRA sede.
-- Si la sede destino aún no tiene ese producto (mismo código) se crea en su catálogo.
create or replace function public.enviar_a_sede(
  p_origen        uuid,
  p_destino       uuid,
  p_items         jsonb,
  p_observaciones text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid; v_serie text; v_corr int; v_num text; v_uid uuid := auth.uid();
  r record; v_prod public.productos%rowtype; v_dest uuid;
begin
  perform public.exigir_permiso('almacen.traspasar');
  perform public.exigir_sede(p_origen);
  if p_origen = p_destino then raise exception 'La sede de origen y destino deben ser distintas.'; end if;
  if not exists (select 1 from public.sedes where id = p_destino and activa) then
    raise exception 'La sede de destino no existe o está inactiva.';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Agrega al menos un producto al envío.';
  end if;

  select o_serie, o_correlativo into v_serie, v_corr from public.siguiente_correlativo(p_origen, 'traspaso');
  v_num := v_serie || '-' || lpad(v_corr::text, 6, '0');

  insert into public.traspasos (numero, sede_origen_id, sede_destino_id, usuario_id, usuario_nombre, observaciones, ubicacion)
  values (v_num, p_origen, p_destino, v_uid, public.nombre_usuario(v_uid), nullif(trim(p_observaciones), ''), 'almacen')
  returning id into v_id;

  for r in
    select (e ->> 'producto_id')::uuid as producto_id, sum((e ->> 'cantidad')::numeric) as cantidad
      from jsonb_array_elements(p_items) e group by 1 order by 1
  loop
    if r.cantidad is null or r.cantidad <= 0 then raise exception 'Cantidad de envío no válida.'; end if;

    select * into v_prod from public.productos where id = r.producto_id and sede_id = p_origen;
    if not found then raise exception 'Hay un producto que no pertenece a la sede de origen.'; end if;

    -- producto equivalente (mismo código) en la sede destino; si no existe se crea
    select id into v_dest from public.productos where sede_id = p_destino and codigo = v_prod.codigo;
    if v_dest is null then
      insert into public.productos (codigo, nombre, descripcion, categoria_id, precio_venta, precio_compra,
                                    unidad, stock_minimo, activo, created_by, sede_id)
      values (v_prod.codigo, v_prod.nombre, v_prod.descripcion, v_prod.categoria_id, v_prod.precio_venta,
              v_prod.precio_compra, v_prod.unidad, v_prod.stock_minimo, true, v_uid, p_destino)
      returning id into v_dest;
    end if;

    insert into public.traspaso_items (traspaso_id, producto_id, cantidad) values (v_id, r.producto_id, r.cantidad);

    perform public.registrar_movimiento_bodega(p_origen,  r.producto_id, -r.cantidad, 'salida',  'envio_sede',
              nullif(trim(p_observaciones), ''), v_num, p_destino, v_id);
    perform public.registrar_movimiento_bodega(p_destino, v_dest,         r.cantidad, 'entrada', 'recepcion_sede',
              nullif(trim(p_observaciones), ''), v_num, p_origen,  v_id);
  end loop;

  return v_id;
end;
$$;

-- Lista simple de sedes activas para elegir destino (cualquier usuario con acceso a almacén)
create or replace function public.sedes_destino()
returns table (id uuid, nombre text, codigo text)
language sql stable security definer set search_path = public
as $$
  select s.id, s.nombre, s.codigo
    from public.sedes s
   where s.activa and public.usuario_activo() and public.tiene_algun_permiso(array['almacen.traspasar','almacen.ver'])
   order by s.numero;
$$;

-- Nombre de sede para historiales (la otra sede puede no ser visible para el usuario)
create or replace function public.nombre_sede(p_id uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select nombre from public.sedes where id = p_id;
$$;

-- ---------------------------------------------------------------------
-- 6. Alta y edición de productos: siempre dentro de UNA sede
-- ---------------------------------------------------------------------
drop function if exists public.crear_producto(jsonb, uuid, numeric);
create or replace function public.crear_producto(
  p_datos         jsonb,
  p_sede          uuid,
  p_stock_inicial numeric default 0
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  perform public.exigir_permiso('productos.crear');
  perform public.exigir_sede(p_sede);

  if length(trim(coalesce(p_datos ->> 'codigo', ''))) = 0 then raise exception 'El código es obligatorio.'; end if;
  if length(trim(coalesce(p_datos ->> 'nombre', ''))) < 2 then raise exception 'El nombre es obligatorio.'; end if;
  if exists (select 1 from public.productos where sede_id = p_sede and codigo = trim(p_datos ->> 'codigo')) then
    raise exception 'Ya existe un producto con el código % en esta sede.', trim(p_datos ->> 'codigo');
  end if;

  insert into public.productos (sede_id, codigo, nombre, descripcion, categoria_id, precio_venta, precio_compra,
                                unidad, stock_minimo, activo, created_by)
  values (p_sede, trim(p_datos ->> 'codigo'), trim(p_datos ->> 'nombre'), nullif(trim(p_datos ->> 'descripcion'), ''),
          nullif(p_datos ->> 'categoria_id', '')::uuid,
          coalesce((p_datos ->> 'precio_venta')::numeric, 0),
          coalesce((p_datos ->> 'precio_compra')::numeric, 0),
          coalesce(nullif(p_datos ->> 'unidad', ''), 'Unidad'),
          coalesce((p_datos ->> 'stock_minimo')::numeric, 0),
          coalesce((p_datos ->> 'activo')::boolean, true),
          auth.uid())
  returning id into v_id;

  if coalesce(p_stock_inicial, 0) > 0 then
    perform public.exigir_permiso('almacen.ajustar');
    perform public.registrar_movimiento(p_sede, v_id, p_stock_inicial, 'entrada', 'stock_inicial',
              'Stock inicial al registrar el producto', 'INICIAL');
  end if;

  return v_id;
end;
$$;

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
  v_old public.productos%rowtype; v_actual numeric; v_nuevo_pv numeric; v_nuevo_pc numeric;
begin
  perform public.exigir_permiso('productos.editar');

  select * into v_old from public.productos where id = p_id for update;
  if not found then raise exception 'El producto no existe.'; end if;
  perform public.exigir_sede(v_old.sede_id);

  v_nuevo_pv := coalesce((p_datos ->> 'precio_venta')::numeric,  v_old.precio_venta);
  v_nuevo_pc := coalesce((p_datos ->> 'precio_compra')::numeric, v_old.precio_compra);
  if v_nuevo_pv is distinct from v_old.precio_venta or v_nuevo_pc is distinct from v_old.precio_compra then
    perform public.exigir_permiso('productos.editar_precio');
  end if;
  if p_datos ? 'activo' and (p_datos ->> 'activo')::boolean is distinct from v_old.activo then
    perform public.exigir_permiso('productos.eliminar');
  end if;
  if p_datos ? 'codigo' and trim(p_datos ->> 'codigo') <> v_old.codigo
     and exists (select 1 from public.productos
                  where sede_id = v_old.sede_id and codigo = trim(p_datos ->> 'codigo') and id <> p_id) then
    raise exception 'Ya existe otro producto con el código % en esta sede.', trim(p_datos ->> 'codigo');
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
    if p_sede <> v_old.sede_id then raise exception 'El producto pertenece a otra sede.'; end if;
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

-- ---------------------------------------------------------------------
-- 7. Vistas
-- ---------------------------------------------------------------------
-- Historial de la TIENDA (se muestra en PRODUCTOS). Se agrega la categoría
-- y el nombre de la otra sede se obtiene sin depender de la visibilidad.
create or replace view public.v_movimientos with (security_invoker = true) as
select
  m.id, m.numero, m.fecha, m.sede_id, s.nombre as sede_nombre,
  m.producto_id, p.codigo as producto_codigo, p.nombre as producto, p.unidad,
  m.tipo, m.operacion, m.cantidad, m.stock_antes, m.stock_despues,
  m.motivo, m.referencia, m.usuario_id, m.usuario_nombre,
  m.sede_contraparte_id, public.nombre_sede(m.sede_contraparte_id) as contraparte_nombre,
  m.venta_id, m.compra_id, m.traspaso_id,
  coalesce(c.nombre, 'Sin categoría') as categoria
from public.movimientos_almacen m
join public.productos p on p.id = m.producto_id
join public.sedes s     on s.id = m.sede_id
left join public.categorias c on c.id = p.categoria_id;

-- Stock del ALMACÉN junto al de la tienda
create or replace view public.v_stock_almacen with (security_invoker = true) as
select
  a.producto_id, a.sede_id,
  s.nombre as sede_nombre, s.codigo as sede_codigo,
  p.codigo, p.nombre as producto, coalesce(c.nombre, 'Sin categoría') as categoria, p.unidad, p.activo,
  a.stock,
  coalesce(ss.stock, 0) as stock_tienda,
  coalesce(ss.stock_minimo, p.stock_minimo) as stock_minimo
from public.almacen_sede a
join public.productos p on p.id = a.producto_id
join public.sedes s     on s.id = a.sede_id
left join public.stock_sede ss on ss.producto_id = a.producto_id and ss.sede_id = a.sede_id
left join public.categorias c on c.id = p.categoria_id;

-- Historial de traslados del ALMACÉN
create or replace view public.v_movimientos_bodega with (security_invoker = true) as
select
  m.id, m.numero, m.fecha, m.sede_id, s.nombre as sede_nombre,
  m.producto_id, p.codigo as producto_codigo, p.nombre as producto, p.unidad,
  coalesce(c.nombre, 'Sin categoría') as categoria,
  m.tipo, m.operacion, m.cantidad, m.stock_antes, m.stock_despues,
  m.motivo, m.referencia, m.usuario_id, m.usuario_nombre,
  m.sede_contraparte_id, public.nombre_sede(m.sede_contraparte_id) as contraparte_nombre,
  m.traspaso_id
from public.movimientos_bodega m
join public.productos p on p.id = m.producto_id
join public.sedes s     on s.id = m.sede_id
left join public.categorias c on c.id = p.categoria_id;

-- Control de integridad del almacén: debe devolver 0 filas
create or replace view public.v_control_almacen with (security_invoker = true) as
select a.producto_id, a.sede_id, a.stock as stock_actual,
       coalesce(m.suma, 0) as suma_movimientos, a.stock - coalesce(m.suma, 0) as diferencia
from public.almacen_sede a
left join (select producto_id, sede_id, sum(cantidad) as suma from public.movimientos_bodega group by 1, 2) m
       on m.producto_id = a.producto_id and m.sede_id = a.sede_id
where a.stock <> coalesce(m.suma, 0);

-- ---------------------------------------------------------------------
-- 8. RLS y permisos
-- ---------------------------------------------------------------------
alter table public.almacen_sede       enable row level security;
alter table public.movimientos_bodega enable row level security;

drop policy if exists productos_select on public.productos;
create policy productos_select on public.productos for select to authenticated
  using (public.usuario_activo() and public.puede_ver_sede(sede_id));

drop policy if exists almacen_select on public.almacen_sede;
create policy almacen_select on public.almacen_sede for select to authenticated
  using (public.puede_ver_sede(sede_id) and public.tiene_algun_permiso(array['almacen.ver']));

drop policy if exists mov_bodega_select on public.movimientos_bodega;
create policy mov_bodega_select on public.movimientos_bodega for select to authenticated
  using (public.puede_ver_sede(sede_id) and public.tiene_permiso('almacen.historial'));

-- El historial de la tienda ahora se consulta desde PRODUCTOS (o desde ALMACÉN, como antes)
drop policy if exists mov_select on public.movimientos_almacen;
create policy mov_select on public.movimientos_almacen for select to authenticated
  using (public.puede_ver_sede(sede_id) and public.tiene_algun_permiso(array['productos.historial','almacen.historial']));

revoke insert, update, delete, truncate on public.almacen_sede, public.movimientos_bodega from authenticated;
grant select on public.almacen_sede, public.movimientos_bodega to authenticated;
grant select on public.v_movimientos, public.v_stock_almacen, public.v_movimientos_bodega,
                public.v_control_almacen to authenticated;

revoke execute on function
  public.registrar_movimiento_bodega(uuid, uuid, numeric, text, text, text, text, uuid, uuid)
  from public, authenticated;

revoke all on function
  public.ajustar_almacen(uuid, uuid, numeric, text, text),
  public.fijar_almacen(uuid, uuid, numeric, text),
  public.mover_almacen_tienda(uuid, text, jsonb, text),
  public.enviar_a_sede(uuid, uuid, jsonb, text),
  public.sedes_destino(),
  public.nombre_sede(uuid),
  public.crear_producto(jsonb, uuid, numeric)
  from public;
grant execute on function
  public.ajustar_almacen(uuid, uuid, numeric, text, text),
  public.fijar_almacen(uuid, uuid, numeric, text),
  public.mover_almacen_tienda(uuid, text, jsonb, text),
  public.enviar_a_sede(uuid, uuid, jsonb, text),
  public.sedes_destino(),
  public.nombre_sede(uuid),
  public.crear_producto(jsonb, uuid, numeric)
  to authenticated;
