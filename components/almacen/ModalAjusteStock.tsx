"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { ajustarAlmacen, type TipoAjuste } from "@/lib/data/almacen";
import type { StockItem } from "@/lib/types";

const inputClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100";

const tipos: { value: TipoAjuste; label: string; ayuda: string }[] = [
  { value: "ingreso", label: "Agregar stock", ayuda: "Suma unidades (ingreso sin compra, devolución, etc.)" },
  { value: "descuento", label: "Descontar (merma / pérdida)", ayuda: "Resta unidades por daño, vencimiento o pérdida" },
  { value: "conteo", label: "Conteo físico", ayuda: "Fija el stock exacto contado en el almacén" },
];

export function ModalAjusteStock({
  item,
  open,
  onClose,
  onDone,
}: {
  item: StockItem | null;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [tipo, setTipo] = useState<TipoAjuste>("ingreso");
  const [cantidad, setCantidad] = useState("");
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTipo("ingreso");
      setCantidad("");
      setMotivo("");
      setError(null);
    }
  }, [open]);

  if (!item) return null;
  const n = Number(cantidad);
  const resultado =
    tipo === "ingreso" ? item.stock + n : tipo === "descuento" ? item.stock - n : n;

  const guardar = async () => {
    setError(null);
    if (!(n >= 0) || cantidad === "" || (tipo !== "conteo" && n <= 0)) return setError("Ingresa una cantidad válida.");
    if (resultado < 0) return setError("El stock resultante no puede ser negativo.");
    if (motivo.trim().length < 3) return setError("El motivo es obligatorio.");
    if (!item.sedeId) return;
    setGuardando(true);
    try {
      await ajustarAlmacen(item.sedeId, item.productoId, tipo, n, motivo);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Ajustar stock del almacén"
      subtitle={`${item.producto} · ${item.tienda}`}
      size="md"
      footer={
        <>
          <button onClick={onClose} className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50">
            Cancelar
          </button>
          <button
            onClick={guardar}
            disabled={guardando}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {guardando && <Loader2 className="h-4 w-4 animate-spin" />} Registrar ajuste
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <div className="grid grid-cols-1 gap-2">
          {tipos.map((t) => (
            <label
              key={t.value}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm ${
                tipo === t.value ? "border-blue-400 bg-blue-50" : "border-gray-200 hover:bg-gray-50"
              }`}
            >
              <input type="radio" checked={tipo === t.value} onChange={() => setTipo(t.value)} className="mt-0.5 accent-blue-600" />
              <span>
                <span className="block font-semibold text-gray-900">{t.label}</span>
                <span className="text-xs text-gray-500">{t.ayuda}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              {tipo === "conteo" ? "Stock contado" : "Cantidad"} ({item.unidad})
            </label>
            <input type="number" min={0} value={cantidad} onChange={(e) => setCantidad(e.target.value)} className={inputClass} />
          </div>
          <div className="rounded-lg bg-gray-50 p-3 text-sm">
            <p className="text-xs text-gray-500">Stock actual → nuevo</p>
            <p className="mt-1 font-bold text-gray-900">
              {item.stock} → <span className={resultado < 0 ? "text-red-600" : "text-blue-600"}>{cantidad === "" ? "—" : resultado}</span>
            </p>
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">Motivo (obligatorio)</label>
          <textarea rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej. Producto vencido, conteo mensual, devolución del cliente..." className={inputClass} />
          <p className="mt-1 text-xs text-gray-500">Se guarda en el historial con tu nombre, fecha y el stock antes/después.</p>
        </div>
      </div>
    </Modal>
  );
}
