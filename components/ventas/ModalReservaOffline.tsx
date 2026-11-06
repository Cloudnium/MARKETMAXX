"use client";

import { Loader2, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { crearReserva, ultimaReserva } from "@/lib/offline/motor";
import type { Caja, Producto } from "@/lib/types";

/** Reserva stock del servidor para vender sin internet desde esta caja. Un único modal, sin repeticiones. */
export function ModalReservaOffline({
  open, onClose, sedeId, cajas, productos, onDone,
}: {
  open: boolean;
  onClose: () => void;
  sedeId: string;
  cajas: Caja[];
  productos: Producto[];
  onDone: (resumen: string) => void;
}) {
  const [cajaId, setCajaId] = useState("");
  const [ttl, setTtl] = useState(480);
  const [cant, setCant] = useState<Record<string, number>>({});
  const [q, setQ] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setQ("");
    const c = cajas[0]?.id ?? "";
    setCajaId(c);
    setCant({});
    if (c) void ultimaReserva(sedeId, c).then((u) => u && setCant(Object.fromEntries(u.items.map((i) => [i.productoId, i.cantidad]))));
  }, [open, sedeId, cajas]);

  const lista = productos.filter((p) => p.activo && p.stock > 0 && (q === "" || `${p.nombre} ${p.codigo}`.toLowerCase().includes(q.toLowerCase())));
  const total = Object.values(cant).reduce((s, n) => s + (n > 0 ? n : 0), 0);

  const reservar = async () => {
    setGuardando(true);
    setError(null);
    try {
      const { resultado } = await crearReserva({
        sedeId,
        cajaId,
        ttlMin: ttl,
        items: Object.entries(cant).map(([productoId, cantidad]) => ({ productoId, cantidad })),
      });
      const parcial = resultado.filter((r) => Number(r.otorgado) < Number(r.solicitado)).length;
      onDone(`Stock reservado para vender sin conexión${parcial ? ` (${parcial} producto(s) con menos unidades de las pedidas)` : ""}.`);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => !guardando && onClose()}
      size="lg"
      title={<span className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-blue-600" /> Reservar stock para vender sin internet</span>}
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} disabled={guardando} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold">Cancelar</button>
          <button onClick={reservar} disabled={guardando || !cajaId || total <= 0} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {guardando && <Loader2 className="h-4 w-4 animate-spin" />} Reservar {total > 0 ? `${total} unidad(es)` : ""}
          </button>
        </div>
      }
    >
      <p className="mb-3 text-xs text-gray-600">
        Las unidades reservadas se descuentan del stock general y solo las puede vender esta caja. Al volver la conexión se envían las ventas y
        lo no vendido regresa al stock automáticamente.
      </p>
      <div className="mb-3 grid grid-cols-2 gap-3">
        <label className="text-xs font-medium text-gray-700">Caja
          <select value={cajaId} onChange={(e) => setCajaId(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
            {cajas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-gray-700">Duración de la reserva
          <select value={ttl} onChange={(e) => setTtl(Number(e.target.value))} className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
            <option value={120}>2 horas</option><option value={240}>4 horas</option><option value={480}>8 horas</option><option value={720}>12 horas</option>
          </select>
        </label>
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar producto…" className="mb-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
      <div className="max-h-72 overflow-y-auto rounded-lg border border-gray-200">
        {lista.map((p) => (
          <div key={p.id} className="flex items-center justify-between border-b border-gray-100 px-3 py-2 text-sm last:border-0">
            <span className="truncate">{p.nombre} <span className="text-xs text-gray-400">· hay {p.stock}</span></span>
            <input type="number" min={0} max={p.stock} value={cant[p.id] ?? ""} placeholder="0"
              onChange={(e) => setCant({ ...cant, [p.id]: Math.min(p.stock, Math.max(0, Number(e.target.value))) })}
              className="w-20 rounded border border-gray-300 px-2 py-1 text-right" />
          </div>
        ))}
        {lista.length === 0 && <p className="p-4 text-center text-sm text-gray-400">No hay productos con stock.</p>}
      </div>
      {error && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    </Modal>
  );
}
