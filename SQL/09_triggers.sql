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
