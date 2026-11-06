"use client";

import { ArrowRight, PackageX, TriangleAlert } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useSede } from "./SedeProvider";
import { useAsync } from "@/lib/hooks/useAsync";
import { listarStockTotal } from "@/lib/data/almacen";

interface StockAlertModalProps {
  open: boolean;
  onClose: () => void;
  onVerInventario: () => void;
}

export function StockAlertModal({
  open,
  onClose,
  onVerInventario,
}: StockAlertModalProps) {
  const { filtro, sede } = useSede();
  const { data } = useAsync(() => listarStockTotal(filtro), [filtro], []);
  const alertas = (data ?? [])
    .filter((item) => item.stock <= item.stockMinimo)
    .map((item) => ({ ...item, producto: item.producto, sedeId: item.sedeId, tienda: item.tienda }))
    .sort((a, b) => a.stock - b.stock);

  const agotados = alertas.filter((producto) => producto.stock === 0).length;
  const bajos = alertas.length - agotados;

  // Solo molesta si realmente hay productos por reponer
  if (alertas.length === 0) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Alerta de inventario"
      subtitle={`Productos con stock bajo o agotado · ${sede.nombre}`}
      size="lg"
      footer={
        <>
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2.5 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-100"
          >
            Entendido
          </button>
          <button
            onClick={() => {
              onClose();
              onVerInventario();
            }}
            className="inline-flex items-center gap-2 rounded-lg bg-pink-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-pink-700"
          >
            Ir a inventario
            <ArrowRight className="h-4 w-4" />
          </button>
        </>
      }
    >
      <div className="mb-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-red-50 p-4 ring-1 ring-red-100">
          <div className="flex items-center gap-2 text-red-600">
            <PackageX className="h-4 w-4" />
            <span className="text-xs font-semibold uppercase tracking-wide">
              Sin stock
            </span>
          </div>
          <p className="mt-1 text-2xl font-bold text-red-700">{agotados}</p>
        </div>
        <div className="rounded-xl bg-amber-50 p-4 ring-1 ring-amber-100">
          <div className="flex items-center gap-2 text-amber-600">
            <TriangleAlert className="h-4 w-4" />
            <span className="text-xs font-semibold uppercase tracking-wide">
              Stock bajo
            </span>
          </div>
          <p className="mt-1 text-2xl font-bold text-amber-700">{bajos}</p>
        </div>
      </div>

      {alertas.length === 0 ? (
        <p className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm font-medium text-green-700">
          Todo el inventario está en orden.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Producto</th>
                <th className="px-4 py-2.5 text-center font-semibold">Stock</th>
                <th className="px-4 py-2.5 text-center font-semibold">
                  Mínimo
                </th>
                <th className="px-4 py-2.5 text-center font-semibold">
                  Estado
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {alertas.map((producto) => (
                <tr
                  key={producto.id}
                  className="hover:bg-gray-50/70"
                >
                  <td className="px-4 py-3">
                    <p className="font-semibold text-gray-900">
                      {producto.producto}
                    </p>
                    <p className="text-xs text-gray-500">
                      {producto.codigo} · {producto.categoria}
                      {producto.tienda ? ` · ${producto.tienda}` : ""}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-center font-semibold text-gray-900">
                    {producto.stock} {producto.unidad}
                  </td>
                  <td className="px-4 py-3 text-center text-gray-500">
                    {producto.stockMinimo}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        producto.stock === 0
                          ? "bg-red-100 text-red-700"
                          : "bg-amber-100 text-amber-700"
                      }`}
                    >
                      {producto.stock === 0 ? "Agotado" : "Stock bajo"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
