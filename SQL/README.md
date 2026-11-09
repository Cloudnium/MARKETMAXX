# SQL — Base de datos de Sistema Market (Supabase / PostgreSQL)

Todo lo necesario para recrear la BD desde cero. Los scripts son **idempotentes**
(se pueden volver a ejecutar sin romper datos) y están numerados en orden de ejecución.

## Cómo replicar la BD en un proyecto Supabase nuevo

1. Crea el proyecto en https://supabase.com.
2. Abre **SQL Editor → New query**, pega el contenido de **`migracion_completa.sql`** y pulsa **Run**.
   (Equivale a ejecutar `01` … `15` en orden.)
3. *(Opcional, solo pruebas)* ejecuta `16_seed_demo.sql` para cargar productos, clientes y 3 sedes de ejemplo.
4. Crea tu primer usuario en **Authentication → Users → Add user** (correo + contraseña, marca *Auto Confirm*).
   **El primer usuario del sistema se convierte automáticamente en Administrador.**
5. Copia las claves a `.env.local` (ver `.env.local.example`) y arranca la app.

| Archivo | Contenido |
|---|---|
| `01_base.sql` | Configuración, zona horaria, utilidades |
| `02_sedes_seguridad_tablas.sql` | `sedes`, `roles`, `permisos`, `rol_permisos`, `perfiles`, `usuario_sedes`, `series_correlativos` |
| `03_catalogo_tablas.sql` | `categorias`, `productos`, `clientes`, `proveedores`, `metodos_pago` |
| `04_inventario_tablas.sql` | `stock_sede`, `traspasos`, `traspaso_items` |
| `05_ventas_cajas_tablas.sql` | `cajas`, `caja_sesiones`, `caja_egresos`, `ventas`, `venta_items` |
| `06_compras_tablas.sql` | `compras`, `compra_items` |
| `07_movimientos_auditoria_tablas.sql` | `movimientos_almacen` (historial inmutable), `auditoria` |
| `08_funciones_seguridad.sql` | `tiene_permiso()`, `puede_ver_sede()`, rangos, alta automática de perfil |
| `09_triggers.sql` | Blindaje del stock, tablas inmutables, alta automática por sede/producto, auditoría |
| `10_funciones_inventario.sql` | `registrar_movimiento()`, ajustes, conteo, traspasos, alta/edición de productos |
| `11_funciones_ventas_cajas.sql` | Cajas, `registrar_venta()`, `anular_venta()` |
| `12_funciones_compras_sedes.sql` | Compras, `crear_sede()`, `actualizar_usuario()` |
| `13_vistas_reportes.sql` | Vistas (`v_stock`, `v_movimientos`, `v_cajas`…) y reportes del dashboard |
| `14_rls.sql` | Row Level Security y permisos mínimos |
| `15_seed_base.sql` | Permisos, roles, métodos de pago, categorías, 1ª sede |
| `16_seed_demo.sql` | **Opcional** datos de ejemplo |
| `17_venta_cliente_manual.sql` | Datos de comprador escritos en la venta (DNI/RUC + nombre) |
| `18_catalogo_por_sede_y_almacen.sql` | Productos propios de cada sede, almacén (bodega) por sede, traslados almacén→tienda / sede→sede e historiales |
| `19_egresos_y_cajas.sql` | Egresos con categoría (módulo EGRESOS), número de caja automático (`abrir_mi_caja`) y vista de turnos `v_caja_sesiones` |
| `20_cambiar_metodo_pago.sql` | Cambiar el método de pago de un comprobante pagado (acción en COMPROBANTES, con auditoría) |
| `21_ajuste_stock_productos.sql` | Agregar / restar stock desde el editor de PRODUCTOS (restar solo Administrador y Supervisor) |
| `22_egresos_compras_reportes.sql` | Compras de insumos como egreso de caja, egresos con RUC/foto y `reporte_egresos` (REPORTES → Egresos) |
| `23_backup_editar_egresos_reportes.sql` | Backup/restauración real de la BD con historial, editar egresos (`egresos.editar`) y tarjetas extra del reporte de ventas |
| `24_resiliencia_idempotencia.sql` | Resiliencia de red: `ejecutar_idempotente` + `consultar_operacion` (sin duplicados al reintentar), compra atómica, fix doble caja y egreso sin caja |
| `25_forzar_idempotencia.sql` | OPCIONAL: ejecutar solo después de desplegar el frontend nuevo; bloquea las llamadas directas sin request_id |
| `26_ventas_concurrentes_offline.sql` | Ventas simultáneas sin sobreventa: lock ordenado, reservas de stock offline por caja (leases), liquidación/expiración automática, reintento de deadlock |
| `27_stock_vivo_y_venta_segura.sql` | Ventas a prueba de cortes de wifi (la venta en línea usa primero la reserva de su caja y se reenvía con el mismo pedido), reservas huérfanas recuperables, `stock_sede_vivo` (stock en tiempo real) y Realtime para `stock_sede` |
| `28_limpiar_sistema.sql` | Limpiador de datos del sistema (solo Administrador, con frase de confirmación): modo «movimientos» o «total». Se usa desde Backup → Limpiar sistema |
| `29_venta_solo_en_mi_caja.sql` | Un cajero solo puede vender en la caja que abrió él (un supervisor, en cualquiera) |
| `30_cierre_caja_seguro.sql` | Cierre de caja sin carreras (ninguna venta/egreso se guarda tras el cierre), tarjetas de turno siempre al día tras anular/cambiar método, reservas offline liberadas al cerrar, `abrir_mi_caja` reutiliza cajas cerradas y `caja_totales` respeta la sede |
| `99_LIMPIAR_BASE_DE_DATOS.sql` | Script manual opcional (editor SQL) para limpiar la base; no es una migración, ejecutar solo si se desea limpiar |
| `00_RESET_solo_desarrollo.sql` | **Peligro**: borra todo el esquema (solo desarrollo) |

