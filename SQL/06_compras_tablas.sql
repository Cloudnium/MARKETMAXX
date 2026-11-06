-- =====================================================================
-- 06_compras_tablas.sql
-- Compras a proveedores (ingresan stock a una sede al recibirse).
-- =====================================================================

create table if not exists public.compras (
  id                    uuid primary key default gen_random_uuid(),
  sede_id               uuid not null references public.sedes(id) on delete restrict,
  numero                text not null unique,             -- C001-000021 (interno)
  comprobante_proveedor text,                             -- N° del documento del proveedor
  proveedor_id          uuid references public.proveedores(id) on delete set null,
  proveedor_nombre      text not null,
  fecha                 timestamptz not null default now(),
  subtotal              numeric(12,2) not null default 0,
  igv                   numeric(12,2) not null default 0,
  total                 numeric(12,2) not null default 0 check (total >= 0),
  estado                text not null default 'pendiente' check (estado in ('pendiente','recibida','anulada')),
  observaciones         text,
  usuario_id            uuid references public.perfiles(id) on delete set null,
  usuario_nombre        text,
  recibida_at           timestamptz,
  recibida_por          uuid references public.perfiles(id) on delete set null,
  anulada_at            timestamptz,
  anulada_por           uuid references public.perfiles(id) on delete set null,
  motivo_anulacion      text,
  created_at            timestamptz not null default now()
);
create index if not exists compras_sede_fecha_idx on public.compras (sede_id, fecha desc);

create table if not exists public.compra_items (
  id               uuid primary key default gen_random_uuid(),
  compra_id        uuid not null references public.compras(id) on delete cascade,
  producto_id      uuid not null references public.productos(id) on delete restrict,
  producto_nombre  text not null,
  cantidad         numeric(12,3) not null check (cantidad > 0),
  precio_compra    numeric(12,2) not null check (precio_compra >= 0),
  subtotal         numeric(12,2) not null check (subtotal >= 0)
);
create index if not exists compra_items_compra_idx on public.compra_items (compra_id);
