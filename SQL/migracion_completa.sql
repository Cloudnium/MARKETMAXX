-- migracion_completa.sql: ejecuta 01..15, 17 y 18 en orden (sin datos demo).
-- Pégalo completo en Supabase > SQL Editor > Run.

-- ######## 01_base.sql ########
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


-- ######## 02_sedes_seguridad_tablas.sql ########
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


-- ######## 03_catalogo_tablas.sql ########
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


-- ######## 04_inventario_tablas.sql ########
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


-- ######## 05_ventas_cajas_tablas.sql ########
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


-- ######## 06_compras_tablas.sql ########
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


-- ######## 07_movimientos_auditoria_tablas.sql ########
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


-- ######## 08_funciones_seguridad.sql ########
-- =====================================================================
-- 08_funciones_seguridad.sql
-- Funciones de autorización (usadas por RLS y por las funciones de
-- negocio) y creación automática de perfil al registrarse un usuario.
-- =====================================================================

create or replace function public.usuario_activo()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.perfiles where id = auth.uid() and estado = 'activo');
$$;

create or replace function public.tiene_permiso(p_codigo text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.perfiles pf
    join public.roles r         on r.id = pf.rol_id and r.activo
    join public.rol_permisos rp on rp.rol_id = r.id
    where pf.id = auth.uid()
      and pf.estado = 'activo'
      and rp.permiso_codigo = p_codigo
  );
$$;

create or replace function public.tiene_algun_permiso(p_codigos text[])
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.perfiles pf
    join public.roles r         on r.id = pf.rol_id and r.activo
    join public.rol_permisos rp on rp.rol_id = r.id
    where pf.id = auth.uid()
      and pf.estado = 'activo'
      and rp.permiso_codigo = any (p_codigos)
  );
$$;

-- Nivel jerárquico (rango) del usuario actual
create or replace function public.nivel_usuario()
returns int
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select r.nivel from public.perfiles pf join public.roles r on r.id = pf.rol_id
      where pf.id = auth.uid() and pf.estado = 'activo'), 0);
$$;

