-- =====================================================================
-- 19_egresos_y_cajas.sql  (idempotente)
--  * EGRESOS: caja_egresos admite egresos generales (con categoría, proveedor,
--    documento y observaciones) vinculados o no a una caja abierta.
--  * CAJAS: el número de caja se asigna solo (correlativo por sede) con
--    abrir_mi_caja(); vista v_caja_sesiones para las tarjetas "Cajas del día".
-- No modifica ventas, compras ni el cierre de caja existente.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Egresos generales
-- ---------------------------------------------------------------------
alter table public.caja_egresos alter column sesion_id drop not null;
alter table public.caja_egresos alter column caja_id   drop not null;

alter table public.caja_egresos
  add column if not exists categoria         text not null default 'Otros gastos',
  add column if not exists proveedor         text,
  add column if not exists tipo_documento    text,
  add column if not exists numero_documento  text,
  add column if not exists observaciones     text,
  add column if not exists fecha_egreso      date;

update public.caja_egresos set fecha_egreso = public.fecha_negocio(fecha) where fecha_egreso is null;
alter table public.caja_egresos alter column fecha_egreso set default public.fecha_negocio(now());
alter table public.caja_egresos alter column fecha_egreso set not null;

alter table public.caja_egresos drop constraint if exists caja_egresos_categoria_chk;
alter table public.caja_egresos add constraint caja_egresos_categoria_chk
  check (categoria in ('Compra de insumos','Servicio / Pago terceros','Pago a personal','Mantenimiento','Otros gastos'));

alter table public.caja_egresos drop constraint if exists caja_egresos_sesion_caja_chk;
alter table public.caja_egresos add constraint caja_egresos_sesion_caja_chk
  check ((sesion_id is null) = (caja_id is null));

create index if not exists caja_egresos_sede_fecha_idx on public.caja_egresos (sede_id, fecha_egreso desc);

drop policy if exists caja_egresos_select on public.caja_egresos;
create policy caja_egresos_select on public.caja_egresos for select to authenticated
  using (public.puede_ver_sede(sede_id) and public.tiene_algun_permiso(array['cajas.ver','compras.ver']));

create or replace function public.registrar_egreso_general(
  p_sede            uuid,
  p_fecha           date,
  p_categoria       text,
  p_concepto        text,
  p_proveedor       text,
  p_monto           numeric,
  p_tipo_documento  text default null,
  p_numero_documento text default null,
  p_observaciones   text default null,
  p_descontar_caja  boolean default true
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_ses public.caja_sesiones%rowtype; v_id uuid;
begin
  if not public.tiene_algun_permiso(array['compras.crear','cajas.egresos']) then
    raise exception 'No tienes permiso para registrar egresos.' using errcode = '42501';
  end if;
  perform public.exigir_sede(p_sede);
  if length(trim(coalesce(p_concepto, ''))) < 2 then raise exception 'Escribe la descripción o concepto del egreso.'; end if;
  if p_monto is null or p_monto <= 0 then raise exception 'El monto del egreso debe ser mayor a cero.'; end if;
  if p_categoria is null then raise exception 'Elige la categoría del egreso.'; end if;

  if coalesce(p_descontar_caja, false) then
    select * into v_ses from public.caja_sesiones
     where sede_id = p_sede and usuario_id = v_uid and estado = 'abierta'
     order by fecha_apertura desc limit 1;
  end if;

  insert into public.caja_egresos (sesion_id, caja_id, sede_id, concepto, monto, usuario_id, usuario_nombre,
                                   categoria, proveedor, tipo_documento, numero_documento, observaciones, fecha_egreso)
  values (v_ses.id, v_ses.caja_id, p_sede, trim(p_concepto), p_monto, v_uid, public.nombre_usuario(v_uid),
          p_categoria, nullif(trim(p_proveedor), ''), nullif(trim(p_tipo_documento), ''),
          nullif(trim(p_numero_documento), ''), nullif(trim(p_observaciones), ''),
          coalesce(p_fecha, public.fecha_negocio(now())))
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 2) Número de caja automático (correlativo por sede)
-- ---------------------------------------------------------------------
create table if not exists public.caja_correlativos (
  sede_id uuid primary key references public.sedes(id) on delete cascade,
  ultimo  int not null default 0 check (ultimo >= 0)
);
alter table public.caja_correlativos enable row level security;
revoke all on public.caja_correlativos from anon, authenticated;

