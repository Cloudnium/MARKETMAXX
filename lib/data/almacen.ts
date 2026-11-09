import type { MovimientoAlmacen, MovimientoBodega, StockItem, TipoMovimiento } from "@/lib/types";
import { limitesRango } from "@/lib/fechas";
import { check, db,  num, rpc, rpcMut, traerTodo, type FiltroFechas } from "./db";
import { obtenerReservadoPorProducto } from "./stockVivo";

/** Stock de la TIENDA (lo que se vende). Solo productos de la sede consultada. */
export async function listarStock(sedeId: string | null): Promise<StockItem[]> {
  const rows = await traerTodo<any>((a, b) => {
    let q = db().from("v_stock").select("*").eq("activo", true)
      .order("producto").order("producto_id").range(a, b);
    if (sedeId) q = q.eq("sede_id", sedeId);
    return q;
  });
  return rows.map((r) => ({
    id: `${r.sede_id}-${r.producto_id}`,
    productoId: r.producto_id,
    producto: r.producto,
    codigo: r.codigo,
    categoria: r.categoria ?? "Sin categoría",
    tienda: r.sede_nombre,
    sedeId: r.sede_id,
    stock: num(r.stock),
    stockMinimo: num(r.stock_minimo),
    unidad: r.unidad,
  }));
}

/** Stock del ALMACÉN (bodega) de cada sede, junto con lo que hay en su tienda. */
export async function listarStockAlmacen(sedeId: string | null): Promise<StockItem[]> {
  const rows = await traerTodo<any>((a, b) => {
    let q = db().from("v_stock_almacen").select("*").eq("activo", true)
      .order("producto").order("producto_id").range(a, b);
    if (sedeId) q = q.eq("sede_id", sedeId);
    return q;
  });
  return rows.map((r) => ({
    id: `${r.sede_id}-${r.producto_id}`,
    productoId: r.producto_id,
    producto: r.producto,
    codigo: r.codigo,
    categoria: r.categoria ?? "Sin categoría",
    tienda: r.sede_nombre,
    sedeId: r.sede_id,
    stock: num(r.stock),
    stockTienda: num(r.stock_tienda),
    stockMinimo: num(r.stock_minimo),
    unidad: r.unidad,
  }));
}

export const operacionLabel: Record<string, string> = {
  stock_inicial: "Stock inicial",
  compra: "Compra recibida",
  anulacion_compra: "Anulación de compra",
  venta: "Venta",
  anulacion_venta: "Anulación de venta",
  traspaso_salida: "Traspaso (salida)",
  traspaso_entrada: "Traspaso (entrada)",
  ingreso_manual: "Ingreso manual",
  ajuste_manual: "Ajuste manual",
  conteo_fisico: "Conteo físico",
  merma: "Merma / pérdida",
  devolucion: "Devolución",
  correccion_producto: "Corrección de producto",
  desde_almacen: "Desde almacén",
  a_almacen: "A almacén",
  reserva_offline: "Reserva offline",
  consumo_reserva: "Consumo de reserva",
  devolucion_lease: "Devolución de reserva",
};

/**
 * Movimientos INTERNOS del sistema de reservas de stock para vender sin internet (apartar, consumir y devolver).
 * No son operaciones del negocio (ventas, compras, anulaciones…): se ocultan del historial por defecto.
 */
export const OPERACIONES_INTERNAS: readonly string[] = ["reserva_offline", "consumo_reserva", "devolucion_lease"];
export const esMovimientoInterno = (operacion: string) => OPERACIONES_INTERNAS.includes(operacion);

function origenDestino(r: any): [string, string] {
  const sede = r.sede_nombre;
  const otra = r.contraparte_nombre ?? "—";
  switch (r.operacion) {
    case "venta": return [sede, "Venta"];
    case "anulacion_venta": return ["Anulación de venta", sede];
    case "compra": return ["Proveedor", sede];
    case "anulacion_compra": return [sede, "Proveedor"];
    case "traspaso_salida": return [sede, otra];
    case "traspaso_entrada": return [otra, sede];
    case "stock_inicial": return ["Alta de producto", sede];
    case "desde_almacen": return ["Almacén", sede];
    case "a_almacen": return [sede, "Almacén"];
    default: return [sede, sede];
  }
}

