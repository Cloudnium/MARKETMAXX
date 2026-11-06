#!/bin/bash
# Pruebas del limpiador de BD (SQL 28) sobre una COPIA de la BD de pruebas (la original no se toca).
# Requiere BD t1 con SQL 01-28 y los cajeros de fixtures.sh.
PGC="psql -h /tmp/pgt -p 5444 -U pgt -q -At"
DB=t1_limpieza
$PGC postgres -c "drop database if exists $DB" -c "create database $DB template t1" >/dev/null || { echo "No se pudo clonar t1 (¿conexiones abiertas?)"; exit 1; }
P="$PGC $DB"
as() { PGOPTIONS="-c request.uid=$1" $PGC $DB "${@:2}"; }
U1=00000000-0000-0000-0000-000000000101; ADM=00000000-0000-0000-0000-0000000000aa
FALLOS=0
ok() { if [ "$2" = "$3" ]; then echo "PASS  $1"; else echo "FAIL  $1 (esperado '$3', obtenido '$2')"; FALLOS=$((FALLOS+1)); fi; }
SC=$($P -c "select id from sedes where codigo='TC'")
PID=$($P -c "select id from productos where sede_id='$SC' and codigo='779001'")
cuenta() { $P -c "select count(*) from $1"; }
invariantes() { ok "$1: stock = suma de movimientos" "$($P -c 'select count(*) from v_control_stock')" 0
                ok "$1: nunca negativo" "$($P -c 'select count(*) from stock_sede where stock < 0')" 0; }
venta() { as $U1 -c "select ejecutar_idempotente(gen_random_uuid(),'registrar_venta',jsonb_build_object('p_sede','$SC','p_caja','$($P -c "select caja_id from caja_sesiones where usuario_id='$U1' and estado='abierta' and sede_id='$SC'")','p_tipo','boleta','p_cliente',null,'p_metodo_pago','Efectivo','p_descuento_pct',0,'p_items',jsonb_build_array(jsonb_build_object('producto_id','$PID','cantidad',$1))))->'respuesta'->>'numero'" 2>&1 | head -1; }

CAJA_U1=$($P -c "select caja_id from caja_sesiones where usuario_id='$U1' and estado='abierta' and sede_id='$SC'")
[ -z "$CAJA_U1" ] && as $U1 -c "select abrir_mi_caja('$SC', 10)" >/dev/null
echo "== L1 seguridad"
ok "L1 un cajero NO puede limpiar" "$(as $U1 -c "select limpiar_sistema('LIMPIAR SISTEMA','total')" 2>&1 | grep -q -E 'Solo un Administrador|permiso' && echo 1)" 1
ok "L1 confirmación incorrecta se rechaza" "$(as $ADM -c "select limpiar_sistema('limpiar','total')" 2>&1 | grep -c 'Confirmación incorrecta')" 1
ok "L1 la función interna no es ejecutable por usuarios" "$(as $ADM -c "set role authenticated; select _limpiar_datos('total')" 2>&1 | grep -ci 'permission denied')" 1
ok "L1 modo inválido se rechaza" "$(as $ADM -c "select limpiar_sistema('LIMPIAR SISTEMA','todo')" 2>&1 | grep -c 'Modo no válido')" 1
ok "L1 nada se borró con los intentos fallidos" "$([ "$(cuenta ventas)" -gt 0 ] && echo si)" si

