-- =====================================================================
-- 21_ajuste_stock_productos.sql  (idempotente)
-- Sección "Agregar / Restar stock" al editar un producto (PRODUCTOS).
--  * Cualquier usuario con permiso de editar productos puede AGREGAR stock.
--  * Solo Administrador y Supervisor (nivel >= 60) pueden RESTAR.
--  * Queda en el historial correspondiente: PRODUCTOS (tienda) o ALMACÉN (bodega).
-- =====================================================================
create or replace function public.ajustar_stock_producto(
  p_sede       uuid,
  p_producto   uuid,
  p_ubicacion  text,      -- 'tienda' | 'almacen'
  p_delta      numeric,
  p_motivo     text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_serie text; v_corr int; v_ref text; v_motivo text; v_op text; v_tipo text;
begin
  perform public.exigir_permiso('productos.editar');
  perform public.exigir_sede(p_sede);
  if p_ubicacion not in ('tienda','almacen') then raise exception 'Ubicación no válida.'; end if;
  if p_delta is null or p_delta = 0 then raise exception 'La cantidad debe ser distinta de cero.'; end if;
  if p_delta < 0 then
    if public.nivel_usuario() < 60 then
      raise exception 'Solo administradores y supervisores pueden restar stock.' using errcode = '42501';
    end if;
    if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Indica el motivo para restar stock.'; end if;
  end if;

  v_op     := case when p_delta > 0 then 'ingreso_manual' else 'ajuste_manual' end;
  v_tipo   := case when p_delta > 0 then 'entrada' else 'ajuste' end;
  v_motivo := coalesce(nullif(trim(p_motivo), ''),
                case p_ubicacion when 'tienda' then 'Ingreso manual desde Productos (tienda)'
                                 else 'Ingreso manual desde Productos (almacén)' end);

  select o_serie, o_correlativo into v_serie, v_corr from public.siguiente_correlativo(p_sede, 'ajuste');
  v_ref := v_serie || '-' || lpad(v_corr::text, 6, '0');

  if p_ubicacion = 'tienda' then
    return public.registrar_movimiento(p_sede, p_producto, p_delta, v_tipo, v_op, v_motivo, v_ref);
  else
    return public.registrar_movimiento_bodega(p_sede, p_producto, p_delta, v_tipo, v_op, v_motivo, v_ref);
  end if;
end;
$$;

revoke all on function public.ajustar_stock_producto(uuid, uuid, text, numeric, text) from public;
grant execute on function public.ajustar_stock_producto(uuid, uuid, text, numeric, text) to authenticated;
