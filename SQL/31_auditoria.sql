-- =====================================================================
-- 31_auditoria.sql  (idempotente; requiere SQL 01-30)
-- Ventana «Auditoría» (Herramientas): solo ADMINISTRADORES.
--  1) La tabla auditoria solo se puede leer con el permiso 'auditoria.ver' Y rol de nivel administrador.
--  2) Se audita también: cajas, turnos (apertura/cierre), egresos (alta/baja/anulación), anulación de ventas
--     y recepción/anulación de compras (antes solo productos, sedes, usuarios, roles, clientes y proveedores).
--  3) Cada registro nuevo guarda una etiqueta legible («ref»: nombre, número, código...). Se ignoran cambios
--     sin interés (updated_at, ultimo_acceso) y se acotan los textos enormes (p. ej. fotos de comprobantes).
--  4) Funciones de consulta con filtros, paginación, resumen y registro de descargas del reporte.
-- No borra ni modifica registros existentes (la tabla es inmutable).
-- =====================================================================

-- 1) Solo administradores -----------------------------------------------------
drop policy if exists auditoria_select on public.auditoria;
create policy auditoria_select on public.auditoria for select to authenticated
  using (public.tiene_permiso('auditoria.ver') and public.nivel_usuario() >= 100);

create index if not exists auditoria_usuario_idx on public.auditoria (usuario_nombre, fecha desc);

-- 3) Auditoría genérica mejorada ----------------------------------------------
create or replace function public._audit_acotar(j jsonb)
returns jsonb
language sql immutable
as $$
  select case when j is null then null else
    coalesce((select jsonb_object_agg(e.k,
              case when jsonb_typeof(e.v) = 'string' and length(e.v #>> '{}') > 500
                   then to_jsonb('[contenido extenso omitido]'::text) else e.v end)
                from jsonb_each(j) as e(k, v)), '{}'::jsonb)
  end;
$$;

create or replace function public.fn_auditar()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_old jsonb; v_new jsonb; v_ref jsonb;
  v_antes jsonb; v_despues jsonb; v_id text; v_etiqueta text;
begin
  if tg_op = 'INSERT' then
    v_new := public._audit_acotar(to_jsonb(new)); v_ref := v_new; v_despues := v_new;
  elsif tg_op = 'UPDATE' then
    v_old := public._audit_acotar(to_jsonb(old)); v_new := public._audit_acotar(to_jsonb(new)); v_ref := v_new;
    select jsonb_object_agg(n.key, n.value), jsonb_object_agg(n.key, v_old -> n.key)
      into v_despues, v_antes
      from jsonb_each(v_new) n
     where n.key not in ('updated_at', 'ultimo_acceso') and (v_old -> n.key) is distinct from n.value;
    if v_despues is null then return new; end if;     -- nada relevante cambió
  else
    v_old := public._audit_acotar(to_jsonb(old)); v_ref := v_old; v_antes := v_old;
  end if;

  v_id := coalesce(v_ref ->> 'id',
                   (v_ref ->> 'rol_id') || ':' || (v_ref ->> 'permiso_codigo'),
                   (v_ref ->> 'usuario_id') || ':' || (v_ref ->> 'sede_id'));
  v_etiqueta := coalesce(nullif(v_ref ->> 'nombre', ''), nullif(v_ref ->> 'numero', ''), nullif(v_ref ->> 'codigo', ''),
                         nullif(v_ref ->> 'concepto', ''), nullif(v_ref ->> 'permiso_codigo', ''), nullif(v_ref ->> 'usuario_nombre', ''));

  insert into public.auditoria (usuario_id, usuario_nombre, accion, tabla, registro_id, detalle)
  values (auth.uid(), coalesce(public.nombre_usuario(auth.uid()), 'Sistema'), tg_op, tg_table_name, v_id,
          jsonb_strip_nulls(jsonb_build_object('antes', v_antes, 'despues', v_despues, 'ref', v_etiqueta)));

  return coalesce(new, old);
end;
$$;

-- 2) Más tablas auditadas ------------------------------------------------------
drop trigger if exists trg_cajas_audit on public.cajas;
create trigger trg_cajas_audit after insert or update or delete on public.cajas
  for each row execute function public.fn_auditar();

drop trigger if exists trg_caja_sesiones_audit on public.caja_sesiones;
create trigger trg_caja_sesiones_audit after insert or update on public.caja_sesiones
  for each row execute function public.fn_auditar();

-- egresos: alta, baja y anulación (la edición ya queda registrada por actualizar_egreso)
drop trigger if exists trg_caja_egresos_audit on public.caja_egresos;
create trigger trg_caja_egresos_audit after insert or delete or update of anulado on public.caja_egresos
  for each row execute function public.fn_auditar();

-- ventas: anulación (el cambio de método de pago ya lo registra cambiar_metodo_pago)
drop trigger if exists trg_ventas_audit on public.ventas;
create trigger trg_ventas_audit after update of estado on public.ventas
  for each row execute function public.fn_auditar();

-- compras: recepción y anulación
drop trigger if exists trg_compras_audit on public.compras;
create trigger trg_compras_audit after update of estado or delete on public.compras
  for each row execute function public.fn_auditar();

