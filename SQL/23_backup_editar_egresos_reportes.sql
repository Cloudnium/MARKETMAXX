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
