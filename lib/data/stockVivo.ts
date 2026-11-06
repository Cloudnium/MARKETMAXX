import type { Producto } from "@/lib/types";
import { num, rpc } from "./db";

/** Stock de un producto "en vivo": lo que hay, lo reservado en cajas y lo reservado por MÍ. */
export interface StockVivo {
  stock: number;
  reservado: number;
  mio: number;
}

/** Foto liviana del stock de toda la sede (una sola consulta pequeña, pensada para repetirse cada pocos segundos). */
export async function obtenerStockVivo(sedeId: string): Promise<Map<string, StockVivo>> {
  const filas = await rpc<{ producto_id: string; stock: number | string; reservado: number | string; mio: number | string }[]>("stock_sede_vivo", { p_sede: sedeId });
  return new Map(filas.map((f) => [f.producto_id, { stock: num(f.stock), reservado: num(f.reservado), mio: num(f.mio) }]));
}

/**
 * Aplica el stock en vivo al catálogo. Lo que el cajero puede vender EN LÍNEA = stock general + lo que tiene reservado para
 * su propia caja (la venta consume primero su reserva). Lo reservado por otras cajas se informa aparte.
 * `respaldoReserva` se usa solo si todavía no llegó el dato en vivo.
 */
export function aplicarStockVivo(productos: Producto[], vivo: Map<string, StockVivo> | null, respaldoReserva: (id: string) => number = () => 0): Producto[] {
  return productos.map((p) => {
    const v = vivo?.get(p.id);
    if (!v) return { ...p, stock: p.stock + respaldoReserva(p.id) };
    return { ...p, stock: v.stock + v.mio, reservadoOtros: Math.max(0, v.reservado - v.mio) };
  });
}
