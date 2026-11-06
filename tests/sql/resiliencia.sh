#!/bin/bash
# Pruebas SQL de resiliencia: BD local con SQL 01-24 aplicados; PGOPTIONS simula auth.uid() del administrador.
export PGOPTIONS="-c request.uid=00000000-0000-0000-0000-0000000000aa"; P="psql -h /tmp/pgt -p 5444 -U pgt -q -At t1"
SC=$($P -c "select id from sedes where codigo='TC'")
CAJA=$($P -c "select caja_id from caja_sesiones where usuario_id=auth.uid() and sede_id='$SC' and estado='abierta'")
$P -c "select cerrar_caja('$CAJA',0,'test')" >/dev/null
echo "== 4 egreso sin caja abierta"
$P -c "select ejecutar_idempotente(gen_random_uuid(),'registrar_egreso_general',jsonb_build_object('p_sede','$SC','p_fecha','2026-11-03','p_categoria','Otros gastos','p_concepto','agua','p_proveedor','X','p_monto',10,'p_descontar_caja',true))" 2>&1 | head -1
$P -c "select count(*) from caja_egresos where concepto='agua'"
echo "== 4b sin descontar caja funciona"
$P -c "select (ejecutar_idempotente(gen_random_uuid(),'registrar_egreso_general',jsonb_build_object('p_sede','$SC','p_fecha','2026-11-03','p_categoria','Otros gastos','p_concepto','agua','p_proveedor','X','p_monto',10,'p_descontar_caja',false)))->>'repetida'"
CAJA=$($P -c "select caja_id from caja_sesiones where usuario_id=auth.uid() and sede_id='$SC' and estado='abierta'")
$P -c "select cerrar_caja('$CAJA',0,'test')" >/dev/null
echo "== 6 doble caja: 4 requests distintos simultáneos"
for i in 1 2 3 4; do ( $P -c "select ejecutar_idempotente(gen_random_uuid(),'abrir_mi_caja',jsonb_build_object('p_sede','$SC','p_monto_apertura',5))::text" 2>&1 | head -1 | cut -c1-80 ) & done; wait
$P -c "select count(*) filter (where estado='abierta') abiertas from caja_sesiones where usuario_id=auth.uid() and sede_id='$SC'"
echo "== 7 compra completa atómica (falla: cantidad 0 en 2º item) no deja proveedor ni producto"
$P -c "select ejecutar_idempotente(gen_random_uuid(),'registrar_compra_completa',jsonb_build_object('p_sede','$SC','p_proveedor_nombre','Prov Fantasma','p_comprobante','F1','p_fecha',null,'p_items','[{\"nombre\":\"Prod Fantasma\",\"cantidad\":2,\"precio\":3},{\"nombre\":\"Otro Fantasma\",\"cantidad\":0,\"precio\":3}]'::jsonb,'p_recibida',true))::text" 2>&1 | head -1
$P -c "select (select count(*) from proveedores where nombre='Prov Fantasma') prov,(select count(*) from productos where nombre like '%Fantasma') prod,(select count(*) from compras where comprobante_proveedor='F1') compras"
echo "== 7b compra completa OK con producto nuevo y proveedor nuevo, reintento misma id"
RQ=44444444-4444-4444-4444-444444444444
ARGS="jsonb_build_object('p_sede','$SC','p_proveedor_nombre','Prov Real','p_comprobante','F2','p_fecha',null,'p_items','[{\"nombre\":\"Prod Real\",\"cantidad\":5,\"precio\":2}]'::jsonb,'p_recibida',true)"
$P -c "select (ejecutar_idempotente('$RQ','registrar_compra_completa',$ARGS))->>'repetida'"
$P -c "select (ejecutar_idempotente('$RQ','registrar_compra_completa',$ARGS))->>'repetida'"
$P -c "select (select count(*) from compras where comprobante_proveedor='F2') compras,(select stock from stock_sede ss join productos p on p.id=ss.producto_id where p.nombre='Prod Real') stock,(select count(*) from v_control_stock) ctrl"
echo "== 8 última unidad: 2 ventas simultáneas de la última unidad"
PID=$($P -c "select id from productos where sede_id='$SC' and codigo='779001'")
$P -c "select ajustar_stock_producto('$SC','$PID','tienda', 1 - (select stock from stock_sede where producto_id='$PID' and sede_id='$SC'),'dejar 1')" 2>&1 | head -1
$P -c "select stock from stock_sede where producto_id='$PID' and sede_id='$SC'"
CAJA=$($P -c "select caja_id from caja_sesiones where usuario_id=auth.uid() and sede_id='$SC' and estado='abierta'")
for i in 1 2; do ( $P -c "select ejecutar_idempotente(gen_random_uuid(),'registrar_venta',jsonb_build_object('p_sede','$SC','p_caja','$CAJA','p_tipo','boleta','p_cliente',null,'p_metodo_pago','Efectivo','p_descuento_pct',0,'p_items',jsonb_build_array(jsonb_build_object('producto_id','$PID','cantidad',1))))::text" 2>&1 | head -1 | cut -c1-110 ) & done; wait
$P -c "select stock from stock_sede where producto_id='$PID' and sede_id='$SC'" -c "select count(*) from v_control_stock"
