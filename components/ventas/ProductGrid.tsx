"use client";

import { Package, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { Producto } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";

export function ProductGrid({
  productos,
  categorias,
  enCarrito,
  onAdd,
  enVivo = false,
}: {
  productos: Producto[];
  categorias: string[];
  /** unidades de cada producto ya agregadas al carrito */
  enCarrito: Record<string, number>;
  onAdd: (producto: Producto) => void;
  /** El stock mostrado se está actualizando en tiempo real. */
  enVivo?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [categoria, setCategoria] = useState("Todas");

  const filtered = useMemo(
    () =>
      productos.filter((p) => {
        const matchQuery =
          p.nombre.toLowerCase().includes(query.toLowerCase()) ||
          p.codigo.toLowerCase().includes(query.toLowerCase());
        const matchCategoria = categoria === "Todas" || p.categoria === categoria;
        return matchQuery && matchCategoria && p.activo;
      }),
    [productos, query, categoria]
  );

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="space-y-3 border-b border-gray-100 p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar producto por nombre o código..."
            className="w-full rounded-lg border border-gray-300 py-2.5 pl-10 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
          />
        </div>
        <p className="flex items-center gap-1.5 text-xs text-gray-500" data-testid="stock-en-vivo">
          <span className={`h-2 w-2 rounded-full ${enVivo ? "animate-pulse bg-green-500" : "bg-gray-300"}`} />
          {enVivo ? "Stock en tiempo real" : "Stock sin actualizar en vivo"}
        </p>
        <div className="flex flex-wrap gap-2">
          {["Todas", ...categorias].map((cat) => (
            <button
              key={cat}
              onClick={() => setCategoria(cat)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                categoria === cat
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      <div className="grid max-h-[calc(100vh-320px)] grid-cols-2 gap-3 overflow-y-auto p-4 sm:grid-cols-3 xl:grid-cols-4">
        {filtered.map((producto) => (
          <button
            key={producto.id}
            onClick={() => onAdd(producto)}
            disabled={producto.stock - (enCarrito[producto.id] ?? 0) <= 0}
            className="group flex flex-col rounded-xl border border-gray-200 p-3 text-left transition-all hover:border-blue-300 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50"
          >
            <div className="mb-2 flex h-20 items-center justify-center rounded-lg bg-gradient-to-br from-gray-50 to-gray-100">
              <Package className="h-8 w-8 text-gray-300 transition-colors group-hover:text-blue-400" />
            </div>
            <p className="line-clamp-2 min-h-[40px] text-sm font-semibold text-gray-900">
              {producto.nombre}
            </p>
            <p className="mt-0.5 text-xs text-gray-400">{producto.codigo}</p>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-sm font-bold text-blue-600">
                {formatCurrency(producto.precio)}
              </span>
              <span
                data-testid={`stock-${producto.codigo}`}
                className={`text-xs font-medium ${
                  producto.stock <= producto.stockMinimo
                    ? "text-amber-600"
                    : "text-gray-400"
                }`}
              >
                {producto.stock} {producto.unidad}
              </span>
            </div>
            {(producto.reservadoOtros ?? 0) > 0 && (
              <p className="mt-1 text-[11px] text-amber-600" title="Unidades apartadas en otras cajas para poder vender si se cae el internet. Vuelven al stock si no se usan.">
                +{producto.reservadoOtros} apartadas en otras cajas
              </p>
            )}
          </button>
        ))}
        {filtered.length === 0 && (
          <p className="col-span-full py-10 text-center text-sm text-gray-500">
            No se encontraron productos.
          </p>
        )}
      </div>
    </div>
  );
}
