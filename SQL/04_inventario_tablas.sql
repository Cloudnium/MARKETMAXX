-- =====================================================================
-- 04_inventario_tablas.sql
-- Stock por sede y traspasos entre sedes.
-- =====================================================================

-- Stock actual de cada producto en cada sede.
-- IMPORTANTE: esta tabla NO se modifica directamente. Solo la función
-- registrar_movimiento() puede alterarla (lo garantiza un trigger), de
-- modo que todo cambio de stock queda en movimientos_almacen.
create table if not exists public.stock_sede (
  producto_id  uuid not null references public.productos(id) on delete restrict,
  sede_id      uuid not null references public.sedes(id)     on delete restrict,
  stock        numeric(12,3) not null default 0 check (stock >= 0),
  stock_minimo numeric(12,3) check (stock_minimo >= 0),   -- NULL = usar productos.stock_minimo
  updated_at   timestamptz not null default now(),
  primary key (producto_id, sede_id)
);
create index if not exists stock_sede_sede_idx on public.stock_sede (sede_id);

-- Traspasos de mercadería entre sedes
create table if not exists public.traspasos (
  id               uuid primary key default gen_random_uuid(),
  numero           text not null unique,
  sede_origen_id   uuid not null references public.sedes(id),
  sede_destino_id  uuid not null references public.sedes(id),
  fecha            timestamptz not null default now(),
  usuario_id       uuid references public.perfiles(id) on delete set null,
  usuario_nombre   text,
  observaciones    text,
  estado           text not null default 'completado' check (estado in ('completado')),
  check (sede_origen_id <> sede_destino_id)
);
create index if not exists traspasos_origen_idx  on public.traspasos (sede_origen_id, fecha desc);
create index if not exists traspasos_destino_idx on public.traspasos (sede_destino_id, fecha desc);

create table if not exists public.traspaso_items (
  id           uuid primary key default gen_random_uuid(),
  traspaso_id  uuid not null references public.traspasos(id) on delete cascade,
  producto_id  uuid not null references public.productos(id),
  cantidad     numeric(12,3) not null check (cantidad > 0)
);
create index if not exists traspaso_items_traspaso_idx on public.traspaso_items (traspaso_id);
