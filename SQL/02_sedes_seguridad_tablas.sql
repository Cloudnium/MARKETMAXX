-- =====================================================================
-- 02_sedes_seguridad_tablas.sql
-- Sedes (multisede), roles/rangos, permisos, perfiles de usuario y
-- series de numeración por sede.
-- =====================================================================

-- ---------------------------------------------------------------------
-- SEDES: cada tienda/sucursal. TODO dato operativo cuelga de una sede.
-- ---------------------------------------------------------------------
create table if not exists public.sedes (
  id          uuid primary key default gen_random_uuid(),
  numero      int generated always as identity unique,   -- 1,2,3... define las series (F001, F002...)
  codigo      text not null unique check (codigo = upper(codigo) and length(codigo) between 1 and 10),
  nombre      text not null check (length(trim(nombre)) >= 2),
  direccion   text,
  telefono    text,
  ciudad      text,
  activa      boolean not null default true,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists sedes_nombre_uq on public.sedes (lower(nombre));

-- ---------------------------------------------------------------------
-- ROLES (rangos). "nivel" define la jerarquía: un usuario solo puede
-- gestionar usuarios cuyo rol tenga nivel <= al suyo.
-- ---------------------------------------------------------------------
create table if not exists public.roles (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null check (length(trim(nombre)) >= 2),
  descripcion text,
  nivel       int  not null default 10 check (nivel between 0 and 100),
  es_sistema  boolean not null default false,   -- roles base: no se pueden borrar
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists roles_nombre_uq on public.roles (lower(nombre));

-- Catálogo de permisos (funciones restringibles del sistema)
create table if not exists public.permisos (
  codigo      text primary key,                 -- ej. 'ventas.anular'
  modulo      text not null,
  descripcion text not null,
  orden       int  not null default 0
);

-- Qué permisos tiene cada rol
create table if not exists public.rol_permisos (
  rol_id          uuid not null references public.roles(id) on delete cascade,
  permiso_codigo  text not null references public.permisos(codigo) on delete cascade on update cascade,
  primary key (rol_id, permiso_codigo)
);

-- ---------------------------------------------------------------------
-- PERFILES: 1 a 1 con auth.users (Supabase Auth guarda email/contraseña)
-- ---------------------------------------------------------------------
create table if not exists public.perfiles (
  id                      uuid primary key references auth.users(id) on delete cascade,
  codigo                  text not null unique default ('U' || lpad(nextval('public.seq_codigo_usuario')::text, 3, '0')),
  nombre                  text not null check (length(trim(nombre)) >= 2),
  email                   text not null,
  telefono                text,
  rol_id                  uuid references public.roles(id),
  estado                  text not null default 'activo' check (estado in ('activo', 'inactivo')),
  sede_predeterminada_id  uuid references public.sedes(id) on delete set null,
  ultimo_acceso           timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create unique index if not exists perfiles_email_uq on public.perfiles (lower(email));
create index if not exists perfiles_rol_idx on public.perfiles (rol_id);

-- Sedes en las que cada usuario puede trabajar (vender, almacén, etc.)
create table if not exists public.usuario_sedes (
  usuario_id uuid not null references public.perfiles(id) on delete cascade,
  sede_id    uuid not null references public.sedes(id)    on delete cascade,
  created_at timestamptz not null default now(),
  primary key (usuario_id, sede_id)
);
create index if not exists usuario_sedes_sede_idx on public.usuario_sedes (sede_id);

-- ---------------------------------------------------------------------
-- SERIES: numeración correlativa por sede y tipo de documento.
-- Ej. sede 1 => F001-0000001, B001-0000001, NV001-0000001
-- ---------------------------------------------------------------------
create table if not exists public.series_correlativos (
  id          uuid primary key default gen_random_uuid(),
  sede_id     uuid not null references public.sedes(id) on delete cascade,
  tipo        text not null check (tipo in ('factura','boleta','nota_venta','compra','traspaso','ajuste')),
  serie       text not null,
  correlativo int  not null default 0 check (correlativo >= 0),
  unique (sede_id, tipo),
  unique (tipo, serie)
);
