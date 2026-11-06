"use client";

import { useEffect, useState } from "react";
import { ArrowRightLeft, Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useSede } from "@/components/shared/SedeProvider";
import { useAuth } from "@/components/shared/AuthProvider";
import { useAsync } from "@/lib/hooks/useAsync";
import { listarStock, traspasar } from "@/lib/data/almacen";
import { createClient } from "@/lib/supabase/client";
import type { StockItem } from "@/lib/types";

const inputClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100";

interface SedeSimple {
  id: string;
  nombre: string;
}

export function ModalTraspaso({
  open,
  onClose,
  onDone,
  productoInicial,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  productoInicial?: string | null;
}) {
  const { sedeOperativa, sedes } = useSede();
  const { sedes: accesibles } = useAuth();
  const [origen, setOrigen] = useState("");
  const [destino, setDestino] = useState("");
  const [productoId, setProductoId] = useState("");
  const [cantidad, setCantidad] = useState(1);
  const [obs, setObs] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // El destino puede ser CUALQUIER sede activa, no solo las asignadas al usuario
  const destinos = useAsync<SedeSimple[]>(
    async () => {
      if (!open) return [];
      const { data } = await createClient().from("sedes").select("id,nombre").eq("activa", true).order("numero");
      return (data as SedeSimple[]) ?? [];
    },
    [open],
    []
  );
  const todasLasSedes = destinos.data?.length ? destinos.data : accesibles;

  const stock = useAsync<StockItem[]>(
    () => (open && origen ? listarStock(origen) : Promise.resolve([])),
    [open, origen],
    []
  );

  useEffect(() => {
    if (!open) return;
    const o = sedeOperativa?.id ?? sedes[0]?.id ?? "";
    setOrigen(o);
    setDestino(todasLasSedes.find((s) => s.id !== o)?.id ?? "");
    setProductoId(productoInicial ?? "");
    setCantidad(1);
    setObs("");
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (destino === origen) setDestino(todasLasSedes.find((s) => s.id !== origen)?.id ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origen, todasLasSedes.length]);

  const items = (stock.data ?? []).filter((i) => i.stock > 0);
  const actual = items.find((i) => i.productoId === productoId);

  const guardar = async () => {
    setError(null);
    if (!productoId) return setError("Selecciona un producto.");
    if (!(cantidad > 0)) return setError("La cantidad debe ser mayor a cero.");
    if (actual && cantidad > actual.stock) return setError(`Solo hay ${actual.stock} disponibles en la sede de origen.`);
    setGuardando(true);
    try {
      await traspasar(origen, destino, productoId, cantidad, obs);
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
      title="Nuevo Traspaso"
      subtitle="Transfiere productos entre sedes (queda registrado en ambas)"
      size="lg"
      footer={
        <>
          <button onClick={onClose} className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50">
            Cancelar
          </button>
          <button
            onClick={guardar}
            disabled={guardando || !destino}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {guardando && <Loader2 className="h-4 w-4 animate-spin" />} Registrar traspaso
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-5">
          <div className="sm:col-span-2">
            <label className="mb-1.5 block text-sm font-medium text-gray-700">Sede origen</label>
            <select className={inputClass} value={origen} onChange={(e) => { setOrigen(e.target.value); setProductoId(""); }}>
              {sedes.map((item) => (
                <option key={item.id} value={item.id}>{item.nombre}</option>
              ))}
            </select>
          </div>
          <div className="flex justify-center pb-3">
            <div className="rounded-full bg-blue-100 p-2">
              <ArrowRightLeft className="h-4 w-4 text-blue-600" />
            </div>
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1.5 block text-sm font-medium text-gray-700">Sede destino</label>
            <select className={inputClass} value={destino} onChange={(e) => setDestino(e.target.value)}>
              {todasLasSedes.filter((s) => s.id !== origen).map((item) => (
                <option key={item.id} value={item.id}>{item.nombre}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">Producto (stock en origen)</label>
          <select className={inputClass} value={productoId} onChange={(e) => setProductoId(e.target.value)}>
            <option value="">Selecciona un producto...</option>
            {items.map((p) => (
              <option key={p.productoId} value={p.productoId}>
                {p.producto} ({p.stock} {p.unidad})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">Cantidad</label>
          <input type="number" min={1} max={actual?.stock} value={cantidad} onChange={(e) => setCantidad(Number(e.target.value))} className={inputClass} />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">Observaciones</label>
          <textarea rows={2} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Motivo del traspaso (opcional)" className={inputClass} />
        </div>
      </div>
    </Modal>
  );
}
