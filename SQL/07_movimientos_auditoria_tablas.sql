-- =====================================================================
-- 07_movimientos_auditoria_tablas.sql
-- HISTORIAL DE ALMACÉN (inmutable) y AUDITORÍA general (inmutable).
-- =====================================================================

-- Cada fila = un cambio de stock en una sede. Nunca se edita ni se borra.
-- cantidad es con signo: + entra stock, - sale stock.
-- Invariante: stock_sede.stock = SUM(cantidad) por (producto, sede).
create table if not exists public.movimientos_almacen (
  id                 uuid primary key default gen_random_uuid(),
  numero             bigint generated always as identity unique,   -- orden estricto
  fecha              timestamptz not null default now(),
  sede_id            uuid not null references public.sedes(id)     on delete restrict,
  producto_id        uuid not null references public.productos(id) on delete restrict,
  -- Categoría visible en la UI
  tipo               text not null check (tipo in ('entrada','salida','traspaso','ajuste')),
  -- Operación exacta que originó el movimiento
  operacion          text not null check (operacion in (
                        'stock_inicial','compra','anulacion_compra',
                        'venta','anulacion_venta',
                        'traspaso_salida','traspaso_entrada',
                        'ingreso_manual','ajuste_manual','conteo_fisico','merma','devolucion',
                        'correccion_producto')),
  cantidad           numeric(12,3) not null check (cantidad <> 0),
  stock_antes        numeric(12,3) not null,
  stock_despues      numeric(12,3) not null check (stock_despues >= 0),
  motivo             text,                          -- obligatorio en ajustes/correcciones/anulaciones
  referencia         text,                          -- N° de venta, compra, traspaso, ajuste
  usuario_id         uuid references public.perfiles(id) on delete set null,
  usuario_nombre     text not null default 'Sistema',   -- copia por si el usuario se elimina
  sede_contraparte_id uuid references public.sedes(id) on delete restrict,  -- traspasos: la otra sede
  venta_id           uuid references public.ventas(id)    on delete restrict,
  compra_id          uuid references public.compras(id)   on delete restrict,
  traspaso_id        uuid references public.traspasos(id) on delete restrict,
  check (stock_despues = stock_antes + cantidad),
  check (operacion not in ('ingreso_manual','ajuste_manual','conteo_fisico','merma','devolucion',
                           'correccion_producto','anulacion_venta','anulacion_compra')
         or length(trim(coalesce(motivo,''))) >= 3)
);
create index if not exists mov_sede_fecha_idx    on public.movimientos_almacen (sede_id, fecha desc);
create index if not exists mov_producto_idx      on public.movimientos_almacen (producto_id, sede_id, numero);
create index if not exists mov_venta_idx         on public.movimientos_almacen (venta_id) where venta_id is not null;

-- Auditoría de acciones sensibles (usuarios, roles, sedes, precios...)
create table if not exists public.auditoria (
  id             uuid primary key default gen_random_uuid(),
  fecha          timestamptz not null default now(),
  usuario_id     uuid,
  usuario_nombre text,
  accion         text not null,          -- INSERT / UPDATE / DELETE
  tabla          text not null,
  registro_id    text,
  detalle        jsonb
);
create index if not exists auditoria_fecha_idx on public.auditoria (fecha desc);
create index if not exists auditoria_tabla_idx on public.auditoria (tabla, fecha desc);
