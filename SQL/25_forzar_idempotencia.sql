-- =====================================================================
-- 25_forzar_idempotencia.sql  (OPCIONAL — ejecutar SOLO después de desplegar el frontend nuevo)
-- Quita el acceso directo a las funciones de escritura: a partir de aquí toda
-- mutación debe pasar por ejecutar_idempotente(request_id, ...). Así ningún
-- cliente antiguo (ni una pestaña vieja sin recargar) puede duplicar datos.
-- Para revertir: ejecutar de nuevo los GRANT de 11/12/18/19/20/21/22/23.
-- =====================================================================
do $$
declare f text;
begin
  foreach f in array public._mutaciones_permitidas() loop
    begin
      execute (
        select coalesce(string_agg(format('revoke execute on function %s from authenticated', p.oid::regprocedure), '; '), 'select 1')
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = f
      );
    end;
  end loop;
end $$;
