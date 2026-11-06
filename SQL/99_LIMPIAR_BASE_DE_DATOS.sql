-- =====================================================================
-- 99_LIMPIAR_BASE_DE_DATOS.sql   —   ¡DESTRUCTIVO!  Ejecutar a mano en el SQL Editor
-- Requiere haber ejecutado antes 28_limpiar_sistema.sql.
-- ANTES: descarga un Backup desde el sistema (módulo Backup). Esto no se puede deshacer.
--
-- Elige UNA de las opciones (quita los dos guiones "--" de la que quieras) y ejecuta:
-- =====================================================================

-- A) Borra ventas, cajas, egresos, compras, traslados e historiales. CONSERVA catálogo, clientes y el stock actual:
-- select public._limpiar_datos('movimientos', false);

-- B) Igual que A, pero deja TODO el stock en 0:
-- select public._limpiar_datos('movimientos', true);

-- C) LIMPIEZA TOTAL: además borra productos, categorías, clientes, proveedores y stock:
-- select public._limpiar_datos('total', false);

-- Siempre se conservan usuarios, roles/permisos, sedes, configuración y métodos de pago.
