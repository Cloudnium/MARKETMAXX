"use client";

import { Download, Printer } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { useEffect, useMemo, useState } from "react";
import { ReportesFiltros, filtrosIniciales, type FiltrosReporte } from "./ReportesFiltros";
import { ReporteProvider, mapearReporte } from "./ReporteContext";
import { useSede } from "@/components/shared/SedeProvider";
import { useAsync } from "@/lib/hooks/useAsync";
import { cargarReporte, cargarReporteExtra } from "@/lib/data/reportes";
import { listarProductosConReservas } from "@/lib/data/productos";
import { listarStockTotal } from "@/lib/data/almacen";
import { ReportesMetricas, type ExtraReporte } from "./ReportesMetricas";
import {
  AlertasStockCard,
  InventarioResumenCard,
  MetodosPagoCard,
  ResumenPeriodoCard,
  TopCategoriasCard,
  TopClientesCard,
  TopProductosCard,
  VentasPorCajaCard,
  VentasPorComprobanteCard,
  VentasSemanalesCard,
} from "./ReportesCards";
import { DetalleVentasTable } from "./DetalleVentasTable";
import { EgresosReporte } from "./EgresosReporte";

export function ReportesView() {
  const { filtro } = useSede();
  const [filtros, setFiltros] = useState<FiltrosReporte>(filtrosIniciales(filtro));
  // al cambiar de sede en la barra superior, el reporte la sigue
  useEffect(() => setFiltros((f) => ({ ...f, sedeId: filtro })), [filtro]);

  const esEgresos = filtros.reporte === "egresos";
  const rep = useAsync(
    () => (esEgresos ? Promise.resolve(null) : cargarReporte(filtros.sedeId, filtros.desde, filtros.hasta, filtros.tipo)),
    [filtros.sedeId, filtros.desde, filtros.hasta, filtros.tipo, esEgresos],
  );
  const ext = useAsync(
    () => (esEgresos ? Promise.resolve(null) : cargarReporteExtra(filtros.sedeId, filtros.desde, filtros.hasta, filtros.tipo)),
    [filtros.sedeId, filtros.desde, filtros.hasta, filtros.tipo, esEgresos],
  );
  const prods = useAsync(() => listarProductosConReservas(filtros.sedeId), [filtros.sedeId], []);
  const extra: ExtraReporte = useMemo(() => {
    const activos = (prods.data ?? []).filter((p) => p.activo);
    return {
      unidades: Number(ext.data?.unidades ?? 0),
      productosUnicos: Number(ext.data?.productos_unicos ?? 0),
      egresos: Number(ext.data?.egresos ?? 0),
      egresosN: Number(ext.data?.egresos_n ?? 0),
      inventarioValor: activos.reduce((a, p) => a + (p.stock + (p.stockAlmacen ?? 0)) * p.precio, 0),
      inventarioProductos: activos.length,
    };
  }, [ext.data, prods.data]);
  const stock = useAsync(() => listarStockTotal(filtros.sedeId), [filtros.sedeId], []);
  const data = useMemo(() => mapearReporte(rep.data, stock.data ?? []), [rep.data, stock.data]);

  return (
    <ReporteProvider value={data}>
    <div>
      <PageHeader
        title="Reportes"
        subtitle="Analiza el rendimiento de tu negocio"
        actions={
          <>
            <button onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50">
              <Printer className="h-4 w-4" /> Imprimir
            </button>
            <button className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700">
              <Download className="h-4 w-4" /> Exportar
            </button>
          </>
        }
      />

      <div className="space-y-4">
        {rep.error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{rep.error}</p>}
        <ReportesFiltros onApply={setFiltros} />
        {esEgresos ? (
          <EgresosReporte filtros={filtros} />
        ) : (
          <>
        <ReportesMetricas extra={extra} />

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <ResumenPeriodoCard />
          <VentasSemanalesCard />
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <MetodosPagoCard />
          <TopProductosCard />
          <TopCategoriasCard />
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <TopClientesCard />
          <VentasPorCajaCard />
          <VentasPorComprobanteCard />
        </div>

        <DetalleVentasTable />

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <AlertasStockCard />
          </div>
          <InventarioResumenCard />
        </div>
          </>
        )}
      </div>
    </div>
    </ReporteProvider>
  );
}
