"use client";

import { CreditCard, Eye, Printer } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import type { Comprobante } from "@/lib/types";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { useSede } from "@/components/shared/SedeProvider";

export function ComprobanteTable({
  comprobantes,
  onView,
  onCambiarMetodo,
}: {
  comprobantes: Comprobante[];
  onView: (comprobante: Comprobante) => void;
  onCambiarMetodo?: (comprobante: Comprobante) => void;
}) {
  const { nombreSede } = useSede();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="bg-gray-50 text-xs uppercase text-gray-500">
          <tr>
            <th className="px-4 py-3 font-semibold">Número</th>
            <th className="px-4 py-3 font-semibold">Tipo</th>
            <th className="px-4 py-3 font-semibold">Sede</th>
            <th className="px-4 py-3 font-semibold">Cliente</th>
            <th className="px-4 py-3 font-semibold">Fecha</th>
            <th className="px-4 py-3 font-semibold">Método</th>
            <th className="px-4 py-3 text-right font-semibold">Total</th>
            <th className="px-4 py-3 text-center font-semibold">Estado</th>
            <th className="px-4 py-3 text-center font-semibold">Acciones</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {comprobantes.map((c) => (
            <tr key={c.id} className="hover:bg-gray-50">
              <td className="px-4 py-3 font-semibold text-gray-900">
                {c.numero}
              </td>
              <td className="px-4 py-3">
                <Badge variant={c.tipo} />
              </td>
              <td className="px-4 py-3 text-gray-600">
                {nombreSede(c.sedeId)}
              </td>
              <td className="px-4 py-3">
                <p className="font-medium text-gray-900">{c.cliente}</p>
                <p className="text-xs text-gray-400">{c.documento}</p>
              </td>
              <td className="px-4 py-3 text-gray-500">
                {formatDateTime(c.fecha)}
              </td>
              <td className="px-4 py-3 text-gray-600">{c.metodoPago}</td>
              <td className="px-4 py-3 text-right font-bold text-gray-900">
                {formatCurrency(c.total)}
              </td>
              <td className="px-4 py-3 text-center">
                <Badge variant={c.estado} />
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center justify-center gap-1">
                  <button
                    onClick={() => onView(c)}
                    className="rounded-lg p-1.5 text-blue-600 hover:bg-blue-50"
                    title="Ver detalle"
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                  {onCambiarMetodo && c.estado === "pagado" && (
                    <button
                      onClick={() => onCambiarMetodo(c)}
                      className="rounded-lg p-1.5 text-amber-600 hover:bg-amber-50"
                      title="Cambiar tipo de pago"
                    >
                      <CreditCard className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100"
                    title="Imprimir"
                  >
                    <Printer className="h-4 w-4" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {comprobantes.length === 0 && (
            <tr>
              <td colSpan={9} className="px-4 py-10 text-center text-gray-500">
                No se encontraron comprobantes.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
