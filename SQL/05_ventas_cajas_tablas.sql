-- =====================================================================
-- 05_ventas_cajas_tablas.sql
-- Cajas, turnos (sesiones), egresos y ventas con sus ítems.
-- =====================================================================

create table if not exists public.cajas (
  id         uuid primary key default gen_random_uuid(),
  sede_id    uuid not null references public.sedes(id) on delete restrict,
  nombre     text not null check (length(trim(nombre)) >= 1),
  activa     boolean not null default true,
  estado     text not null default 'cerrada' check (estado in ('abierta','cerrada')),
  created_at timestamptz not null default now(),
  unique (sede_id, nombre)
);

-- Cada apertura/cierre de una caja es una sesión (turno)
create table if not exists public.caja_sesiones (
  id               uuid primary key default gen_random_uuid(),
  caja_id          uuid not null references public.cajas(id) on delete restrict,
  sede_id          uuid not null references public.sedes(id) on delete restrict,
  usuario_id       uuid references public.perfiles(id) on delete set null,
  usuario_nombre   text,
  monto_apertura   numeric(12,2) not null default 0 check (monto_apertura >= 0),
  fecha_apertura   timestamptz not null default now(),
  fecha_cierre     timestamptz,
  ingresos_cierre  numeric(12,2),
  egresos_cierre   numeric(12,2),
  ventas_cierre    int,
  monto_sistema    numeric(12,2),     -- apertura + efectivo vendido - egresos
  monto_contado    numeric(12,2),     -- efectivo contado al cerrar
  diferencia       numeric(12,2),
  observaciones    text,
  estado           text not null default 'abierta' check (estado in ('abierta','cerrada'))
);
-- Solo una sesión abierta por caja
create unique index if not exists caja_sesion_abierta_uq
  on public.caja_sesiones (caja_id) where estado = 'abierta';
create index if not exists caja_sesiones_sede_idx on public.caja_sesiones (sede_id, fecha_apertura desc);

create table if not exists public.caja_egresos (
  id             uuid primary key default gen_random_uuid(),
  sesion_id      uuid not null references public.caja_sesiones(id) on delete restrict,
  caja_id        uuid not null references public.cajas(id) on delete restrict,
  sede_id        uuid not null references public.sedes(id) on delete restrict,
  concepto       text not null check (length(trim(concepto)) >= 2),
  monto          numeric(12,2) not null check (monto > 0),
  usuario_id     uuid references public.perfiles(id) on delete set null,
  usuario_nombre text,
  fecha          timestamptz not null default now()
);
create index if not exists caja_egresos_sesion_idx on public.caja_egresos (sesion_id);

create table if not exists public.ventas (
  id                 uuid primary key default gen_random_uuid(),
  sede_id            uuid not null references public.sedes(id) on delete restrict,
  caja_id            uuid not null references public.cajas(id) on delete restrict,
  caja_sesion_id     uuid not null references public.caja_sesiones(id) on delete restrict,
  tipo_comprobante   text not null check (tipo_comprobante in ('factura','boleta','nota_venta')),
  serie              text not null,
  correlativo        int  not null,
  numero             text not null unique,                 -- F001-0000123
  cliente_id         uuid references public.clientes(id) on delete set null,
  cliente_nombre     text not null default 'Cliente Varios',
  cliente_documento  text,
  fecha              timestamptz not null default now(),
  subtotal           numeric(12,2) not null check (subtotal >= 0),   -- sin IGV
  igv                numeric(12,2) not null check (igv >= 0),
  descuento_pct      numeric(5,2)  not null default 0 check (descuento_pct between 0 and 100),
  descuento_monto    numeric(12,2) not null default 0 check (descuento_monto >= 0),
  total              numeric(12,2) not null check (total >= 0),
  metodo_pago        text not null references public.metodos_pago(nombre) on update cascade,
  estado             text not null default 'pagado' check (estado in ('pagado','anulado','pendiente')),
  usuario_id         uuid references public.perfiles(id) on delete set null,
  usuario_nombre     text,
  notas              text,
  anulada_at         timestamptz,
  anulada_por        uuid references public.perfiles(id) on delete set null,
  anulada_por_nombre text,
  motivo_anulacion   text,
  created_at         timestamptz not null default now(),
  unique (sede_id, tipo_comprobante, serie, correlativo),
  check (estado <> 'anulado' or (motivo_anulacion is not null and anulada_at is not null))
);
create index if not exists ventas_sede_fecha_idx  on public.ventas (sede_id, fecha desc);
create index if not exists ventas_sesion_idx      on public.ventas (caja_sesion_id);
create index if not exists ventas_cliente_idx     on public.ventas (cliente_id);

create table if not exists public.venta_items (
  id               uuid primary key default gen_random_uuid(),
  venta_id         uuid not null references public.ventas(id) on delete cascade,
  producto_id      uuid not null references public.productos(id) on delete restrict,
  producto_codigo  text,
  producto_nombre  text not null,
  cantidad         numeric(12,3) not null check (cantidad > 0),
  precio_unitario  numeric(12,2) not null check (precio_unitario >= 0),
  precio_compra    numeric(12,2) not null default 0,           -- costo al momento de vender
  subtotal         numeric(12,2) not null check (subtotal >= 0)
);
create index if not exists venta_items_venta_idx    on public.venta_items (venta_id);
create index if not exists venta_items_producto_idx on public.venta_items (producto_id);