echo "== L2 modo 'movimientos' conservando el stock (con una reserva offline activa)"
as $ADM -c "select ajustar_stock_producto('$SC','$PID','tienda', 20 - (select stock from stock_sede where producto_id='$PID' and sede_id='$SC') + case when (select stock from stock_sede where producto_id='$PID' and sede_id='$SC')=20 then 1 else 0 end,'test')" >/dev/null
CAJA=$($P -c "select caja_id from caja_sesiones where usuario_id='$U1' and estado='abierta' and sede_id='$SC'")
as $U1 -c "select crear_lease_offline('$SC','$CAJA',jsonb_build_array(jsonb_build_object('producto_id','$PID','cantidad',5)),480,'dev')" >/dev/null
venta 2 >/dev/null
TOTAL_ANTES=$($P -c "select (select stock from stock_sede where producto_id='$PID' and sede_id='$SC') + (select coalesce(sum(cantidad-usada-devuelta),0) from stock_leases_offline where estado='activo' and producto_id='$PID' and sede_id='$SC')")
NPROD=$(cuenta productos); NCLI=$(cuenta clientes); NPERF=$(cuenta perfiles); NSEDE=$(cuenta sedes); NROL=$(cuenta roles); NPERM=$(cuenta rol_permisos); NCFG=$(cuenta configuracion); NMET=$(cuenta metodos_pago)
RES=$(as $ADM -c "select limpiar_sistema('LIMPIAR SISTEMA','movimientos',false)::text")
for t in ventas venta_items caja_sesiones caja_egresos cajas compras traspasos stock_leases_offline auditoria operaciones_idempotentes; do ok "L2 $t vacía" "$(cuenta $t)" 0; done
ok "L2 productos intactos" "$(cuenta productos)" "$NPROD"
ok "L2 clientes intactos" "$(cuenta clientes)" "$NCLI"
ok "L2 usuarios, sedes, roles, permisos, config y métodos de pago intactos" "$(cuenta perfiles)/$(cuenta sedes)/$(cuenta roles)/$(cuenta rol_permisos)/$(cuenta configuracion)/$(cuenta metodos_pago)" "$NPERF/$NSEDE/$NROL/$NPERM/$NCFG/$NMET"
ok "L2 el stock se conserva (incluida la reserva devuelta)" "$($P -c "select stock from stock_sede where producto_id='$PID' and sede_id='$SC'")" "$TOTAL_ANTES"
ok "L2 el historial queda solo con 'Saldo inicial'" "$($P -c "select string_agg(distinct operacion, ',') from movimientos_almacen")" "stock_inicial"
ok "L2 numeración reiniciada" "$($P -c "select max(correlativo) from series_correlativos")" 0
ok "L2 el informe indica lo borrado" "$(echo "$RES" | python3 -c "import sys,json; print(json.load(sys.stdin)['borrado']['ventas'] > 0)")" True
ok "L2 queda registrado en el historial de backups" "$($P -c "select count(*) from backup_historial where tipo='limpieza'")" 1
invariantes L2
echo "   -- el sistema sigue funcionando: abrir caja, vender y numeración desde 1"
as $U1 -c "select abrir_mi_caja('$SC', 50)" >/dev/null
NUM=$(venta 1)
ok "L2 nueva venta numerada desde 1" "$(echo "$NUM" | grep -c -E '[BFN0-9]*-?0*1$')" 1
ok "L2 la caja nueva es 'Caja 1'" "$($P -c "select nombre from cajas order by created_at limit 1")" "Caja 1"
invariantes L2b

echo "== L3 stock en cero"
as $ADM -c "select limpiar_sistema('LIMPIAR SISTEMA','movimientos',true)" >/dev/null
ok "L3 todo el stock en 0" "$($P -c "select coalesce(sum(stock),0) from stock_sede")/$($P -c "select coalesce(sum(stock),0) from almacen_sede")" "0.000/0.000"
ok "L3 sin movimientos" "$(cuenta movimientos_almacen)" 0
ok "L3 productos conservados" "$(cuenta productos)" "$NPROD"
invariantes L3

echo "== L4 limpieza TOTAL"
as $ADM -c "select limpiar_sistema('LIMPIAR SISTEMA','total')" >/dev/null
for t in productos categorias clientes proveedores stock_sede almacen_sede ventas compras movimientos_almacen; do ok "L4 $t vacía" "$(cuenta $t)" 0; done
ok "L4 usuarios, sedes, roles y métodos de pago se conservan" "$(cuenta perfiles)/$(cuenta sedes)/$(cuenta roles)/$(cuenta metodos_pago)" "$NPERF/$NSEDE/$NROL/$NMET"
ok "L4 el administrador puede seguir entrando (permisos)" "$(as $ADM -c "select tiene_permiso('backup.usar')")" t
ok "L4 se puede abrir caja de nuevo" "$(as $U1 -c "select abrir_mi_caja('$SC', 0) is not null" 2>&1 | head -1)" t
invariantes L4

echo "== L5 la limpieza manual en el editor SQL funciona igual"
$PGC postgres -c "drop database $DB" -c "create database $DB template t1" >/dev/null
ok "L5 _limpiar_datos como dueño de la BD" "$($P -c "select (_limpiar_datos('total',false))->>'modo'")" total
ok "L5 queda vacío" "$(cuenta ventas)/$(cuenta productos)" "0/0"
$PGC postgres -c "drop database $DB" >/dev/null
echo "== Resultado: $FALLOS fallos"
[ "$FALLOS" = 0 ]