-- ¿El usuario puede VER datos de esa sede?
create or replace function public.puede_ver_sede(p_sede uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.usuario_activo() and (
    public.tiene_permiso('sedes.ver_todas')
    or exists (select 1 from public.usuario_sedes us where us.usuario_id = auth.uid() and us.sede_id = p_sede)
  );
$$;

-- ¿El usuario puede OPERAR (vender, mover stock...) en esa sede?
create or replace function public.puede_operar_en_sede(p_sede uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.sedes where id = p_sede and activa)
     and public.puede_ver_sede(p_sede);
$$;

-- Lanza error si el usuario actual no tiene el permiso
create or replace function public.exigir_permiso(p_codigo text)
returns void
language plpgsql stable security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sesión no válida. Vuelve a iniciar sesión.' using errcode = '42501';
  end if;
  if not public.tiene_permiso(p_codigo) then
    raise exception 'No tienes permiso para realizar esta acción (%).', p_codigo using errcode = '42501';
  end if;
end;
$$;

create or replace function public.exigir_sede(p_sede uuid)
returns void
language plpgsql stable security definer set search_path = public
as $$
begin
  if p_sede is null or not public.puede_operar_en_sede(p_sede) then
    raise exception 'No puedes operar en la sede seleccionada.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.nombre_usuario(p_id uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select coalesce((select nombre from public.perfiles where id = p_id), 'Sistema');
$$;

-- ¿El usuario actual puede crear/editar a otro usuario con ese rol?
-- Regla de rango: solo puede gestionar usuarios de nivel <= al suyo.
create or replace function public.validar_gestion_usuario(
  p_permiso text,
  p_rol_destino uuid default null,
  p_usuario_destino uuid default null
) returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare
  v_mi_nivel int;
  v_nivel_rol int;
  v_nivel_actual int;
begin
  if not public.tiene_permiso(p_permiso) then return false; end if;
  v_mi_nivel := public.nivel_usuario();

  if p_rol_destino is not null then
    select nivel into v_nivel_rol from public.roles where id = p_rol_destino and activo;
    if v_nivel_rol is null or v_nivel_rol > v_mi_nivel then return false; end if;
  end if;

  if p_usuario_destino is not null then
    select coalesce(r.nivel, 0) into v_nivel_actual
      from public.perfiles pf left join public.roles r on r.id = pf.rol_id
     where pf.id = p_usuario_destino;
    if v_nivel_actual > v_mi_nivel then return false; end if;
  end if;
  return true;
end;
$$;

-- Permisos del usuario actual (para ocultar/mostrar opciones en la UI)
create or replace function public.mis_permisos()
returns text[]
language sql stable security definer set search_path = public
as $$
  select coalesce(array_agg(rp.permiso_codigo order by rp.permiso_codigo), '{}')
  from public.perfiles pf
  join public.roles r         on r.id = pf.rol_id and r.activo
  join public.rol_permisos rp on rp.rol_id = r.id
  where pf.id = auth.uid() and pf.estado = 'activo';
$$;

-- Siguiente correlativo atómico por sede y tipo de documento
create or replace function public.siguiente_correlativo(p_sede uuid, p_tipo text,
                                                        out o_serie text, out o_correlativo int)
language plpgsql security definer set search_path = public
as $$
begin
  update public.series_correlativos
     set correlativo = correlativo + 1
   where sede_id = p_sede and tipo = p_tipo
  returning serie, correlativo into o_serie, o_correlativo;

  if o_serie is null then
    raise exception 'La sede no tiene serie configurada para "%".', p_tipo;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Alta automática de perfil cuando se crea un usuario en Supabase Auth.
--  * El PRIMER usuario del sistema se convierte en Administrador.
--  * Los demás se crean desde la app (con rol en raw_user_meta_data.rol_id).
--    Si no traen rol quedan 'inactivo' hasta que un administrador los active.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_primero boolean;
  v_rol     uuid;
  v_estado  text;
  v_nombre  text;
begin
  select not exists (select 1 from public.perfiles) into v_primero;
  v_nombre := coalesce(nullif(trim(new.raw_user_meta_data ->> 'nombre'), ''), split_part(new.email, '@', 1));

  if v_primero then
    select id into v_rol from public.roles where nombre = 'Administrador' limit 1;
    v_estado := 'activo';
  else
    v_rol := nullif(new.raw_user_meta_data ->> 'rol_id', '')::uuid;
    v_estado := case when v_rol is null then 'inactivo'
                     else coalesce(nullif(new.raw_user_meta_data ->> 'estado', ''), 'activo') end;
  end if;

  insert into public.perfiles (id, nombre, email, telefono, rol_id, estado)
  values (new.id, v_nombre, new.email, nullif(new.raw_user_meta_data ->> 'telefono', ''), v_rol, v_estado);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ######## 09_triggers.sql ########
-- =====================================================================
-- 09_triggers.sql
-- Blindajes de integridad, creación automática de datos por sede y
-- auditoría. Aquí vive la regla "todo movimiento de stock se registra".
-- =====================================================================

-- ---------------------------------------------------------------------
-- updated_at automático
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['sedes','roles','perfiles','productos','clientes','proveedores'] loop
    execute format('drop trigger if exists trg_%1$s_updated on public.%1$s', t);
    execute format('create trigger trg_%1$s_updated before update on public.%1$s
                    for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- GUARDIA DE STOCK: stock_sede solo cambia dentro de registrar_movimiento()
-- (que activa la variable app.mov_ok durante la transacción).
-- ---------------------------------------------------------------------
create or replace function public.trg_stock_guard()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('app.mov_ok', true), 'off') = 'on' then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' and new.stock = 0 then
    return new;                         -- filas vacías al crear sede/producto
  end if;
  if tg_op = 'UPDATE' and new.stock = old.stock then
    return new;                         -- cambios que no tocan el stock (ej. stock_minimo)
  end if;
  if tg_op = 'DELETE' and old.stock = 0 then
    return old;
  end if;

  raise exception 'El stock solo puede modificarse registrando un movimiento de almacén.'
    using errcode = '42501';
end;
$$;

drop trigger if exists trg_stock_guard on public.stock_sede;
create trigger trg_stock_guard
  before insert or update or delete on public.stock_sede
  for each row execute function public.trg_stock_guard();

-- ---------------------------------------------------------------------
-- Tablas de solo-añadir: movimientos y auditoría no se editan ni borran
-- ---------------------------------------------------------------------
create or replace function public.trg_solo_insertar()
returns trigger
language plpgsql
as $$
begin
  raise exception 'La tabla % es de solo lectura histórica: no se permite % de registros.',
    tg_table_name, lower(tg_op) using errcode = '42501';
end;
$$;

drop trigger if exists trg_mov_inmutable on public.movimientos_almacen;
create trigger trg_mov_inmutable
  before update or delete on public.movimientos_almacen
  for each row execute function public.trg_solo_insertar();

drop trigger if exists trg_auditoria_inmutable on public.auditoria;
create trigger trg_auditoria_inmutable
  before update or delete on public.auditoria
  for each row execute function public.trg_solo_insertar();

-- ---------------------------------------------------------------------
-- Documentos que nunca se borran (se anulan)
-- ---------------------------------------------------------------------
create or replace function public.trg_no_borrar()
returns trigger
language plpgsql
as $$
begin
  raise exception 'No se permite eliminar registros de % (usa anulación).', tg_table_name
    using errcode = '42501';
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['ventas','venta_items','compras','compra_items','traspasos','traspaso_items',
                           'caja_sesiones','caja_egresos','sedes','productos'] loop
    execute format('drop trigger if exists trg_%1$s_nodelete on public.%1$s', t);
    execute format('create trigger trg_%1$s_nodelete before delete on public.%1$s
                    for each row execute function public.trg_no_borrar()', t);
  end loop;
end $$;

-- Una venta solo puede cambiar de pagado -> anulado; sus importes son inmutables
create or replace function public.trg_ventas_inmutable()
returns trigger
language plpgsql
as $$
begin
  if old.estado = 'anulado' then
    raise exception 'La venta % ya está anulada y no puede modificarse.', old.numero;
  end if;
  if new.total is distinct from old.total
     or new.subtotal is distinct from old.subtotal
     or new.igv is distinct from old.igv
     or new.sede_id is distinct from old.sede_id
     or new.numero is distinct from old.numero
     or new.caja_sesion_id is distinct from old.caja_sesion_id
     or new.metodo_pago is distinct from old.metodo_pago then
    raise exception 'Los importes de una venta emitida no se pueden modificar.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ventas_inmutable on public.ventas;
create trigger trg_ventas_inmutable
  before update on public.ventas
  for each row execute function public.trg_ventas_inmutable();

-- Desactivar clientes/proveedores requiere permiso específico
create or replace function public.trg_desactivar_requiere_permiso()
returns trigger
language plpgsql
as $$
declare v_permiso text;
begin
  if new.activo is distinct from old.activo and new.activo = false then
    v_permiso := case tg_table_name when 'clientes' then 'clientes.eliminar' else 'compras.anular' end;
    perform public.exigir_permiso(v_permiso);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_clientes_desactivar on public.clientes;
create trigger trg_clientes_desactivar before update on public.clientes
  for each row execute function public.trg_desactivar_requiere_permiso();
drop trigger if exists trg_proveedores_desactivar on public.proveedores;
create trigger trg_proveedores_desactivar before update on public.proveedores
  for each row execute function public.trg_desactivar_requiere_permiso();

-- ---------------------------------------------------------------------
-- MULTISEDE AUTOMÁTICO
-- Al crear una sede: series de numeración, stock en 0 de todos los
-- productos y una "Caja 1". Al crear un producto: fila de stock en
-- todas las sedes. Así una sede nueva funciona sin pasos manuales.
-- ---------------------------------------------------------------------
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

  insert into public.stock_sede (producto_id, sede_id, stock)
  select p.id, new.id, 0 from public.productos p
  on conflict do nothing;

  insert into public.cajas (sede_id, nombre) values (new.id, 'Caja 1');
  return new;
end;
$$;

drop trigger if exists trg_sede_nueva on public.sedes;
create trigger trg_sede_nueva after insert on public.sedes
  for each row execute function public.trg_sede_nueva();

create or replace function public.trg_producto_nuevo()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.stock_sede (producto_id, sede_id, stock)
  select new.id, s.id, 0 from public.sedes s
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists trg_producto_nuevo on public.productos;
create trigger trg_producto_nuevo after insert on public.productos
  for each row execute function public.trg_producto_nuevo();

-- ---------------------------------------------------------------------
-- AUDITORÍA genérica (solo guarda los campos que cambiaron)
-- ---------------------------------------------------------------------
create or replace function public.fn_auditar()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_old jsonb; v_new jsonb; v_ref jsonb;
  v_antes jsonb; v_despues jsonb; v_id text;
begin
  if tg_op = 'INSERT' then
    v_new := to_jsonb(new); v_ref := v_new; v_despues := v_new;
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old); v_new := to_jsonb(new); v_ref := v_new;
    select jsonb_object_agg(n.key, n.value), jsonb_object_agg(n.key, v_old -> n.key)
      into v_despues, v_antes
      from jsonb_each(v_new) n
     where n.key <> 'updated_at' and (v_old -> n.key) is distinct from n.value;
    if v_despues is null then return new; end if;     -- nada relevante cambió
  else
    v_old := to_jsonb(old); v_ref := v_old; v_antes := v_old;
  end if;

  v_id := coalesce(v_ref ->> 'id',
                   (v_ref ->> 'rol_id') || ':' || (v_ref ->> 'permiso_codigo'),
                   (v_ref ->> 'usuario_id') || ':' || (v_ref ->> 'sede_id'));

  insert into public.auditoria (usuario_id, usuario_nombre, accion, tabla, registro_id, detalle)
  values (auth.uid(), public.nombre_usuario(auth.uid()), tg_op, tg_table_name, v_id,
          jsonb_strip_nulls(jsonb_build_object('antes', v_antes, 'despues', v_despues)));

  return coalesce(new, old);
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['productos','sedes','perfiles','roles','rol_permisos','usuario_sedes','clientes','proveedores'] loop
    execute format('drop trigger if exists trg_%1$s_audit on public.%1$s', t);
    execute format('create trigger trg_%1$s_audit after insert or update or delete on public.%1$s
                    for each row execute function public.fn_auditar()', t);
  end loop;
end $$;


-- ######## 10_funciones_inventario.sql ########
-- =====================================================================
-- 10_funciones_inventario.sql
-- ÚNICO punto de entrada para modificar stock: registrar_movimiento().
-- Sobre él se construyen ajustes, traspasos, alta/edición de productos.
-- =====================================================================

-- ---------------------------------------------------------------------
-- registrar_movimiento (INTERNA): cambia el stock y deja el historial.
-- No es invocable por usuarios; la usan las demás funciones del sistema.
-- ---------------------------------------------------------------------
create or replace function public.registrar_movimiento(
  p_sede         uuid,
  p_producto     uuid,
  p_delta        numeric,           -- + entra / - sale
  p_tipo         text,              -- entrada | salida | traspaso | ajuste
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
  v_antes   numeric;
  v_despues numeric;
  v_id      uuid;
  v_prod    text;
  v_uid     uuid := auth.uid();
begin
  if p_delta is null or p_delta = 0 then
    raise exception 'La cantidad del movimiento no puede ser cero.';
  end if;

  perform set_config('app.mov_ok', 'on', true);

  select stock into v_antes
    from public.stock_sede
   where producto_id = p_producto and sede_id = p_sede
   for update;

  if not found then
    insert into public.stock_sede (producto_id, sede_id, stock) values (p_producto, p_sede, 0);
    v_antes := 0;
  end if;

  v_despues := v_antes + p_delta;
  if v_despues < 0 then
    select nombre into v_prod from public.productos where id = p_producto;
    raise exception 'Stock insuficiente de "%": disponible %, solicitado %.',
      v_prod, v_antes, abs(p_delta) using errcode = '23514';
  end if;

  update public.stock_sede
     set stock = v_despues, updated_at = now()
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

-- ---------------------------------------------------------------------
-- ajustar_stock: agregar / descontar stock manualmente CON MOTIVO.
--   p_operacion: ingreso_manual | ajuste_manual | merma | devolucion
--   p_delta: positivo suma, negativo resta (merma siempre resta)
-- ---------------------------------------------------------------------
create or replace function public.ajustar_stock(
  p_sede      uuid,
  p_producto  uuid,
  p_delta     numeric,
  p_operacion text,
  p_motivo    text
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_ref text; v_serie text; v_corr int; v_tipo text; v_delta numeric := p_delta;
begin
  perform public.exigir_permiso('almacen.ajustar');
  perform public.exigir_sede(p_sede);

  if p_operacion not in ('ingreso_manual','ajuste_manual','merma','devolucion') then
    raise exception 'Operación de ajuste no válida: %', p_operacion;
  end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Debes indicar el motivo del ajuste.';
  end if;
  if p_delta is null or p_delta = 0 then
    raise exception 'La cantidad debe ser distinta de cero.';
  end if;
  if p_operacion in ('ingreso_manual','devolucion') and p_delta < 0 then
    raise exception 'Para esta operación la cantidad debe ser positiva.';
  end if;
  if p_operacion = 'merma' then v_delta := -abs(p_delta); end if;

  v_tipo := case when p_operacion in ('ingreso_manual','devolucion') then 'entrada' else 'ajuste' end;
  select o_serie, o_correlativo into v_serie, v_corr from public.siguiente_correlativo(p_sede, 'ajuste');
  v_ref := v_serie || '-' || lpad(v_corr::text, 6, '0');

  return public.registrar_movimiento(p_sede, p_producto, v_delta, v_tipo, p_operacion, p_motivo, v_ref);
end;
$$;

-- ---------------------------------------------------------------------
-- fijar_stock: conteo físico. Deja el stock exactamente en p_nuevo_stock.
-- ---------------------------------------------------------------------
create or replace function public.fijar_stock(
  p_sede        uuid,
  p_producto    uuid,
  p_nuevo_stock numeric,
  p_motivo      text
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_actual numeric; v_serie text; v_corr int;
begin
  perform public.exigir_permiso('almacen.ajustar');
  perform public.exigir_sede(p_sede);

  if p_nuevo_stock is null or p_nuevo_stock < 0 then
    raise exception 'El stock contado no puede ser negativo.';
  end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Debes indicar el motivo del ajuste.';
  end if;

  select stock into v_actual from public.stock_sede
   where producto_id = p_producto and sede_id = p_sede for update;
  v_actual := coalesce(v_actual, 0);
  if p_nuevo_stock = v_actual then return null; end if;

  select o_serie, o_correlativo into v_serie, v_corr from public.siguiente_correlativo(p_sede, 'ajuste');
  return public.registrar_movimiento(p_sede, p_producto, p_nuevo_stock - v_actual, 'ajuste',
           'conteo_fisico', p_motivo, v_serie || '-' || lpad(v_corr::text, 6, '0'));
end;
$$;

-- ---------------------------------------------------------------------
-- traspasar: mueve stock de una sede a otra (2 movimientos enlazados).
--   p_items: [{"producto_id": "...", "cantidad": 5}, ...]
-- ---------------------------------------------------------------------
create or replace function public.traspasar(
  p_origen  uuid,
  p_destino uuid,
  p_items   jsonb,
  p_observaciones text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid; v_serie text; v_corr int; v_num text;
  r record; v_uid uuid := auth.uid();
begin
  perform public.exigir_permiso('almacen.traspasar');
  perform public.exigir_sede(p_origen);
  if p_origen = p_destino then raise exception 'La sede de origen y destino deben ser distintas.'; end if;
  if not exists (select 1 from public.sedes where id = p_destino and activa) then
    raise exception 'La sede de destino no existe o está inactiva.';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Agrega al menos un producto al traspaso.';
  end if;

  select o_serie, o_correlativo into v_serie, v_corr from public.siguiente_correlativo(p_origen, 'traspaso');
  v_num := v_serie || '-' || lpad(v_corr::text, 6, '0');

  insert into public.traspasos (numero, sede_origen_id, sede_destino_id, usuario_id, usuario_nombre, observaciones)
  values (v_num, p_origen, p_destino, v_uid, public.nombre_usuario(v_uid), nullif(trim(p_observaciones), ''))
  returning id into v_id;

  for r in
    select (e ->> 'producto_id')::uuid as producto_id, sum((e ->> 'cantidad')::numeric) as cantidad
      from jsonb_array_elements(p_items) e
     group by 1 order by 1
  loop
    if r.cantidad is null or r.cantidad <= 0 then raise exception 'Cantidad de traspaso no válida.'; end if;

    insert into public.traspaso_items (traspaso_id, producto_id, cantidad) values (v_id, r.producto_id, r.cantidad);

    perform public.registrar_movimiento(p_origen,  r.producto_id, -r.cantidad, 'traspaso', 'traspaso_salida',
              nullif(trim(p_observaciones), ''), v_num, p_destino, null, null, v_id);
    perform public.registrar_movimiento(p_destino, r.producto_id,  r.cantidad, 'traspaso', 'traspaso_entrada',
              nullif(trim(p_observaciones), ''), v_num, p_origen,  null, null, v_id);
  end loop;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- crear_producto: alta del producto + stock inicial (con movimiento)
--   p_datos: {codigo, nombre, descripcion, categoria_id, precio_venta,
--             precio_compra, unidad, stock_minimo, activo}
-- ---------------------------------------------------------------------
create or replace function public.crear_producto(
  p_datos         jsonb,
  p_sede          uuid    default null,
  p_stock_inicial numeric default 0
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  perform public.exigir_permiso('productos.crear');

  if length(trim(coalesce(p_datos ->> 'codigo', ''))) = 0 then raise exception 'El código es obligatorio.'; end if;
  if length(trim(coalesce(p_datos ->> 'nombre', ''))) < 2 then raise exception 'El nombre es obligatorio.'; end if;
  if exists (select 1 from public.productos where codigo = trim(p_datos ->> 'codigo')) then
    raise exception 'Ya existe un producto con el código %.', trim(p_datos ->> 'codigo');
  end if;

  insert into public.productos (codigo, nombre, descripcion, categoria_id, precio_venta, precio_compra,
                                unidad, stock_minimo, activo, created_by)
  values (trim(p_datos ->> 'codigo'), trim(p_datos ->> 'nombre'), nullif(trim(p_datos ->> 'descripcion'), ''),
          nullif(p_datos ->> 'categoria_id', '')::uuid,
          coalesce((p_datos ->> 'precio_venta')::numeric, 0),
          coalesce((p_datos ->> 'precio_compra')::numeric, 0),
          coalesce(nullif(p_datos ->> 'unidad', ''), 'Unidad'),
          coalesce((p_datos ->> 'stock_minimo')::numeric, 0),
          coalesce((p_datos ->> 'activo')::boolean, true),
          auth.uid())
  returning id into v_id;

  if coalesce(p_stock_inicial, 0) > 0 then
    perform public.exigir_sede(p_sede);
    perform public.exigir_permiso('almacen.ajustar');
    perform public.registrar_movimiento(p_sede, v_id, p_stock_inicial, 'entrada', 'stock_inicial',
              'Stock inicial al registrar el producto', 'INICIAL');
  end if;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- actualizar_producto: edita datos. Cambiar precios exige permiso propio;
-- cambiar el stock de una sede exige permiso + MOTIVO y queda en el historial.
-- ---------------------------------------------------------------------
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
  v_old public.productos%rowtype;
  v_actual numeric;
  v_nuevo_pv numeric; v_nuevo_pc numeric;
begin
  perform public.exigir_permiso('productos.editar');

  select * into v_old from public.productos where id = p_id for update;
  if not found then raise exception 'El producto no existe.'; end if;

  v_nuevo_pv := coalesce((p_datos ->> 'precio_venta')::numeric,  v_old.precio_venta);
  v_nuevo_pc := coalesce((p_datos ->> 'precio_compra')::numeric, v_old.precio_compra);
  if v_nuevo_pv is distinct from v_old.precio_venta or v_nuevo_pc is distinct from v_old.precio_compra then
    perform public.exigir_permiso('productos.editar_precio');
  end if;
  if p_datos ? 'activo' and (p_datos ->> 'activo')::boolean is distinct from v_old.activo then
    perform public.exigir_permiso('productos.eliminar');
  end if;
  if p_datos ? 'codigo' and trim(p_datos ->> 'codigo') <> v_old.codigo
     and exists (select 1 from public.productos where codigo = trim(p_datos ->> 'codigo') and id <> p_id) then
    raise exception 'Ya existe otro producto con el código %.', trim(p_datos ->> 'codigo');
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
    perform public.exigir_sede(p_sede);
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


-- ######## 11_funciones_ventas_cajas.sql ########
-- =====================================================================
-- 11_funciones_ventas_cajas.sql
-- Cajas (crear/abrir/cerrar/egresos) y ventas (registrar/anular).
-- Toda la lógica crítica corre en la BD: el precio y el stock se leen
-- aquí, nunca se confía en lo que envía el navegador.
-- =====================================================================

-- Totales de una sesión de caja
create or replace function public.caja_totales(p_sesion uuid)
returns table (ingresos numeric, ingresos_efectivo numeric, egresos numeric, ventas bigint)
language sql stable security definer set search_path = public
as $$
  select
    coalesce((select sum(v.total) from public.ventas v where v.caja_sesion_id = p_sesion and v.estado = 'pagado'), 0),
    coalesce((select sum(v.total) from public.ventas v where v.caja_sesion_id = p_sesion and v.estado = 'pagado' and v.metodo_pago = 'Efectivo'), 0),
    coalesce((select sum(e.monto) from public.caja_egresos e where e.sesion_id = p_sesion), 0),
    (select count(*) from public.ventas v where v.caja_sesion_id = p_sesion and v.estado = 'pagado');
$$;

-- ---------------------------------------------------------------------
-- abrir_caja: inicia un turno
-- ---------------------------------------------------------------------
create or replace function public.abrir_caja(p_caja uuid, p_monto_apertura numeric default 0)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_caja public.cajas%rowtype; v_id uuid; v_uid uuid := auth.uid();
begin
  perform public.exigir_permiso('cajas.abrir');
  select * into v_caja from public.cajas where id = p_caja for update;
  if not found then raise exception 'La caja no existe.'; end if;
  perform public.exigir_sede(v_caja.sede_id);
  if not v_caja.activa then raise exception 'La caja está desactivada.'; end if;
  if v_caja.estado = 'abierta' then raise exception 'La caja ya está abierta.'; end if;
  if coalesce(p_monto_apertura, 0) < 0 then raise exception 'El monto de apertura no puede ser negativo.'; end if;

  insert into public.caja_sesiones (caja_id, sede_id, usuario_id, usuario_nombre, monto_apertura)
  values (p_caja, v_caja.sede_id, v_uid, public.nombre_usuario(v_uid), coalesce(p_monto_apertura, 0))
  returning id into v_id;

  update public.cajas set estado = 'abierta' where id = p_caja;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- crear_caja: crea una caja en la sede (y opcionalmente la abre)
-- ---------------------------------------------------------------------
create or replace function public.crear_caja(p_sede uuid, p_nombre text, p_monto_apertura numeric default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  perform public.exigir_permiso('cajas.crear');
  perform public.exigir_sede(p_sede);
  if length(trim(coalesce(p_nombre, ''))) = 0 then raise exception 'El nombre de la caja es obligatorio.'; end if;
  if exists (select 1 from public.cajas where sede_id = p_sede and lower(nombre) = lower(trim(p_nombre))) then
    raise exception 'Ya existe una caja con ese nombre en la sede.';
  end if;

  insert into public.cajas (sede_id, nombre) values (p_sede, trim(p_nombre)) returning id into v_id;
  if p_monto_apertura is not null then
    perform public.abrir_caja(v_id, p_monto_apertura);
  end if;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- cerrar_caja: cierra el turno y guarda el resumen
-- ---------------------------------------------------------------------
create or replace function public.cerrar_caja(p_caja uuid, p_monto_contado numeric default null, p_observaciones text default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_ses public.caja_sesiones%rowtype; t record; v_sistema numeric;
begin
  perform public.exigir_permiso('cajas.cerrar');
  select * into v_ses from public.caja_sesiones where caja_id = p_caja and estado = 'abierta' for update;
  if not found then raise exception 'La caja no tiene un turno abierto.'; end if;
  perform public.exigir_sede(v_ses.sede_id);
  if v_ses.usuario_id is distinct from auth.uid() then
    perform public.exigir_permiso('cajas.supervisar');
  end if;

  select * into t from public.caja_totales(v_ses.id);
  v_sistema := v_ses.monto_apertura + t.ingresos_efectivo - t.egresos;

  update public.caja_sesiones set
    estado = 'cerrada', fecha_cierre = now(),
    ingresos_cierre = t.ingresos, egresos_cierre = t.egresos, ventas_cierre = t.ventas,
    monto_sistema = v_sistema, monto_contado = p_monto_contado,
    diferencia = case when p_monto_contado is null then null else p_monto_contado - v_sistema end,
    observaciones = nullif(trim(p_observaciones), '')
  where id = v_ses.id;

  update public.cajas set estado = 'cerrada' where id = p_caja;
  return v_ses.id;
end;
$$;

-- ---------------------------------------------------------------------
-- registrar_egreso: salida de dinero de la caja abierta
-- ---------------------------------------------------------------------
create or replace function public.registrar_egreso(p_caja uuid, p_concepto text, p_monto numeric)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_ses public.caja_sesiones%rowtype; v_id uuid; v_uid uuid := auth.uid();
begin
  perform public.exigir_permiso('cajas.egresos');
  select * into v_ses from public.caja_sesiones where caja_id = p_caja and estado = 'abierta';
  if not found then raise exception 'La caja no está abierta.'; end if;
  perform public.exigir_sede(v_ses.sede_id);
  if v_ses.usuario_id is distinct from v_uid then perform public.exigir_permiso('cajas.supervisar'); end if;
  if length(trim(coalesce(p_concepto, ''))) < 2 then raise exception 'Indica el concepto del egreso.'; end if;
  if p_monto is null or p_monto <= 0 then raise exception 'El monto del egreso debe ser mayor a cero.'; end if;

  insert into public.caja_egresos (sesion_id, caja_id, sede_id, concepto, monto, usuario_id, usuario_nombre)
  values (v_ses.id, p_caja, v_ses.sede_id, trim(p_concepto), p_monto, v_uid, public.nombre_usuario(v_uid))
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- registrar_venta
--   p_items: [{"producto_id": "...", "cantidad": 2}, ...]
--   Devuelve {id, numero, total}
-- ---------------------------------------------------------------------
create or replace function public.registrar_venta(
  p_sede           uuid,
  p_caja           uuid,
  p_tipo           text,
  p_cliente        uuid,
  p_metodo_pago    text,
  p_descuento_pct  numeric,
  p_items          jsonb,
  p_notas          text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ses public.caja_sesiones%rowtype;
  v_cli public.clientes%rowtype;
  v_prod public.productos%rowtype;
  v_row record;
  v_pct numeric := coalesce(p_descuento_pct, 0);
  v_bruto numeric := 0; v_desc numeric; v_total numeric; v_sub numeric; v_igv numeric;
  v_serie text; v_corr int; v_num text; v_venta uuid; v_linea numeric;
begin
  perform public.exigir_permiso('ventas.crear');
  perform public.exigir_sede(p_sede);

  if p_tipo not in ('factura','boleta','nota_venta') then raise exception 'Tipo de comprobante no válido.'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta no tiene productos.';
  end if;
  if v_pct < 0 or v_pct > 100 then raise exception 'El descuento debe estar entre 0 y 100.'; end if;
  if v_pct > 0 then perform public.exigir_permiso('ventas.descuentos'); end if;
  if not exists (select 1 from public.metodos_pago where nombre = p_metodo_pago and activo) then
    raise exception 'Método de pago no válido.';
  end if;

  if not exists (select 1 from public.cajas where id = p_caja and sede_id = p_sede and activa) then
    raise exception 'La caja no pertenece a la sede seleccionada.';
  end if;
  select * into v_ses from public.caja_sesiones where caja_id = p_caja and estado = 'abierta';
  if not found then raise exception 'La caja seleccionada no está abierta. Ábrela para vender.'; end if;

  if p_cliente is not null then
    select * into v_cli from public.clientes where id = p_cliente and activo;
    if not found then raise exception 'El cliente no existe o está inactivo.'; end if;
  end if;
  if p_tipo = 'factura' and (p_cliente is null or coalesce(v_cli.documento, '') = '') then
    raise exception 'La factura requiere un cliente con documento (RUC).';
  end if;

  -- 1) Validar productos y calcular total (precios SIEMPRE desde la BD)
  for v_row in
    select (e ->> 'producto_id')::uuid as producto_id, sum((e ->> 'cantidad')::numeric) as cantidad
      from jsonb_array_elements(p_items) e group by 1 order by 1
  loop
    if v_row.cantidad is null or v_row.cantidad <= 0 then raise exception 'Cantidad no válida en la venta.'; end if;
    select * into v_prod from public.productos where id = v_row.producto_id;
    if not found or not v_prod.activo then raise exception 'Hay un producto no disponible en la venta.'; end if;
    v_bruto := v_bruto + round(v_prod.precio_venta * v_row.cantidad, 2);
  end loop;

  v_desc  := round(v_bruto * v_pct / 100, 2);
  v_total := v_bruto - v_desc;
  v_sub   := round(v_total / 1.18, 2);
  v_igv   := v_total - v_sub;

  -- 2) Cabecera
  select o_serie, o_correlativo into v_serie, v_corr from public.siguiente_correlativo(p_sede, p_tipo);
  v_num := v_serie || '-' || lpad(v_corr::text, 7, '0');

  insert into public.ventas (
    sede_id, caja_id, caja_sesion_id, tipo_comprobante, serie, correlativo, numero,
    cliente_id, cliente_nombre, cliente_documento, subtotal, igv, descuento_pct, descuento_monto,
    total, metodo_pago, estado, usuario_id, usuario_nombre, notas)
  values (
    p_sede, p_caja, v_ses.id, p_tipo, v_serie, v_corr, v_num,
    p_cliente, coalesce(v_cli.nombre, 'Cliente Varios'), v_cli.documento, v_sub, v_igv, v_pct, v_desc,
    v_total, p_metodo_pago, 'pagado', v_uid, public.nombre_usuario(v_uid), nullif(trim(p_notas), ''))
  returning id into v_venta;

  -- 3) Ítems + salida de stock (cada una queda en el historial de almacén)
  for v_row in
    select (e ->> 'producto_id')::uuid as producto_id, sum((e ->> 'cantidad')::numeric) as cantidad
      from jsonb_array_elements(p_items) e group by 1 order by 1
  loop
    select * into v_prod from public.productos where id = v_row.producto_id;
    v_linea := round(v_prod.precio_venta * v_row.cantidad, 2);

    insert into public.venta_items (venta_id, producto_id, producto_codigo, producto_nombre, cantidad,
                                    precio_unitario, precio_compra, subtotal)
    values (v_venta, v_prod.id, v_prod.codigo, v_prod.nombre, v_row.cantidad,
            v_prod.precio_venta, v_prod.precio_compra, v_linea);

    perform public.registrar_movimiento(p_sede, v_prod.id, -v_row.cantidad, 'salida', 'venta',
              null, v_num, null, v_venta);
  end loop;

  return jsonb_build_object('id', v_venta, 'numero', v_num, 'total', v_total);
end;
$$;

-- ---------------------------------------------------------------------
-- anular_venta: devuelve el stock y registra quién y por qué
-- ---------------------------------------------------------------------
create or replace function public.anular_venta(p_venta uuid, p_motivo text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v public.ventas%rowtype; v_ses_estado text; it record; v_uid uuid := auth.uid();
begin
  perform public.exigir_permiso('ventas.anular');
  select * into v from public.ventas where id = p_venta for update;
  if not found then raise exception 'La venta no existe.'; end if;
  perform public.exigir_sede(v.sede_id);
  if v.estado = 'anulado' then raise exception 'La venta ya está anulada.'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 5 then
    raise exception 'Indica el motivo de la anulación (mínimo 5 caracteres).';
  end if;

  select estado into v_ses_estado from public.caja_sesiones where id = v.caja_sesion_id;
  if v_ses_estado = 'cerrada' then
    perform public.exigir_permiso('cajas.supervisar');   -- afecta un turno ya cerrado
  end if;

  update public.ventas set
    estado = 'anulado', anulada_at = now(), anulada_por = v_uid,
    anulada_por_nombre = public.nombre_usuario(v_uid), motivo_anulacion = trim(p_motivo)
  where id = p_venta;

  for it in select producto_id, cantidad from public.venta_items where venta_id = p_venta order by producto_id loop
    perform public.registrar_movimiento(v.sede_id, it.producto_id, it.cantidad, 'entrada', 'anulacion_venta',
              'Anulación de ' || v.numero || ': ' || trim(p_motivo), v.numero, null, p_venta);
  end loop;

  return p_venta;
end;
$$;


-- ######## 12_funciones_compras_sedes.sql ########
-- =====================================================================
-- 12_funciones_compras_sedes.sql
-- Compras a proveedores y administración de sedes.
-- =====================================================================

-- Interna: ingresa al stock los ítems de una compra
create or replace function public._recibir_compra(p_compra uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare c public.compras%rowtype; it record; v_uid uuid := auth.uid();
begin
  select * into c from public.compras where id = p_compra for update;
  if c.estado <> 'pendiente' then raise exception 'La compra % no está pendiente.', c.numero; end if;

  for it in select producto_id, cantidad, precio_compra from public.compra_items
             where compra_id = p_compra order by producto_id loop
    perform public.registrar_movimiento(c.sede_id, it.producto_id, it.cantidad, 'entrada', 'compra',
              null, c.numero, null, null, p_compra);
    update public.productos set precio_compra = it.precio_compra where id = it.producto_id;   -- último costo
  end loop;

  update public.compras set estado = 'recibida', recibida_at = now(), recibida_por = v_uid where id = p_compra;
end;
$$;

-- ---------------------------------------------------------------------
-- registrar_compra
--   p_items: [{"producto_id":"...","cantidad":10,"precio_compra":3.5}]
--   p_recibida: true => ingresa stock de inmediato; false => queda pendiente
-- ---------------------------------------------------------------------
create or replace function public.registrar_compra(
  p_sede        uuid,
  p_proveedor   uuid,
  p_comprobante text,
  p_fecha       timestamptz,
  p_items       jsonb,
  p_recibida    boolean default true,
  p_observaciones text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid(); v_prov public.proveedores%rowtype; v_id uuid;
  v_serie text; v_corr int; v_num text; v_total numeric := 0; v_sub numeric; r record; v_prod public.productos%rowtype;
begin
  perform public.exigir_permiso('compras.crear');
  perform public.exigir_sede(p_sede);
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Agrega al menos un producto a la compra.';
  end if;

  select * into v_prov from public.proveedores where id = p_proveedor and activo;
  if not found then raise exception 'Selecciona un proveedor válido.'; end if;

  select o_serie, o_correlativo into v_serie, v_corr from public.siguiente_correlativo(p_sede, 'compra');
  v_num := v_serie || '-' || lpad(v_corr::text, 6, '0');

  insert into public.compras (sede_id, numero, comprobante_proveedor, proveedor_id, proveedor_nombre, fecha,
                              usuario_id, usuario_nombre, observaciones)
  values (p_sede, v_num, nullif(trim(p_comprobante), ''), v_prov.id, v_prov.nombre,
          coalesce(p_fecha, now()), v_uid, public.nombre_usuario(v_uid), nullif(trim(p_observaciones), ''))
  returning id into v_id;

  for r in
    select (e ->> 'producto_id')::uuid as producto_id,
           sum((e ->> 'cantidad')::numeric) as cantidad,
           max((e ->> 'precio_compra')::numeric) as precio
      from jsonb_array_elements(p_items) e group by 1 order by 1
  loop
    if r.cantidad is null or r.cantidad <= 0 then raise exception 'Cantidad no válida en la compra.'; end if;
    if r.precio is null or r.precio < 0 then raise exception 'Precio de compra no válido.'; end if;
    select * into v_prod from public.productos where id = r.producto_id;
    if not found then raise exception 'Hay un producto inexistente en la compra.'; end if;

    insert into public.compra_items (compra_id, producto_id, producto_nombre, cantidad, precio_compra, subtotal)
    values (v_id, v_prod.id, v_prod.nombre, r.cantidad, r.precio, round(r.cantidad * r.precio, 2));
    v_total := v_total + round(r.cantidad * r.precio, 2);
  end loop;

  v_sub := round(v_total / 1.18, 2);
  update public.compras set total = v_total, subtotal = v_sub, igv = v_total - v_sub where id = v_id;

  if p_recibida then perform public._recibir_compra(v_id); end if;
  return v_id;
end;
$$;

create or replace function public.recibir_compra(p_compra uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_sede uuid;
begin
  perform public.exigir_permiso('compras.crear');
  select sede_id into v_sede from public.compras where id = p_compra;
  if v_sede is null then raise exception 'La compra no existe.'; end if;
  perform public.exigir_sede(v_sede);
  perform public._recibir_compra(p_compra);
  return p_compra;
end;
$$;

-- Anular compra: si ya ingresó stock, lo descuenta (debe haber stock suficiente)
create or replace function public.anular_compra(p_compra uuid, p_motivo text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare c public.compras%rowtype; it record; v_uid uuid := auth.uid();
begin
  perform public.exigir_permiso('compras.anular');
  select * into c from public.compras where id = p_compra for update;
  if not found then raise exception 'La compra no existe.'; end if;
  perform public.exigir_sede(c.sede_id);
  if c.estado = 'anulada' then raise exception 'La compra ya está anulada.'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 5 then
    raise exception 'Indica el motivo de la anulación (mínimo 5 caracteres).';
  end if;

  if c.estado = 'recibida' then
    for it in select producto_id, cantidad from public.compra_items where compra_id = p_compra order by producto_id loop
      perform public.registrar_movimiento(c.sede_id, it.producto_id, -it.cantidad, 'salida', 'anulacion_compra',
                'Anulación de ' || c.numero || ': ' || trim(p_motivo), c.numero, null, null, p_compra);
    end loop;
  end if;

  update public.compras set estado = 'anulada', anulada_at = now(), anulada_por = v_uid,
         motivo_anulacion = trim(p_motivo) where id = p_compra;
  return p_compra;
end;
$$;

-- ---------------------------------------------------------------------
-- SEDES
-- ---------------------------------------------------------------------
create or replace function public.crear_sede(
  p_nombre    text,
  p_codigo    text,
  p_direccion text default null,
  p_telefono  text default null,
  p_ciudad    text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_id uuid; v_uid uuid := auth.uid(); v_cod text := upper(trim(coalesce(p_codigo, '')));
begin
  perform public.exigir_permiso('sedes.crear');
  if length(trim(coalesce(p_nombre, ''))) < 2 then raise exception 'El nombre de la sede es obligatorio.'; end if;
  if v_cod = '' or length(v_cod) > 10 then raise exception 'El código debe tener entre 1 y 10 caracteres.'; end if;
  if exists (select 1 from public.sedes where codigo = v_cod) then raise exception 'Ya existe una sede con el código %.', v_cod; end if;
  if exists (select 1 from public.sedes where lower(nombre) = lower(trim(p_nombre))) then
    raise exception 'Ya existe una sede con ese nombre.';
  end if;

  insert into public.sedes (codigo, nombre, direccion, telefono, ciudad, created_by)
  values (v_cod, trim(p_nombre), nullif(trim(p_direccion), ''), nullif(trim(p_telefono), ''),
          nullif(trim(p_ciudad), ''), v_uid)
  returning id into v_id;

  -- El creador puede trabajar de inmediato en la nueva sede
  insert into public.usuario_sedes (usuario_id, sede_id) values (v_uid, v_id) on conflict do nothing;
  return v_id;
end;
$$;

create or replace function public.actualizar_sede(
  p_id        uuid,
  p_nombre    text,
  p_direccion text,
  p_telefono  text,
  p_ciudad    text,
  p_activa    boolean
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_old public.sedes%rowtype;
begin
  perform public.exigir_permiso('sedes.editar');
  select * into v_old from public.sedes where id = p_id for update;
  if not found then raise exception 'La sede no existe.'; end if;
  if length(trim(coalesce(p_nombre, ''))) < 2 then raise exception 'El nombre de la sede es obligatorio.'; end if;
  if exists (select 1 from public.sedes where lower(nombre) = lower(trim(p_nombre)) and id <> p_id) then
    raise exception 'Ya existe otra sede con ese nombre.';
  end if;

  if v_old.activa and not p_activa then
    if exists (select 1 from public.cajas where sede_id = p_id and estado = 'abierta') then
      raise exception 'No puedes desactivar la sede: tiene cajas abiertas.';
    end if;
    if (select count(*) from public.sedes where activa and id <> p_id) = 0 then
      raise exception 'Debe existir al menos una sede activa.';
    end if;
  end if;

  update public.sedes set nombre = trim(p_nombre), direccion = nullif(trim(p_direccion), ''),
         telefono = nullif(trim(p_telefono), ''), ciudad = nullif(trim(p_ciudad), ''), activa = p_activa
   where id = p_id;
  return p_id;
end;
$$;

-- El usuario elige su sede por defecto (solo entre las que tiene asignadas)
create or replace function public.elegir_sede_predeterminada(p_sede uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.puede_ver_sede(p_sede) then
    raise exception 'No tienes acceso a esa sede.' using errcode = '42501';
  end if;
  update public.perfiles set sede_predeterminada_id = p_sede, ultimo_acceso = now() where id = auth.uid();
end;
$$;

-- Registra el acceso del usuario (se llama al iniciar sesión)
create or replace function public.registrar_acceso()
returns void
language sql security definer set search_path = public
as $$
  update public.perfiles set ultimo_acceso = now() where id = auth.uid();
$$;

-- Asignación de sedes a un usuario (la usa el API de usuarios)
create or replace function public.asignar_sedes_usuario(p_usuario uuid, p_sedes uuid[])
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not (public.tiene_permiso('usuarios.editar') or public.tiene_permiso('usuarios.crear')) then
    raise exception 'No tienes permiso para asignar sedes.' using errcode = '42501';
  end if;
  if not public.validar_gestion_usuario('usuarios.editar', null, p_usuario)
     and not public.validar_gestion_usuario('usuarios.crear', null, p_usuario) then
    raise exception 'No puedes gestionar a un usuario de rango superior al tuyo.' using errcode = '42501';
  end if;

  delete from public.usuario_sedes where usuario_id = p_usuario and not (sede_id = any (coalesce(p_sedes, '{}')));
  insert into public.usuario_sedes (usuario_id, sede_id)
  select p_usuario, s.id from public.sedes s
   where s.id = any (coalesce(p_sedes, '{}'))
  on conflict do nothing;
end;
$$;

-- ---------------------------------------------------------------------
-- actualizar_usuario: edita perfil/rol/estado respetando el rango.
-- (La contraseña y el bloqueo en Auth los maneja el API de servidor.)
-- ---------------------------------------------------------------------
create or replace function public.actualizar_usuario(
  p_id       uuid,
  p_nombre   text,
  p_telefono text,
  p_rol      uuid,
  p_estado   text
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_old public.perfiles%rowtype;
begin
  perform public.exigir_permiso('usuarios.editar');
  select * into v_old from public.perfiles where id = p_id for update;
  if not found then raise exception 'El usuario no existe.'; end if;

  if not public.validar_gestion_usuario('usuarios.editar', p_rol, p_id) then
    raise exception 'No puedes gestionar a un usuario o asignar un rol de rango superior al tuyo.' using errcode = '42501';
  end if;
  if p_estado not in ('activo','inactivo') then raise exception 'Estado no válido.'; end if;
  if length(trim(coalesce(p_nombre, ''))) < 2 then raise exception 'El nombre es obligatorio.'; end if;

  if p_id = auth.uid() and (p_rol is distinct from v_old.rol_id or p_estado <> v_old.estado) then
    raise exception 'No puedes cambiar tu propio rol ni tu estado.';
  end if;
  if p_estado = 'inactivo' and v_old.estado = 'activo' then
    perform public.exigir_permiso('usuarios.eliminar');
  end if;

  update public.perfiles
     set nombre = trim(p_nombre), telefono = nullif(trim(p_telefono), ''), rol_id = p_rol, estado = p_estado
   where id = p_id;
  return p_id;
end;
$$;


-- ######## 13_vistas_reportes.sql ########
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


-- ######## 14_rls.sql ########
-- =====================================================================
-- 14_rls.sql
-- Row Level Security: la BD decide qué ve y qué puede hacer cada usuario
-- (aunque alguien use directamente la API de Supabase).
--  * Lectura: según permisos y sedes asignadas.
--  * Escritura: SOLO mediante las funciones del sistema (RPC), salvo
--    catálogos simples (clientes, proveedores, categorías).
-- =====================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'configuracion','sedes','roles','permisos','rol_permisos','perfiles','usuario_sedes','series_correlativos',
    'categorias','productos','clientes','proveedores','metodos_pago',
    'stock_sede','traspasos','traspaso_items','movimientos_almacen','auditoria',
    'cajas','caja_sesiones','caja_egresos','ventas','venta_items','compras','compra_items'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Limpia políticas previas (script re-ejecutable)
do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies where schemaname = 'public' loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- ---- Configuración / catálogos de seguridad -------------------------
create policy cfg_select on public.configuracion for select to authenticated using (public.usuario_activo());
create policy permisos_select on public.permisos for select to authenticated using (public.usuario_activo());
create policy roles_select on public.roles for select to authenticated using (public.usuario_activo());
create policy rol_permisos_select on public.rol_permisos for select to authenticated using (public.usuario_activo());
create policy roles_insert on public.roles for insert to authenticated
  with check (public.tiene_permiso('roles.gestionar') and nivel <= public.nivel_usuario() and es_sistema = false);
create policy roles_update on public.roles for update to authenticated
  using (public.tiene_permiso('roles.gestionar') and nivel <= public.nivel_usuario() and nombre <> 'Administrador')
  with check (public.tiene_permiso('roles.gestionar') and nivel <= public.nivel_usuario() and nombre <> 'Administrador');
create policy rol_permisos_insert on public.rol_permisos for insert to authenticated
  with check (public.tiene_permiso('roles.gestionar')
              and exists (select 1 from public.roles r where r.id = rol_id and r.nivel <= public.nivel_usuario() and r.nombre <> 'Administrador'));
create policy rol_permisos_delete on public.rol_permisos for delete to authenticated
  using (public.tiene_permiso('roles.gestionar')
         and exists (select 1 from public.roles r where r.id = rol_id and r.nivel <= public.nivel_usuario() and r.nombre <> 'Administrador'));

-- ---- Sedes y usuarios -----------------------------------------------
create policy sedes_select on public.sedes for select to authenticated using (public.puede_ver_sede(id));

create policy perfiles_select on public.perfiles for select to authenticated
  using (public.usuario_activo() and (id = auth.uid() or public.tiene_permiso('usuarios.ver')));
create policy usuario_sedes_select on public.usuario_sedes for select to authenticated
  using (usuario_id = auth.uid() or public.tiene_permiso('usuarios.ver'));
create policy series_select on public.series_correlativos for select to authenticated
  using (public.puede_ver_sede(sede_id) and public.tiene_permiso('sedes.ver'));

-- ---- Catálogos globales ---------------------------------------------
create policy categorias_select on public.categorias for select to authenticated using (public.usuario_activo());
create policy categorias_insert on public.categorias for insert to authenticated
  with check (public.tiene_permiso('productos.crear'));
create policy categorias_update on public.categorias for update to authenticated
  using (public.tiene_permiso('productos.editar')) with check (public.tiene_permiso('productos.editar'));

create policy productos_select on public.productos for select to authenticated using (public.usuario_activo());
create policy metodos_pago_select on public.metodos_pago for select to authenticated using (public.usuario_activo());

create policy clientes_select on public.clientes for select to authenticated
  using (public.tiene_algun_permiso(array['clientes.ver','ventas.crear']));
create policy clientes_insert on public.clientes for insert to authenticated
  with check (public.tiene_permiso('clientes.crear'));
create policy clientes_update on public.clientes for update to authenticated
  using (public.tiene_algun_permiso(array['clientes.editar','clientes.eliminar']))
  with check (public.tiene_algun_permiso(array['clientes.editar','clientes.eliminar']));

create policy proveedores_select on public.proveedores for select to authenticated
  using (public.tiene_algun_permiso(array['compras.ver','compras.crear']));
create policy proveedores_insert on public.proveedores for insert to authenticated
  with check (public.tiene_permiso('compras.crear'));
create policy proveedores_update on public.proveedores for update to authenticated
  using (public.tiene_algun_permiso(array['compras.crear','compras.anular']))
  with check (public.tiene_algun_permiso(array['compras.crear','compras.anular']));

-- ---- Inventario (solo lectura directa; escritura por funciones) -------
create policy stock_select on public.stock_sede for select to authenticated
  using (public.puede_ver_sede(sede_id) and public.tiene_algun_permiso(array['almacen.ver','productos.ver','ventas.crear','dashboard.ver']));
create policy mov_select on public.movimientos_almacen for select to authenticated
  using (public.puede_ver_sede(sede_id) and public.tiene_permiso('almacen.historial'));
create policy traspasos_select on public.traspasos for select to authenticated
  using ((public.puede_ver_sede(sede_origen_id) or public.puede_ver_sede(sede_destino_id)) and public.tiene_permiso('almacen.historial'));
create policy traspaso_items_select on public.traspaso_items for select to authenticated
  using (exists (select 1 from public.traspasos t where t.id = traspaso_id));

-- ---- Cajas y ventas ----------------------------------------------------
create policy cajas_select on public.cajas for select to authenticated
  using (public.puede_ver_sede(sede_id) and public.tiene_algun_permiso(array['cajas.ver','ventas.crear']));
create policy caja_sesiones_select on public.caja_sesiones for select to authenticated
  using (public.puede_ver_sede(sede_id) and public.tiene_algun_permiso(array['cajas.ver','ventas.crear']));
create policy caja_egresos_select on public.caja_egresos for select to authenticated
  using (public.puede_ver_sede(sede_id) and public.tiene_permiso('cajas.ver'));

create policy ventas_select on public.ventas for select to authenticated
  using (public.puede_ver_sede(sede_id)
         and public.tiene_algun_permiso(array['comprobantes.ver','ventas.crear','dashboard.ver','reportes.ver']));
create policy venta_items_select on public.venta_items for select to authenticated
  using (exists (select 1 from public.ventas v where v.id = venta_id));

-- ---- Compras ---------------------------------------------------------------
create policy compras_select on public.compras for select to authenticated
  using (public.puede_ver_sede(sede_id) and public.tiene_algun_permiso(array['compras.ver','compras.crear']));
create policy compra_items_select on public.compra_items for select to authenticated
  using (exists (select 1 from public.compras c where c.id = compra_id));

-- ---- Auditoría ------------------------------------------------------------
create policy auditoria_select on public.auditoria for select to authenticated
  using (public.tiene_permiso('auditoria.ver'));

-- =====================================================================
-- GRANTS: mínimo privilegio
-- =====================================================================
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

revoke insert, update, delete, truncate on all tables in schema public from authenticated;
grant  select on all tables in schema public to authenticated;

-- Escrituras directas permitidas (protegidas por las políticas de arriba)
grant insert, update on public.clientes, public.proveedores, public.categorias to authenticated;
grant insert, update on public.roles to authenticated;
grant insert, delete on public.rol_permisos to authenticated;

-- Funciones: nadie ejecuta nada por defecto...
revoke execute on all functions in schema public from public, authenticated;

-- ...salvo las funciones pensadas para la aplicación
grant execute on function
  public.usuario_activo(), public.tiene_permiso(text), public.tiene_algun_permiso(text[]),
  public.nivel_usuario(), public.puede_ver_sede(uuid), public.puede_operar_en_sede(uuid),
  public.validar_gestion_usuario(text, uuid, uuid), public.mis_permisos(),
  public.zona_negocio(), public.fecha_negocio(timestamptz),
  public.caja_totales(uuid),
  public.ajustar_stock(uuid, uuid, numeric, text, text),
  public.fijar_stock(uuid, uuid, numeric, text),
  public.traspasar(uuid, uuid, jsonb, text),
  public.crear_producto(jsonb, uuid, numeric),
  public.actualizar_producto(uuid, jsonb, uuid, numeric, text),
  public.abrir_caja(uuid, numeric), public.crear_caja(uuid, text, numeric),
  public.cerrar_caja(uuid, numeric, text), public.registrar_egreso(uuid, text, numeric),
  public.registrar_venta(uuid, uuid, text, uuid, text, numeric, jsonb, text),
  public.anular_venta(uuid, text),
  public.registrar_compra(uuid, uuid, text, timestamptz, jsonb, boolean, text),
  public.recibir_compra(uuid), public.anular_compra(uuid, text),
  public.crear_sede(text, text, text, text, text),
  public.actualizar_sede(uuid, text, text, text, text, boolean),
  public.elegir_sede_predeterminada(uuid), public.registrar_acceso(),
  public.asignar_sedes_usuario(uuid, uuid[]), public.actualizar_usuario(uuid, text, text, uuid, text),
  public.dashboard_resumen(uuid), public.reporte_ventas(uuid, date, date, text)
to authenticated;

-- Las funciones internas (registrar_movimiento, siguiente_correlativo, _recibir_compra,
-- exigir_*, nombre_usuario) quedan SIN acceso para usuarios: solo las llaman otras funciones.
-- Las vistas necesitan poder llamar a caja_totales / fecha_negocio: ya concedido arriba.


-- ######## 15_seed_base.sql ########
-- =====================================================================
-- 15_seed_base.sql
-- Datos mínimos para que el sistema funcione: permisos, roles (rangos),
-- métodos de pago, categorías, configuración y la primera sede.
-- Es idempotente: puede ejecutarse varias veces.
-- =====================================================================

insert into public.configuracion (clave, valor, descripcion) values
  ('zona_horaria', 'America/Lima', 'Zona horaria del negocio'),
  ('igv_pct',      '18',           'Porcentaje de IGV (informativo)'),
  ('moneda',       'PEN',          'Moneda del sistema')
on conflict (clave) do nothing;

-- ---------------------------------------------------------------------
-- Catálogo de permisos
-- ---------------------------------------------------------------------
insert into public.permisos (codigo, modulo, descripcion, orden) values
  ('dashboard.ver',         'Dashboard',    'Ver el dashboard',                                   10),
  ('ventas.crear',          'Ventas',       'Registrar ventas en el punto de venta',              20),
  ('ventas.descuentos',     'Ventas',       'Aplicar descuentos en una venta',                    21),
  ('ventas.anular',         'Ventas',       'Anular ventas (devuelve el stock)',                  22),
  ('comprobantes.ver',      'Comprobantes', 'Consultar comprobantes emitidos',                    30),
  ('productos.ver',         'Productos',    'Ver el catálogo de productos',                       40),
  ('productos.crear',       'Productos',    'Crear productos',                                    41),
  ('productos.editar',      'Productos',    'Editar datos de productos',                          42),
  ('productos.editar_precio','Productos',   'Cambiar precios de venta y compra',                  43),
  ('productos.eliminar',    'Productos',    'Activar/desactivar productos',                       44),
  ('clientes.ver',          'Clientes',     'Ver clientes',                                       50),
  ('clientes.crear',        'Clientes',     'Crear clientes',                                     51),
  ('clientes.editar',       'Clientes',     'Editar clientes',                                    52),
  ('clientes.eliminar',     'Clientes',     'Desactivar clientes',                                53),
  ('usuarios.ver',          'Usuarios',     'Ver usuarios',                                       60),
  ('usuarios.crear',        'Usuarios',     'Crear usuarios',                                     61),
  ('usuarios.editar',       'Usuarios',     'Editar usuarios, rol y sedes',                       62),
  ('usuarios.eliminar',     'Usuarios',     'Desactivar usuarios',                                63),
  ('roles.gestionar',       'Usuarios',     'Crear roles y cambiar sus permisos',                 64),
  ('cajas.ver',             'Cajas',        'Ver cajas y sus reportes',                           70),
  ('cajas.crear',           'Cajas',        'Crear cajas',                                        71),
  ('cajas.abrir',           'Cajas',        'Abrir caja',                                         72),
  ('cajas.cerrar',          'Cajas',        'Cerrar caja',                                        73),
  ('cajas.egresos',         'Cajas',        'Registrar egresos de caja',                          74),
  ('cajas.supervisar',      'Cajas',        'Operar cajas abiertas por otros usuarios',           75),
  ('almacen.ver',           'Almacén',      'Ver stock por sede',                                 80),
  ('almacen.historial',     'Almacén',      'Ver el historial de movimientos',                    81),
  ('almacen.ajustar',       'Almacén',      'Agregar/descontar stock con motivo',                 82),
  ('almacen.traspasar',     'Almacén',      'Traspasar productos entre sedes',                    83),
  ('compras.ver',           'Compras',      'Ver compras',                                        90),
  ('compras.crear',         'Compras',      'Registrar y recibir compras',                        91),
  ('compras.anular',        'Compras',      'Anular compras',                                     92),
  ('reportes.ver',          'Reportes',     'Ver reportes',                                      100),
  ('sedes.ver',             'Sedes',        'Ver y administrar la pantalla de sedes',            110),
  ('sedes.crear',           'Sedes',        'Crear sedes',                                       111),
  ('sedes.editar',          'Sedes',        'Editar o desactivar sedes',                         112),
  ('sedes.ver_todas',       'Sedes',        'Ver y operar en TODAS las sedes (sin asignación)',  113),
  ('auditoria.ver',         'Sistema',      'Ver la auditoría del sistema',                      120),
  ('asistente.usar',        'Herramientas', 'Usar el asistente',                                 130),
  ('impresion.usar',        'Herramientas', 'Configurar/usar impresión',                         131),
  ('backup.usar',           'Herramientas', 'Acceder a backup',                                  132)
on conflict (codigo) do update
  set modulo = excluded.modulo, descripcion = excluded.descripcion, orden = excluded.orden;

-- ---------------------------------------------------------------------
-- Roles base (rangos). nivel: mayor = más jerarquía.
-- ---------------------------------------------------------------------
insert into public.roles (nombre, descripcion, nivel, es_sistema) values
  ('Administrador', 'Acceso total al sistema y a todas las sedes', 100, true),
  ('Supervisor',    'Opera ventas, almacén y cajas; anula y ajusta con motivo', 60, true),
  ('Almacenero',    'Gestiona productos, stock, traspasos y compras',           30, true),
  ('Cajero',        'Vende y administra su caja',                               20, true)
on conflict ((lower(nombre))) do update set descripcion = excluded.descripcion;

-- Permisos por rol (se reinician a los valores base)
do $$
declare
  v_admin uuid := (select id from public.roles where nombre = 'Administrador');
  v_sup   uuid := (select id from public.roles where nombre = 'Supervisor');
  v_alm   uuid := (select id from public.roles where nombre = 'Almacenero');
  v_caj   uuid := (select id from public.roles where nombre = 'Cajero');
begin
  delete from public.rol_permisos where rol_id in (v_admin, v_sup, v_alm, v_caj);

  -- Administrador: todo
  insert into public.rol_permisos select v_admin, codigo from public.permisos;

  -- Supervisor
  insert into public.rol_permisos select v_sup, c from unnest(array[
    'dashboard.ver','ventas.crear','ventas.descuentos','ventas.anular','comprobantes.ver',
    'productos.ver','productos.crear','productos.editar','productos.editar_precio',
    'clientes.ver','clientes.crear','clientes.editar','clientes.eliminar',
    'usuarios.ver',
    'cajas.ver','cajas.crear','cajas.abrir','cajas.cerrar','cajas.egresos','cajas.supervisar',
    'almacen.ver','almacen.historial','almacen.ajustar','almacen.traspasar',
    'compras.ver','compras.crear','compras.anular','reportes.ver',
    'asistente.usar','impresion.usar'
  ]) c;

  -- Almacenero
  insert into public.rol_permisos select v_alm, c from unnest(array[
    'dashboard.ver','productos.ver','productos.crear','productos.editar',
    'almacen.ver','almacen.historial','almacen.ajustar','almacen.traspasar',
    'compras.ver','compras.crear','asistente.usar','impresion.usar'
  ]) c;

  -- Cajero
  insert into public.rol_permisos select v_caj, c from unnest(array[
    'dashboard.ver','ventas.crear','comprobantes.ver','productos.ver',
    'clientes.ver','clientes.crear','clientes.editar',
    'cajas.ver','cajas.abrir','cajas.cerrar','cajas.egresos',
    'almacen.ver','asistente.usar','impresion.usar'
  ]) c;
end $$;

-- ---------------------------------------------------------------------
-- Métodos de pago y categorías
-- ---------------------------------------------------------------------
insert into public.metodos_pago (nombre, orden) values
  ('Efectivo', 1), ('Yape', 2), ('Tarjeta', 3), ('Transferencia', 4)
on conflict (nombre) do nothing;

insert into public.categorias (nombre) values
  ('Abarrotes'), ('Bebidas'), ('Limpieza'), ('Lácteos'), ('Snacks'), ('Cuidado Personal')
on conflict ((lower(nombre))) do nothing;

-- ---------------------------------------------------------------------
-- Primera sede (las demás se crean desde la pantalla SEDES)
-- ---------------------------------------------------------------------
insert into public.sedes (codigo, nombre, direccion, telefono)
select 'TC', 'Tienda Central', 'Av. Principal 120', '987 100 200'
where not exists (select 1 from public.sedes);

-- =====================================================================
-- 17_venta_cliente_manual.sql
-- Permite registrar una venta con los datos del comprador escritos a mano
-- (DNI/RUC + nombre o razon social), sin necesidad de crear un cliente.
-- =====================================================================

drop function if exists public.registrar_venta(uuid, uuid, text, uuid, text, numeric, jsonb, text);

create or replace function public.registrar_venta(
  p_sede               uuid,
  p_caja               uuid,
  p_tipo               text,
  p_cliente            uuid,
  p_metodo_pago        text,
  p_descuento_pct      numeric,
  p_items              jsonb,
  p_notas              text default null,
  p_cliente_nombre     text default null,
  p_cliente_documento  text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ses public.caja_sesiones%rowtype;
  v_cli public.clientes%rowtype;
  v_prod public.productos%rowtype;
  v_row record;
  v_pct numeric := coalesce(p_descuento_pct, 0);
  v_bruto numeric := 0; v_desc numeric; v_total numeric; v_sub numeric; v_igv numeric;
  v_serie text; v_corr int; v_num text; v_venta uuid; v_linea numeric;
  v_cli_nombre text;
  v_cli_doc text;
begin
  perform public.exigir_permiso('ventas.crear');
  perform public.exigir_sede(p_sede);

  if p_tipo not in ('factura','boleta','nota_venta') then raise exception 'Tipo de comprobante no valido.'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta no tiene productos.';
  end if;
  if v_pct < 0 or v_pct > 100 then raise exception 'El descuento debe estar entre 0 y 100.'; end if;
  if v_pct > 0 then perform public.exigir_permiso('ventas.descuentos'); end if;
  if not exists (select 1 from public.metodos_pago where nombre = p_metodo_pago and activo) then
    raise exception 'Metodo de pago no valido.';
  end if;

  if not exists (select 1 from public.cajas where id = p_caja and sede_id = p_sede and activa) then
    raise exception 'La caja no pertenece a la sede seleccionada.';
  end if;
  select * into v_ses from public.caja_sesiones where caja_id = p_caja and estado = 'abierta';
  if not found then raise exception 'La caja seleccionada no esta abierta. Abrela para vender.'; end if;

  if p_cliente is not null then
    select * into v_cli from public.clientes where id = p_cliente and activo;
    if not found then raise exception 'El cliente no existe o esta inactivo.'; end if;
  end if;

  -- Los datos escritos en la venta tienen prioridad sobre el cliente elegido.
  v_cli_nombre := nullif(trim(coalesce(p_cliente_nombre, '')), '');
  v_cli_doc := nullif(trim(coalesce(p_cliente_documento, '')), '');
  if v_cli_nombre is null and p_cliente is not null then v_cli_nombre := v_cli.nombre; end if;
  if v_cli_doc is null and p_cliente is not null then v_cli_doc := v_cli.documento; end if;
  v_cli_nombre := coalesce(v_cli_nombre, 'Cliente Varios');

  if p_tipo = 'factura' then
    if coalesce(v_cli_doc, '') = '' then
      raise exception 'La factura requiere el RUC del comprador.';
    end if;
    if v_cli_nombre = 'Cliente Varios' then
      raise exception 'La factura requiere el nombre o razon social del comprador.';
    end if;
  end if;

  -- 1) Validar productos y calcular total (precios SIEMPRE desde la BD)
  for v_row in
    select (e ->> 'producto_id')::uuid as producto_id, sum((e ->> 'cantidad')::numeric) as cantidad
      from jsonb_array_elements(p_items) e group by 1 order by 1
  loop
    if v_row.cantidad is null or v_row.cantidad <= 0 then raise exception 'Cantidad no valida en la venta.'; end if;
    select * into v_prod from public.productos where id = v_row.producto_id;
    if not found or not v_prod.activo then raise exception 'Hay un producto no disponible en la venta.'; end if;
    v_bruto := v_bruto + round(v_prod.precio_venta * v_row.cantidad, 2);
  end loop;

  v_desc  := round(v_bruto * v_pct / 100, 2);
  v_total := v_bruto - v_desc;
  v_sub   := round(v_total / 1.18, 2);
  v_igv   := v_total - v_sub;

  -- 2) Cabecera
  select o_serie, o_correlativo into v_serie, v_corr from public.siguiente_correlativo(p_sede, p_tipo);
  v_num := v_serie || '-' || lpad(v_corr::text, 7, '0');

  insert into public.ventas (
    sede_id, caja_id, caja_sesion_id, tipo_comprobante, serie, correlativo, numero,
    cliente_id, cliente_nombre, cliente_documento, subtotal, igv, descuento_pct, descuento_monto,
    total, metodo_pago, estado, usuario_id, usuario_nombre, notas)
  values (
    p_sede, p_caja, v_ses.id, p_tipo, v_serie, v_corr, v_num,
    p_cliente, v_cli_nombre, v_cli_doc, v_sub, v_igv, v_pct, v_desc,
    v_total, p_metodo_pago, 'pagado', v_uid, public.nombre_usuario(v_uid), nullif(trim(p_notas), ''))
  returning id into v_venta;

  -- 3) Items + salida de stock (cada una queda en el historial de almacen)
  for v_row in
    select (e ->> 'producto_id')::uuid as producto_id, sum((e ->> 'cantidad')::numeric) as cantidad
      from jsonb_array_elements(p_items) e group by 1 order by 1
  loop
    select * into v_prod from public.productos where id = v_row.producto_id;
    v_linea := round(v_prod.precio_venta * v_row.cantidad, 2);

    insert into public.venta_items (venta_id, producto_id, producto_codigo, producto_nombre, cantidad,
                                    precio_unitario, precio_compra, subtotal)
    values (v_venta, v_prod.id, v_prod.codigo, v_prod.nombre, v_row.cantidad,
            v_prod.precio_venta, v_prod.precio_compra, v_linea);

    perform public.registrar_movimiento(p_sede, v_prod.id, -v_row.cantidad, 'salida', 'venta',
              null, v_num, null, v_venta);
  end loop;

  return jsonb_build_object('id', v_venta, 'numero', v_num, 'total', v_total);
end;
$$;

revoke all on function public.registrar_venta(uuid, uuid, text, uuid, text, numeric, jsonb, text, text, text) from public;
grant execute on function public.registrar_venta(uuid, uuid, text, uuid, text, numeric, jsonb, text, text, text) to authenticated;

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
                         'ingreso_manual','ajuste_manual','conteo_fisico','merma',
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


-- =====================================================================
-- 19_egresos_y_cajas.sql  (idempotente)
--  * EGRESOS: caja_egresos admite egresos generales (con categoría, proveedor,
--    documento y observaciones) vinculados o no a una caja abierta.
--  * CAJAS: el número de caja se asigna solo (correlativo por sede) con
--    abrir_mi_caja(); vista v_caja_sesiones para las tarjetas "Cajas del día".
-- No modifica ventas, compras ni el cierre de caja existente.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Egresos generales
-- ---------------------------------------------------------------------
alter table public.caja_egresos alter column sesion_id drop not null;
alter table public.caja_egresos alter column caja_id   drop not null;

alter table public.caja_egresos
  add column if not exists categoria         text not null default 'Otros gastos',
  add column if not exists proveedor         text,
  add column if not exists tipo_documento    text,
  add column if not exists numero_documento  text,
  add column if not exists observaciones     text,
  add column if not exists fecha_egreso      date;

update public.caja_egresos set fecha_egreso = public.fecha_negocio(fecha) where fecha_egreso is null;
alter table public.caja_egresos alter column fecha_egreso set default public.fecha_negocio(now());
alter table public.caja_egresos alter column fecha_egreso set not null;

alter table public.caja_egresos drop constraint if exists caja_egresos_categoria_chk;
alter table public.caja_egresos add constraint caja_egresos_categoria_chk
  check (categoria in ('Compra de insumos','Servicio / Pago terceros','Pago a personal','Mantenimiento','Otros gastos'));

alter table public.caja_egresos drop constraint if exists caja_egresos_sesion_caja_chk;
alter table public.caja_egresos add constraint caja_egresos_sesion_caja_chk
  check ((sesion_id is null) = (caja_id is null));

create index if not exists caja_egresos_sede_fecha_idx on public.caja_egresos (sede_id, fecha_egreso desc);

drop policy if exists caja_egresos_select on public.caja_egresos;
create policy caja_egresos_select on public.caja_egresos for select to authenticated
  using (public.puede_ver_sede(sede_id) and public.tiene_algun_permiso(array['cajas.ver','compras.ver']));

create or replace function public.registrar_egreso_general(
  p_sede            uuid,
  p_fecha           date,
  p_categoria       text,
  p_concepto        text,
  p_proveedor       text,
  p_monto           numeric,
  p_tipo_documento  text default null,
  p_numero_documento text default null,
  p_observaciones   text default null,
  p_descontar_caja  boolean default true
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_ses public.caja_sesiones%rowtype; v_id uuid;
begin
  if not public.tiene_algun_permiso(array['compras.crear','cajas.egresos']) then
    raise exception 'No tienes permiso para registrar egresos.' using errcode = '42501';
  end if;
  perform public.exigir_sede(p_sede);
  if length(trim(coalesce(p_concepto, ''))) < 2 then raise exception 'Escribe la descripción o concepto del egreso.'; end if;
  if p_monto is null or p_monto <= 0 then raise exception 'El monto del egreso debe ser mayor a cero.'; end if;
  if p_categoria is null then raise exception 'Elige la categoría del egreso.'; end if;

  if coalesce(p_descontar_caja, false) then
    select * into v_ses from public.caja_sesiones
     where sede_id = p_sede and usuario_id = v_uid and estado = 'abierta'
     order by fecha_apertura desc limit 1;
  end if;

  insert into public.caja_egresos (sesion_id, caja_id, sede_id, concepto, monto, usuario_id, usuario_nombre,
                                   categoria, proveedor, tipo_documento, numero_documento, observaciones, fecha_egreso)
  values (v_ses.id, v_ses.caja_id, p_sede, trim(p_concepto), p_monto, v_uid, public.nombre_usuario(v_uid),
          p_categoria, nullif(trim(p_proveedor), ''), nullif(trim(p_tipo_documento), ''),
          nullif(trim(p_numero_documento), ''), nullif(trim(p_observaciones), ''),
          coalesce(p_fecha, public.fecha_negocio(now())))
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 2) Número de caja automático (correlativo por sede)
-- ---------------------------------------------------------------------
create table if not exists public.caja_correlativos (
  sede_id uuid primary key references public.sedes(id) on delete cascade,
  ultimo  int not null default 0 check (ultimo >= 0)
);
alter table public.caja_correlativos enable row level security;
revoke all on public.caja_correlativos from anon, authenticated;

create or replace function public.abrir_mi_caja(p_sede uuid, p_monto_apertura numeric default 0)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_n int; v_caja uuid; v_abierta text;
begin
  perform public.exigir_permiso('cajas.abrir');
  perform public.exigir_sede(p_sede);
  if coalesce(p_monto_apertura, 0) < 0 then raise exception 'El monto de apertura no puede ser negativo.'; end if;

  select c.nombre into v_abierta
    from public.caja_sesiones s join public.cajas c on c.id = s.caja_id
   where s.sede_id = p_sede and s.usuario_id = v_uid and s.estado = 'abierta' limit 1;
  if found then
    raise exception 'Ya tienes abierta la %. Ciérrala antes de abrir otra.', v_abierta;
  end if;

  -- el contador arranca después de la caja más alta que ya exista en la sede
  insert into public.caja_correlativos (sede_id, ultimo)
  select p_sede, coalesce(max((substring(nombre from '(\d{1,6})\s*$'))::int), 0)
    from public.cajas where sede_id = p_sede
  on conflict (sede_id) do nothing;

  loop
    update public.caja_correlativos set ultimo = ultimo + 1 where sede_id = p_sede returning ultimo into v_n;
    exit when not exists (select 1 from public.cajas where sede_id = p_sede and lower(nombre) = lower('Caja ' || v_n));
  end loop;

  insert into public.cajas (sede_id, nombre) values (p_sede, 'Caja ' || v_n) returning id into v_caja;
  return public.abrir_caja(v_caja, coalesce(p_monto_apertura, 0));
end;
$$;

-- ---------------------------------------------------------------------
-- 3) Turnos de caja (una fila por apertura) para las tarjetas "Cajas del día"
-- ---------------------------------------------------------------------
create or replace view public.v_caja_sesiones with (security_invoker = true) as
select
  s.id as sesion_id, s.caja_id, c.nombre as caja_nombre, s.sede_id, sd.nombre as sede_nombre,
  s.usuario_id, s.usuario_nombre, s.fecha_apertura, s.fecha_cierre, s.estado,
  public.fecha_negocio(s.fecha_apertura) as dia,
  s.monto_apertura, s.monto_sistema, s.monto_contado, s.diferencia, s.observaciones,
  case when s.estado = 'cerrada' then coalesce(s.ingresos_cierre, t.ingresos) else t.ingresos end as ingresos,
  t.ingresos_efectivo,
  case when s.estado = 'cerrada' then coalesce(s.egresos_cierre, t.egresos) else t.egresos end as egresos,
  case when s.estado = 'cerrada' then coalesce(s.ventas_cierre, t.ventas) else t.ventas end as ventas
from public.caja_sesiones s
join public.cajas c  on c.id  = s.caja_id
join public.sedes sd on sd.id = s.sede_id
left join lateral public.caja_totales(s.id) t on true;

-- ---------------------------------------------------------------------
-- 4) Permisos
-- ---------------------------------------------------------------------
revoke all on function public.registrar_egreso_general(uuid, date, text, text, text, numeric, text, text, text, boolean) from public;
revoke all on function public.abrir_mi_caja(uuid, numeric) from public;
grant execute on function
  public.registrar_egreso_general(uuid, date, text, text, text, numeric, text, text, text, boolean),
  public.abrir_mi_caja(uuid, numeric)
  to authenticated;
grant select on public.v_caja_sesiones to authenticated;


-- =====================================================================
-- 20_cambiar_metodo_pago.sql  (idempotente)
-- Permite corregir el método de pago de un comprobante pagado (cualquier rol
-- con acceso a la sede). El importe NO cambia; queda registrado en auditoría.
-- =====================================================================
create or replace function public.trg_ventas_inmutable()
returns trigger
language plpgsql
as $$
begin
  if old.estado = 'anulado' then
    raise exception 'La venta % ya está anulada y no puede modificarse.', old.numero;
  end if;
  if new.total is distinct from old.total
     or new.subtotal is distinct from old.subtotal
     or new.igv is distinct from old.igv
     or new.sede_id is distinct from old.sede_id
     or new.numero is distinct from old.numero
     or new.caja_sesion_id is distinct from old.caja_sesion_id
     or (new.metodo_pago is distinct from old.metodo_pago
         and coalesce(current_setting('app.mp_ok', true), '') <> '1') then
    raise exception 'Los importes de una venta emitida no se pueden modificar.';
  end if;
  return new;
end;
$$;

create or replace function public.cambiar_metodo_pago(p_venta uuid, p_metodo text)
returns text
language plpgsql security definer set search_path = public
as $$
declare v public.ventas%rowtype; v_uid uuid := auth.uid();
begin
  if not public.usuario_activo() then
    raise exception 'Usuario no autorizado.' using errcode = '42501';
  end if;
  select * into v from public.ventas where id = p_venta for update;
  if not found then raise exception 'El comprobante no existe.'; end if;
  perform public.exigir_sede(v.sede_id);
  if v.estado <> 'pagado' then raise exception 'Solo se puede cambiar el método de un comprobante pagado.'; end if;
  if not exists (select 1 from public.metodos_pago where nombre = p_metodo and activo) then
    raise exception 'Método de pago no válido.';
  end if;
  if v.metodo_pago = p_metodo then return v.metodo_pago; end if;

  perform set_config('app.mp_ok', '1', true);
  update public.ventas set metodo_pago = p_metodo where id = p_venta;
  perform set_config('app.mp_ok', '', true);

  insert into public.auditoria (usuario_id, usuario_nombre, accion, tabla, registro_id, detalle)
  values (v_uid, public.nombre_usuario(v_uid), 'UPDATE', 'ventas', p_venta::text,
          jsonb_build_object('campo', 'metodo_pago', 'comprobante', v.numero, 'de', v.metodo_pago, 'a', p_metodo));
  return p_metodo;
end;
$$;

revoke all on function public.cambiar_metodo_pago(uuid, text) from public;
grant execute on function public.cambiar_metodo_pago(uuid, text) to authenticated;


-- =====================================================================
-- 21_ajuste_stock_productos.sql  (idempotente)
-- Sección "Agregar / Restar stock" al editar un producto (PRODUCTOS).
--  * Cualquier usuario con permiso de editar productos puede AGREGAR stock.
--  * Solo Administrador y Supervisor (nivel >= 60) pueden RESTAR.
--  * Queda en el historial correspondiente: PRODUCTOS (tienda) o ALMACÉN (bodega).
-- =====================================================================
create or replace function public.ajustar_stock_producto(
  p_sede       uuid,
  p_producto   uuid,
  p_ubicacion  text,      -- 'tienda' | 'almacen'
  p_delta      numeric,
  p_motivo     text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_serie text; v_corr int; v_ref text; v_motivo text; v_op text; v_tipo text;
begin
  perform public.exigir_permiso('productos.editar');
  perform public.exigir_sede(p_sede);
  if p_ubicacion not in ('tienda','almacen') then raise exception 'Ubicación no válida.'; end if;
  if p_delta is null or p_delta = 0 then raise exception 'La cantidad debe ser distinta de cero.'; end if;
  if p_delta < 0 then
    if public.nivel_usuario() < 60 then
      raise exception 'Solo administradores y supervisores pueden restar stock.' using errcode = '42501';
    end if;
    if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Indica el motivo para restar stock.'; end if;
  end if;

  v_op     := case when p_delta > 0 then 'ingreso_manual' else 'ajuste_manual' end;
  v_tipo   := case when p_delta > 0 then 'entrada' else 'ajuste' end;
  v_motivo := coalesce(nullif(trim(p_motivo), ''),
                case p_ubicacion when 'tienda' then 'Ingreso manual desde Productos (tienda)'
                                 else 'Ingreso manual desde Productos (almacén)' end);

  select o_serie, o_correlativo into v_serie, v_corr from public.siguiente_correlativo(p_sede, 'ajuste');
  v_ref := v_serie || '-' || lpad(v_corr::text, 6, '0');

  if p_ubicacion = 'tienda' then
    return public.registrar_movimiento(p_sede, p_producto, p_delta, v_tipo, v_op, v_motivo, v_ref);
  else
    return public.registrar_movimiento_bodega(p_sede, p_producto, p_delta, v_tipo, v_op, v_motivo, v_ref);
  end if;
end;
$$;

revoke all on function public.ajustar_stock_producto(uuid, uuid, text, numeric, text) from public;
grant execute on function public.ajustar_stock_producto(uuid, uuid, text, numeric, text) to authenticated;


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


-- =====================================================================
-- 23_backup_editar_egresos_reportes.sql  (idempotente)
--  * Editar egresos (permiso egresos.editar: Administrador y Supervisor).
--  * Datos extra para las tarjetas de REPORTES (unidades vendidas, egresos).
--  * BACKUP real: copia de la BD descargable + restauración atómica + historial.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Editar egresos
-- ---------------------------------------------------------------------
insert into public.permisos (codigo, modulo, descripcion, orden)
values ('egresos.editar', 'Compras', 'Editar egresos registrados', 93)
on conflict (codigo) do update set modulo = excluded.modulo, descripcion = excluded.descripcion, orden = excluded.orden;

insert into public.rol_permisos (rol_id, permiso_codigo)
select r.id, 'egresos.editar' from public.roles r where r.nombre in ('Administrador', 'Supervisor')
on conflict do nothing;

create or replace function public.actualizar_egreso(
  p_id                  uuid,
  p_fecha               date,
  p_categoria           text,
  p_concepto            text,
  p_proveedor           text,
  p_monto               numeric,
  p_tipo_documento      text default null,
  p_numero_documento    text default null,
  p_proveedor_documento text default null,
  p_foto                text default null,     -- null = conservar la foto actual
  p_quitar_foto         boolean default false
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare e public.caja_egresos%rowtype; v_uid uuid := auth.uid(); v_ses text; v_concepto text;
begin
  perform public.exigir_permiso('egresos.editar');
  select * into e from public.caja_egresos where id = p_id for update;
  if not found then raise exception 'El egreso no existe.'; end if;
  perform public.exigir_sede(e.sede_id);
  if e.anulado then raise exception 'El egreso está anulado y no se puede editar.'; end if;
  if e.compra_id is not null then
    raise exception 'Este egreso viene de una compra de insumos: corrígela anulando la compra y registrándola de nuevo.';
  end if;
  if p_categoria is null or p_categoria = 'Compra de insumos' then raise exception 'Elige una categoría válida.'; end if;
  if p_monto is null or p_monto <= 0 then raise exception 'El monto del egreso debe ser mayor a cero.'; end if;
  if p_foto is not null and length(p_foto) > 1500000 then raise exception 'La foto es demasiado pesada.'; end if;

  if e.sesion_id is not null then
    select estado into v_ses from public.caja_sesiones where id = e.sesion_id;
    if v_ses = 'cerrada' and p_monto is distinct from e.monto then
      raise exception 'Este egreso pertenece a una caja ya cerrada: no se puede cambiar el monto.';
    end if;
  end if;

  v_concepto := coalesce(nullif(trim(p_concepto), ''), p_categoria || coalesce(' - ' || nullif(trim(p_proveedor), ''), ''));

  update public.caja_egresos set
    fecha_egreso = coalesce(p_fecha, fecha_egreso), categoria = p_categoria, concepto = v_concepto,
    proveedor = nullif(trim(p_proveedor), ''), proveedor_documento = nullif(trim(p_proveedor_documento), ''),
    monto = p_monto, tipo_documento = nullif(trim(p_tipo_documento), ''), numero_documento = nullif(trim(p_numero_documento), ''),
    foto_comprobante = case when p_quitar_foto then null when p_foto is not null and p_foto <> '' then p_foto else foto_comprobante end
  where id = p_id;

  insert into public.auditoria (usuario_id, usuario_nombre, accion, tabla, registro_id, detalle)
  values (v_uid, public.nombre_usuario(v_uid), 'UPDATE', 'caja_egresos', p_id::text,
          jsonb_build_object('antes', to_jsonb(e) - 'foto_comprobante' - 'tiene_foto',
                             'despues', jsonb_build_object('fecha_egreso', p_fecha, 'categoria', p_categoria, 'concepto', v_concepto,
                                'proveedor', p_proveedor, 'monto', p_monto, 'tipo_documento', p_tipo_documento,
                                'numero_documento', p_numero_documento)));
  return p_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 2) Datos extra para las tarjetas de REPORTES
-- ---------------------------------------------------------------------
create or replace function public.reporte_ventas_extra(
  p_sede uuid default null, p_desde date default null, p_hasta date default null, p_tipo text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_hasta date := coalesce(p_hasta, public.fecha_negocio());
  v_desde date := coalesce(p_desde, v_hasta - 29);
  v_zona text := public.zona_negocio();
  v_ini timestamptz := v_desde::timestamp at time zone v_zona;
  v_fin timestamptz := (v_hasta + 1)::timestamp at time zone v_zona;
  v_unid numeric; v_uni int; v_eg numeric; v_egn int;
begin
  perform public.exigir_permiso('reportes.ver');
  select coalesce(sum(i.cantidad), 0), count(distinct i.producto_id) into v_unid, v_uni
    from public.venta_items i join public.ventas v on v.id = i.venta_id
   where v.estado = 'pagado' and v.fecha >= v_ini and v.fecha < v_fin
     and public.puede_ver_sede(v.sede_id) and (p_sede is null or v.sede_id = p_sede)
     and (p_tipo is null or v.tipo_comprobante = p_tipo);
  select coalesce(sum(e.monto), 0), count(*) into v_eg, v_egn
    from public.caja_egresos e
   where not e.anulado and e.fecha_egreso between v_desde and v_hasta
     and public.puede_ver_sede(e.sede_id) and (p_sede is null or e.sede_id = p_sede);
  return jsonb_build_object('unidades', v_unid, 'productos_unicos', v_uni, 'egresos', v_eg, 'egresos_n', v_egn);
end;
$$;

-- ---------------------------------------------------------------------
-- 3) BACKUP
-- ---------------------------------------------------------------------
create table if not exists public.backup_historial (
  id             uuid primary key default gen_random_uuid(),
  fecha          timestamptz not null default now(),
  usuario_id     uuid,
  usuario_nombre text,
  tipo           text not null check (tipo in ('descarga','restauracion')),
  archivo        text,
  tamano_bytes   bigint,
  filas          bigint,
  tablas         int,
  estado         text not null default 'completado',
  detalle        text
);
create index if not exists backup_historial_fecha_idx on public.backup_historial (fecha desc);

-- Área de paso para subir una copia por partes y aplicarla en una sola transacción
create table if not exists public.backup_staging (
  token uuid not null,
  tabla text not null,
  lote  int  not null,
  datos jsonb not null,
  creado timestamptz not null default now(),
  primary key (token, tabla, lote)
);

alter table public.backup_historial enable row level security;
alter table public.backup_staging   enable row level security;
drop policy if exists backup_historial_select on public.backup_historial;
create policy backup_historial_select on public.backup_historial for select to authenticated
  using (public.tiene_permiso('backup.usar'));
revoke all on public.backup_staging from anon, authenticated;
revoke insert, update, delete, truncate on public.backup_historial from authenticated;
grant select on public.backup_historial to authenticated;

-- Tablas que forman parte de la copia (todas las de public salvo el propio backup)
create or replace function public._backup_lista()
returns text[]
language sql stable security definer set search_path = public
as $$
  select coalesce(array_agg(c.relname::text order by c.relname), '{}')
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relname not in ('backup_historial', 'backup_staging');
$$;

create or replace function public.backup_tablas()
returns table (tabla text, filas bigint)
language plpgsql security definer set search_path = public
as $$
declare t text;
begin
  perform public.exigir_permiso('backup.usar');
  foreach t in array public._backup_lista() loop
    tabla := t;
    execute format('select count(*) from public.%I', t) into filas;
    return next;
  end loop;
end;
$$;

create or replace function public.backup_leer(p_tabla text, p_desde int, p_limite int)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare r jsonb;
begin
  perform public.exigir_permiso('backup.usar');
  if not (p_tabla = any (public._backup_lista())) then raise exception 'Tabla no válida: %', p_tabla; end if;
  execute format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from (select * from public.%I order by 1 offset %s limit %s) t',
                 p_tabla, greatest(p_desde, 0), least(greatest(p_limite, 1), 2000)) into r;
  return r;
end;
$$;

create or replace function public.backup_registrar(
  p_tipo text, p_archivo text, p_bytes bigint, p_filas bigint, p_tablas int, p_detalle text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_id uuid; v_uid uuid := auth.uid();
begin
  perform public.exigir_permiso('backup.usar');
  insert into public.backup_historial (usuario_id, usuario_nombre, tipo, archivo, tamano_bytes, filas, tablas, detalle)
  values (v_uid, public.nombre_usuario(v_uid), p_tipo, p_archivo, p_bytes, p_filas, p_tablas, p_detalle)
  returning id into v_id;
  return v_id;
end;
$$;

-- Restaurar es solo para Administradores (nivel 100)
create or replace function public.backup_subir(p_token uuid, p_tabla text, p_lote int, p_datos jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.exigir_permiso('backup.usar');
  if public.nivel_usuario() < 100 then raise exception 'Solo un Administrador puede restaurar copias.' using errcode = '42501'; end if;
  if jsonb_typeof(p_datos) <> 'array' then raise exception 'Formato de copia no válido.'; end if;
  if not (p_tabla = any (public._backup_lista())) then return; end if;   -- tablas desconocidas: se ignoran
  delete from public.backup_staging where creado < now() - interval '1 day';
  insert into public.backup_staging (token, tabla, lote, datos) values (p_token, p_tabla, p_lote, p_datos)
  on conflict (token, tabla, lote) do update set datos = excluded.datos;
end;
$$;

create or replace function public.backup_cancelar(p_token uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.exigir_permiso('backup.usar');
  delete from public.backup_staging where token = p_token;
end;
$$;

-- Aplica la copia subida: reemplaza TODOS los datos en una sola transacción (si algo falla, no cambia nada)
create or replace function public.backup_aplicar(p_token uuid, p_archivo text default null, p_bytes bigint default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid(); v_nombre text := public.nombre_usuario(auth.uid());
  t text; cols text; rec record; v_filas bigint := 0; v_n bigint; v_tablas int := 0; v_faltan text[] := '{}';
  seq record; v_max numeric;
begin
  perform public.exigir_permiso('backup.usar');
  if public.nivel_usuario() < 100 then raise exception 'Solo un Administrador puede restaurar copias.' using errcode = '42501'; end if;

  foreach t in array public._backup_lista() loop
    if not exists (select 1 from public.backup_staging where token = p_token and tabla = t) then
      v_faltan := v_faltan || t;
    end if;
  end loop;
  if array_length(v_faltan, 1) > 0 then
    raise exception 'La copia no incluye las tablas: %. Probablemente es de una versión anterior del sistema.', array_to_string(v_faltan, ', ');
  end if;

  if not exists (select 1 from public.backup_staging s, jsonb_array_elements(s.datos) e
                  where s.token = p_token and s.tabla = 'perfiles' and e ->> 'id' = v_uid::text) then
    raise exception 'La copia no contiene tu usuario: al restaurarla perderías el acceso. Operación cancelada.';
  end if;

  -- sin disparadores ni verificación de claves mientras se reemplazan los datos (se restablece al terminar)
  set local session_replication_role = replica;

  execute 'truncate table ' || (select string_agg(format('public.%I', x), ', ') from unnest(public._backup_lista()) x) || ' restart identity cascade';

  foreach t in array public._backup_lista() loop
    select string_agg(quote_ident(column_name), ',' order by ordinal_position) into cols
      from information_schema.columns
     where table_schema = 'public' and table_name = t and is_generated = 'NEVER';
    for rec in select s.datos from public.backup_staging s where s.token = p_token and s.tabla = t order by s.lote loop
      execute format('insert into public.%I (%s) overriding system value select %s from jsonb_populate_recordset(null::public.%I, $1)', t, cols, cols, t)
        using rec.datos;
      get diagnostics v_n = row_count;
      v_filas := v_filas + v_n;
    end loop;
    v_tablas := v_tablas + 1;
  end loop;

  -- secuencias / identidades: continúan después del mayor valor restaurado
  for seq in
    select c.table_name as tabla, c.column_name as col, pg_get_serial_sequence(format('public.%I', c.table_name), c.column_name) as sq
      from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = any (public._backup_lista())
  loop
    if seq.sq is not null then
      execute format('select max(%I) from public.%I', seq.col, seq.tabla) into v_max;
      perform setval(seq.sq::regclass, greatest(coalesce(v_max, 1), 1)::bigint, v_max is not null);
    end if;
  end loop;

  delete from public.backup_staging where token = p_token;
  insert into public.backup_historial (usuario_id, usuario_nombre, tipo, archivo, tamano_bytes, filas, tablas, detalle)
  values (v_uid, v_nombre, 'restauracion', p_archivo, p_bytes, v_filas, v_tablas, 'Datos reemplazados por la copia');
  return jsonb_build_object('filas', v_filas, 'tablas', v_tablas);
end;
$$;

revoke all on function
  public.actualizar_egreso(uuid, date, text, text, text, numeric, text, text, text, text, boolean),
  public.reporte_ventas_extra(uuid, date, date, text),
  public._backup_lista(), public.backup_tablas(), public.backup_leer(text, int, int),
  public.backup_registrar(text, text, bigint, bigint, int, text),
  public.backup_subir(uuid, text, int, jsonb), public.backup_cancelar(uuid),
  public.backup_aplicar(uuid, text, bigint) from public;
grant execute on function
  public.actualizar_egreso(uuid, date, text, text, text, numeric, text, text, text, text, boolean),
  public.reporte_ventas_extra(uuid, date, date, text),
  public.backup_tablas(), public.backup_leer(text, int, int),
  public.backup_registrar(text, text, bigint, bigint, int, text),
  public.backup_subir(uuid, text, int, jsonb), public.backup_cancelar(uuid),
  public.backup_aplicar(uuid, text, bigint) to authenticated;


-- =====================================================================
-- 24_resiliencia_idempotencia.sql  (idempotente, se puede ejecutar varias veces)
--
-- Resiliencia ante fallas de red:
--  1) operaciones_idempotentes + ejecutar_idempotente(request_id, funcion, args)
--     Toda mutación del sistema se ejecuta con un request_id generado por el
--     formulario. Si la respuesta se pierde (timeout, corte de red, doble clic,
--     otra pestaña) y se REPITE la misma operación, la base devuelve la MISMA
--     respuesta y no vuelve a escribir. Mismo request_id con datos distintos
--     se rechaza (P0409).  consultar_operacion() dice si una operación llegó a
--     completarse ("verificar estado").
--  2) Flujos de varios pasos hechos atómicos: registrar_compra_completa
--     (proveedor + productos nuevos + compra), guardar_cliente, crear_proveedor,
--     guardar_permisos_rol, crear_rol.
--  3) Correcciones: abrir_mi_caja (doble caja por clics/pestañas simultáneas) y
--     egresos que dicen "descontar de mi caja" sin tener caja abierta.
--
-- No toca datos existentes. Después de desplegar el frontend nuevo se puede
-- ejecutar 25_forzar_idempotencia.sql (opcional) para cerrar las llamadas directas.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Registro de operaciones idempotentes
-- ---------------------------------------------------------------------
create table if not exists public.operaciones_idempotentes (
  usuario_id   uuid        not null,
  request_id   uuid        not null,
  funcion      text        not null,
  payload_hash text        not null,
  respuesta    jsonb,
  creado       timestamptz not null default now(),
  primary key (usuario_id, request_id)
);
create index if not exists operaciones_idempotentes_creado_idx on public.operaciones_idempotentes (creado);
alter table public.operaciones_idempotentes enable row level security;
revoke all on public.operaciones_idempotentes from anon, authenticated;

-- Funciones que pueden ejecutarse a través del envoltorio (lista cerrada)
create or replace function public._mutaciones_permitidas()
returns text[] language sql immutable as $$
  select array[
    'registrar_venta','anular_venta','cambiar_metodo_pago',
    'abrir_caja','abrir_mi_caja','crear_caja','cerrar_caja','registrar_egreso',
    'registrar_egreso_general','actualizar_egreso',
    'registrar_compra','registrar_compra_completa','recibir_compra','anular_compra',
    'crear_producto','actualizar_producto','ajustar_stock_producto',
    'ajustar_almacen','fijar_almacen','mover_almacen_tienda','enviar_a_sede',
    'crear_sede','actualizar_sede',
    'guardar_cliente','desactivar_cliente','crear_proveedor','guardar_permisos_rol','crear_rol',
    'backup_registrar','backup_aplicar','backup_cancelar'
  ]
$$;

-- ---------------------------------------------------------------------
-- 2) Envoltorio: ejecuta UNA vez por (usuario, request_id)
-- ---------------------------------------------------------------------
create or replace function public.ejecutar_idempotente(p_request_id uuid, p_fn text, p_args jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_hash  text;
  v_prev  public.operaciones_idempotentes%rowtype;
  v_proc  record;
  v_lista text := '';
  v_k     text;
  v_idx   int;
  v_sql   text;
  v_res   jsonb;
  v_val   text;
begin
  if v_uid is null then
    raise exception 'Sesión no válida. Vuelve a iniciar sesión.' using errcode = '42501';
  end if;
  if p_request_id is null then raise exception 'Falta el identificador de la operación (request_id).' using errcode = '22023'; end if;
  if not (p_fn = any (public._mutaciones_permitidas())) then
    raise exception 'Operación no permitida: %.', p_fn using errcode = '42501';
  end if;
  p_args := coalesce(p_args, '{}'::jsonb);
  if jsonb_typeof(p_args) <> 'object' then raise exception 'Los argumentos deben ser un objeto.' using errcode = '22023'; end if;

  v_hash := md5(p_fn || '|' || p_args::text);

  -- Serializa llamadas simultáneas con el mismo request_id (doble clic, otra pestaña, reintento)
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':' || p_request_id::text, 0));

  select * into v_prev from public.operaciones_idempotentes where usuario_id = v_uid and request_id = p_request_id;
  if found then
    if v_prev.payload_hash <> v_hash then
      raise exception 'Este identificador de operación ya se usó con datos distintos.' using errcode = 'P0409';
    end if;
    return jsonb_build_object('repetida', true, 'respuesta', v_prev.respuesta);
  end if;

  -- Resuelve la función (única sobrecarga con más parámetros)
  select p.oid, p.proargnames, p.proargtypes::oid[] as tipos, p.prorettype, p.pronargs
    into v_proc
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = p_fn
   order by p.pronargs desc limit 1;
  if v_proc.oid is null then raise exception 'La operación % no existe.', p_fn using errcode = '42883'; end if;

  for v_k in select jsonb_object_keys(p_args) loop
    v_idx := array_position(v_proc.proargnames, v_k);
    if v_idx is null or v_idx > v_proc.pronargs then
      raise exception 'Argumento desconocido "%" para %.', v_k, p_fn using errcode = '22023';
    end if;
    v_val := p_args ->> v_k;
    -- los arreglos JSON ([..]) se convierten a arreglos de Postgres ({..}) cuando el parámetro es text[], uuid[], etc.
    if jsonb_typeof(p_args -> v_k) = 'array' and format_type(v_proc.tipos[v_idx - 1], null) like '%[]' then
      select coalesce('{' || string_agg('"' || replace(replace(x, '\', '\\'), '"', '\"') || '"', ',') || '}', '{}')
        into v_val from jsonb_array_elements_text(p_args -> v_k) x;
    end if;
    v_lista := v_lista || case when v_lista = '' then '' else ', ' end
      || format('%I := %L::%s', v_k, v_val, format_type(v_proc.tipos[v_idx - 1], null));
  end loop;

  if v_proc.prorettype = 'void'::regtype then
    execute format('select public.%I(%s)', p_fn, v_lista);
    v_res := null;
  else
    execute format('select to_jsonb(public.%I(%s))', p_fn, v_lista) into v_res;
  end if;

  insert into public.operaciones_idempotentes (usuario_id, request_id, funcion, payload_hash, respuesta)
  values (v_uid, p_request_id, p_fn, v_hash, v_res);

  -- limpieza oportunista (>30 días)
  delete from public.operaciones_idempotentes where creado < now() - interval '30 days';

  return jsonb_build_object('repetida', false, 'respuesta', v_res);
end;
$$;

-- "Verificar estado": ¿esta operación llegó a completarse?
create or replace function public.consultar_operacion(p_request_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare v_uid uuid := auth.uid(); r public.operaciones_idempotentes%rowtype;
begin
  if v_uid is null then raise exception 'Sesión no válida. Vuelve a iniciar sesión.' using errcode = '42501'; end if;
  select * into r from public.operaciones_idempotentes where usuario_id = v_uid and request_id = p_request_id;
  if not found then return jsonb_build_object('estado', 'no_encontrada'); end if;
  return jsonb_build_object('estado', 'completada', 'funcion', r.funcion, 'respuesta', r.respuesta, 'creado', r.creado);
end;
$$;

-- ---------------------------------------------------------------------
-- 3) Pasos sueltos que ahora son una sola transacción
-- ---------------------------------------------------------------------
create or replace function public.crear_proveedor(p_nombre text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_id uuid; v_n text := trim(coalesce(p_nombre, ''));
begin
  perform public.exigir_permiso('compras.crear');
  if length(v_n) < 2 then raise exception 'Escribe el nombre del proveedor.'; end if;
  select id into v_id from public.proveedores where lower(trim(nombre)) = lower(v_n) order by activo desc limit 1;
  if v_id is not null then
    update public.proveedores set activo = true where id = v_id and not activo;
    return v_id;
  end if;
  insert into public.proveedores (nombre) values (v_n) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.guardar_cliente(p_id uuid, p_datos jsonb)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid := p_id;
  v_nombre text := trim(coalesce(p_datos ->> 'nombre', ''));
  v_tipo text := coalesce(nullif(p_datos ->> 'tipo', ''), 'regular');
begin
  if length(v_nombre) < 2 then raise exception 'El nombre del cliente es obligatorio.'; end if;
  if v_tipo not in ('regular','vip') then raise exception 'Tipo de cliente no válido.'; end if;
  if v_id is null then
    perform public.exigir_permiso('clientes.crear');
    insert into public.clientes (nombre, documento, telefono, email, direccion, tipo, created_by)
    values (v_nombre, nullif(trim(p_datos ->> 'documento'), ''), nullif(trim(p_datos ->> 'telefono'), ''),
            nullif(trim(p_datos ->> 'email'), ''), nullif(trim(p_datos ->> 'direccion'), ''), v_tipo, auth.uid())
    returning id into v_id;
  else
    if not public.tiene_algun_permiso(array['clientes.editar','clientes.eliminar']) then
      raise exception 'No tienes permiso para editar clientes.' using errcode = '42501';
    end if;
    update public.clientes set nombre = v_nombre, documento = nullif(trim(p_datos ->> 'documento'), ''),
           telefono = nullif(trim(p_datos ->> 'telefono'), ''), email = nullif(trim(p_datos ->> 'email'), ''),
           direccion = nullif(trim(p_datos ->> 'direccion'), ''), tipo = v_tipo, updated_at = now()
     where id = v_id;
    if not found then raise exception 'El cliente no existe.'; end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.desactivar_cliente(p_id uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
begin
  if not public.tiene_algun_permiso(array['clientes.eliminar']) then
    raise exception 'No tienes permiso para eliminar clientes.' using errcode = '42501';
  end if;
  update public.clientes set activo = false, updated_at = now() where id = p_id;
  return p_id;
end;
$$;

create or replace function public.crear_rol(p_nombre text, p_descripcion text, p_nivel int)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  perform public.exigir_permiso('roles.gestionar');
  if p_nivel is null or p_nivel > public.nivel_usuario() then
    raise exception 'No puedes crear un rol de nivel superior al tuyo.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_nombre, ''))) < 2 then raise exception 'El nombre del rol es obligatorio.'; end if;
  insert into public.roles (nombre, descripcion, nivel, es_sistema) values (trim(p_nombre), p_descripcion, p_nivel, false)
  returning id into v_id;
  return v_id;
end;
$$;

-- Reemplaza los permisos del rol en UNA transacción (antes: delete + insert separados)
create or replace function public.guardar_permisos_rol(p_rol uuid, p_permisos text[])
returns int
language plpgsql security definer set search_path = public
as $$
declare r public.roles%rowtype;
begin
  perform public.exigir_permiso('roles.gestionar');
  select * into r from public.roles where id = p_rol for update;
  if not found then raise exception 'El rol no existe.'; end if;
  if r.nombre = 'Administrador' or r.nivel > public.nivel_usuario() then
    raise exception 'No puedes modificar los permisos de este rol.' using errcode = '42501';
  end if;
  delete from public.rol_permisos where rol_id = p_rol and not (permiso_codigo = any (coalesce(p_permisos, '{}')));
  insert into public.rol_permisos (rol_id, permiso_codigo)
  select p_rol, p.codigo from public.permisos p where p.codigo = any (coalesce(p_permisos, '{}'))
  on conflict do nothing;
  return coalesce(array_length(p_permisos, 1), 0);
end;
$$;

-- Compra completa: proveedor (existente o nuevo) + productos nuevos + compra, TODO o NADA.
--   p_items: [{producto_id?, nombre, cantidad, precio}]  (sin producto_id => se busca por nombre o se crea)
drop function if exists public.registrar_compra_completa(uuid, uuid, text, text, timestamptz, jsonb, boolean, text);
create or replace function public.registrar_compra_completa(
  p_sede            uuid,
  p_proveedor_nombre text,
  p_comprobante     text,
  p_fecha           timestamptz,
  p_items           jsonb,
  p_proveedor_id    uuid default null,
  p_recibida        boolean default true,
  p_observaciones   text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_prov uuid := p_proveedor_id; e jsonb; v_prod uuid; v_nombre text; v_precio numeric;
  v_items jsonb := '[]'::jsonb; v_cod text;
begin
  perform public.exigir_permiso('compras.crear');
  perform public.exigir_sede(p_sede);
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Agrega al menos un producto a la compra.';
  end if;
  if v_prov is null then v_prov := public.crear_proveedor(p_proveedor_nombre); end if;

  for e in select * from jsonb_array_elements(p_items) loop
    v_prod := nullif(e ->> 'producto_id', '')::uuid;
    v_nombre := trim(coalesce(e ->> 'nombre', ''));
    v_precio := coalesce((e ->> 'precio')::numeric, (e ->> 'precio_compra')::numeric);
    if v_prod is null then
      if length(v_nombre) < 2 then raise exception 'Hay un producto sin nombre en la compra.'; end if;
      select id into v_prod from public.productos
       where sede_id = p_sede and lower(trim(nombre)) = lower(v_nombre) order by activo desc limit 1;
      if v_prod is null then
        loop
          v_cod := 'N' || upper(substr(md5(gen_random_uuid()::text), 1, 8));
          exit when not exists (select 1 from public.productos where sede_id = p_sede and codigo = v_cod);
        end loop;
        v_prod := public.crear_producto(
          jsonb_build_object('codigo', v_cod, 'nombre', v_nombre, 'precio_venta', coalesce(v_precio, 0),
                             'precio_compra', coalesce(v_precio, 0), 'unidad', 'Unidad', 'stock_minimo', 0, 'activo', true),
          p_sede, 0);
      end if;
    end if;
    v_items := v_items || jsonb_build_object('producto_id', v_prod, 'cantidad', e -> 'cantidad', 'precio_compra', v_precio);
  end loop;

  return public.registrar_compra(p_sede, v_prov, p_comprobante, p_fecha, v_items, coalesce(p_recibida, true), p_observaciones);
end;
$$;

-- ---------------------------------------------------------------------
-- 4) Corrección: abrir_mi_caja (doble caja)
--    Dos clics / dos pestañas / un reintento simultáneo podían pasar la
--    verificación "ya tengo una abierta" a la vez y crear dos cajas.
--    Ahora se serializa por usuario+sede.
-- ---------------------------------------------------------------------
create or replace function public.abrir_mi_caja(p_sede uuid, p_monto_apertura numeric default 0)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_n int; v_caja uuid; v_abierta text;
begin
  perform public.exigir_permiso('cajas.abrir');
  perform public.exigir_sede(p_sede);
  if coalesce(p_monto_apertura, 0) < 0 then raise exception 'El monto de apertura no puede ser negativo.'; end if;

  perform pg_advisory_xact_lock(hashtextextended('abrir_mi_caja:' || v_uid::text || ':' || p_sede::text, 0));

  select c.nombre into v_abierta
    from public.caja_sesiones s join public.cajas c on c.id = s.caja_id
   where s.sede_id = p_sede and s.usuario_id = v_uid and s.estado = 'abierta' limit 1;
  if found then
    raise exception 'Ya tienes abierta la %. Ciérrala antes de abrir otra.', v_abierta;
  end if;

  insert into public.caja_correlativos (sede_id, ultimo)
  select p_sede, coalesce(max((substring(nombre from '(\d{1,6})\s*$'))::int), 0)
    from public.cajas where sede_id = p_sede
  on conflict (sede_id) do nothing;

  loop
    update public.caja_correlativos set ultimo = ultimo + 1 where sede_id = p_sede returning ultimo into v_n;
    exit when not exists (select 1 from public.cajas where sede_id = p_sede and lower(nombre) = lower('Caja ' || v_n));
  end loop;

  insert into public.cajas (sede_id, nombre) values (p_sede, 'Caja ' || v_n) returning id into v_caja;
  return public.abrir_caja(v_caja, coalesce(p_monto_apertura, 0));
end;
$$;

-- Red de seguridad en BD: un usuario no puede tener 2 cajas abiertas en la misma sede.
-- (solo se crea si hoy no hay usuarios con dos abiertas; si las hay, se avisa y se omite)
do $$
begin
  if exists (select 1 from public.caja_sesiones where estado = 'abierta' group by usuario_id, sede_id having count(*) > 1) then
    raise notice 'Hay usuarios con más de una caja abierta en la misma sede: cierra las sobrantes y vuelve a ejecutar este script para activar el índice único.';
  else
    create unique index if not exists caja_sesion_abierta_usuario_sede_uq
      on public.caja_sesiones (usuario_id, sede_id) where estado = 'abierta';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 5) Corrección: egreso "descontar de mi caja" sin caja abierta
--    Antes se guardaba igual, sin descontar de ninguna caja, y el usuario
--    creía que sí. Ahora se rechaza con un mensaje claro.
-- ---------------------------------------------------------------------
create or replace function public.registrar_egreso_general(
  p_sede                uuid,
  p_fecha               date,
  p_categoria           text,
  p_concepto            text,
  p_proveedor           text,
  p_monto               numeric,
  p_tipo_documento      text default null,
  p_numero_documento    text default null,
  p_observaciones       text default null,
  p_descontar_caja      boolean default true,
  p_proveedor_documento text default null,
  p_foto                text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_ses public.caja_sesiones%rowtype; v_id uuid;
begin
  if not public.tiene_algun_permiso(array['compras.crear','cajas.egresos']) then
    raise exception 'No tienes permiso para registrar egresos.' using errcode = '42501';
  end if;
  perform public.exigir_sede(p_sede);
  if length(trim(coalesce(p_concepto, ''))) < 2 and length(trim(coalesce(p_proveedor, ''))) < 2 then
    raise exception 'Escribe la descripción o el proveedor del egreso.';
  end if;
  if p_monto is null or p_monto <= 0 then raise exception 'El monto del egreso debe ser mayor a cero.'; end if;
  if p_categoria is null then raise exception 'Elige la categoría del egreso.'; end if;
  if p_categoria = 'Compra de insumos' then
    raise exception 'Las compras de insumos se registran en la pestaña "Compras de insumos".';
  end if;

  if coalesce(p_descontar_caja, false) then
    select * into v_ses from public.caja_sesiones
     where sede_id = p_sede and usuario_id = v_uid and estado = 'abierta'
     order by fecha_apertura desc limit 1 for share;
    if not found then
      raise exception 'No tienes una caja abierta en esta sede. Abre tu caja o desmarca "Descontar de mi caja abierta".'
        using errcode = 'P0422';
    end if;
  end if;

  insert into public.caja_egresos (sesion_id, caja_id, sede_id, concepto, monto, usuario_id, usuario_nombre,
                                   categoria, proveedor, tipo_documento, numero_documento, observaciones, fecha_egreso,
                                   proveedor_documento, foto_comprobante)
  values (v_ses.id, v_ses.caja_id, p_sede, coalesce(nullif(trim(p_concepto), ''), trim(p_proveedor)), p_monto, v_uid,
          public.nombre_usuario(v_uid), p_categoria, nullif(trim(p_proveedor), ''), nullif(trim(p_tipo_documento), ''),
          nullif(trim(p_numero_documento), ''), nullif(trim(p_observaciones), ''),
          coalesce(p_fecha, public.fecha_negocio(now())), nullif(trim(p_proveedor_documento), ''), nullif(p_foto, ''))
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 5b) El registro de request_id NO forma parte del backup: es un libro operativo.
--     Así las copias anteriores a este script siguen siendo restaurables y una
--     restauración no borra los request_id (un reintento tardío sigue sin duplicar).
-- ---------------------------------------------------------------------
create or replace function public._backup_lista()
returns text[]
language sql stable security definer set search_path = public
as $$
  select coalesce(array_agg(c.relname::text order by c.relname), '{}')
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and c.relname not in ('backup_historial', 'backup_staging', 'operaciones_idempotentes');
$$;

-- ---------------------------------------------------------------------
-- 6) Permisos de ejecución
-- ---------------------------------------------------------------------
revoke all on function
  public._mutaciones_permitidas(),
  public.ejecutar_idempotente(uuid, text, jsonb),
  public.consultar_operacion(uuid),
  public.crear_proveedor(text),
  public.guardar_cliente(uuid, jsonb),
  public.desactivar_cliente(uuid),
  public.crear_rol(text, text, int),
  public.guardar_permisos_rol(uuid, text[]),
  public.registrar_compra_completa(uuid, text, text, timestamptz, jsonb, uuid, boolean, text),
  public.abrir_mi_caja(uuid, numeric),
  public.registrar_egreso_general(uuid, date, text, text, text, numeric, text, text, text, boolean, text, text)
  from public;
grant execute on function
  public.ejecutar_idempotente(uuid, text, jsonb),
  public.consultar_operacion(uuid),
  public.crear_proveedor(text),
  public.guardar_cliente(uuid, jsonb),
  public.desactivar_cliente(uuid),
  public.crear_rol(text, text, int),
  public.guardar_permisos_rol(uuid, text[]),
  public.registrar_compra_completa(uuid, text, text, timestamptz, jsonb, uuid, boolean, text),
  public.abrir_mi_caja(uuid, numeric),
  public.registrar_egreso_general(uuid, date, text, text, text, numeric, text, text, text, boolean, text, text)
  to authenticated;


-- =====================================================================
-- 26_ventas_concurrentes_offline.sql  (idempotente; requiere SQL 01-25)
--
-- Ventas simultáneas sin sobreventa, con o sin internet:
--  1) registrar_venta: bloquea el stock con FOR UPDATE en orden de producto_id
--     (sin deadlocks entre ventas), valida precio esperado y puede consumir una
--     RESERVA OFFLINE (lease) de la caja. Nunca deja stock negativo.
--  2) Leases offline: crear_lease_offline() descuenta stock del pool y lo reserva
--     para UNA caja; liquidar_lease() devuelve lo no usado; los leases vencidos
--     devuelven su stock solos (_expirar_leases). Todo queda en el historial de
--     movimientos, así stock = suma de movimientos siempre.
--  3) ejecutar_idempotente reintenta automáticamente los deadlocks (40P01) con
--     la misma request_id.
-- No cambia permisos, RLS ni datos existentes.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0) Nuevas operaciones permitidas en el historial de movimientos
-- ---------------------------------------------------------------------
alter table public.movimientos_almacen drop constraint if exists mov_operacion_valida;
alter table public.movimientos_almacen add constraint mov_operacion_valida check (operacion = any (array[
  'stock_inicial','compra','anulacion_compra','venta','anulacion_venta','traspaso_salida','traspaso_entrada',
  'ingreso_manual','ajuste_manual','conteo_fisico','merma','devolucion','correccion_producto','desde_almacen','a_almacen',
  'reserva_offline','consumo_reserva','devolucion_lease']));

-- ---------------------------------------------------------------------
-- 1) Reservas de stock para venta offline
-- ---------------------------------------------------------------------
create table if not exists public.stock_leases_offline (
  id            uuid primary key default gen_random_uuid(),
  lease_id      uuid not null,                                   -- agrupa los productos de una misma reserva
  sede_id       uuid not null references public.sedes(id) on delete restrict,
  caja_id       uuid not null references public.cajas(id) on delete restrict,
  usuario_id    uuid not null,
  dispositivo   text,
  producto_id   uuid not null references public.productos(id) on delete restrict,
  cantidad      numeric(12,3) not null check (cantidad > 0),     -- reservada
  usada         numeric(12,3) not null default 0 check (usada >= 0),
  devuelta      numeric(12,3) not null default 0 check (devuelta >= 0),
  estado        text not null default 'activo' check (estado in ('activo','liquidado','vencido')),
  creado        timestamptz not null default now(),
  expira        timestamptz not null,
  cerrado_at    timestamptz,
  check (usada + devuelta <= cantidad),
  unique (lease_id, producto_id)
);
create index if not exists stock_leases_activos_idx on public.stock_leases_offline (expira) where estado = 'activo';
create index if not exists stock_leases_prod_idx    on public.stock_leases_offline (sede_id, producto_id) where estado = 'activo';
alter table public.stock_leases_offline enable row level security;
revoke all on public.stock_leases_offline from anon, authenticated;   -- solo se toca vía funciones

-- Devuelve al stock lo no usado de los leases vencidos (opcionalmente de una sede / sin tocar un lease).
create or replace function public._expirar_leases(p_sede uuid default null, p_excepto uuid default null)
returns int
language plpgsql security definer set search_path = public
as $$
declare r record; v_sobra numeric; v_n int := 0;
begin
  for r in
    select id, lease_id, sede_id, producto_id, cantidad, usada, devuelta
      from public.stock_leases_offline
     where estado = 'activo' and expira <= now()
       and (p_sede is null or sede_id = p_sede)
       and (p_excepto is null or lease_id <> p_excepto)
     order by producto_id, id
       for update skip locked
  loop
    v_sobra := r.cantidad - r.usada - r.devuelta;
    if v_sobra > 0 then
      perform public.registrar_movimiento(r.sede_id, r.producto_id, v_sobra, 'entrada', 'devolucion_lease',
                'Reserva offline vencida: stock devuelto', left(r.lease_id::text, 8));
    end if;
    update public.stock_leases_offline
       set estado = 'vencido', devuelta = devuelta + greatest(v_sobra, 0), cerrado_at = now()
     where id = r.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- Reserva stock del pool para UNA caja abierta del usuario. Otras cajas ya no pueden venderlo.
--   p_items: [{producto_id, cantidad}]   Devuelve {lease_id, expira, servidor_ahora, items:[{producto_id, solicitado, otorgado}]}
create or replace function public.crear_lease_offline(
  p_sede uuid, p_caja uuid, p_items jsonb, p_ttl_min int default 480, p_dispositivo text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid(); v_ses public.caja_sesiones%rowtype; v_caja_nombre text;
  v_lease uuid := gen_random_uuid(); v_exp timestamptz; v_row record; v_stock numeric; v_dar numeric;
  v_out jsonb := '[]'::jsonb; v_total numeric := 0;
begin
  perform public.exigir_permiso('ventas.crear');
  perform public.exigir_sede(p_sede);
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Elige al menos un producto para reservar.';
  end if;
  select nombre into v_caja_nombre from public.cajas where id = p_caja and sede_id = p_sede and activa;
  if not found then raise exception 'La caja no pertenece a la sede seleccionada.'; end if;
  select * into v_ses from public.caja_sesiones where caja_id = p_caja and estado = 'abierta';
  if not found then raise exception 'La caja seleccionada no esta abierta. Abrela para reservar stock offline.'; end if;
  if v_ses.usuario_id is distinct from v_uid then
    raise exception 'Solo quien tiene abierta la caja puede reservar stock para ella.' using errcode = '42501';
  end if;

  perform public._expirar_leases(p_sede);
  v_exp := now() + make_interval(mins => least(greatest(coalesce(p_ttl_min, 480), 5), 1440));

  for v_row in
    select (e ->> 'producto_id')::uuid as producto_id, sum((e ->> 'cantidad')::numeric) as cantidad
      from jsonb_array_elements(p_items) e group by 1 order by 1          -- orden fijo: sin deadlocks
  loop
    if v_row.cantidad is null or v_row.cantidad <= 0 then raise exception 'Cantidad no valida en la reserva.'; end if;
    if not exists (select 1 from public.productos where id = v_row.producto_id and sede_id = p_sede and activo) then
      raise exception 'Hay un producto no disponible en la reserva.';
    end if;
    select stock into v_stock from public.stock_sede where producto_id = v_row.producto_id and sede_id = p_sede for update;
    v_dar := least(v_row.cantidad, coalesce(v_stock, 0));
    if v_dar > 0 then
      perform public.registrar_movimiento(p_sede, v_row.producto_id, -v_dar, 'salida', 'reserva_offline',
                'Reserva offline para ' || v_caja_nombre, left(v_lease::text, 8));
      insert into public.stock_leases_offline (lease_id, sede_id, caja_id, usuario_id, dispositivo, producto_id, cantidad, expira)
      values (v_lease, p_sede, p_caja, v_uid, p_dispositivo, v_row.producto_id, v_dar, v_exp);
      v_total := v_total + v_dar;
    end if;
    v_out := v_out || jsonb_build_object('producto_id', v_row.producto_id, 'solicitado', v_row.cantidad, 'otorgado', v_dar);
  end loop;

  if v_total <= 0 then
    raise exception 'No hay stock disponible para reservar.' using errcode = '23514';
  end if;
  return jsonb_build_object('lease_id', v_lease, 'caja_id', p_caja, 'sede_id', p_sede, 'expira', v_exp,
                            'servidor_ahora', now(), 'items', v_out);
end;
$$;

-- Cierra la reserva y devuelve al stock lo que no se vendió. Se puede repetir sin efecto.
create or replace function public.liquidar_lease(p_lease uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid(); r record; v_sobra numeric; v_dev jsonb := '[]'::jsonb; v_usado numeric := 0; v_n int := 0; v_estado text;
begin
  perform public.exigir_permiso('ventas.crear');
  if not exists (select 1 from public.stock_leases_offline where lease_id = p_lease) then
    raise exception 'La reserva offline no existe.';
  end if;
  if not exists (select 1 from public.stock_leases_offline where lease_id = p_lease and usuario_id = v_uid)
     and not public.tiene_permiso('cajas.supervisar') then
    raise exception 'La reserva pertenece a otro usuario.' using errcode = '42501';
  end if;

  for r in
    select id, sede_id, producto_id, cantidad, usada, devuelta, estado
      from public.stock_leases_offline where lease_id = p_lease
     order by producto_id for update
  loop
    v_usado := v_usado + r.usada; v_n := v_n + 1;
    if r.estado = 'activo' then
      v_sobra := r.cantidad - r.usada - r.devuelta;
      if v_sobra > 0 then
        perform public.registrar_movimiento(r.sede_id, r.producto_id, v_sobra, 'entrada', 'devolucion_lease',
                  'Reserva offline liquidada: stock no vendido', left(p_lease::text, 8));
        v_dev := v_dev || jsonb_build_object('producto_id', r.producto_id, 'cantidad', v_sobra);
      end if;
      update public.stock_leases_offline
         set estado = 'liquidado', devuelta = devuelta + greatest(v_sobra, 0), cerrado_at = now() where id = r.id;
    end if;
  end loop;
  select min(estado) into v_estado from public.stock_leases_offline where lease_id = p_lease;
  return jsonb_build_object('lease_id', p_lease, 'estado', v_estado, 'usado', v_usado, 'devuelto', v_dev);
end;
$$;

-- Reservas activas del usuario (para que el dispositivo se re-sincronice)
create or replace function public.mis_leases_offline()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'lease_id', lease_id, 'sede_id', sede_id, 'caja_id', caja_id, 'producto_id', producto_id,
      'cantidad', cantidad, 'usada', usada, 'devuelta', devuelta, 'estado', estado, 'expira', expira)), '[]'::jsonb)
    from public.stock_leases_offline where usuario_id = auth.uid() and estado = 'activo';
$$;

-- ---------------------------------------------------------------------
-- 2) registrar_venta: lock ordenado, precio esperado y consumo de lease
--    (reemplaza la versión de 10 parámetros; los parámetros nuevos son opcionales)
-- ---------------------------------------------------------------------
drop function if exists public.registrar_venta(uuid, uuid, text, uuid, text, numeric, jsonb, text, text, text);

create or replace function public.registrar_venta(
  p_sede               uuid,
  p_caja               uuid,
  p_tipo               text,
  p_cliente            uuid,
  p_metodo_pago        text,
  p_descuento_pct      numeric,
  p_items              jsonb,
  p_notas              text default null,
  p_cliente_nombre     text default null,
  p_cliente_documento  text default null,
  p_lease              uuid default null,          -- reserva offline desde la que se vendió
  p_fecha_offline      timestamptz default null,   -- cuándo se hizo la venta en el dispositivo
  p_aceptar_precio     boolean default false,      -- acepta el precio actual si cambió desde la venta offline
  p_numero_provisional text default null           -- ticket provisional entregado al cliente
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ses public.caja_sesiones%rowtype;
  v_cli public.clientes%rowtype;
  v_prod public.productos%rowtype;
  v_row record;
  v_lease public.stock_leases_offline%rowtype;
  v_pct numeric := coalesce(p_descuento_pct, 0);
  v_bruto numeric := 0; v_desc numeric; v_total numeric; v_sub numeric; v_igv numeric;
  v_serie text; v_corr int; v_num text; v_venta uuid; v_linea numeric;
  v_cli_nombre text; v_cli_doc text; v_fecha timestamptz; v_esperado numeric; v_notas text;
  v_de_lease numeric;
begin
  perform public.exigir_permiso('ventas.crear');
  perform public.exigir_sede(p_sede);

  if p_tipo not in ('factura','boleta','nota_venta') then raise exception 'Tipo de comprobante no valido.'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta no tiene productos.';
  end if;
  if v_pct < 0 or v_pct > 100 then raise exception 'El descuento debe estar entre 0 y 100.'; end if;
  if v_pct > 0 then perform public.exigir_permiso('ventas.descuentos'); end if;
  if not exists (select 1 from public.metodos_pago where nombre = p_metodo_pago and activo) then
    raise exception 'Metodo de pago no valido.';
  end if;

  if not exists (select 1 from public.cajas where id = p_caja and sede_id = p_sede and activa) then
    raise exception 'La caja no pertenece a la sede seleccionada.' using errcode = 'P0422';
  end if;
  select * into v_ses from public.caja_sesiones where caja_id = p_caja and estado = 'abierta';
  if not found then raise exception 'La caja seleccionada no esta abierta. Abrela para vender.' using errcode = 'P0422'; end if;

  if p_cliente is not null then
    select * into v_cli from public.clientes where id = p_cliente and activo;
    if not found then raise exception 'El cliente no existe o esta inactivo.'; end if;
  end if;

  v_cli_nombre := nullif(trim(coalesce(p_cliente_nombre, '')), '');
  v_cli_doc := nullif(trim(coalesce(p_cliente_documento, '')), '');
  if v_cli_nombre is null and p_cliente is not null then v_cli_nombre := v_cli.nombre; end if;
  if v_cli_doc is null and p_cliente is not null then v_cli_doc := v_cli.documento; end if;
  v_cli_nombre := coalesce(v_cli_nombre, 'Cliente Varios');

  if p_tipo = 'factura' then
    if coalesce(v_cli_doc, '') = '' then raise exception 'La factura requiere el RUC del comprador.'; end if;
    if v_cli_nombre = 'Cliente Varios' then raise exception 'La factura requiere el nombre o razon social del comprador.'; end if;
  end if;

  -- Reserva offline: debe ser de esta caja y de este usuario (si no, la venta no la usa)
  if p_lease is not null then
    if not exists (select 1 from public.stock_leases_offline where lease_id = p_lease and caja_id = p_caja and usuario_id = v_uid) then
      raise exception 'La reserva offline no corresponde a esta caja o usuario.' using errcode = 'P0426';
    end if;
  end if;

  -- Devuelve el stock de reservas vencidas (sin tocar la reserva de esta misma venta)
  if exists (select 1 from public.stock_leases_offline where estado = 'activo' and expira <= now() and sede_id = p_sede) then
    perform public._expirar_leases(p_sede, p_lease);
  end if;

  -- 0) BLOQUEO del stock de TODOS los productos, siempre en el mismo orden (producto_id): sin deadlocks entre ventas
  perform 1
    from public.stock_sede ss
   where ss.sede_id = p_sede
     and ss.producto_id in (select (e ->> 'producto_id')::uuid from jsonb_array_elements(p_items) e)
   order by ss.producto_id
     for update;

  -- 1) Validar productos y calcular total (precios SIEMPRE desde la BD)
  for v_row in
    select (e ->> 'producto_id')::uuid as producto_id, sum((e ->> 'cantidad')::numeric) as cantidad,
           max(nullif(e ->> 'precio_esperado', '')::numeric) as precio_esperado
      from jsonb_array_elements(p_items) e group by 1 order by 1
  loop
    if v_row.cantidad is null or v_row.cantidad <= 0 then raise exception 'Cantidad no valida en la venta.'; end if;
    select * into v_prod from public.productos where id = v_row.producto_id;
    if not found or not v_prod.activo then raise exception 'Hay un producto no disponible en la venta.'; end if;
    if v_row.precio_esperado is not null and not coalesce(p_aceptar_precio, false)
       and v_row.precio_esperado is distinct from v_prod.precio_venta then
      raise exception 'El precio de "%" cambio de % a %.', v_prod.nombre, v_row.precio_esperado, v_prod.precio_venta
        using errcode = 'P0424';
    end if;
    v_bruto := v_bruto + round(v_prod.precio_venta * v_row.cantidad, 2);
  end loop;

  v_desc  := round(v_bruto * v_pct / 100, 2);
  v_total := v_bruto - v_desc;
  v_sub   := round(v_total / 1.18, 2);
  v_igv   := v_total - v_sub;

  -- 2) Cabecera (el correlativo se toma al final, con el stock ya bloqueado)
  select o_serie, o_correlativo into v_serie, v_corr from public.siguiente_correlativo(p_sede, p_tipo);
  v_num := v_serie || '-' || lpad(v_corr::text, 7, '0');
  v_fecha := case when p_fecha_offline is null then now()
                  else least(now(), greatest(p_fecha_offline, v_ses.fecha_apertura)) end;
  v_notas := nullif(trim(concat_ws(' · ', nullif(trim(coalesce(p_notas, '')), ''),
                                   case when p_numero_provisional is not null then 'Venta offline ' || p_numero_provisional end)), '');

  insert into public.ventas (
    sede_id, caja_id, caja_sesion_id, tipo_comprobante, serie, correlativo, numero, fecha,
    cliente_id, cliente_nombre, cliente_documento, subtotal, igv, descuento_pct, descuento_monto,
    total, metodo_pago, estado, usuario_id, usuario_nombre, notas)
  values (
    p_sede, p_caja, v_ses.id, p_tipo, v_serie, v_corr, v_num, v_fecha,
    p_cliente, v_cli_nombre, v_cli_doc, v_sub, v_igv, v_pct, v_desc,
    v_total, p_metodo_pago, 'pagado', v_uid, public.nombre_usuario(v_uid), v_notas)
  returning id into v_venta;

  -- 3) Items + salida de stock (lease primero, luego el pool). stock_sede nunca baja de 0 (registrar_movimiento lo exige)
  for v_row in
    select (e ->> 'producto_id')::uuid as producto_id, sum((e ->> 'cantidad')::numeric) as cantidad
      from jsonb_array_elements(p_items) e group by 1 order by 1
  loop
    select * into v_prod from public.productos where id = v_row.producto_id;
    v_linea := round(v_prod.precio_venta * v_row.cantidad, 2);

    insert into public.venta_items (venta_id, producto_id, producto_codigo, producto_nombre, cantidad,
                                    precio_unitario, precio_compra, subtotal)
    values (v_venta, v_prod.id, v_prod.codigo, v_prod.nombre, v_row.cantidad,
            v_prod.precio_venta, v_prod.precio_compra, v_linea);

    v_de_lease := 0;
    if p_lease is not null and p_fecha_offline is not null then
      select * into v_lease from public.stock_leases_offline
       where lease_id = p_lease and producto_id = v_row.producto_id and estado = 'activo'
         and p_fecha_offline <= expira + interval '1 minute'
         for update;
      if found then v_de_lease := least(v_row.cantidad, v_lease.cantidad - v_lease.usada - v_lease.devuelta); end if;
    end if;

    if v_de_lease > 0 then
      -- el stock ya estaba reservado: se "consume la reserva" y se registra la venta (neto 0 en stock, ambos en el historial)
      perform public.registrar_movimiento(p_sede, v_prod.id, v_de_lease, 'entrada', 'consumo_reserva',
                null, v_num, null, v_venta);
      update public.stock_leases_offline set usada = usada + v_de_lease where id = v_lease.id;
    end if;
    perform public.registrar_movimiento(p_sede, v_prod.id, -v_row.cantidad, 'salida', 'venta',
              null, v_num, null, v_venta);
  end loop;

  return jsonb_build_object('id', v_venta, 'numero', v_num, 'total', v_total);
end;
$$;

-- ---------------------------------------------------------------------
-- 3) Lista de mutaciones y envoltorio idempotente con reintento de deadlock
-- ---------------------------------------------------------------------
create or replace function public._mutaciones_permitidas()
returns text[] language sql immutable as $$
  select array[
    'registrar_venta','anular_venta','cambiar_metodo_pago',
    'abrir_caja','abrir_mi_caja','crear_caja','cerrar_caja','registrar_egreso',
    'registrar_egreso_general','actualizar_egreso',
    'registrar_compra','registrar_compra_completa','recibir_compra','anular_compra',
    'crear_producto','actualizar_producto','ajustar_stock_producto',
    'ajustar_almacen','fijar_almacen','mover_almacen_tienda','enviar_a_sede',
    'crear_sede','actualizar_sede',
    'guardar_cliente','desactivar_cliente','crear_proveedor','guardar_permisos_rol','crear_rol',
    'backup_registrar','backup_aplicar','backup_cancelar',
    'crear_lease_offline','liquidar_lease'
  ]
$$;

create or replace function public.ejecutar_idempotente(p_request_id uuid, p_fn text, p_args jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_hash  text;
  v_prev  public.operaciones_idempotentes%rowtype;
  v_proc  record;
  v_lista text := '';
  v_k     text;
  v_idx   int;
  v_res   jsonb;
  v_val   text;
  v_sql   text;
  v_try   int := 0;
begin
  if v_uid is null then
    raise exception 'Sesión no válida. Vuelve a iniciar sesión.' using errcode = '42501';
  end if;
  if p_request_id is null then raise exception 'Falta el identificador de la operación (request_id).' using errcode = '22023'; end if;
  if not (p_fn = any (public._mutaciones_permitidas())) then
    raise exception 'Operación no permitida: %.', p_fn using errcode = '42501';
  end if;
  p_args := coalesce(p_args, '{}'::jsonb);
  if jsonb_typeof(p_args) <> 'object' then raise exception 'Los argumentos deben ser un objeto.' using errcode = '22023'; end if;

  v_hash := md5(p_fn || '|' || p_args::text);

  -- Serializa llamadas simultáneas con el mismo request_id (doble clic, otra pestaña, reintento)
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':' || p_request_id::text, 0));

  select * into v_prev from public.operaciones_idempotentes where usuario_id = v_uid and request_id = p_request_id;
  if found then
    if v_prev.payload_hash <> v_hash then
      raise exception 'Este identificador de operación ya se usó con datos distintos.' using errcode = 'P0409';
    end if;
    return jsonb_build_object('repetida', true, 'respuesta', v_prev.respuesta);
  end if;

  select p.oid, p.proargnames, p.proargtypes::oid[] as tipos, p.prorettype, p.pronargs
    into v_proc
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = p_fn
   order by p.pronargs desc limit 1;
  if v_proc.oid is null then raise exception 'La operación % no existe.', p_fn using errcode = '42883'; end if;

  for v_k in select jsonb_object_keys(p_args) loop
    v_idx := array_position(v_proc.proargnames, v_k);
    if v_idx is null or v_idx > v_proc.pronargs then
      raise exception 'Argumento desconocido "%" para %.', v_k, p_fn using errcode = '22023';
    end if;
    v_val := p_args ->> v_k;
    if jsonb_typeof(p_args -> v_k) = 'array' and format_type(v_proc.tipos[v_idx - 1], null) like '%[]' then
      select coalesce('{' || string_agg('"' || replace(replace(x, '\', '\\'), '"', '\"') || '"', ',') || '}', '{}')
        into v_val from jsonb_array_elements_text(p_args -> v_k) x;
    end if;
    v_lista := v_lista || case when v_lista = '' then '' else ', ' end
      || format('%I := %L::%s', v_k, v_val, format_type(v_proc.tipos[v_idx - 1], null));
  end loop;

  if v_proc.prorettype = 'void'::regtype then
    v_sql := format('select public.%I(%s)', p_fn, v_lista);
  else
    v_sql := format('select to_jsonb(public.%I(%s))', p_fn, v_lista);
  end if;

  -- Deadlock (40P01): la transacción interna se deshace y se reintenta con la MISMA request_id
  loop
    v_try := v_try + 1;
    begin
      if v_proc.prorettype = 'void'::regtype then
        execute v_sql;
        v_res := null;
      else
        execute v_sql into v_res;
      end if;
      exit;
    exception when deadlock_detected then
      if v_try >= 4 then raise; end if;
      perform pg_sleep(0.05 * v_try + random() * 0.1);
    end;
  end loop;

  insert into public.operaciones_idempotentes (usuario_id, request_id, funcion, payload_hash, respuesta)
  values (v_uid, p_request_id, p_fn, v_hash, v_res);

  delete from public.operaciones_idempotentes where creado < now() - interval '30 days';

  return jsonb_build_object('repetida', false, 'respuesta', v_res);
end;
$$;

-- ---------------------------------------------------------------------
-- 4) Permisos de ejecución
-- ---------------------------------------------------------------------
revoke all on function
  public._expirar_leases(uuid, uuid),
  public.crear_lease_offline(uuid, uuid, jsonb, int, text),
  public.liquidar_lease(uuid),
  public.mis_leases_offline(),
  public.registrar_venta(uuid, uuid, text, uuid, text, numeric, jsonb, text, text, text, uuid, timestamptz, boolean, text),
  public.ejecutar_idempotente(uuid, text, jsonb)
  from public;
grant execute on function
  public.crear_lease_offline(uuid, uuid, jsonb, int, text),
  public.liquidar_lease(uuid),
  public.mis_leases_offline(),
  public.registrar_venta(uuid, uuid, text, uuid, text, numeric, jsonb, text, text, text, uuid, timestamptz, boolean, text),
  public.ejecutar_idempotente(uuid, text, jsonb)
  to authenticated;


-- =====================================================================
-- 27_stock_vivo_y_venta_segura.sql  (idempotente; requiere SQL 01-26)
-- =====================================================================
-- =====================================================================
-- 27_stock_vivo_y_venta_segura.sql
-- Ventas seguras ante cortes de red + stock en tiempo real.
--   1) registrar_venta: una venta ONLINE también puede consumir primero la reserva de SU caja (p_lease),
--      de modo que el mismo pedido (misma request_id y mismos datos) sirva tanto en línea como al
--      reenviarse desde el dispositivo: un corte justo en medio de la venta ya no puede duplicarla.
--   2) mis_leases_offline: ahora incluye el dispositivo, para que cada equipo reconcilie sus reservas
--      (si se perdió la respuesta al reservar, la reserva "huérfana" se devuelve sola).
--   3) stock_sede_vivo(sede): stock disponible + reservado por producto, liviano para consultar cada pocos segundos.
--   4) stock_sede entra a la publicación Realtime (solo si existe) para avisar los cambios al instante.
-- Idempotente. No toca migraciones anteriores, permisos ni RLS.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) registrar_venta (misma firma que en 26; cambia solo el uso de la reserva)
-- ---------------------------------------------------------------------
create or replace function public.registrar_venta(
  p_sede               uuid,
  p_caja               uuid,
  p_tipo               text,
  p_cliente            uuid,
  p_metodo_pago        text,
  p_descuento_pct      numeric,
  p_items              jsonb,
  p_notas              text default null,
  p_cliente_nombre     text default null,
  p_cliente_documento  text default null,
  p_lease              uuid default null,          -- reserva offline desde la que se vendió
  p_fecha_offline      timestamptz default null,   -- cuándo se hizo la venta en el dispositivo
  p_aceptar_precio     boolean default false,      -- acepta el precio actual si cambió desde la venta offline
  p_numero_provisional text default null           -- ticket provisional entregado al cliente
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ses public.caja_sesiones%rowtype;
  v_cli public.clientes%rowtype;
  v_prod public.productos%rowtype;
  v_row record;
  v_lease public.stock_leases_offline%rowtype;
  v_pct numeric := coalesce(p_descuento_pct, 0);
  v_bruto numeric := 0; v_desc numeric; v_total numeric; v_sub numeric; v_igv numeric;
  v_serie text; v_corr int; v_num text; v_venta uuid; v_linea numeric;
  v_cli_nombre text; v_cli_doc text; v_fecha timestamptz; v_esperado numeric; v_notas text;
  v_de_lease numeric;
begin
  perform public.exigir_permiso('ventas.crear');
  perform public.exigir_sede(p_sede);

  if p_tipo not in ('factura','boleta','nota_venta') then raise exception 'Tipo de comprobante no valido.'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta no tiene productos.';
  end if;
  if v_pct < 0 or v_pct > 100 then raise exception 'El descuento debe estar entre 0 y 100.'; end if;
  if v_pct > 0 then perform public.exigir_permiso('ventas.descuentos'); end if;
  if not exists (select 1 from public.metodos_pago where nombre = p_metodo_pago and activo) then
    raise exception 'Metodo de pago no valido.';
  end if;

  if not exists (select 1 from public.cajas where id = p_caja and sede_id = p_sede and activa) then
    raise exception 'La caja no pertenece a la sede seleccionada.' using errcode = 'P0422';
  end if;
  select * into v_ses from public.caja_sesiones where caja_id = p_caja and estado = 'abierta';
  if not found then raise exception 'La caja seleccionada no esta abierta. Abrela para vender.' using errcode = 'P0422'; end if;

  if p_cliente is not null then
    select * into v_cli from public.clientes where id = p_cliente and activo;
    if not found then raise exception 'El cliente no existe o esta inactivo.'; end if;
  end if;

  v_cli_nombre := nullif(trim(coalesce(p_cliente_nombre, '')), '');
  v_cli_doc := nullif(trim(coalesce(p_cliente_documento, '')), '');
  if v_cli_nombre is null and p_cliente is not null then v_cli_nombre := v_cli.nombre; end if;
  if v_cli_doc is null and p_cliente is not null then v_cli_doc := v_cli.documento; end if;
  v_cli_nombre := coalesce(v_cli_nombre, 'Cliente Varios');

  if p_tipo = 'factura' then
    if coalesce(v_cli_doc, '') = '' then raise exception 'La factura requiere el RUC del comprador.'; end if;
    if v_cli_nombre = 'Cliente Varios' then raise exception 'La factura requiere el nombre o razon social del comprador.'; end if;
  end if;

  -- Reserva offline: debe ser de esta caja y de este usuario (si no, la venta no la usa)
  if p_lease is not null then
    if not exists (select 1 from public.stock_leases_offline where lease_id = p_lease and caja_id = p_caja and usuario_id = v_uid) then
      raise exception 'La reserva offline no corresponde a esta caja o usuario.' using errcode = 'P0426';
    end if;
  end if;

  -- Devuelve el stock de reservas vencidas (sin tocar la reserva de esta misma venta)
  if exists (select 1 from public.stock_leases_offline where estado = 'activo' and expira <= now() and sede_id = p_sede) then
    perform public._expirar_leases(p_sede, p_lease);
  end if;

  -- 0) BLOQUEO del stock de TODOS los productos, siempre en el mismo orden (producto_id): sin deadlocks entre ventas
  perform 1
    from public.stock_sede ss
   where ss.sede_id = p_sede
     and ss.producto_id in (select (e ->> 'producto_id')::uuid from jsonb_array_elements(p_items) e)
   order by ss.producto_id
     for update;

  -- 1) Validar productos y calcular total (precios SIEMPRE desde la BD)
  for v_row in
    select (e ->> 'producto_id')::uuid as producto_id, sum((e ->> 'cantidad')::numeric) as cantidad,
           max(nullif(e ->> 'precio_esperado', '')::numeric) as precio_esperado
      from jsonb_array_elements(p_items) e group by 1 order by 1
  loop
    if v_row.cantidad is null or v_row.cantidad <= 0 then raise exception 'Cantidad no valida en la venta.'; end if;
    select * into v_prod from public.productos where id = v_row.producto_id;
    if not found or not v_prod.activo then raise exception 'Hay un producto no disponible en la venta.'; end if;
    if v_row.precio_esperado is not null and not coalesce(p_aceptar_precio, false)
       and v_row.precio_esperado is distinct from v_prod.precio_venta then
      raise exception 'El precio de "%" cambio de % a %.', v_prod.nombre, v_row.precio_esperado, v_prod.precio_venta
        using errcode = 'P0424';
    end if;
    v_bruto := v_bruto + round(v_prod.precio_venta * v_row.cantidad, 2);
  end loop;

  v_desc  := round(v_bruto * v_pct / 100, 2);
  v_total := v_bruto - v_desc;
  v_sub   := round(v_total / 1.18, 2);
  v_igv   := v_total - v_sub;

  -- 2) Cabecera (el correlativo se toma al final, con el stock ya bloqueado)
  select o_serie, o_correlativo into v_serie, v_corr from public.siguiente_correlativo(p_sede, p_tipo);
  v_num := v_serie || '-' || lpad(v_corr::text, 7, '0');
  v_fecha := case when p_fecha_offline is null then now()
                  else least(now(), greatest(p_fecha_offline, v_ses.fecha_apertura)) end;
  v_notas := nullif(trim(concat_ws(' · ', nullif(trim(coalesce(p_notas, '')), ''),
                                   case when p_numero_provisional is not null then 'Venta offline ' || p_numero_provisional end)), '');

  insert into public.ventas (
    sede_id, caja_id, caja_sesion_id, tipo_comprobante, serie, correlativo, numero, fecha,
    cliente_id, cliente_nombre, cliente_documento, subtotal, igv, descuento_pct, descuento_monto,
    total, metodo_pago, estado, usuario_id, usuario_nombre, notas)
  values (
    p_sede, p_caja, v_ses.id, p_tipo, v_serie, v_corr, v_num, v_fecha,
    p_cliente, v_cli_nombre, v_cli_doc, v_sub, v_igv, v_pct, v_desc,
    v_total, p_metodo_pago, 'pagado', v_uid, public.nombre_usuario(v_uid), v_notas)
  returning id into v_venta;

  -- 3) Items + salida de stock (lease primero, luego el pool). stock_sede nunca baja de 0 (registrar_movimiento lo exige)
  for v_row in
    select (e ->> 'producto_id')::uuid as producto_id, sum((e ->> 'cantidad')::numeric) as cantidad
      from jsonb_array_elements(p_items) e group by 1 order by 1
  loop
    select * into v_prod from public.productos where id = v_row.producto_id;
    v_linea := round(v_prod.precio_venta * v_row.cantidad, 2);

    insert into public.venta_items (venta_id, producto_id, producto_codigo, producto_nombre, cantidad,
                                    precio_unitario, precio_compra, subtotal)
    values (v_venta, v_prod.id, v_prod.codigo, v_prod.nombre, v_row.cantidad,
            v_prod.precio_venta, v_prod.precio_compra, v_linea);

    v_de_lease := 0;
    if p_lease is not null then
      select * into v_lease from public.stock_leases_offline
       where lease_id = p_lease and producto_id = v_row.producto_id and estado = 'activo'
         and coalesce(p_fecha_offline, now()) <= expira + interval '1 minute'
         for update;
      if found then v_de_lease := least(v_row.cantidad, v_lease.cantidad - v_lease.usada - v_lease.devuelta); end if;
    end if;

    if v_de_lease > 0 then
      -- el stock ya estaba reservado: se "consume la reserva" y se registra la venta (neto 0 en stock, ambos en el historial)
      perform public.registrar_movimiento(p_sede, v_prod.id, v_de_lease, 'entrada', 'consumo_reserva',
                null, v_num, null, v_venta);
      update public.stock_leases_offline set usada = usada + v_de_lease where id = v_lease.id;
    end if;
    perform public.registrar_movimiento(p_sede, v_prod.id, -v_row.cantidad, 'salida', 'venta',
              null, v_num, null, v_venta);
  end loop;

  return jsonb_build_object('id', v_venta, 'numero', v_num, 'total', v_total);
