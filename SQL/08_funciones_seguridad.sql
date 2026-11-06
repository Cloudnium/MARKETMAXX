-- =====================================================================
-- 08_funciones_seguridad.sql
-- Funciones de autorización (usadas por RLS y por las funciones de
-- negocio) y creación automática de perfil al registrarse un usuario.
-- =====================================================================

create or replace function public.usuario_activo()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.perfiles where id = auth.uid() and estado = 'activo');
$$;

create or replace function public.tiene_permiso(p_codigo text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.perfiles pf
    join public.roles r         on r.id = pf.rol_id and r.activo
    join public.rol_permisos rp on rp.rol_id = r.id
    where pf.id = auth.uid()
      and pf.estado = 'activo'
      and rp.permiso_codigo = p_codigo
  );
$$;

create or replace function public.tiene_algun_permiso(p_codigos text[])
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.perfiles pf
    join public.roles r         on r.id = pf.rol_id and r.activo
    join public.rol_permisos rp on rp.rol_id = r.id
    where pf.id = auth.uid()
      and pf.estado = 'activo'
      and rp.permiso_codigo = any (p_codigos)
  );
$$;

-- Nivel jerárquico (rango) del usuario actual
create or replace function public.nivel_usuario()
returns int
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select r.nivel from public.perfiles pf join public.roles r on r.id = pf.rol_id
      where pf.id = auth.uid() and pf.estado = 'activo'), 0);
$$;

-- ¿El usuario puede VER datos de esa sede?
create or replace function public.puede_ver_sede(p_sede uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.usuario_activo() and (
    public.tiene_permiso('sedes.ver_todas')
    or exists (select 1 from public.usuario_sedes us where us.usuario_id = auth.uid() and us.sede_id = p_sede)
  );
$$;

-- ¿El usuario puede OPERAR (vender, mover stock...) en esa sede?
create or replace function public.puede_operar_en_sede(p_sede uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.sedes where id = p_sede and activa)
     and public.puede_ver_sede(p_sede);
$$;

-- Lanza error si el usuario actual no tiene el permiso
create or replace function public.exigir_permiso(p_codigo text)
returns void
language plpgsql stable security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sesión no válida. Vuelve a iniciar sesión.' using errcode = '42501';
  end if;
  if not public.tiene_permiso(p_codigo) then
    raise exception 'No tienes permiso para realizar esta acción (%).', p_codigo using errcode = '42501';
  end if;
end;
$$;

create or replace function public.exigir_sede(p_sede uuid)
returns void
language plpgsql stable security definer set search_path = public
as $$
begin
  if p_sede is null or not public.puede_operar_en_sede(p_sede) then
    raise exception 'No puedes operar en la sede seleccionada.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.nombre_usuario(p_id uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select coalesce((select nombre from public.perfiles where id = p_id), 'Sistema');
$$;

-- ¿El usuario actual puede crear/editar a otro usuario con ese rol?
-- Regla de rango: solo puede gestionar usuarios de nivel <= al suyo.
create or replace function public.validar_gestion_usuario(
  p_permiso text,
  p_rol_destino uuid default null,
  p_usuario_destino uuid default null
) returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare
  v_mi_nivel int;
  v_nivel_rol int;
  v_nivel_actual int;
begin
  if not public.tiene_permiso(p_permiso) then return false; end if;
  v_mi_nivel := public.nivel_usuario();

  if p_rol_destino is not null then
    select nivel into v_nivel_rol from public.roles where id = p_rol_destino and activo;
    if v_nivel_rol is null or v_nivel_rol > v_mi_nivel then return false; end if;
  end if;

  if p_usuario_destino is not null then
    select coalesce(r.nivel, 0) into v_nivel_actual
      from public.perfiles pf left join public.roles r on r.id = pf.rol_id
     where pf.id = p_usuario_destino;
    if v_nivel_actual > v_mi_nivel then return false; end if;
  end if;
  return true;
end;
$$;

-- Permisos del usuario actual (para ocultar/mostrar opciones en la UI)
create or replace function public.mis_permisos()
returns text[]
language sql stable security definer set search_path = public
as $$
  select coalesce(array_agg(rp.permiso_codigo order by rp.permiso_codigo), '{}')
  from public.perfiles pf
  join public.roles r         on r.id = pf.rol_id and r.activo
  join public.rol_permisos rp on rp.rol_id = r.id
  where pf.id = auth.uid() and pf.estado = 'activo';
$$;

-- Siguiente correlativo atómico por sede y tipo de documento
create or replace function public.siguiente_correlativo(p_sede uuid, p_tipo text,
                                                        out o_serie text, out o_correlativo int)
language plpgsql security definer set search_path = public
as $$
begin
  update public.series_correlativos
     set correlativo = correlativo + 1
   where sede_id = p_sede and tipo = p_tipo
  returning serie, correlativo into o_serie, o_correlativo;

  if o_serie is null then
    raise exception 'La sede no tiene serie configurada para "%".', p_tipo;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Alta automática de perfil cuando se crea un usuario en Supabase Auth.
--  * El PRIMER usuario del sistema se convierte en Administrador.
--  * Los demás se crean desde la app (con rol en raw_user_meta_data.rol_id).
--    Si no traen rol quedan 'inactivo' hasta que un administrador los active.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_primero boolean;
  v_rol     uuid;
  v_estado  text;
  v_nombre  text;
begin
  select not exists (select 1 from public.perfiles) into v_primero;
  v_nombre := coalesce(nullif(trim(new.raw_user_meta_data ->> 'nombre'), ''), split_part(new.email, '@', 1));

  if v_primero then
    select id into v_rol from public.roles where nombre = 'Administrador' limit 1;
    v_estado := 'activo';
  else
    v_rol := nullif(new.raw_user_meta_data ->> 'rol_id', '')::uuid;
    v_estado := case when v_rol is null then 'inactivo'
                     else coalesce(nullif(new.raw_user_meta_data ->> 'estado', ''), 'activo') end;
  end if;

  insert into public.perfiles (id, nombre, email, telefono, rol_id, estado)
  values (new.id, v_nombre, new.email, nullif(new.raw_user_meta_data ->> 'telefono', ''), v_rol, v_estado);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
