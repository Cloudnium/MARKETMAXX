# Puesta en marcha con Supabase

1. **Base de datos**: sigue `SQL/README.md` (pegar `SQL/migracion_completa.sql` en el SQL Editor).
2. **Variables**: copia `.env.local.example` a `.env.local` y completa
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY`
   (Project Settings → API). La *service role* solo se usa en el servidor (`app/api/usuarios`) para crear usuarios; nunca la expongas.
3. `npm install` → `npm run dev` → http://localhost:3000
4. Ingresa con el primer usuario que creaste en Authentication (será Administrador).
5. Flujo recomendado: **Sedes** (crear/editar) → **Usuarios** (crear, rol y sedes) → **Productos** → **Compras** (ingreso de stock) → **Cajas** (abrir) → **Ventas**.

## Qué cambió en el sistema
- **Login real** (Supabase Auth). Tras ingresar, si el usuario tiene varias sedes elige con cuál trabajar; luego puede cambiarla en la barra superior.
- **Sidebar**: nueva sección **Sedes**; cada opción se muestra solo si el rol tiene permiso.
- **Almacén**: historial real de movimientos, botón **Ajustar** (agregar / descontar / conteo físico con motivo obligatorio) y traspasos reales.
- **Ventas, Cajas, Comprobantes, Compras, Clientes, Productos, Usuarios, Dashboard y Reportes** leen y escriben en la BD.
- **Usuarios**: crear/editar con rol y sedes, desactivar, y editor de **Roles y permisos**.
- `lib/mock-data.ts` ya no se usa; quedó en `_legacy/` por referencia.

## Notas
- Los productos, clientes y proveedores son globales; el **stock, cajas, ventas y compras son por sede**.
- Las ventas exigen una caja **abierta** en la sede.
- Backup: Supabase hace copias automáticas (Dashboard → Database → Backups); la pantalla “Backup” del sistema sigue siendo solo visual.
