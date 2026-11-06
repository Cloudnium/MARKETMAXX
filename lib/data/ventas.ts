import type { Comprobante, TipoComprobante } from "@/lib/types";
import { check, db,  num, rpc, rpcMut } from "./db";

export interface NuevaVenta {
  sedeId: string;
  cajaId: string;
  tipo: TipoComprobante;
  clienteId: string | null;
  clienteNombre: string | null;
  clienteDocumento: string | null;
  metodo: string;
  descuento: number;
  items: { productoId: string; cantidad: number }[];
}

export const registrarVenta = (v: NuevaVenta) =>
  rpcMut<{ id: string; numero: string; total: number }>("registrar_venta", {
    p_sede: v.sedeId,
    p_caja: v.cajaId,
    p_tipo: v.tipo,
    p_cliente: v.clienteId,
    p_metodo_pago: v.metodo,
    p_descuento_pct: v.descuento,
    p_items: v.items.map((i) => ({ producto_id: i.productoId, cantidad: i.cantidad })),
    p_notas: null,
    p_cliente_nombre: v.clienteNombre,
    p_cliente_documento: v.clienteDocumento,
  });

export const anularVenta = (id: string, motivo: string) =>
  rpcMut<string>("anular_venta", { p_venta: id, p_motivo: motivo });

export const cambiarMetodoPago = (id: string, metodo: string) =>
  rpcMut<string>("cambiar_metodo_pago", { p_venta: id, p_metodo: metodo });

export async function listarComprobantes(sedeId: string | null, limite = 500): Promise<Comprobante[]> {
  let q = db()
    .from("ventas")
    .select(
      "id,numero,tipo_comprobante,cliente_nombre,cliente_documento,fecha,total,estado,metodo_pago,sede_id,usuario_nombre,descuento_pct,motivo_anulacion,anulada_por_nombre,cajas(nombre),venta_items(producto_nombre,cantidad,precio_unitario)"
    )
    .order("fecha", { ascending: false })
    .limit(limite);
  if (sedeId) q = q.eq("sede_id", sedeId);
  const rows = check(await q) as any[];
  return rows.map((r) => ({
    id: r.id,
    numero: r.numero,
    tipo: r.tipo_comprobante,
    cliente: r.cliente_nombre,
    documento: r.cliente_documento || "-",
    fecha: r.fecha,
    total: num(r.total),
    estado: r.estado,
    metodoPago: r.metodo_pago,
    caja: r.cajas?.nombre ?? "—",
    sedeId: r.sede_id,
    vendedor: r.usuario_nombre ?? undefined,
    descuento: num(r.descuento_pct),
    motivoAnulacion: r.motivo_anulacion ?? undefined,
    anuladoPor: r.anulada_por_nombre ?? undefined,
    items: (r.venta_items ?? []).map((i: any) => ({
      producto: i.producto_nombre,
      cantidad: num(i.cantidad),
      precio: num(i.precio_unitario),
    })),
  }));
}

export async function listarMetodosPago(): Promise<string[]> {
  const rows = check(
    await db().from("metodos_pago").select("nombre").eq("activo", true).order("orden")
  ) as any[];
  return rows.map((r) => r.nombre);
}
