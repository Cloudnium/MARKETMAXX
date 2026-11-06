#!/bin/bash
# Pruebas SQL de ventas concurrentes + leases offline. BD local con SQL 01-26 y 3 cajeros (U1..U3) con caja abierta.
. /tmp/fx.sh
FALLOS=0
ok() { if [ "$2" = "$3" ]; then echo "PASS  $1"; else echo "FAIL  $1 (esperado '$3', obtenido '$2')"; FALLOS=$((FALLOS+1)); fi; }
PID=$($P -c "select id from productos where sede_id='$SC' and codigo='779001'")
PID2=$($P -c "select id from productos where sede_id='$SC' and codigo<>'779001' and activo order by codigo limit 1")
stock()  { $P -c "select stock from stock_sede where producto_id='$1' and sede_id='$SC'"; }
poner()  { as $ADM -c "select ajustar_stock_producto('$SC','$1','tienda', $2 - (select stock from stock_sede where producto_id='$1' and sede_id='$SC'),'test')" >/dev/null; }
caja()   { $P -c "select caja_id from caja_sesiones where usuario_id='$1' and estado='abierta' and sede_id='$SC'"; }
venta()  { # usuario producto cantidad [lease] [precio_esperado] [aceptar]
  local u=$1 pid=$2 q=$3 lease=${4:-null} pe=${5:-null} ac=${6:-false}
  local lq="null"; [ "$lease" != "null" ] && lq="'$lease'"
  local fo="null"; [ "$lease" != "null" ] && fo="'${FECHA_OFF:-$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)}'::timestamptz"
  as $u -c "select ejecutar_idempotente(${REQ:-gen_random_uuid()},'registrar_venta',jsonb_build_object('p_sede','$SC','p_caja','$(caja $u)','p_tipo','boleta','p_cliente',null,'p_metodo_pago','Efectivo','p_descuento_pct',0,'p_items',jsonb_build_array(jsonb_build_object('producto_id','$pid','cantidad',$q,'precio_esperado',$pe)),'p_lease',$lq,'p_fecha_offline',$fo,'p_aceptar_precio',$ac))::text" 2>&1 | head -1
}
lease() { as $1 -c "select crear_lease_offline('$SC','$(caja $1)',jsonb_build_array(jsonb_build_object('producto_id','$PID','cantidad',$2)),480,'dev')->>'lease_id'" 2>&1 | head -1; }
invariantes() { ok "$1: stock = suma de movimientos" "$($P -c 'select count(*) from v_control_stock')" 0
                ok "$1: nunca negativo" "$($P -c 'select count(*) from stock_sede where stock < 0')" 0; }

echo "== T1 tres usuarios compran la última unidad (online, simultáneo)"
poner $PID 1
for u in $U1 $U2 $U3; do ( venta $u $PID 1 > /tmp/v_$u.out ) & done; wait
OKS=$(cat /tmp/v_*.out | grep -c '"repetida": false')
ok "T1 exactamente 1 venta pasa" "$OKS" 1
ok "T1 stock final 0" "$(stock $PID)" 0.000
ok "T1 los otros 2 reciben mensaje claro" "$(cat /tmp/v_*.out | grep -c 'Stock insuficiente')" 2
invariantes T1

