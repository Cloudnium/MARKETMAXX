"use client";

import { Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import type { Cliente } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";

function initials(nombre: string) {
  return nombre
    .split(" ")
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase();
}

export function ClienteTable({
  clientes,
  onEdit,
  onDelete,
}: {
  clientes: Cliente[];
  onEdit?: (cliente: Cliente) => void;
  onDelete?: (cliente: Cliente) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="bg-gray-50 text-xs uppercase text-gray-500">
          <tr>
            <th className="px-4 py-3 font-semibold">Cliente</th>
            <th className="px-4 py-3 font-semibold">Documento</th>
            <th className="px-4 py-3 font-semibold">Teléfono</th>
            <th className="px-4 py-3 font-semibold">Tipo</th>
            <th className="px-4 py-3 text-center font-semibold">Compras</th>
            <th className="px-4 py-3 text-right font-semibold">Total gastado</th>
            <th className="px-4 py-3 text-center font-semibold">Acciones</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {clientes.map((cliente) => (
            <tr key={cliente.id} className="hover:bg-gray-50">
              <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold ${
                      cliente.tipo === "vip"
                        ? "bg-purple-100 text-purple-700"
                        : "bg-pink-100 text-pink-600"
                    }`}
                  >
                    {initials(cliente.nombre)}
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">
                      {cliente.nombre}
                    </p>
                    <p className="text-xs text-gray-400">{cliente.email}</p>
                  </div>
                </div>
              </td>
              <td className="px-4 py-3 text-gray-600">{cliente.documento}</td>
              <td className="px-4 py-3 text-gray-600">{cliente.telefono}</td>
              <td className="px-4 py-3">
                <Badge variant={cliente.tipo} />
              </td>
              <td className="px-4 py-3 text-center font-semibold text-gray-900">
                {cliente.compras}
              </td>
              <td className="px-4 py-3 text-right font-semibold text-green-600">
                {formatCurrency(cliente.totalGastado)}
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center justify-center gap-1">
                  {onEdit && (
                    <button
                      onClick={() => onEdit(cliente)}
                      className="rounded-lg p-1.5 text-blue-600 hover:bg-blue-50"
                      title="Editar"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  )}
                  {onDelete && (
                    <button
                      onClick={() => onDelete(cliente)}
                      className="rounded-lg p-1.5 text-red-500 hover:bg-red-50"
                      title="Desactivar"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
          {clientes.length === 0 && (
            <tr>
              <td colSpan={7} className="px-4 py-10 text-center text-gray-500">
                No se encontraron clientes.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