end;
$$;

-- ---------------------------------------------------------------------
-- 2) Reservas activas del usuario, con el dispositivo que las creó
-- ---------------------------------------------------------------------
create or replace function public.mis_leases_offline()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'lease_id', lease_id, 'sede_id', sede_id, 'caja_id', caja_id, 'producto_id', producto_id,
      'cantidad', cantidad, 'usada', usada, 'devuelta', devuelta, 'estado', estado, 'expira', expira,
      'dispositivo', dispositivo, 'creado', creado)), '[]'::jsonb)
    from public.stock_leases_offline where usuario_id = auth.uid() and estado = 'activo';
$$;

-- ---------------------------------------------------------------------
-- 3) Stock en vivo de una sede: disponible (lo que se puede vender), reservado en cajas y lo reservado por mí
-- ---------------------------------------------------------------------
create or replace function public.stock_sede_vivo(p_sede uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
begin
  perform public.exigir_sede(p_sede);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'producto_id', ss.producto_id,
             'stock', ss.stock,
             'reservado', coalesce(r.total, 0),
             'mio', coalesce(r.mio, 0)))
      from public.stock_sede ss
      left join (
        select producto_id,
               sum(cantidad - usada - devuelta) as total,
               sum(case when usuario_id = auth.uid() then cantidad - usada - devuelta else 0 end) as mio
          from public.stock_leases_offline
         where sede_id = p_sede and estado = 'activo' and expira > now()
         group by producto_id
      ) r on r.producto_id = ss.producto_id
     where ss.sede_id = p_sede
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.stock_sede_vivo(uuid) from public, anon;
grant execute on function public.stock_sede_vivo(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4) Realtime: avisar al instante los cambios de stock (si la publicación existe, p. ej. en Supabase)
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'stock_sede') then
    alter publication supabase_realtime add table public.stock_sede;
  end if;
