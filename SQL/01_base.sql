-- =====================================================================
-- 01_base.sql
-- Configuración global y utilidades compartidas.
-- Ejecutar en orden: 01 -> 16 (o usar migracion_completa.sql).
-- =====================================================================

-- Configuración clave/valor del sistema (zona horaria, IGV, etc.)
create table if not exists public.configuracion (
  clave       text primary key,
  valor       text not null,
  descripcion text,
  updated_at  timestamptz not null default now()
);

-- Zona horaria del negocio (se usa para "ventas de hoy", reportes, etc.)
create or replace function public.zona_negocio()
returns text
language sql stable
as $$
  select coalesce(
    (select valor from public.configuracion where clave = 'zona_horaria'),
    'America/Lima'
  );
$$;

-- Fecha "calendario" del negocio para un instante dado
create or replace function public.fecha_negocio(ts timestamptz default now())
returns date
language sql stable
as $$
  select (ts at time zone public.zona_negocio())::date;
$$;

-- Trigger genérico: mantiene updated_at
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Secuencia para códigos legibles de usuario (U001, U002, ...)
create sequence if not exists public.seq_codigo_usuario;
