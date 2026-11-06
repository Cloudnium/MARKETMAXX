"use client";

import {
  AlertTriangle,
  ArrowRight,
  Eye,
  Package,
  Receipt,
  ShoppingCart,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { MetricCards } from "./MetricCards";
import { DashboardCharts } from "./DashboardCharts";
import { ModalDetalleVenta } from "./ModalDetalleVenta";
import { cargarDashboard } from "@/lib/data/reportes";
import { listarStockTotal } from "@/lib/data/almacen";
import { useAsync } from "@/lib/hooks/useAsync";
import type { View } from "@/components/shared/Sidebar";
import type { VentaReciente } from "@/lib/types";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { useSede } from "@/components/shared/SedeProvider";
import { useAuth } from "@/components/shared/AuthProvider";

const quickActions: {
  label: string;
  icon: LucideIcon;
  tone: string;
  view: View;
  perm: string;
}[] = [
  {
    label: "Nueva Venta",
    icon: ShoppingCart,
    tone: "bg-green-100 text-green-600",
    view: "ventas",
    perm: "ventas.crear",
  },
  {
    label: "Nuevo Producto",
    icon: Package,
    tone: "bg-blue-100 text-blue-600",
    view: "productos",
    perm: "productos.crear",
  },
  {
    label: "Comprobantes",
    icon: Receipt,
    tone: "bg-purple-100 text-purple-600",
    view: "comprobantes",
    perm: "comprobantes.ver",
  },
];

export function DashboardView({
  onNavigate,
}: {
  onNavigate?: (view: View) => void;
}) {
  const { filtro, sede, nombreSede } = useSede();
  const { can } = useAuth();
  const [selected, setSelected] = useState<VentaReciente | null>(null);
  const { data: dash } = useAsync(() => cargarDashboard(filtro), [filtro]);
  const { data: stock } = useAsync(() => listarStockTotal(filtro), [filtro], []);
  const ventasSede: VentaReciente[] = ((dash?.recientes ?? []) as any[]).map((v) => ({
    id: v.id,
    numero: v.numero,
    cliente: v.cliente,
    fecha: v.fecha,
    total: Number(v.total),
    tipo: v.tipo,
    metodoPago: v.metodo_pago,
    estado: v.estado,
    sedeId: v.sede_id,
  }));
  const alertasSede = (stock ?? [])
    .filter((i) => i.stock <= i.stockMinimo)
    .sort((a, b) => a.stock - b.stock)
    .slice(0, 12);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={`Resumen general de tu negocio · ${sede.nombre}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {quickActions.filter((a) => can(a.perm)).map((action) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.label}
                  onClick={() => onNavigate?.(action.view)}
                  className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
                >
                  <span className={`rounded-md p-1 ${action.tone}`}>
                    <Icon className="h-4 w-4" />
                  </span>
                  {action.label}
                </button>
              );
            })}
          </div>
        }
      />

      <div className="space-y-4">
        <MetricCards hoy={dash?.hoy} ayer={dash?.ayer} />
        <DashboardCharts semana={dash?.semana} meses={dash?.meses} categorias={dash?.categorias} />

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader
              title="Ventas Recientes"
              icon={Receipt}
              tone="blue"
              right={
                <button
                  onClick={() => onNavigate?.("comprobantes")}
                  className="inline-flex items-center gap-1 text-sm font-semibold text-blue-600 hover:text-blue-700"
                >
                  Ver todas <ArrowRight className="h-4 w-4" />
                </button>
              }
            />
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Comprobante</th>
                    <th className="px-4 py-3 font-semibold">Cliente</th>
                    <th className="px-4 py-3 font-semibold">Sede</th>
                    <th className="px-4 py-3 font-semibold">Tipo</th>
                    <th className="px-4 py-3 font-semibold">Fecha</th>
                    <th className="px-4 py-3 text-right font-semibold">Total</th>
                    <th className="px-4 py-3 text-center font-semibold">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {ventasSede.map((venta) => (
                    <tr key={venta.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {venta.numero}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{venta.cliente}</td>
                      <td className="px-4 py-3 text-gray-600">
                        {nombreSede(venta.sedeId)}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={venta.tipo} />
                      </td>
                      <td className="px-4 py-3 text-gray-500">
                        {formatDateTime(venta.fecha)}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-900">
                        {formatCurrency(venta.total)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => setSelected(venta)}
                          className="rounded-lg p-1.5 text-blue-600 hover:bg-blue-50"
                          title="Ver detalle"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Alertas de Stock"
              icon={AlertTriangle}
              tone="red"
              subtitle="Productos por debajo del mínimo"
            />
            <div className="divide-y divide-gray-100">
              {alertasSede.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {item.producto}
                    </p>
                    <p className="text-xs text-gray-500">
                      Mínimo: {item.stockMinimo} {item.unidad}
                      {item.tienda ? ` · ${item.tienda}` : ""}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      item.stock === 0
                        ? "bg-red-100 text-red-700"
                        : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {item.stock === 0 ? "Agotado" : `${item.stock} restantes`}
                  </span>
                </div>
              ))}
              {alertasSede.length === 0 && (
                <p className="px-4 py-6 text-center text-sm text-gray-500">
                  Todo el stock está en orden.
                </p>
              )}
            </div>
          </Card>
        </div>
      </div>

      <ModalDetalleVenta venta={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