end $$;


-- =====================================================================
-- 28_limpiar_sistema.sql  (idempotente; requiere SQL 01-27)
-- =====================================================================
-- =====================================================================
-- 28_limpiar_sistema.sql
-- LIMPIADOR DE BASE DE DATOS (pensado para dejar el sistema listo para operar desde cero).
--
--   _limpiar_datos(modo, stock_cero)  Lógica interna. Solo el dueño de la BD (SQL Editor de Supabase) la puede ejecutar.
--   limpiar_sistema(confirmacion, modo, stock_cero)  La que usa el botón «Limpiar sistema» (Backup). Solo ADMINISTRADOR.
--
-- MODOS
--   'movimientos' : borra ventas, comprobantes, cajas y sus egresos, compras, traslados, historial de movimientos
--                   (almacén y tienda), reservas de stock offline, auditoría y la memoria de operaciones; reinicia la
--                   numeración. CONSERVA productos, categorías, clientes, proveedores y el stock actual (queda como
--                   «Saldo inicial» en el historial) — o lo deja en 0 si stock_cero = true.
--   'total'       : lo anterior + borra productos, categorías, clientes, proveedores y todo el stock.
--
-- SIEMPRE se conservan: usuarios (perfiles), roles y permisos, sedes y sus usuarios, configuración y métodos de pago.
-- Idempotente (solo crea funciones). No toca migraciones anteriores, permisos ni RLS.
-- =====================================================================

