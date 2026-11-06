import type { Compra, Proveedor } from "@/lib/types";
import { check, db,  num, rpc, rpcMut } from "./db";

export async function listarCompras(sedeId: string | null): Promise<Compra[]> {
  let q = db()
    .from("compras")
    .select("id,numero,comprobante_proveedor,proveedor_nombre,fecha,total,estado,usuario_nombre,sede_id,motivo_anulacion,compra_items(count)")
    .order("fecha", { ascending: false })
    .limit(500);
  if (sedeId) q = q.eq("sede_id", sedeId);
  const rows = check(await q) as any[];
  return rows.map((r) => ({
    id: r.id,
    numero: r.numero,
    proveedor: r.proveedor_nombre,
    fecha: r.fecha,
    total: num(r.total),
    estado: r.estado,
    items: num(r.compra_items?.[0]?.count),
    usuario: r.usuario_nombre ?? "—",
    sedeId: r.sede_id,
    comprobante: r.comprobante_proveedor ?? undefined,
    motivoAnulacion: r.motivo_anulacion ?? undefined,
  }));
}

export async function listarProveedores(): Promise<Proveedor[]> {
  return check(
    await db().from("proveedores").select("id,nombre").eq("activo", true).order("nombre")
  ) as Proveedor[];
}

export const crearProveedor = (nombre: string) => rpcMut<string>("crear_proveedor", { p_nombre: nombre.trim() });

export interface NuevaCompra {
  sedeId: string;
  proveedorId: string;
  comprobante: string;
  fecha: string;
  recibida: boolean;
  items: { productoId: string; cantidad: number; precio: number }[];
}

export const registrarCompra = (c: NuevaCompra) =>
  rpcMut<string>("registrar_compra", {
    p_sede: c.sedeId,
    p_proveedor: c.proveedorId,
    p_comprobante: c.comprobante,
    p_fecha: c.fecha ? new Date(c.fecha + "T12:00:00").toISOString() : null,
    p_items: c.items.map((i) => ({ producto_id: i.productoId, cantidad: i.cantidad, precio_compra: i.precio })),
    p_recibida: c.recibida,
    p_observaciones: null,
  });

export const recibirCompra = (id: string) => rpcMut<string>("recibir_compra", { p_compra: id });
export const anularCompra = (id: string, motivo: string) =>
  rpcMut<string>("anular_compra", { p_compra: id, p_motivo: motivo });

export interface LineaCompraLibre {
  productoId?: string | null;
  nombre: string;
  cantidad: number;
  precio: number;
}

/** Compra completa en UNA transacción: proveedor (nuevo o existente) + productos nuevos + compra + ingreso de stock. */
export const registrarCompraCompleta = (c: {
  sedeId: string;
  proveedorId?: string | null;
  proveedorNombre: string;
  comprobante: string;
  fecha: string;
  recibida: boolean;
  items: LineaCompraLibre[];
}) =>
  rpcMut<string>("registrar_compra_completa", {
    p_sede: c.sedeId,
    p_proveedor_nombre: c.proveedorNombre.trim(),
    p_comprobante: c.comprobante,
    p_fecha: c.fecha ? new Date(c.fecha + "T12:00:00").toISOString() : null,
    p_items: c.items.map((i) => ({ producto_id: i.productoId ?? null, nombre: i.nombre.trim(), cantidad: i.cantidad, precio: i.precio })),
    p_proveedor_id: c.proveedorId ?? null,
    p_recibida: c.recibida,
    p_observaciones: null,
  });
