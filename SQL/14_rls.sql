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
  public.registrar_venta(uuid, uuid, text, uuid, text, numeric, jsonb, text, text, text),
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
