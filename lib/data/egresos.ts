import type { Egreso } from "@/lib/types";
import { COLS_EGRESO, mapEgreso } from "./cajas";
import { check, db, rpc, rpcMut } from "./db";

export const CATEGORIAS_EGRESO = [
  "Compra de insumos",
  "Servicio / Pago terceros",
  "Pago a personal",
  "Mantenimiento",
  "Otros gastos",
] as const;
export type CategoriaEgreso = (typeof CATEGORIAS_EGRESO)[number];

export const TIPOS_DOCUMENTO = ["Factura", "Boleta", "Recibo", "Nota de venta", "Ticket", "Sin documento"] as const;
/** Categorías que se eligen en "Registrar Egreso" (las compras de insumos van en su pestaña). */
export const CATEGORIAS_EGRESO_FORM = CATEGORIAS_EGRESO.filter((c) => c !== "Compra de insumos");

/** Egresos (no compras) de una sede, o de todas, por rango de fechas elegidas al registrar. */
export async function listarEgresosSede(sedeId: string | null, desde?: string, hasta?: string): Promise<Egreso[]> {
  let q = db().from("caja_egresos").select(COLS_EGRESO).eq("anulado", false).order("fecha_egreso", { ascending: false }).order("fecha", { ascending: false }).limit(1000);
  if (sedeId) q = q.eq("sede_id", sedeId);
  if (desde) q = q.gte("fecha_egreso", desde);
  if (hasta) q = q.lte("fecha_egreso", hasta);
  return (check(await q) as any[]).map(mapEgreso);
}

export interface NuevoEgreso {
  sedeId: string;
  fecha: string;
  categoria: string;
  concepto: string;
  proveedor: string;
  monto: number;
  tipoDocumento: string;
  numeroDocumento: string;
  observaciones: string;
  descontarCaja: boolean;
  proveedorDocumento?: string;
  foto?: string | null;
}

export const registrarEgresoGeneral = (e: NuevoEgreso) =>
  rpcMut<string>("registrar_egreso_general", {
    p_sede: e.sedeId,
    p_fecha: e.fecha,
    p_categoria: e.categoria,
    p_concepto: e.concepto,
    p_proveedor: e.proveedor,
    p_monto: e.monto,
    p_tipo_documento: e.tipoDocumento,
    p_numero_documento: e.numeroDocumento,
    p_observaciones: e.observaciones,
    p_descontar_caja: e.descontarCaja,
    p_proveedor_documento: e.proveedorDocumento ?? "",
    p_foto: e.foto ?? null,
  });

/** La foto del comprobante se pide solo al verla (es pesada). */
export async function obtenerFotoEgreso(id: string): Promise<string | null> {
  const r = check(await db().from("caja_egresos").select("foto_comprobante").eq("id", id).single()) as any;
  return r?.foto_comprobante ?? null;
}

export const cargarReporteEgresos = (sedeId: string | null, desde: string, hasta: string, categoria: string | null) =>
  rpc<any>("reporte_egresos", { p_sede: sedeId, p_desde: desde, p_hasta: hasta, p_categoria: categoria });

export interface EdicionEgreso {
  id: string;
  fecha: string;
  categoria: string;
  concepto: string;
  proveedor: string;
  monto: number;
  tipoDocumento: string;
  numeroDocumento: string;
  proveedorDocumento: string;
  /** undefined = conservar la foto actual */
  foto?: string | null;
  quitarFoto?: boolean;
}

export const actualizarEgreso = (e: EdicionEgreso) =>
  rpcMut<void>("actualizar_egreso", {
    p_id: e.id,
    p_fecha: e.fecha,
    p_categoria: e.categoria,
    p_concepto: e.concepto,
    p_proveedor: e.proveedor,
    p_monto: e.monto,
    p_tipo_documento: e.tipoDocumento,
    p_numero_documento: e.numeroDocumento,
    p_proveedor_documento: e.proveedorDocumento,
    p_foto: e.foto ?? null,
    p_quitar_foto: !!e.quitarFoto,
  });