echo "== T2 tres equipos offline con leases separados (stock 6 → 2 por caja)"
poner $PID 6
L1=$(lease $U1 2); L2=$(lease $U2 2); L3=$(lease $U3 2)
ok "T2 stock del pool tras reservar" "$(stock $PID)" 0.000
ok "T2 otra caja online no puede usar lo reservado" "$(venta $ADM $PID 1 | grep -c 'Stock insuficiente')" 1
ok "T2 un usuario no puede usar el lease de otro" "$(venta $U2 $PID 1 $L1 | grep -c 'no corresponde')" 1
R1=$(cat /proc/sys/kernel/random/uuid); R2=$(cat /proc/sys/kernel/random/uuid); R3=$(cat /proc/sys/kernel/random/uuid); R4=$(cat /proc/sys/kernel/random/uuid)
( REQ="'$R1'" venta $U1 $PID 2 $L1 > /tmp/o1 ) & ( REQ="'$R2'" venta $U2 $PID 2 $L2 > /tmp/o2 ) & ( REQ="'$R3'" venta $U3 $PID 1 $L3 > /tmp/o3 ) & wait
ok "T2 las 3 ventas offline sincronizan" "$(cat /tmp/o1 /tmp/o2 /tmp/o3 | grep -c '"repetida": false')" 3
ok "T2 stock sigue 0 (sin sobreventa)" "$(stock $PID)" 0.000
ok "T2 lease sobrepasado no vende de más" "$(venta $U1 $PID 1 $L1 | grep -c 'Stock insuficiente')" 1
echo "== T3 reconexión: reenviar la misma request_id = 1 venta"
poner $PID 3
NV=$($P -c "select count(*) from ventas"); FECHA_OFF=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)
R5=$(cat /proc/sys/kernel/random/uuid); B=$(FECHA_OFF=$FECHA_OFF REQ="'$R5'" venta $U1 $PID 2 $L1); C=$(FECHA_OFF=$FECHA_OFF REQ="'$R5'" venta $U1 $PID 2 $L1)
ok "T3 reenvío con la misma request_id devuelve repetida=true" "$(echo "$C" | grep -c '"repetida": true')" 1
ok "T3 la 1ª ejecución creó la venta" "$(echo "$B" | grep -c '"repetida": false')" 1
ok "T3 la misma request_id nunca crea una 2ª venta" "$($P -c "select count(*) from ventas")" "$((NV+1))"
invariantes T3

echo "== T4 liquidar devuelve lo no usado (y es repetible)"
ANTES=$(stock $PID)
as $U3 -c "select liquidar_lease('$L3')::text" | head -1
ok "T4 U3 reservó 2, usó 1 → vuelve 1" "$(stock $PID)" "$(echo "$ANTES + 1" | bc)"
as $U3 -c "select ejecutar_idempotente(gen_random_uuid(),'liquidar_lease',jsonb_build_object('p_lease','$L3'))::text" >/dev/null
ok "T4 segundo liquidar no devuelve más" "$(stock $PID)" "$(echo "$ANTES + 1" | bc)"
invariantes T4

echo "== T5 lease vencido devuelve stock automáticamente"
poner $PID 5
L4=$(lease $U2 3)
ok "T5 reservó 3" "$(stock $PID)" 2.000
$P -c "update stock_leases_offline set expira = now() - interval '1 minute' where lease_id='$L4'" >/dev/null
as $ADM -c "select _expirar_leases('$SC')" >/dev/null
ok "T5 vencido: stock devuelto" "$(stock $PID)" 5.000
ok "T5 estado vencido" "$($P -c "select distinct estado from stock_leases_offline where lease_id='$L4'")" vencido
ok "T5 venta tardía del lease vencido cae al pool si hay stock" "$(venta $U2 $PID 1 $L4 | grep -c '"repetida": false')" 1
ok "T5 …y descuenta del pool" "$(stock $PID)" 4.000
invariantes T5

echo "== T6 precio cambiado → conflicto; aceptar precio → pasa"
PRE=$($P -c "select precio_venta from productos where id='$PID'")
as $ADM -c "update productos set precio_venta = precio_venta + 1 where id='$PID'" >/dev/null 2>&1 || $P -c "update productos set precio_venta = precio_venta + 1 where id='$PID'" >/dev/null
ok "T6 precio distinto rechazado" "$(venta $U1 $PID 1 null $PRE false | grep -c 'cambio de')" 1
ok "T6 aceptando el nuevo precio pasa" "$(venta $U1 $PID 1 null $PRE true | grep -c '"repetida": false')" 1