/** Historial de la TIENDA (se ve en PRODUCTOS): ventas, compras, ajustes, ingresos desde almacén... */
export async function listarMovimientos(
  sedeId: string | null,
  rango: FiltroFechas = {}
): Promise<MovimientoAlmacen[]> {
  const lim = limitesRango(rango.desde ?? "1970-01-01", rango.hasta ?? "2999-12-31");
  const rows = await traerTodo<any>((a, b) => {
    let q = db().from("v_movimientos").select("*").order("numero", { ascending: false }).range(a, b);
    if (sedeId) q = q.eq("sede_id", sedeId);
    if (rango.desde) q = q.gte("fecha", lim.desde);
    if (rango.hasta) q = q.lte("fecha", lim.hasta);
    return q;
  });
  return rows.map((r) => {
    const [origen, destino] = origenDestino(r);
    return {
      id: r.id,
      fecha: r.fecha,
      tipo: r.tipo as TipoMovimiento,
      operacion: r.operacion,
      producto: r.producto,
      codigo: r.producto_codigo,
      productoId: r.producto_id,
      categoria: r.categoria ?? "Sin categoría",
      cantidad: num(r.cantidad),
      unidad: r.unidad,
      origen,
      destino,
      usuario: r.usuario_nombre,
      referencia: r.referencia ?? "—",
      sedeId: r.sede_id,
      sedeNombre: r.sede_nombre,
      stockAntes: num(r.stock_antes),
      stockDespues: num(r.stock_despues),
      nota: r.motivo ?? undefined,
    };
  });
}

// ---------------------------------------------------------------------
// ALMACÉN (bodega)
// ---------------------------------------------------------------------
export type TipoAjuste = "ingreso" | "descuento" | "conteo";

/** Ajusta el stock del ALMACÉN (siempre con motivo). */
export function ajustarAlmacen(sedeId: string, productoId: string, tipo: TipoAjuste, cantidad: number, motivo: string) {
  if (tipo === "conteo")
    return rpcMut<string | null>("fijar_almacen", { p_sede: sedeId, p_producto: productoId, p_nuevo_stock: cantidad, p_motivo: motivo });
  return rpcMut<string>("ajustar_almacen", {
    p_sede: sedeId,
    p_producto: productoId,
    p_delta: tipo === "ingreso" ? Math.abs(cantidad) : -Math.abs(cantidad),
    p_operacion: tipo === "ingreso" ? "ingreso_manual" : "merma",
    p_motivo: motivo,
  });
}

export interface ItemTraslado {
  productoId: string;
  cantidad: number;
}

const itemsJson = (items: ItemTraslado[]) =>
  items.map((i) => ({ producto_id: i.productoId, cantidad: i.cantidad }));

/** Mueve stock entre el almacén y la tienda de la MISMA sede. */
export const moverAlmacenTienda = (
  sedeId: string,
  sentido: "a_tienda" | "a_almacen",
  items: ItemTraslado[],
  obs: string
) =>
  rpcMut<string>("mover_almacen_tienda", {
    p_sede: sedeId,
    p_sentido: sentido,
    p_items: itemsJson(items),
    p_observaciones: obs,
  });

/** Envía del almacén de una sede al almacén de OTRA sede. */
export const enviarASede = (origen: string, destino: string, items: ItemTraslado[], obs: string) =>
  rpcMut<string>("enviar_a_sede", {
    p_origen: origen,
    p_destino: destino,
    p_items: itemsJson(items),
    p_observaciones: obs,
  });

export async function listarSedesDestino(): Promise<{ id: string; nombre: string; codigo: string }[]> {
  return (await rpc<{ id: string; nombre: string; codigo: string }[]>("sedes_destino")) ?? [];
}

const operacionBodegaLabel: Record<string, string> = {
  ingreso_manual: "Ingreso manual",
  ajuste_manual: "Ajuste",
  conteo_fisico: "Conteo físico",
  merma: "Merma / pérdida",
};

/** Texto del tipo de traslado, como en el PDF: "Almacén > Tienda". */
export function textoTraslado(operacion: string, sede: string, otra: string | null): string {
  switch (operacion) {
    case "a_tienda": return "Almacén > Tienda";
    case "desde_tienda": return "Tienda > Almacén";
    case "envio_sede": return `Almacén > ${otra ?? "otra sede"}`;
    case "recepcion_sede": return `${otra ?? "otra sede"} > Almacén`;
    default: return operacionBodegaLabel[operacion] ?? operacion;
  }
}

