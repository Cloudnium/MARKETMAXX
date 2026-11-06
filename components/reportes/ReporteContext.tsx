"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { StockItem, VentaReciente } from "@/lib/types";

const num = (v: unknown) => Number(v ?? 0);

/** Variación porcentual vs. periodo anterior (redondeada a 1 decimal). */
const variacion = (actual: number, previo: number) =>
  previo > 0 ? Math.round(((actual - previo) / previo) * 1000) / 10 : actual > 0 ? 100 : 0;

const COLORES_PAGO: Record<string, string> = {
  Efectivo: "#22c55e",
  Yape: "#8b5cf6",
  Tarjeta: "#3b82f6",
  Transferencia: "#f59e0b",
};
const EXTRA = ["#14b8a6", "#ef4444", "#6366f1", "#ec4899"];

export interface ReporteData {
  resumenPeriodo: {
    ventasTotales: number;
    comprobantes: number;
    ticketPromedio: number;
    utilidad: number;
    variacionVentas: number;
    variacionComprobantes: number;
    variacionTicket: number;
    variacionUtilidad: number;
  };
  ventasSemanales: { dia: string; ventas: number; comprobantes: number }[];
  metodosPago: { nombre: string; total: number; porcentaje: number; color: string }[];
  topProductos: { nombre: string; cantidad: number; total: number }[];
  topCategorias: { nombre: string; total: number; porcentaje: number }[];
  topClientes: { nombre: string; compras: number; total: number }[];
  ventasPorCaja: { caja: string; total: number; comprobantes: number }[];
  ventasPorComprobante: { tipo: string; total: number; cantidad: number }[];
  detalle: VentaReciente[];
  alertasStock: StockItem[];
  inventarioCategorias: { nombre: string; porcentaje: number }[];
}

export const reporteVacio: ReporteData = {
  resumenPeriodo: {
    ventasTotales: 0, comprobantes: 0, ticketPromedio: 0, utilidad: 0,
    variacionVentas: 0, variacionComprobantes: 0, variacionTicket: 0, variacionUtilidad: 0,
  },
  ventasSemanales: [], metodosPago: [], topProductos: [], topCategorias: [], topClientes: [],
  ventasPorCaja: [], ventasPorComprobante: [], detalle: [], alertasStock: [], inventarioCategorias: [],
};

/** Convierte la respuesta de reporte_ventas() a la forma que usan las tarjetas. */
export function mapearReporte(r: any, stock: StockItem[]): ReporteData {
  const a = r?.actual ?? {};
  const p = r?.anterior ?? {};
  const unidades = stock.reduce((acc, s) => acc + s.stock, 0);
  const porCat = new Map<string, number>();
  stock.forEach((s) => porCat.set(s.categoria, (porCat.get(s.categoria) ?? 0) + s.stock));

  return {
    resumenPeriodo: {
      ventasTotales: num(a.ventas),
      comprobantes: num(a.comprobantes),
      ticketPromedio: num(a.ticket),
      utilidad: num(a.utilidad),
      variacionVentas: variacion(num(a.ventas), num(p.ventas)),
      variacionComprobantes: variacion(num(a.comprobantes), num(p.comprobantes)),
      variacionTicket: variacion(num(a.ticket), num(p.ticket)),
      variacionUtilidad: variacion(num(a.utilidad), num(p.utilidad)),
    },
    ventasSemanales: (r?.semanal ?? []).map((x: any) => ({ dia: x.dia, ventas: num(x.ventas), comprobantes: num(x.comprobantes) })),
    metodosPago: (r?.metodos_pago ?? []).map((x: any, i: number) => ({
      nombre: x.nombre, total: num(x.total), porcentaje: num(x.porcentaje),
      color: COLORES_PAGO[x.nombre] ?? EXTRA[i % EXTRA.length],
    })),
    topProductos: (r?.top_productos ?? []).map((x: any) => ({ nombre: x.nombre, cantidad: num(x.cantidad), total: num(x.total) })),
    topCategorias: (r?.top_categorias ?? []).map((x: any) => ({ nombre: x.nombre, total: num(x.total), porcentaje: num(x.porcentaje) })),
    topClientes: (r?.top_clientes ?? []).map((x: any) => ({ nombre: x.nombre, compras: num(x.compras), total: num(x.total) })),
    ventasPorCaja: (r?.por_caja ?? []).map((x: any) => ({ caja: x.caja, total: num(x.total), comprobantes: num(x.comprobantes) })),
    ventasPorComprobante: (r?.por_comprobante ?? []).map((x: any) => ({ tipo: x.tipo, total: num(x.total), cantidad: num(x.cantidad) })),
    detalle: (r?.detalle ?? []).map((x: any) => ({
      id: x.id, numero: x.numero, cliente: x.cliente, fecha: x.fecha, total: num(x.total),
      tipo: x.tipo, metodoPago: x.metodo_pago, estado: x.estado, sedeId: x.sede_id,
    })),
    alertasStock: stock.filter((s) => s.stock <= s.stockMinimo).sort((x, y) => x.stock - y.stock).slice(0, 12),
    inventarioCategorias: [...porCat.entries()]
      .map(([nombre, u]) => ({ nombre, porcentaje: unidades ? Math.round((u / unidades) * 100) : 0 }))
      .sort((x, y) => y.porcentaje - x.porcentaje)
      .slice(0, 6),
  };
}

const Ctx = createContext<ReporteData>(reporteVacio);
export const ReporteProvider = ({ value, children }: { value: ReporteData; children: ReactNode }) => (
  <Ctx.Provider value={value}>{children}</Ctx.Provider>
);
export const useReporte = () => useContext(Ctx);
