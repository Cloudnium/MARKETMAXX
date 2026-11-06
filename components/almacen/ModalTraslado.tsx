"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, Loader2, Plus, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useSede } from "@/components/shared/SedeProvider";
import { useAsync } from "@/lib/hooks/useAsync";
import {
  enviarASede,
  listarSedesDestino,
  listarStock,
  listarStockAlmacen,
  moverAlmacenTienda,
} from "@/lib/data/almacen";
import type { StockItem } from "@/lib/types";

export type ModoTraslado = "a_tienda" | "a_almacen" | "a_sede";

const inputClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100";

const modos: { value: ModoTraslado; label: string; ayuda: string }[] = [
  { value: "a_tienda", label: "Almacén → Tienda", ayuda: "Pasa productos del almacén a la tienda de esta sede para venderlos." },
  { value: "a_sede", label: "Enviar a otra sede", ayuda: "Del almacén de esta sede al almacén de otra sede. Si allá no existe el producto, se crea." },
  { value: "a_almacen", label: "Tienda → Almacén", ayuda: "Devuelve productos de la tienda al almacén de esta sede." },
];

interface Linea {
  productoId: string;
  cantidad: string;
}

export function ModalTraslado({
  open,
  modoInicial,
  modosPermitidos,
  productoInicial,
  onClose,
  onDone,
}: {
  open: boolean;
  modoInicial: ModoTraslado;
  /** Modos que se pueden elegir (si es uno solo no se muestran pestañas). */
  modosPermitidos: ModoTraslado[];
  productoInicial?: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { sedeOperativa, sedes } = useSede();
  const [modo, setModo] = useState<ModoTraslado>(modoInicial);
  const [sedeId, setSedeId] = useState("");
  const [destino, setDestino] = useState("");
  const [lineas, setLineas] = useState<Linea[]>([{ productoId: "", cantidad: "1" }]);
  const [obs, setObs] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const destinos = useAsync(() => (open ? listarSedesDestino() : Promise.resolve([])), [open], []);
  const otrasSedes = useMemo(() => (destinos.data ?? []).filter((s) => s.id !== sedeId), [destinos.data, sedeId]);

  // Qué stock se puede mover según el sentido del traslado
  const stock = useAsync<StockItem[]>(
    async () => {
      if (!open || !sedeId) return [];
      return modo === "a_almacen" ? listarStock(sedeId) : listarStockAlmacen(sedeId);
    },
    [open, sedeId, modo],
    []
  );
  const disponibles = useMemo(() => (stock.data ?? []).filter((i) => i.stock > 0), [stock.data]);

  useEffect(() => {
    if (!open) return;
    setModo(modoInicial);
    setSedeId(sedeOperativa?.id ?? sedes[0]?.id ?? "");
    setLineas([{ productoId: productoInicial ?? "", cantidad: "1" }]);
    setObs("");
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (modo === "a_sede" && (!destino || destino === sedeId)) setDestino(otrasSedes[0]?.id ?? "");
  }, [modo, sedeId, otrasSedes, destino]);

  const cambiarModo = (m: ModoTraslado) => {
    setModo(m);
    setLineas([{ productoId: "", cantidad: "1" }]);
    setError(null);
  };

  const actualizar = (i: number, cambios: Partial<Linea>) =>
    setLineas((prev) => prev.map((l, j) => (j === i ? { ...l, ...cambios } : l)));

  const guardar = async () => {
    setError(null);
    const items = lineas.filter((l) => l.productoId).map((l) => ({ productoId: l.productoId, cantidad: Number(l.cantidad) }));
    if (items.length === 0) return setError("Selecciona al menos un producto.");
    const repetidos = new Set(items.map((i) => i.productoId));
    if (repetidos.size !== items.length) return setError("Hay productos repetidos: une las cantidades en una sola línea.");
    for (const it of items) {
      const prod = disponibles.find((d) => d.productoId === it.productoId);
      if (!(it.cantidad > 0)) return setError("Todas las cantidades deben ser mayores a cero.");
      if (prod && it.cantidad > prod.stock)
        return setError(`"${prod.producto}": solo hay ${prod.stock} disponibles para mover.`);
    }
    if (modo === "a_sede" && !destino) return setError("Elige la sede de destino.");
    setGuardando(true);
    try {
      if (modo === "a_sede") await enviarASede(sedeId, destino, items, obs);
      else await moverAlmacenTienda(sedeId, modo, items, obs);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  };

  const modoActual = modos.find((m) => m.value === modo)!;
  const opcionesModo = modos.filter((m) => modosPermitidos.includes(m.value));
  const soloSede = modosPermitidos.length === 1 && modosPermitidos[0] === "a_sede";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={soloSede ? "Enviar a otra sede" : "Traslado Tienda ⇄ Almacén"}
      subtitle={soloSede ? "Del almacén de una sede al almacén de otra; queda registrado en el historial" : "Mueve productos entre el almacén y la tienda de la misma sede"}
      size="xl"
      footer={
        <>
          <button onClick={onClose} className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50">
            Cancelar
          </button>
          <button
            onClick={guardar}
            disabled={guardando || !sedeId}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {guardando && <Loader2 className="h-4 w-4 animate-spin" />} Registrar traslado
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        {opcionesModo.length > 1 && <div className="flex flex-wrap gap-1.5">
          {opcionesModo.map((m) => (
            <button
              key={m.value}
              onClick={() => cambiarModo(m.value)}
              className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                modo === m.value ? "bg-blue-600 text-white" : "border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>}
        <p className="text-sm text-gray-500">{modoActual.ayuda}</p>

        <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-5">
          <div className={modo === "a_sede" ? "sm:col-span-2" : "sm:col-span-5"}>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              {modo === "a_sede" ? "Sede origen" : "Sede"}
            </label>
            <select
              className={inputClass}
              value={sedeId}
              onChange={(e) => {
                setSedeId(e.target.value);
                setLineas([{ productoId: "", cantidad: "1" }]);
              }}
            >
              {sedes.map((s) => (
                <option key={s.id} value={s.id}>{s.nombre}</option>
              ))}
            </select>
          </div>
          {modo === "a_sede" && (
            <>
              <div className="flex justify-center pb-3">
                <div className="rounded-full bg-blue-100 p-2">
                  <ArrowRightLeft className="h-4 w-4 text-blue-600" />
                </div>
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Sede destino</label>
                <select className={inputClass} value={destino} onChange={(e) => setDestino(e.target.value)}>
                  {otrasSedes.map((s) => (
                    <option key={s.id} value={s.id}>{s.nombre}</option>
                  ))}
                </select>
              </div>
            </>
          )}
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">
            Productos ({modo === "a_almacen" ? "stock en tienda" : "stock en almacén"})
          </label>
          {lineas.map((l, i) => {
            const prod = disponibles.find((d) => d.productoId === l.productoId);
            return (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)_6rem_2.25rem] items-center gap-2">
                <select className={inputClass} value={l.productoId} onChange={(e) => actualizar(i, { productoId: e.target.value })}>
                  <option value="">{stock.loading ? "Cargando..." : disponibles.length ? "Selecciona un producto..." : "No hay productos con stock"}</option>
                  {disponibles.map((p) => (
                    <option key={p.productoId} value={p.productoId}>
                      {p.producto} ({p.stock} {p.unidad})
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={1}
                  max={prod?.stock}
                  value={l.cantidad}
                  onChange={(e) => actualizar(i, { cantidad: e.target.value })}
                  className={inputClass}
                  aria-label="Cantidad"
                />
                <button
                  onClick={() => setLineas((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : prev))}
                  disabled={lineas.length === 1}
                  className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                  aria-label="Quitar producto"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            );
          })}
          <button
            onClick={() => setLineas((prev) => [...prev, { productoId: "", cantidad: "1" }])}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:text-blue-700"
          >
            <Plus className="h-4 w-4" /> Agregar otro producto
          </button>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">Observaciones</label>
          <textarea rows={2} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Motivo del traslado (opcional)" className={inputClass} />
        </div>
      </div>
    </Modal>
  );
}
