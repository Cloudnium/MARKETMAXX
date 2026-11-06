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
