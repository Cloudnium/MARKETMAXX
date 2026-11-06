"use client";

import { CheckCircle2, Clock, DollarSign, Truck } from "lucide-react";
import type { Compra } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";

export function ComprasMetricas({ compras = [] }: { compras?: Compra[] }) {
  const validas = compras.filter((compra) => compra.estado !== "anulada");
  const totalCompras = validas.reduce((acc, compra) => acc + compra.total, 0);
  const comprasRecibidas = compras.filter((compra) => compra.estado === "recibida").length;
  const comprasPendientes = compras.filter((compra) => compra.estado === "pendiente").length;
  const proveedores = new Set(validas.map((compra) => compra.proveedor)).size;

  const cards = [
    {
      label: "Total Compras",
      value: formatCurrency(totalCompras),
      icon: DollarSign,
      bg: "bg-blue-100",
      color: "text-blue-600",
    },
    {
      label: "Recibidas",
      value: comprasRecibidas.toString(),
      icon: CheckCircle2,
      bg: "bg-green-100",
      color: "text-green-600",
    },
    {
      label: "Pendientes",
      value: comprasPendientes.toString(),
      icon: Clock,
      bg: "bg-amber-100",
      color: "text-amber-600",
    },
    {
      label: "Proveedores",
      value: proveedores.toString(),
      icon: Truck,
      bg: "bg-purple-100",
      color: "text-purple-600",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div
            key={card.label}
            className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
          >
            <div className={`rounded-lg p-3 ${card.bg}`}>
              <Icon className={`h-6 w-6 ${card.color}`} />
            </div>
            <div>
              <p className="text-sm text-gray-500">{card.label}</p>
              <p className="text-lg font-bold text-gray-900">{card.value}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
