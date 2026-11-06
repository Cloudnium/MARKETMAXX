"use client";

import { Package, Pencil, Power } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import type { Producto } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";

export function ProductTable({
  productos,
  onEdit,
  onToggle,
  mostrarSede,
}: {
  productos: Producto[];
  mostrarSede?: boolean;
  onEdit?: (producto: Producto) => void;
  onToggle?: (producto: Producto) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="bg-gray-50 text-xs uppercase text-gray-500">
          <tr>
            <th className="px-4 py-3 font-semibold">Producto</th>
            <th className="px-4 py-3 font-semibold">Categoría</th>
            {mostrarSede && <th className="px-4 py-3 font-semibold">Sede</th>}
            <th className="px-4 py-3 font-semibold">Precio</th>
            <th className="px-4 py-3 font-semibold">Stock</th>
            <th className="px-4 py-3 font-semibold">Estado</th>
            <th className="px-4 py-3 text-center font-semibold">Acciones</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {productos.map((producto) => {
            const total = producto.stock + (producto.stockAlmacen ?? 0);
            const stockBajo = total <= producto.stockMinimo;
            return (
              <tr key={producto.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100">
                      <Package className="h-5 w-5 text-gray-400" />
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900">
                        {producto.nombre}
                      </p>
                      <p className="text-xs text-gray-400">{producto.codigo}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-600">{producto.categoria}</td>
                {mostrarSede && <td className="px-4 py-3 text-gray-600">{producto.sedeNombre}</td>}
                <td className="px-4 py-3 font-semibold text-gray-900">
                  {formatCurrency(producto.precio)}
                </td>
                <td className="px-4 py-3">
                  <span
                    title={`Tienda ${producto.stock} · Almacén ${producto.stockAlmacen ?? 0}`}
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      total === 0
                        ? "bg-red-100 text-red-700"
                        : stockBajo
                        ? "bg-amber-100 text-amber-700"
                        : "bg-green-100 text-green-700"
                    }`}
                  >
                    {total} {producto.unidad}
                  </span>
                  <p className="mt-0.5 text-[11px] text-gray-400">Tienda {producto.stock} · Almacén {producto.stockAlmacen ?? 0}</p>
                </td>
                <td className="px-4 py-3">
                  <Badge variant={producto.activo ? "activo" : "inactivo"} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-center gap-1">
                    {onEdit && (
                      <button
                        onClick={() => onEdit(producto)}
                        className="rounded-lg p-1.5 text-blue-600 hover:bg-blue-50"
                        title="Editar"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    )}
                    {onToggle && (
                      <button
                        onClick={() => onToggle(producto)}
                        className={`rounded-lg p-1.5 ${
                          producto.activo ? "text-red-500 hover:bg-red-50" : "text-green-600 hover:bg-green-50"
                        }`}
                        title={producto.activo ? "Desactivar" : "Activar"}
                      >
                        <Power className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
          {productos.length === 0 && (
            <tr>
              <td colSpan={mostrarSede ? 7 : 6} className="px-4 py-10 text-center text-gray-500">
                No se encontraron productos.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