-- El historial de backups también registra las limpiezas
do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.backup_historial'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%tipo%descarga%' loop
    execute format('alter table public.backup_historial drop constraint %I', c.conname);
  end loop;
  alter table public.backup_historial add constraint backup_historial_tipo_check check (tipo in ('descarga', 'restauracion', 'limpieza'));
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------
-- Lógica interna
-- ---------------------------------------------------------------------
create or replace function public._limpiar_datos(p_modo text default 'movimientos', p_stock_cero boolean default false)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_oper text[] := array[
    'venta_items', 'ventas', 'caja_egresos', 'caja_sesiones', 'cajas', 'caja_correlativos',
    'compra_items', 'compras', 'traspaso_items', 'traspasos',
    'movimientos_almacen', 'movimientos_bodega', 'stock_leases_offline',
    'auditoria', 'operaciones_idempotentes', 'backup_staging'];
  v_cat text[] := array['productos', 'stock_sede', 'almacen_sede', 'categorias', 'clientes', 'proveedores'];
  v_lista text[];
  t text; n bigint; v_borrado jsonb := '{}'::jsonb;
begin
  if p_modo not in ('movimientos', 'total') then
    raise exception 'Modo no válido: usa ''movimientos'' o ''total''.';
  end if;
  v_lista := case when p_modo = 'total' then v_oper || v_cat else v_oper end;

  -- una sola limpieza a la vez y sin ventas/cierres concurrentes a mitad
  perform pg_advisory_xact_lock(hashtextextended('limpiar_sistema', 0));
  perform set_config('app.mov_ok', 'on', true);

  -- cuántos registros se borran (para informar)
  foreach t in array v_lista loop
    if to_regclass(format('public.%I', t)) is not null then
      execute format('select count(*) from public.%I', t) into n;
      v_borrado := v_borrado || jsonb_build_object(t, n);
    end if;
  end loop;

  -- 1) lo reservado para vender sin internet vuelve al stock ANTES de borrar las reservas (si se conserva el stock)
  if p_modo = 'movimientos' and not p_stock_cero and to_regclass('public.stock_leases_offline') is not null then
    update public.stock_sede ss
       set stock = ss.stock + r.pendiente, updated_at = now()
      from (select sede_id, producto_id, sum(cantidad - usada - devuelta) as pendiente
              from public.stock_leases_offline where estado = 'activo' group by 1, 2) r
     where ss.sede_id = r.sede_id and ss.producto_id = r.producto_id and r.pendiente > 0;
  end if;

  -- 2) borrado (TRUNCATE de todo junto: respeta las claves foráneas y es inmediato)
  execute 'truncate table ' || (select string_agg(format('public.%I', x), ', ')
                                   from unnest(v_lista) x where to_regclass(format('public.%I', x)) is not null) || ' restart identity';

  -- 3) numeración desde 1 (las series se conservan; las cajas se vuelven a crear al abrir)
  update public.series_correlativos set correlativo = 0;

  -- 4) stock
  if p_modo = 'movimientos' then
    if p_stock_cero then
      update public.stock_sede set stock = 0, updated_at = now();
      update public.almacen_sede set stock = 0, updated_at = now();
    else
      -- el stock actual queda respaldado por un «saldo inicial» para que stock = suma de movimientos
      insert into public.movimientos_almacen (sede_id, producto_id, tipo, operacion, cantidad, stock_antes, stock_despues, motivo, usuario_nombre)
      select sede_id, producto_id, 'entrada', 'stock_inicial', stock, 0, stock, 'Saldo inicial tras limpiar el sistema', 'Sistema'
        from public.stock_sede where stock > 0;
      insert into public.movimientos_bodega (sede_id, producto_id, tipo, operacion, cantidad, stock_antes, stock_despues, motivo, usuario_nombre)
      select sede_id, producto_id, 'entrada', 'stock_inicial', stock, 0, stock, 'Saldo inicial tras limpiar el sistema', 'Sistema'
        from public.almacen_sede where stock > 0;
    end if;
  end if;

  return jsonb_build_object('modo', p_modo, 'stock_en_cero', p_stock_cero, 'borrado', v_borrado);
