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
  -- Supabase activa pg_safeupdate (rechaza UPDATE/DELETE sin WHERE). Solo en ESTA transacción se desactiva,
  -- para que ninguna sentencia masiva de la limpieza (ni de un trigger) la haga fallar.
  begin perform set_config('safeupdate.enabled', '0', true); exception when others then null; end;

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
  update public.series_correlativos set correlativo = 0 where correlativo is distinct from 0;

  -- 4) stock
  if p_modo = 'movimientos' then
    if p_stock_cero then
      update public.stock_sede set stock = 0, updated_at = now() where stock is distinct from 0;
      update public.almacen_sede set stock = 0, updated_at = now() where stock is distinct from 0;
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
