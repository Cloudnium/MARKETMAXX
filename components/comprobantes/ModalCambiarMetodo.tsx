"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useAsync } from "@/lib/hooks/useAsync";
import { cambiarMetodoPago, listarMetodosPago } from "@/lib/data/ventas";
import type { Comprobante } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";

/** Corrige el tipo de pago de un comprobante pagado (el importe no cambia). */
export function ModalCambiarMetodo({
  comprobante,
  onClose,
  onDone,
}: {
  comprobante: Comprobante | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const metodos = useAsync(() => (comprobante ? listarMetodosPago() : Promise.resolve([])), [comprobante?.id], []);
  const [metodo, setMetodo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (comprobante) {
      setMetodo(comprobante.metodoPago);
      setError(null);
    }
  }, [comprobante]);

  if (!comprobante) return null;

  const guardar = async () => {
    setGuardando(true);
    setError(null);
    try {
      await cambiarMetodoPago(comprobante.id, metodo);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Cambiar tipo de pago"
      subtitle={`${comprobante.numero} · ${formatCurrency(comprobante.total)}`}
      size="sm"
      footer={
        <>
          <button onClick={onClose} className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50">
            Cancelar
          </button>
          <button
            onClick={guardar}
            disabled={guardando || !metodo || metodo === comprobante.metodoPago}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {guardando && <Loader2 className="h-4 w-4 animate-spin" />} Guardar
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <p className="text-sm text-gray-500">
          Actual: <span className="font-semibold text-gray-800">{comprobante.metodoPago}</span>. El cambio queda registrado en auditoría y se refleja en el cierre y ticket de caja.
        </p>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">Nuevo tipo de pago</label>
          <select value={metodo} onChange={(e) => setMetodo(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none">
            {(metodos.data ?? []).map((m) => <option key={m}>{m}</option>)}
          </select>
        </div>
      </div>
    </Modal>
  );
}