end;
$$;
revoke all on function public._limpiar_datos(text, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Botón «Limpiar sistema» (Backup): solo Administrador y con confirmación escrita
-- ---------------------------------------------------------------------
create or replace function public.limpiar_sistema(
  p_confirmacion text,
  p_modo text default 'movimientos',
  p_stock_cero boolean default false
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_nombre text := public.nombre_usuario(auth.uid()); v_res jsonb; v_filas bigint;
begin
  perform public.exigir_permiso('backup.usar');
  if public.nivel_usuario() < 100 then
    raise exception 'Solo un Administrador puede limpiar el sistema.' using errcode = '42501';
  end if;
  if coalesce(p_confirmacion, '') <> 'LIMPIAR SISTEMA' then
    raise exception 'Confirmación incorrecta: escribe exactamente LIMPIAR SISTEMA.';
  end if;

  v_res := public._limpiar_datos(p_modo, coalesce(p_stock_cero, false));
  select coalesce(sum(value::bigint), 0) into v_filas from jsonb_each_text(v_res -> 'borrado');

  insert into public.backup_historial (usuario_id, usuario_nombre, tipo, filas, tablas, estado, detalle)
  values (v_uid, v_nombre, 'limpieza', v_filas, (select count(*) from jsonb_object_keys(v_res -> 'borrado')), 'completado',
          case p_modo when 'total' then 'Limpieza TOTAL (datos y catálogo)' else 'Limpieza de movimientos' end
          || case when p_stock_cero then ' · stock en 0' else ' · stock conservado' end);
  return v_res;
end;
$$;
revoke all on function public.limpiar_sistema(text, text, boolean) from public, anon;
grant execute on function public.limpiar_sistema(text, text, boolean) to authenticated;
