-- =====================================================================
-- 03_catalogo_tablas.sql
-- Catálogos GLOBALES (compartidos por todas las sedes):
-- categorías, productos, clientes, proveedores, métodos de pago.
-- El STOCK no vive aquí: vive por sede en stock_sede (04).
-- =====================================================================

create table if not exists public.categorias (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null check (length(trim(nombre)) >= 2),
  activa     boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists categorias_nombre_uq on public.categorias (lower(nombre));

create table if not exists public.productos (
  id            uuid primary key default gen_random_uuid(),
  codigo        text not null unique check (length(trim(codigo)) >= 1),
  nombre        text not null check (length(trim(nombre)) >= 2),
  descripcion   text,
  categoria_id  uuid references public.categorias(id) on delete set null,
  precio_venta  numeric(12,2) not null default 0 check (precio_venta >= 0),   -- incluye IGV
  precio_compra numeric(12,2) not null default 0 check (precio_compra >= 0),  -- último costo
  unidad        text not null default 'Unidad',
  stock_minimo  numeric(12,3) not null default 0 check (stock_minimo >= 0),   -- mínimo por defecto
  activo        boolean not null default true,
  created_by    uuid references public.perfiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists productos_categoria_idx on public.productos (categoria_id);
create index if not exists productos_nombre_idx on public.productos (lower(nombre));

create table if not exists public.clientes (
  id         uuid primary key default gen_random_uuid(),
  documento  text,                                  -- DNI / RUC / CE
  nombre     text not null check (length(trim(nombre)) >= 2),
  telefono   text,
  email      text,
  direccion  text,
  tipo       text not null default 'regular' check (tipo in ('regular','vip')),
  activo     boolean not null default true,
  created_by uuid references public.perfiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists clientes_documento_uq
  on public.clientes (documento) where documento is not null and documento <> '';

create table if not exists public.proveedores (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null check (length(trim(nombre)) >= 2),
  ruc        text,
  telefono   text,
  email      text,
  direccion  text,
  activo     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists proveedores_nombre_uq on public.proveedores (lower(nombre));

create table if not exists public.metodos_pago (
  nombre text primary key,
  activo boolean not null default true,
  orden  int not null default 0
);