create or replace function public.abrir_mi_caja(p_sede uuid, p_monto_apertura numeric default 0)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_n int; v_caja uuid; v_abierta text;
begin
  perform public.exigir_permiso('cajas.abrir');
  perform public.exigir_sede(p_sede);
  if coalesce(p_monto_apertura, 0) < 0 then raise exception 'El monto de apertura no puede ser negativo.'; end if;

  select c.nombre into v_abierta
    from public.caja_sesiones s join public.cajas c on c.id = s.caja_id
   where s.sede_id = p_sede and s.usuario_id = v_uid and s.estado = 'abierta' limit 1;
  if found then
    raise exception 'Ya tienes abierta la %. Ciérrala antes de abrir otra.', v_abierta;
  end if;

  -- el contador arranca después de la caja más alta que ya exista en la sede
  insert into public.caja_correlativos (sede_id, ultimo)
  select p_sede, coalesce(max((substring(nombre from '(\d{1,6})\s*$'))::int), 0)
    from public.cajas where sede_id = p_sede
  on conflict (sede_id) do nothing;

  loop
    update public.caja_correlativos set ultimo = ultimo + 1 where sede_id = p_sede returning ultimo into v_n;
    exit when not exists (select 1 from public.cajas where sede_id = p_sede and lower(nombre) = lower('Caja ' || v_n));
  end loop;

  insert into public.cajas (sede_id, nombre) values (p_sede, 'Caja ' || v_n) returning id into v_caja;
  return public.abrir_caja(v_caja, coalesce(p_monto_apertura, 0));
end;
$$;

-- ---------------------------------------------------------------------
-- 3) Turnos de caja (una fila por apertura) para las tarjetas "Cajas del día"
-- ---------------------------------------------------------------------
create or replace view public.v_caja_sesiones with (security_invoker = true) as
select
  s.id as sesion_id, s.caja_id, c.nombre as caja_nombre, s.sede_id, sd.nombre as sede_nombre,
  s.usuario_id, s.usuario_nombre, s.fecha_apertura, s.fecha_cierre, s.estado,
  public.fecha_negocio(s.fecha_apertura) as dia,
  s.monto_apertura, s.monto_sistema, s.monto_contado, s.diferencia, s.observaciones,
  case when s.estado = 'cerrada' then coalesce(s.ingresos_cierre, t.ingresos) else t.ingresos end as ingresos,
  t.ingresos_efectivo,
  case when s.estado = 'cerrada' then coalesce(s.egresos_cierre, t.egresos) else t.egresos end as egresos,
  case when s.estado = 'cerrada' then coalesce(s.ventas_cierre, t.ventas) else t.ventas end as ventas
from public.caja_sesiones s
join public.cajas c  on c.id  = s.caja_id
join public.sedes sd on sd.id = s.sede_id
left join lateral public.caja_totales(s.id) t on true;

-- ---------------------------------------------------------------------
-- 4) Permisos
-- ---------------------------------------------------------------------
revoke all on function public.registrar_egreso_general(uuid, date, text, text, text, numeric, text, text, text, boolean) from public;
revoke all on function public.abrir_mi_caja(uuid, numeric) from public;
grant execute on function
  public.registrar_egreso_general(uuid, date, text, text, text, numeric, text, text, text, boolean),
  public.abrir_mi_caja(uuid, numeric)
  to authenticated;
grant select on public.v_caja_sesiones to authenticated;
