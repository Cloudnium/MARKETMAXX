"use client";

import { DollarSign, FileText, ShoppingBag, Users } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { TrendingDown, TrendingUp } from "lucide-react";

interface Resumen {
  ventas: number;
  comprobantes: number;
  clientes: number;
  productos: number;
}

/** % de variación vs. ayer (0 si no hay base de comparación). */
const variacion = (hoy: number, ayer: number) =>
  ayer > 0 ? Math.round(((hoy - ayer) / ayer) * 1000) / 10 : hoy > 0 ? 100 : 0;

export function MetricCards({ hoy, ayer }: { hoy?: Resumen; ayer?: Resumen }) {
  const h = hoy ?? { ventas: 0, comprobantes: 0, clientes: 0, productos: 0 };
  const a = ayer ?? { ventas: 0, comprobantes: 0, clientes: 0, productos: 0 };
  const dashboardMetrics = {
    variacionVentas: variacion(h.ventas, a.ventas),
    variacionComprobantes: variacion(h.comprobantes, a.comprobantes),
    variacionClientes: variacion(h.clientes, a.clientes),
    variacionProductos: variacion(h.productos, a.productos),
  };
  const ventasHoy = h.ventas;
  const comprobantesHoy = h.comprobantes;
  const clientesHoy = h.clientes;
  const productosVendidos = h.productos;

  const cards = [
    {
      label: "Ventas de Hoy",
      value: formatCurrency(ventasHoy),
      variation: dashboardMetrics.variacionVentas,
      icon: DollarSign,
      bg: "bg-green-100",
      color: "text-green-600",
      border: "border-l-green-500",
    },
    {
      label: "Comprobantes",
      value: comprobantesHoy.toString(),
      variation: dashboardMetrics.variacionComprobantes,
      icon: FileText,
      bg: "bg-blue-100",
      color: "text-blue-600",
      border: "border-l-blue-500",
    },
    {
      label: "Clientes Atendidos",
      value: clientesHoy.toString(),
      variation: dashboardMetrics.variacionClientes,
      icon: Users,
      bg: "bg-purple-100",
      color: "text-purple-600",
      border: "border-l-purple-500",
    },
    {
      label: "Productos Vendidos",
      value: productosVendidos.toString(),
      variation: dashboardMetrics.variacionProductos,
      icon: ShoppingBag,
      bg: "bg-amber-100",
      color: "text-amber-600",
      border: "border-l-amber-500",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => {
        const Icon = card.icon;
        const positive = card.variation >= 0;
        return (
          <div
            key={card.label}
            className={`rounded-xl border border-gray-200 border-l-4 ${card.border} bg-white p-5 shadow-sm transition-all duration-300 hover:shadow-lg`}
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500">{card.label}</p>
                <p className="mt-1 text-2xl font-bold text-gray-900">
                  {card.value}
                </p>
              </div>
              <div className={`rounded-lg p-2.5 ${card.bg}`}>
                <Icon className={`h-5 w-5 ${card.color}`} />
              </div>
            </div>
            <div className="mt-3 flex items-center gap-1.5">
              {positive ? (
                <TrendingUp className="h-4 w-4 text-green-600" />
              ) : (
                <TrendingDown className="h-4 w-4 text-red-600" />
              )}
              <span
                className={`text-xs font-semibold ${
                  positive ? "text-green-600" : "text-red-600"
                }`}
              >
                {positive ? "+" : ""}
                {card.variation}%
              </span>
              <span className="text-xs text-gray-400">vs. ayer</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