/** Historial del ALMACÉN: traslados a la tienda / a otras sedes, recepciones y ajustes. */
export async function listarMovimientosBodega(
  sedeId: string | null,
  rango: FiltroFechas = {}
): Promise<MovimientoBodega[]> {
  const lim = limitesRango(rango.desde ?? "1970-01-01", rango.hasta ?? "2999-12-31");
  const rows = await traerTodo<any>((a, b) => {
    let q = db().from("v_movimientos_bodega").select("*").order("numero", { ascending: false }).range(a, b);
    if (sedeId) q = q.eq("sede_id", sedeId);
    if (rango.desde) q = q.gte("fecha", lim.desde);
    if (rango.hasta) q = q.lte("fecha", lim.hasta);
    return q;
  });
  // Lo que pasó en la tienda en los mismos traslados (mismo número de referencia y producto)
  const tienda = new Map<string, { antes: number; despues: number }>();
  if (rows.some((r) => r.operacion === "a_tienda" || r.operacion === "desde_tienda")) {
    const filasTienda = await traerTodo<any>((a, b) => {
      let q = db().from("v_movimientos").select("referencia,producto_id,stock_antes,stock_despues")
        .in("operacion", ["desde_almacen", "a_almacen"]).order("numero", { ascending: false }).range(a, b);
      if (sedeId) q = q.eq("sede_id", sedeId);
      if (rango.desde) q = q.gte("fecha", lim.desde);
      if (rango.hasta) q = q.lte("fecha", lim.hasta);
      return q;
    });
    for (const t of filasTienda)
      tienda.set(`${t.referencia}|${t.producto_id}`, { antes: num(t.stock_antes), despues: num(t.stock_despues) });
  }
  return rows.map((r) => {
    const sede = r.sede_nombre as string;
    const t = tienda.get(`${r.referencia}|${r.producto_id}`);
    const otra = (r.contraparte_nombre as string | null) ?? null;
    const traslado = textoTraslado(r.operacion, sede, otra);
    let origen = sede;
    let destino = sede;
    switch (r.operacion) {
      case "a_tienda": origen = "Almacén"; destino = "Tienda"; break;
      case "desde_tienda": origen = "Tienda"; destino = "Almacén"; break;
      case "envio_sede": origen = `Almacén · ${sede}`; destino = otra ?? "otra sede"; break;
      case "recepcion_sede": origen = otra ?? "otra sede"; destino = `Almacén · ${sede}`; break;
      default: origen = "Almacén"; destino = "Almacén";
    }
    return {
      id: r.id,
      numero: Number(r.numero),
      fecha: r.fecha,
      tipo: r.tipo,
      operacion: r.operacion,
      producto: r.producto,
      codigo: r.producto_codigo,
      categoria: r.categoria ?? "Sin categoría",
      unidad: r.unidad,
      cantidad: num(r.cantidad),
      stockAntes: num(r.stock_antes),
      stockDespues: num(r.stock_despues),
      stockTiendaAntes: t?.antes,
      stockTiendaDespues: t?.despues,
      origen,
      destino,
      traslado,
      usuario: r.usuario_nombre,
      referencia: r.referencia ?? "—",
      nota: r.motivo ?? undefined,
      sedeId: r.sede_id,
      sedeNombre: sede,
    };
  });
}

/**
 * Stock REAL por producto = tienda + almacén. Es el que se usa para las alertas de stock bajo.
 * `stock` es el total; `stockTienda` y `stockAlmacen` el desglose.
 */
export async function listarStockTotal(sedeId: string | null): Promise<StockItem[]> {
  const [tienda, almacen] = await Promise.all([listarStock(sedeId), listarStockAlmacen(sedeId)]);
  // lo apartado en cajas para vender sin internet sigue siendo stock de la tienda (el servidor solo lo descuenta del stock libre)
  const reservado = await obtenerReservadoPorProducto(tienda.map((t) => t.sedeId));
  const mapa = new Map<string, StockItem>();
  for (const t of tienda) {
    const enTienda = t.stock + (reservado.get(t.productoId) ?? 0);
    mapa.set(t.id, { ...t, stock: enTienda, stockTienda: enTienda, stockAlmacen: 0 });
  }
  for (const a of almacen) {
    const base = mapa.get(a.id);
    if (base) mapa.set(a.id, { ...base, stock: base.stockTienda! + a.stock, stockAlmacen: a.stock });
    else mapa.set(a.id, { ...a, stock: a.stock, stockTienda: 0, stockAlmacen: a.stock });
  }
  return Array.from(mapa.values()).sort((x, y) => x.producto.localeCompare(y.producto));
}