## Cómo funciona (resumen)

**Multisede.** Todo dato operativo (stock, cajas, ventas, compras, movimientos) lleva `sede_id`.
Al crear una sede se generan solos: sus series (`F00N`, `B00N`, `NV00N`…), el stock en 0 de todos los
productos y una “Caja 1”. Cada usuario ve/opera solo las sedes de `usuario_sedes`
(salvo roles con el permiso `sedes.ver_todas`). Los productos, clientes y proveedores son globales.

**Almacén sin excepciones.** `stock_sede` solo puede cambiar a través de `registrar_movimiento()`:
un trigger rechaza cualquier otro `UPDATE`/`INSERT` de stock, y `movimientos_almacen` no admite
`UPDATE` ni `DELETE`. Cada movimiento guarda cantidad, stock antes/después, usuario, referencia y motivo.
Operaciones registradas: stock inicial, compra, anulación de compra, venta, anulación de venta,
traspaso (salida/entrada), ingreso manual, ajuste, merma, devolución, conteo físico y corrección de producto.
Ajustes, correcciones y anulaciones **exigen motivo**.
Control de integridad: `select * from v_control_stock;` debe devolver 0 filas.

**Rangos y permisos.** Cada rol tiene un `nivel` y un conjunto de permisos (tabla `rol_permisos`).
Se validan en la BD (no solo en la pantalla). Un usuario solo puede gestionar usuarios/roles de nivel
igual o inferior al suyo. Los roles y permisos se editan desde la app (Usuarios → Roles y permisos).

**Seguridad.** RLS activo en todas las tablas; el navegador solo puede *leer* lo que su rol/sedes permiten.
Las escrituras críticas pasan por funciones (`registrar_venta`, `anular_venta`, `traspasar`…) que leen
precios y stock desde la BD, nunca desde el navegador.

## Base de datos ya instalada
Si tu BD ya existe, ejecuta solo los scripts nuevos que necesites (por ejemplo
`17_venta_cliente_manual.sql`, `18_catalogo_por_sede_y_almacen.sql`, `19_egresos_y_cajas.sql`, `20_cambiar_metodo_pago.sql`, `21_ajuste_stock_productos.sql`, `22_egresos_compras_reportes.sql`, `23_backup_editar_egresos_reportes.sql` y `24_resiliencia_idempotencia.sql`) en el SQL Editor de Supabase.

> **18 reparte los productos existentes por sede**: cada producto queda en la sede donde tiene stock/movimientos;
> si se usó en varias sedes se crea una copia por sede con su propio stock e historial. Haz un backup antes
> (Supabase → Database → Backups) y revisa el mensaje `NOTICE` que muestra cuántos productos asignó y copió.

## Agregar cambios futuros
Crea un archivo nuevo `18_xxx.sql` (idempotente) y añádelo a `migracion_completa.sql`.
Si agregas una tabla nueva: activa RLS, crea sus políticas y concede `select` a `authenticated`.
