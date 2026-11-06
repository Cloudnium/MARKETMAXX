import type { Caja, Egreso, SesionCaja, VentaCaja } from "@/lib/types";
import { limitesRango } from "@/lib/fechas";
import { check, db,  num, rpc, rpcMut } from "./db";
import { liberarReservasDeCaja } from "@/lib/offline/motor";

export async function listarCajas(sedeId: string | null): Promise<Caja[]> {
  let q = db().from("v_cajas").select("*").eq("activa", true).order("sede_nombre").order("nombre");
  if (sedeId) q = q.eq("sede_id", sedeId);
  const rows = check(await q) as any[];
  return rows.map((r) => ({
    id: r.id,
    nombre: r.nombre,
    tienda: r.sede_nombre,
    sedeId: r.sede_id,
    estado: r.estado,
    ingresos: num(r.ingresos),
    egresos: num(r.egresos),
    ventas: num(r.ventas),
    fechaApertura: r.fecha_apertura ?? "",
    usuario: r.usuario_nombre ?? "—",
    sesionId: r.sesion_id,
    montoApertura: num(r.monto_apertura),
  }));
}

export async function listarEgresos(sesionId: string): Promise<Egreso[]> {
  const rows = check(
    await db().from("caja_egresos").select(COLS_EGRESO).eq("sesion_id", sesionId).eq("anulado", false).order("fecha", { ascending: false })
  ) as any[];
  return rows.map(mapEgreso);
}

export const mapEgreso = (r: any): Egreso => ({
  id: r.id,
  concepto: r.concepto,
  monto: num(r.monto),
  fecha: r.fecha,
  usuario: r.usuario_nombre ?? "—",
  sedeId: r.sede_id,
  categoria: r.categoria ?? "Otros gastos",
  proveedor: r.proveedor ?? "",
  tipoDocumento: r.tipo_documento ?? "",
  numeroDocumento: r.numero_documento ?? "",
  observaciones: r.observaciones ?? "",
  fechaEgreso: r.fecha_egreso,
  enCaja: !!r.sesion_id,
  proveedorDocumento: r.proveedor_documento ?? "",
  tieneFoto: !!r.tiene_foto,
  compraId: r.compra_id ?? null,
});

/** Columnas de caja_egresos SIN la foto (pesada); la foto se pide aparte. */
export const COLS_EGRESO =
  "id,sesion_id,caja_id,sede_id,concepto,monto,usuario_id,usuario_nombre,fecha,categoria,proveedor,proveedor_documento,tipo_documento,numero_documento,observaciones,fecha_egreso,compra_id,anulado,tiene_foto";

/** Turnos de caja (uno por apertura) dentro de un rango de días (hora de Lima). */
export async function listarSesiones(sedeId: string | null, desde: string, hasta: string): Promise<SesionCaja[]> {
  const lim = limitesRango(desde, hasta);
  let q = db()
    .from("v_caja_sesiones")
    .select("*")
    // los turnos aún abiertos se muestran siempre; los cerrados, solo los del rango
    .or(`estado.eq.abierta,and(fecha_apertura.gte.${lim.desde},fecha_apertura.lte.${lim.hasta})`)
    .order("fecha_apertura", { ascending: false })
    .limit(500);
  if (sedeId) q = q.eq("sede_id", sedeId);
  const rows = check(await q) as any[];
  return rows.map((r) => ({
    id: r.sesion_id,
    cajaId: r.caja_id,
    caja: r.caja_nombre,
    sedeId: r.sede_id,
    sede: r.sede_nombre,
    usuario: r.usuario_nombre ?? "—",
    fechaApertura: r.fecha_apertura,
    fechaCierre: r.fecha_cierre ?? null,
    estado: r.estado,
    dia: r.dia,
    montoApertura: num(r.monto_apertura),
    montoSistema: r.monto_sistema === null ? null : num(r.monto_sistema),
    montoContado: r.monto_contado === null ? null : num(r.monto_contado),
    diferencia: r.diferencia === null ? null : num(r.diferencia),
    observaciones: r.observaciones ?? "",
    ingresos: num(r.ingresos),
    ingresosEfectivo: num(r.ingresos_efectivo),
    egresos: num(r.egresos),
    ventas: num(r.ventas),
  }));
}