echo "== T7 deadlock: otra transacción toma los locks en orden inverso; la venta se reintenta sola"
poner $PID 10; poner $PID2 10
DL0=$($P -c "select deadlocks from pg_stat_database where datname='t1'")
# la venta bloquea en orden de producto_id (LO→HI); el competidor lo hace al revés (HI→LO) para provocar el deadlock
if [[ "$PID" < "$PID2" ]]; then LO=$PID; HI=$PID2; else LO=$PID2; HI=$PID; fi
( $P <<SQL > /dev/null
begin;
select 1 from stock_sede where producto_id='$HI' and sede_id='$SC' for update;
select pg_sleep(1.2);
select 1 from stock_sede where producto_id='$LO' and sede_id='$SC' for update;
commit;
SQL
) &
sleep 0.3
ITEMS="jsonb_build_array(jsonb_build_object('producto_id','$PID','cantidad',1),jsonb_build_object('producto_id','$PID2','cantidad',1))"
OUT=$(as $U1 -c "select ejecutar_idempotente(gen_random_uuid(),'registrar_venta',jsonb_build_object('p_sede','$SC','p_caja','$(caja $U1)','p_tipo','boleta','p_cliente',null,'p_metodo_pago','Efectivo','p_descuento_pct',0,'p_items',$ITEMS))::text" 2>&1 | head -1)
wait
sleep 1
ok "T7 Postgres detectó un deadlock real (y la venta lo reintentó)" "$($P -c "select (deadlocks > $DL0)::int from pg_stat_database where datname='t1'")" 1
ok "T7 la venta termina bien pese al deadlock" "$(echo "$OUT" | grep -c '"repetida": false')" 1
invariantes T7

echo "== T8 venta ONLINE contra la reserva de mi caja + stock en vivo + mismo pedido reenviado tras un corte"
poner $PID 6
L8=$(lease $U1 2)
ok "T8 reservó 2 (pool 4)" "$(stock $PID)" 4.000
ok "T8 sin la reserva, pedir 5 con pool 4 falla (otra caja)" "$(venta $U2 $PID 5 | grep -c 'Stock insuficiente')" 1
R8=$(cat /proc/sys/kernel/random/uuid)
venta8() { as $U1 -c "select ejecutar_idempotente('$R8','registrar_venta',jsonb_build_object('p_sede','$SC','p_caja','$(caja $U1)','p_tipo','boleta','p_cliente',null,'p_metodo_pago','Efectivo','p_descuento_pct',0,'p_items',jsonb_build_array(jsonb_build_object('producto_id','$PID','cantidad',5)),'p_lease','$L8'))::text" 2>&1 | head -1; }
NV8=$($P -c "select count(*) from ventas")
A8=$(venta8)
ok "T8 con mi reserva (2) + pool (3) alcanza para 5" "$(echo "$A8" | grep -c '"repetida": false')" 1
ok "T8 stock: 6 - 5 = 1" "$(stock $PID)" 1.000
ok "T8 la reserva quedó consumida (usada=2)" "$($P -c "select usada from stock_leases_offline where lease_id='$L8'")" 2.000
B8=$(venta8)
ok "T8 el MISMO pedido tras un corte devuelve repetida (sin duplicar)" "$(echo "$B8" | grep -c '"repetida": true')" 1
ok "T8 una sola venta nueva" "$($P -c "select count(*) from ventas")" "$((NV8+1))"
ok "T8 el stock no se descontó dos veces" "$(stock $PID)" 1.000
invariantes T8
poner $PID 10
L9=$(lease $U2 3)
V1=$(as $U1 -c "select (select e from jsonb_array_elements(stock_sede_vivo('$SC')) e where e->>'producto_id'='$PID')::text")
ok "T8 stock en vivo (otro cajero): ve el pool, 3 reservados en otra caja, 0 míos" "$(echo "$V1" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['stock'], d['reservado'], d['mio'])")" "7.0 3.0 0.0"
V2=$(as $U2 -c "select (select e from jsonb_array_elements(stock_sede_vivo('$SC')) e where e->>'producto_id'='$PID')::text")
ok "T8 stock en vivo (dueño de la reserva): mio = 3" "$(echo "$V2" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['mio'])")" "3.0"
as $U2 -c "select liquidar_lease('$L9')::text" >/dev/null
as $U1 -c "select liquidar_lease('$L8')::text" >/dev/null 2>&1
ok "T8 usuario de otra sede no ve el stock (exigir_sede)" "$(as 00000000-0000-0000-0000-0000000000ff -c "select stock_sede_vivo('$SC')" 2>&1 | grep -c 'No puedes operar')" 1
invariantes T8b

echo "== Resultado: $FALLOS fallos"
exit $FALLOS
