"use client";

import { Minus, Plus, Trash2 } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

export interface CartItem {
  producto: {
    id: string;
    nombre: string;
    precio: number;
    stock?: number;
  };
  cantidad: number;
}

export function CartProduct({
  item,
  onIncrease,
  onDecrease,
  onRemove,
}: {
  item: CartItem;
  onIncrease: () => void;
  onDecrease: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-gray-900">
          {item.producto.nombre}
        </p>
        <p className="text-xs text-gray-500">
          {formatCurrency(item.producto.precio)} c/u
        </p>
      </div>
      <div className="flex items-center gap-1 rounded-lg border border-gray-200">
        <button
          onClick={onDecrease}
          className="p-1.5 text-gray-500 hover:bg-gray-50"
          aria-label="Disminuir"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <span className="min-w-[24px] text-center text-sm font-semibold text-gray-900">
          {item.cantidad}
        </span>
        <button
          onClick={onIncrease}
          disabled={item.producto.stock !== undefined && item.cantidad >= item.producto.stock}
          className="p-1.5 text-gray-500 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-30"
          aria-label="Aumentar"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <span className="w-20 text-right text-sm font-bold text-gray-900">
        {formatCurrency(item.producto.precio * item.cantidad)}
      </span>
      <button
        onClick={onRemove}
        className="rounded-lg p-1.5 text-red-500 hover:bg-red-50"
        aria-label="Eliminar"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}
