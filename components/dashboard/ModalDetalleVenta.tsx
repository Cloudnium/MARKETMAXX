"use client";

import { Printer, Receipt } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import type { VentaReciente } from "@/lib/types";
import { formatCurrency, formatDateTime } from "@/lib/utils";

export function ModalDetalleVenta({
  venta,
  onClose,
}: {
  venta: VentaReciente | null;
  onClose: () => void;
}) {
  if (!venta) return null;

  return (
    <Modal
      open={!!venta}
      onClose={onClose}
      title={`Comprobante ${venta.numero}`}
      subtitle={formatDateTime(venta.fecha)}
      size="md"
      footer={
        <>
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            Cerrar
          </button>
          <button className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
            <Printer className="h-4 w-4" />
            Imprimir
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex items-center justify-between rounded-lg bg-gray-50 p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-blue-100 p-2.5">
              <Receipt className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">{venta.numero}</p>
              <p className="text-xs text-gray-500">{venta.metodoPago}</p>
            </div>
          </div>
          <Badge variant={venta.tipo} />
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-gray-500">Cliente</p>
            <p className="font-semibold text-gray-900">{venta.cliente}</p>
          </div>
          <div>
            <p className="text-gray-500">Estado</p>
            <Badge variant={venta.estado} />
          </div>
          <div>
            <p className="text-gray-500">Fecha</p>
            <p className="font-semibold text-gray-900">
              {formatDateTime(venta.fecha)}
            </p>
          </div>
          <div>
            <p className="text-gray-500">Método de pago</p>
            <p className="font-semibold text-gray-900">{venta.metodoPago}</p>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200">
          <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-semibold text-gray-700">
            <span>Total</span>
            <span className="text-lg text-green-600">
              {formatCurrency(venta.total)}
            </span>
          </div>
          <div className="px-4 py-3 text-sm text-gray-600">
            Detalle de productos disponible en el módulo de comprobantes.
          </div>
        </div>
      </div>
    </Modal>
  );
}
