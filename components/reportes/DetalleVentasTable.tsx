"use client";

import { Receipt } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { useReporte } from "./ReporteContext";
import { formatCurrency, formatDateTime } from "@/lib/utils";

export function DetalleVentasTable() {
  const { detalle: ventasRecientes } = useReporte();
  return (
    <Card>
      <CardHeader
        title="Detalle de Ventas"
        icon={Receipt}
        tone="blue"
        subtitle="Movimientos del periodo seleccionado"
        right={
          <button className="text-sm font-semibold text-blue-600 hover:text-blue-700">
            Exportar
          </button>
        }
      />
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3 font-semibold">Comprobante</th>
              <th className="px-4 py-3 font-semibold">Cliente</th>
              <th className="px-4 py-3 font-semibold">Tipo</th>
              <th className="px-4 py-3 font-semibold">Fecha</th>
              <th className="px-4 py-3 font-semibold">Método</th>
              <th className="px-4 py-3 text-right font-semibold">Total</th>
              <th className="px-4 py-3 text-center font-semibold">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {ventasRecientes.map((venta) => (
              <tr key={venta.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-semibold text-gray-900">
                  {venta.numero}
                </td>
                <td className="px-4 py-3 text-gray-600">{venta.cliente}</td>
                <td className="px-4 py-3">
                  <Badge variant={venta.tipo} />
                </td>
                <td className="px-4 py-3 text-gray-500">
                  {formatDateTime(venta.fecha)}
                </td>
                <td className="px-4 py-3 text-gray-600">{venta.metodoPago}</td>
                <td className="px-4 py-3 text-right font-bold text-gray-900">
                  {formatCurrency(venta.total)}
                </td>
                <td className="px-4 py-3 text-center">
                  <Badge variant={venta.estado} />
                </td>
              </tr>
            ))}
            {ventasRecientes.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                  Sin ventas en el periodo seleccionado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
