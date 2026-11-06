import type { Egreso, SesionCaja, VentaCaja } from "@/lib/types";

const METODOS_BASE = ["Efectivo", "Yape", "Tarjeta", "Transferencia"];

export interface ResumenCaja {
  /** Ingresos por método (solo ventas pagadas), siempre con los 4 métodos base. */
  metodos: { metodo: string; total: number; ventas: number }[];
  totalIngresos: number;
  efectivo: number;
  /** Tarjetas y billeteras: todo lo que no es efectivo. */
  digital: number;
  anulado: number;
  anuladas: number;
  egresos: number;
  neto: number;
  /** Apertura + efectivo vendido - egresos (lo que debe haber en la gaveta). */
  efectivoEntregar: number;
  ventasPagadas: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function resumenCaja(s: SesionCaja, ventas: VentaCaja[], egresos: Egreso[]): ResumenCaja {
  const pagadas = ventas.filter((v) => v.estado === "pagado");
  const anuladas = ventas.filter((v) => v.estado === "anulado");
  const nombres = [...METODOS_BASE];
  for (const v of pagadas) if (!nombres.includes(v.metodoPago)) nombres.push(v.metodoPago);
  const metodos = nombres.map((metodo) => {
    const d = pagadas.filter((v) => v.metodoPago === metodo);
    return { metodo, total: r2(d.reduce((a, v) => a + v.total, 0)), ventas: d.length };
  });
  const totalIngresos = r2(metodos.reduce((a, m) => a + m.total, 0));
  const efectivo = metodos.find((m) => m.metodo === "Efectivo")?.total ?? 0;
  const totalEgresos = r2(egresos.reduce((a, e) => a + e.monto, 0));
  return {
    metodos,
    totalIngresos,
    efectivo,
    digital: r2(totalIngresos - efectivo),
    anulado: r2(anuladas.reduce((a, v) => a + v.total, 0)),
    anuladas: anuladas.length,
    egresos: totalEgresos,
    neto: r2(totalIngresos - totalEgresos),
    efectivoEntregar: r2(s.montoApertura + efectivo - totalEgresos),
    ventasPagadas: pagadas.length,
  };
}

/** Código corto y estable del turno para el ticket. */
export const codigoSesion = (s: SesionCaja) =>
  `${s.dia.replace(/-/g, "").slice(2)}-${s.id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;

/** "Caja 12" -> 12 (para "Caja #12"). */
export const numeroCaja = (s: SesionCaja) => s.caja.match(/(\d+)\s*$/)?.[1] ?? s.caja;