-- 4) Consultas ------------------------------------------------------------------
create or replace function public._auditoria_filtrada(
  p_desde timestamptz, p_hasta timestamptz, p_usuario text, p_tabla text, p_accion text, p_busqueda text)
returns setof public.auditoria
language sql stable security invoker set search_path = public
as $$
  select a.* from public.auditoria a
   where (p_desde is null or a.fecha >= p_desde)
     and (p_hasta is null or a.fecha <  p_hasta)
     and (coalesce(p_usuario, '') = '' or a.usuario_nombre = p_usuario)
     and (coalesce(p_tabla,   '') = '' or a.tabla   = p_tabla)
     and (coalesce(p_accion,  '') = '' or a.accion  = p_accion)
     and (coalesce(trim(p_busqueda), '') = ''
          or strpos(lower(coalesce(a.usuario_nombre, '') || ' ' || a.tabla || ' ' || coalesce(a.registro_id, '') || ' ' || coalesce(a.detalle::text, '')),
                    lower(trim(p_busqueda))) > 0);
$$;

create or replace function public.auditoria_buscar(
  p_desde timestamptz default null, p_hasta timestamptz default null, p_usuario text default null,
  p_tabla text default null, p_accion text default null, p_busqueda text default null,
  p_limit int default 20, p_offset int default 0)
returns table (id uuid, fecha timestamptz, usuario_id uuid, usuario_nombre text, accion text, tabla text,
               registro_id text, detalle jsonb, total bigint)
language sql stable security invoker set search_path = public
as $$
  select f.id, f.fecha, f.usuario_id, f.usuario_nombre, f.accion, f.tabla, f.registro_id, f.detalle, count(*) over ()
    from public._auditoria_filtrada(p_desde, p_hasta, p_usuario, p_tabla, p_accion, p_busqueda) f
   order by f.fecha desc, f.id desc
   limit least(greatest(coalesce(p_limit, 20), 1), 1000) offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function public.auditoria_resumen(
  p_desde timestamptz default null, p_hasta timestamptz default null, p_usuario text default null,
  p_tabla text default null, p_accion text default null, p_busqueda text default null)
returns jsonb
language sql stable security invoker set search_path = public
as $$
  with f as (select * from public._auditoria_filtrada(p_desde, p_hasta, p_usuario, p_tabla, p_accion, p_busqueda))
  select jsonb_build_object(
    'total',    (select count(*) from f),
    'usuarios', (select count(distinct coalesce(usuario_nombre, '—')) from f),
    'por_accion', coalesce((select jsonb_object_agg(accion, n) from (select accion, count(*) n from f group by accion) x), '{}'::jsonb),
    'por_tabla',  coalesce((select jsonb_object_agg(tabla, n)  from (select tabla,  count(*) n from f group by tabla)  x), '{}'::jsonb));
$$;

create or replace function public.auditoria_opciones()
returns jsonb
language sql stable security invoker set search_path = public
as $$
  select jsonb_build_object(
    'usuarios', coalesce((select jsonb_agg(u order by u) from (select distinct usuario_nombre u from public.auditoria where usuario_nombre is not null) x), '[]'::jsonb),
    'tablas',   coalesce((select jsonb_agg(t order by t) from (select distinct tabla t from public.auditoria) x), '[]'::jsonb),
    'acciones', coalesce((select jsonb_agg(a order by a) from (select distinct accion a from public.auditoria) x), '[]'::jsonb));
$$;

-- Deja constancia de quién bajó un reporte de auditoría
create or replace function public.auditoria_registrar_descarga(p_formato text, p_filtros jsonb default '{}'::jsonb, p_filas int default 0)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if not (public.tiene_permiso('auditoria.ver') and public.nivel_usuario() >= 100) then
    raise exception 'Solo un administrador puede descargar la auditoría.' using errcode = '42501';
  end if;
  insert into public.auditoria (usuario_id, usuario_nombre, accion, tabla, registro_id, detalle)
  values (v_uid, public.nombre_usuario(v_uid), 'DESCARGA', 'auditoria', null,
          jsonb_build_object('formato', p_formato, 'filas', p_filas, 'filtros', coalesce(p_filtros, '{}'::jsonb)));
end;
$$;

revoke all on function public.auditoria_registrar_descarga(text, jsonb, int) from public, anon;
grant execute on function public.auditoria_registrar_descarga(text, jsonb, int) to authenticated;
revoke all on function public._auditoria_filtrada(timestamptz, timestamptz, text, text, text, text) from public, anon;
grant execute on function public._auditoria_filtrada(timestamptz, timestamptz, text, text, text, text) to authenticated;
revoke all on function public.auditoria_buscar(timestamptz, timestamptz, text, text, text, text, int, int) from public, anon;
grant execute on function public.auditoria_buscar(timestamptz, timestamptz, text, text, text, text, int, int) to authenticated;
revoke all on function public.auditoria_resumen(timestamptz, timestamptz, text, text, text, text) from public, anon;
grant execute on function public.auditoria_resumen(timestamptz, timestamptz, text, text, text, text) to authenticated;
revoke all on function public.auditoria_opciones() from public, anon;
grant execute on function public.auditoria_opciones() to authenticated;