/** Ventas (con sus productos) de un turno de caja, de la más antigua a la más reciente. */
export async function listarVentasSesion(sesionId: string): Promise<VentaCaja[]> {
  const rows = check(
    await db()
      .from("ventas")
      .select(
        "id,numero,tipo_comprobante,fecha,total,estado,metodo_pago,cliente_nombre,usuario_nombre,venta_items(producto_nombre,cantidad,precio_unitario)"
      )
      .eq("caja_sesion_id", sesionId)
      .order("fecha", { ascending: true })
      .limit(5000)
  ) as any[];
  return rows.map((r) => ({
    id: r.id,
    numero: r.numero,
    tipo: r.tipo_comprobante,
    fecha: r.fecha,
    total: num(r.total),
    estado: r.estado,
    metodoPago: r.metodo_pago,
    cliente: r.cliente_nombre ?? "",
    usuario: r.usuario_nombre ?? "—",
    items: (r.venta_items ?? []).map((i: any) => ({
      producto: i.producto_nombre,
      cantidad: num(i.cantidad),
      precio: num(i.precio_unitario),
    })),
  }));
}

/** El sistema asigna el siguiente número de caja (correlativo de la sede). */
export const abrirMiCaja = (sedeId: string, monto: number) =>
  rpcMut<string>("abrir_mi_caja", { p_sede: sedeId, p_monto_apertura: monto });

export const crearCaja = (sedeId: string, nombre: string, montoApertura: number | null) =>
  rpcMut<string>("crear_caja", { p_sede: sedeId, p_nombre: nombre, p_monto_apertura: montoApertura });

export const abrirCaja = (cajaId: string, monto: number) =>
  rpcMut<string>("abrir_caja", { p_caja: cajaId, p_monto_apertura: monto });

export const cerrarCaja = async (cajaId: string, contado: number | null, obs: string) => {
  const r = await rpcMut<string>("cerrar_caja", { p_caja: cajaId, p_monto_contado: contado, p_observaciones: obs });
  void liberarReservasDeCaja(cajaId); // el stock reservado para vender sin internet vuelve solo al stock
  return r;
};

export const registrarEgreso = (cajaId: string, concepto: string, monto: number) =>
  rpcMut<string>("registrar_egreso", { p_caja: cajaId, p_concepto: concepto, p_monto: monto });

/** Ventas y egresos de un turno (egresos de más antiguo a más reciente), para detalle/PDF/ticket. */
export async function datosSesion(sesionId: string) {
  const [ventas, egresos] = await Promise.all([listarVentasSesion(sesionId), listarEgresos(sesionId)]);
  egresos.sort((a, b) => a.fecha.localeCompare(b.fecha));
  return { ventas, egresos };
}

export interface MovimientoCaja {
  id: string;
  fecha: string;
  sesionId: string;
  tipo: "apertura" | "venta" | "egreso";
  detalle: string;
  metodo: string;
  /** Con signo: ventas y apertura (+), egresos (-). */
  monto: number;
  anulado?: boolean;
}

/** Movimientos (apertura, ventas, egresos) de varios turnos, del más reciente al más antiguo. */
export async function listarMovimientosSesiones(sesiones: SesionCaja[]): Promise<MovimientoCaja[]> {
  if (sesiones.length === 0) return [];
  const ids = sesiones.map((s) => s.id);
  const [ventas, egresos] = await Promise.all([
    db().from("ventas").select("id,numero,fecha,total,estado,metodo_pago,caja_sesion_id").in("caja_sesion_id", ids).order("fecha", { ascending: false }).limit(1000),
    db().from("caja_egresos").select("id,fecha,monto,concepto,categoria,sesion_id").in("sesion_id", ids).eq("anulado", false).order("fecha", { ascending: false }).limit(1000),
  ]);
  const out: MovimientoCaja[] = [
    ...sesiones.map((s) => ({
      id: `a-${s.id}`, fecha: s.fechaApertura, sesionId: s.id, tipo: "apertura" as const,
      detalle: `Apertura de ${s.caja}`, metodo: "Efectivo", monto: s.montoApertura,
    })),
    ...(check(ventas) as any[]).map((r) => ({
      id: r.id, fecha: r.fecha, sesionId: r.caja_sesion_id, tipo: "venta" as const,
      detalle: `Venta ${r.numero}`, metodo: r.metodo_pago, monto: num(r.total), anulado: r.estado === "anulado",
    })),
    ...(check(egresos) as any[]).map((r) => ({
      id: r.id, fecha: r.fecha, sesionId: r.sesion_id, tipo: "egreso" as const,
      detalle: `${r.categoria}: ${r.concepto}`, metodo: "Efectivo", monto: -num(r.monto),
    })),
  ];
  return out.sort((a, b) => b.fecha.localeCompare(a.fecha));
}
