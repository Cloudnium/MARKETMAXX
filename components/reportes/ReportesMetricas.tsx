"use client";

import { Boxes, DollarSign, FileText, Package, Receipt, Scale } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useReporte } from "./ReporteContext";
import { formatCurrency } from "@/lib/utils";

export interface ExtraReporte {
  unidades: number;
  productosUnicos: number;
  egresos: number;
  egresosN: number;
  inventarioValor: number;
  inventarioProductos: number;
}

interface Tarjeta {
  label: string;
  badge: string;
  value: string;
  pie: string;
  pieValor: string;
  icon: LucideIcon;
  border: string;
  bg: string;
  color: string;
  badgeCls: string;
  valueCls?: string;
}

export function ReportesMetricas({ extra }: { extra: ExtraReporte }) {
  const { resumenPeriodo: r } = useReporte();
  const dif = r.ventasTotales - extra.egresos;
  const sup = dif >= 0;
  const cards: Tarjeta[] = [
    {
      label: "Ventas Totales", badge: "Ingresos", value: formatCurrency(r.ventasTotales),
      pie: "Ticket promedio", pieValor: formatCurrency(r.ticketPromedio),
      icon: DollarSign, border: "border-l-green-500", bg: "bg-green-100", color: "text-green-600", badgeCls: "bg-green-100 text-green-700",
    },
    {
      label: "Egresos", badge: "Compras", value: formatCurrency(extra.egresos),
      pie: "Total compras", pieValor: String(extra.egresosN),
      icon: Receipt, border: "border-l-red-500", bg: "bg-red-100", color: "text-red-600", badgeCls: "bg-red-100 text-red-700",
    },
    {
      label: "Diferencia", badge: sup ? "Superávit" : "Déficit", value: `${sup ? "+" : "-"}${formatCurrency(Math.abs(dif))}`,
      pie: "Ingresos − Egresos", pieValor: sup ? "Positivo" : "Negativo",
      icon: Scale, border: sup ? "border-l-blue-500" : "border-l-orange-500", bg: sup ? "bg-blue-100" : "bg-orange-100",
      color: sup ? "text-blue-600" : "text-orange-600", badgeCls: sup ? "bg-blue-100 text-blue-700" : "bg-orange-100 text-orange-700",
      valueCls: sup ? "text-blue-700" : "text-orange-600",
    },
    {
      label: "Productos Vendidos", badge: `${extra.productosUnicos} SKU`, value: extra.unidades.toLocaleString("es-PE"),
      pie: "Productos únicos", pieValor: String(extra.productosUnicos),
      icon: Package, border: "border-l-purple-500", bg: "bg-purple-100", color: "text-purple-600", badgeCls: "bg-purple-100 text-purple-700",
    },
    {
      label: "Comprobantes", badge: "Emitidos", value: String(r.comprobantes),
      pie: "Total ventas", pieValor: formatCurrency(r.ventasTotales),
      icon: FileText, border: "border-l-amber-500", bg: "bg-amber-100", color: "text-amber-600", badgeCls: "bg-amber-100 text-amber-700",
    },
    {
      label: "Inventario", badge: "Stock", value: formatCurrency(extra.inventarioValor),
      pie: "Total productos", pieValor: String(extra.inventarioProductos),
      icon: Boxes, border: "border-l-teal-500", bg: "bg-teal-100", color: "text-teal-600", badgeCls: "bg-teal-100 text-teal-700",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <div key={c.label} className={`rounded-xl border border-gray-200 border-l-4 ${c.border} bg-white p-5 shadow-sm transition-all duration-300 hover:shadow-xl`}>
            <div className="flex items-start justify-between">
              <div className={`rounded-lg p-2.5 ${c.bg}`}>
                <Icon className={`h-5 w-5 ${c.color}`} />
              </div>
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${c.badgeCls}`}>{c.badge}</span>
            </div>
            <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-gray-500">{c.label}</p>
            <p className={`mt-1 text-2xl font-bold ${c.valueCls ?? "text-gray-900"}`}>{c.value}</p>
            <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-3 text-xs">
              <span className="text-gray-500">{c.pie}</span>
              <span className="font-semibold text-gray-800">{c.pieValor}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
