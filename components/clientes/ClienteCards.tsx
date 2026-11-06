"use client";

import { Mail, MapPin, Pencil, Phone, ShoppingBag, Trash2 } from "lucide-react";
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

export function ClienteCards({
  clientes,
  onEdit,
  onDelete,
}: {
  clientes: Cliente[];
  onEdit?: (cliente: Cliente) => void;
  onDelete?: (cliente: Cliente) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 xl:grid-cols-3">
      {clientes.map((cliente) => (
        <div
          key={cliente.id}
          className="rounded-xl border border-gray-200 p-4 transition-all hover:border-pink-200 hover:shadow-md"
        >
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div
                className={`flex h-11 w-11 items-center justify-center rounded-full text-sm font-bold ${
                  cliente.tipo === "vip"
                    ? "bg-purple-100 text-purple-700"
                    : "bg-pink-100 text-pink-600"
                }`}
              >
                {initials(cliente.nombre)}
              </div>
              <div>
                <p className="font-semibold text-gray-900">{cliente.nombre}</p>
                <p className="text-xs text-gray-500">{cliente.documento}</p>
              </div>
            </div>
            <Badge variant={cliente.tipo} />
          </div>

          <div className="mt-4 space-y-1.5 text-sm text-gray-600">
            <p className="flex items-center gap-2">
              <Phone className="h-3.5 w-3.5 text-gray-400" /> {cliente.telefono}
            </p>
            <p className="flex items-center gap-2 truncate">
              <Mail className="h-3.5 w-3.5 shrink-0 text-gray-400" />
              {cliente.email}
            </p>
            <p className="flex items-center gap-2 truncate">
              <MapPin className="h-3.5 w-3.5 shrink-0 text-gray-400" />
              {cliente.direccion}
            </p>
          </div>

          <div className="mt-4 flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2.5">
            <div>
              <p className="text-xs text-gray-500">Compras</p>
              <p className="flex items-center gap-1 text-sm font-bold text-gray-900">
                <ShoppingBag className="h-3.5 w-3.5 text-gray-400" />
                {cliente.compras}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500">Total gastado</p>
              <p className="text-sm font-bold text-green-600">
                {formatCurrency(cliente.totalGastado)}
              </p>
            </div>
          </div>

          <div className="mt-3 flex gap-2">
            {onEdit && (
              <button
                onClick={() => onEdit(cliente)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-300 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
              >
                <Pencil className="h-3.5 w-3.5" /> Editar
              </button>
            )}
            {onDelete && (
              <button
                onClick={() => onDelete(cliente)}
                className="rounded-lg border border-red-200 p-2 text-red-500 hover:bg-red-50"
                title="Desactivar"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      ))}
      {clientes.length === 0 && (
        <p className="col-span-full py-10 text-center text-sm text-gray-500">
          No se encontraron clientes.
        </p>
      )}
    </div>
  );
}
