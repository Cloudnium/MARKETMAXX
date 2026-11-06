"use client";

import { PackageCheck, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import type { Compra } from "@/lib/types";
import { formatCurrency, formatDateTime } from "@/lib/utils";

export function ComprasTable({
  compras,
  onRecibir,
  onAnular,
}: {
  compras: Compra[];
  onRecibir?: (compra: Compra) => void;
  onAnular?: (compra: Compra) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="bg-gray-50 text-xs uppercase text-gray-500">
          <tr>
            <th className="px-4 py-3 font-semibold">Número</th>
            <th className="px-4 py-3 font-semibold">Proveedor</th>
            <th className="px-4 py-3 font-semibold">Fecha</th>
            <th className="px-4 py-3 text-center font-semibold">Items</th>
            <th className="px-4 py-3 text-right font-semibold">Total</th>
            <th className="px-4 py-3 text-center font-semibold">Estado</th>
            <th className="px-4 py-3 text-center font-semibold">Acciones</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {compras.map((compra) => (
            <tr key={compra.id} className="hover:bg-gray-50">
              <td className="px-4 py-3 font-semibold text-gray-900">
                {compra.numero}
              </td>
              <td className="px-4 py-3">
                <p className="font-medium text-gray-900">{compra.proveedor}</p>
                <p className="text-xs text-gray-400">{compra.usuario}{compra.motivoAnulacion ? ` · Anulada: ${compra.motivoAnulacion}` : ""}</p>
              </td>
              <td className="px-4 py-3 text-gray-500">
                {formatDateTime(compra.fecha)}
              </td>
              <td className="px-4 py-3 text-center text-gray-600">
                {compra.items}
              </td>
              <td className="px-4 py-3 text-right font-bold text-gray-900">
                {formatCurrency(compra.total)}
              </td>
              <td className="px-4 py-3 text-center">
                <Badge variant={compra.estado} />
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center justify-center gap-1">
                  {compra.estado === "pendiente" && onRecibir && (
                    <button
                      onClick={() => onRecibir(compra)}
                      className="rounded-lg p-1.5 text-green-600 hover:bg-green-50"
                      title="Marcar como recibida (ingresa stock)"
                    >
                      <PackageCheck className="h-4 w-4" />
                    </button>
                  )}
                  {compra.estado !== "anulada" && onAnular && (
                    <button
                      onClick={() => onAnular(compra)}
                      className="rounded-lg p-1.5 text-red-500 hover:bg-red-50"
                      title="Anular"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
          {compras.length === 0 && (
            <tr>
              <td colSpan={7} className="px-4 py-10 text-center text-gray-500">
                No se encontraron compras.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
