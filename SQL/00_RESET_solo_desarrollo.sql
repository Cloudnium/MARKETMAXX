-- =====================================================================
-- 00_RESET_solo_desarrollo.sql
-- ¡PELIGRO! Borra TODAS las tablas, vistas y funciones del sistema en el
-- esquema public. Úsalo solo en desarrollo para volver a empezar.
-- Los usuarios de Supabase Auth NO se borran (hazlo desde Authentication).
-- =====================================================================
drop trigger if exists on_auth_user_created on auth.users;
drop view if exists public.v_control_stock, public.v_sedes_resumen, public.v_clientes,
                    public.v_cajas, public.v_movimientos, public.v_stock cascade;
drop table if exists
  public.auditoria, public.movimientos_almacen, public.compra_items, public.compras,
  public.venta_items, public.ventas, public.caja_egresos, public.caja_sesiones, public.cajas,
  public.traspaso_items, public.traspasos, public.stock_sede,
  public.metodos_pago, public.proveedores, public.clientes, public.productos, public.categorias,
  public.series_correlativos, public.usuario_sedes, public.perfiles, public.rol_permisos,
  public.permisos, public.roles, public.sedes, public.configuracion cascade;
drop sequence if exists public.seq_codigo_usuario;
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prokind = 'f' loop
    execute 'drop function if exists ' || r.f || ' cascade';
  end loop;
end $$;
