-- =====================================================================
-- 20_cambiar_metodo_pago.sql  (idempotente)
-- Permite corregir el método de pago de un comprobante pagado (cualquier rol
-- con acceso a la sede). El importe NO cambia; queda registrado en auditoría.
-- =====================================================================
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
     or (new.metodo_pago is distinct from old.metodo_pago
         and coalesce(current_setting('app.mp_ok', true), '') <> '1') then
    raise exception 'Los importes de una venta emitida no se pueden modificar.';
  end if;
  return new;
end;
$$;

create or replace function public.cambiar_metodo_pago(p_venta uuid, p_metodo text)
returns text
language plpgsql security definer set search_path = public
as $$
declare v public.ventas%rowtype; v_uid uuid := auth.uid();
begin
  if not public.usuario_activo() then
    raise exception 'Usuario no autorizado.' using errcode = '42501';
  end if;
  select * into v from public.ventas where id = p_venta for update;
  if not found then raise exception 'El comprobante no existe.'; end if;
  perform public.exigir_sede(v.sede_id);
  if v.estado <> 'pagado' then raise exception 'Solo se puede cambiar el método de un comprobante pagado.'; end if;
  if not exists (select 1 from public.metodos_pago where nombre = p_metodo and activo) then
    raise exception 'Método de pago no válido.';
  end if;
  if v.metodo_pago = p_metodo then return v.metodo_pago; end if;

  perform set_config('app.mp_ok', '1', true);
  update public.ventas set metodo_pago = p_metodo where id = p_venta;
  perform set_config('app.mp_ok', '', true);

  insert into public.auditoria (usuario_id, usuario_nombre, accion, tabla, registro_id, detalle)
  values (v_uid, public.nombre_usuario(v_uid), 'UPDATE', 'ventas', p_venta::text,
          jsonb_build_object('campo', 'metodo_pago', 'comprobante', v.numero, 'de', v.metodo_pago, 'a', p_metodo));
  return p_metodo;
end;
$$;

revoke all on function public.cambiar_metodo_pago(uuid, text) from public;
grant execute on function public.cambiar_metodo_pago(uuid, text) to authenticated;
