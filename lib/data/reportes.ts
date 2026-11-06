import { rpc } from "./db";

export const cargarDashboard = (sedeId: string | null) =>
  rpc<any>("dashboard_resumen", { p_sede: sedeId });

export const cargarReporte = (sedeId: string | null, desde: string, hasta: string, tipo: string | null) =>
  rpc<any>("reporte_ventas", { p_sede: sedeId, p_desde: desde, p_hasta: hasta, p_tipo: tipo });

export const cargarReporteExtra = (sedeId: string | null, desde: string, hasta: string, tipo: string | null) =>
  rpc<any>("reporte_ventas_extra", { p_sede: sedeId, p_desde: desde, p_hasta: hasta, p_tipo: tipo });
