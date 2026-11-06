"use client";

import { useMemo, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowRightLeft,
  ArrowUpFromLine,
  Search,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useAsync } from "@/lib/hooks/useAsync";
import { listarMovimientos, operacionLabel } from "@/lib/data/almacen";
import type { TipoMovimiento } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";
import { useSede } from "@/components/shared/SedeProvider";

const tipoConfig: Record<
  TipoMovimiento,
  { label: string; icon: LucideIcon; className: string }
> = {
  entrada: {
    label: "Entrada",
    icon: ArrowDownToLine,
    className: "bg-green-100 text-green-700",
  },
  salida: {
    label: "Salida",
    icon: ArrowUpFromLine,
    className: "bg-red-100 text-red-700",
  },
  traspaso: {
    label: "Traspaso",
    icon: ArrowRightLeft,
    className: "bg-blue-100 text-blue-700",
  },
  ajuste: {
    label: "Ajuste",
    icon: SlidersHorizontal,
    className: "bg-amber-100 text-amber-700",
  },
};

const filtros: { value: "todos" | TipoMovimiento; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "entrada", label: "Entradas" },
  { value: "salida", label: "Salidas" },
  { value: "traspaso", label: "Traspasos" },
  { value: "ajuste", label: "Ajustes" },
];

const totalesIniciales: Record<TipoMovimiento, number> = {
  entrada: 0,
  salida: 0,
  traspaso: 0,
  ajuste: 0,
};

interface HistorialMovimientosModalProps {
  open: boolean;
  onClose: () => void;
}

export function HistorialMovimientosModal({
  open,
  onClose,
}: HistorialMovimientosModalProps) {
  const { filtro, sede } = useSede();
  const [query, setQuery] = useState("");
  const [tipo, setTipo] = useState<"todos" | TipoMovimiento>("todos");

  const mov = useAsync(
    () => (open ? listarMovimientos(filtro) : Promise.resolve([])),
    [open, filtro],
    []
  );
  const movimientosSede = useMemo(() => mov.data ?? [], [mov.data]);

  const totales = useMemo(
    () =>
      movimientosSede.reduce<Record<TipoMovimiento, number>>(
        (acc, movimiento) => {
          acc[movimiento.tipo] += 1;
          return acc;
        },
        { ...totalesIniciales }
      ),
    [movimientosSede]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return movimientosSede
      .filter((movimiento) => tipo === "todos" || movimiento.tipo === tipo)
      .filter(
        (movimiento) =>
          !q ||
          movimiento.producto.toLowerCase().includes(q) ||
          movimiento.referencia.toLowerCase().includes(q) ||
          movimiento.usuario.toLowerCase().includes(q) ||
          movimiento.origen.toLowerCase().includes(q) ||
          movimiento.destino.toLowerCase().includes(q)
      )
      .sort((a, b) => b.fecha.localeCompare(a.fecha));
  }, [movimientosSede, query, tipo]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Historial de movimientos"
      subtitle={`Entradas, salidas, traspasos y ajustes · ${sede.nombre}`}
      size="2xl"
      footer={
        <button
          onClick={onClose}
          className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700"
        >
          Cerrar
        </button>
      }
    >
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(Object.keys(tipoConfig) as TipoMovimiento[]).map((key) => {
          const config = tipoConfig[key];
          const Icon = config.icon;
          return (
            <div
              key={key}
              className="rounded-xl border border-gray-200 bg-white p-3"
            >
              <div className="flex items-center gap-2">
                <span className={`rounded-md p-1 ${config.className}`}>
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {config.label}
                </span>
              </div>
              <p className="mt-1 text-xl font-bold text-gray-900">
                {totales[key]}
              </p>
            </div>
          );
        })}
      </div>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar producto, referencia o usuario..."
            className="w-full rounded-lg border border-gray-300 py-2.5 pl-10 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {filtros.map((filtro) => (
            <button
              key={filtro.value}
              onClick={() => setTipo(filtro.value)}
              className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                tipo === filtro.value
                  ? "bg-blue-600 text-white"
                  : "border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              {filtro.label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200">
        <div className="max-h-[45vh] overflow-y-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 z-10 bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Fecha</th>
                <th className="px-4 py-3 font-semibold">Tipo</th>
                <th className="px-4 py-3 font-semibold">Producto / Motivo</th>
                <th className="px-4 py-3 text-center font-semibold">
                  Cantidad
                </th>
                <th className="px-4 py-3 font-semibold">Origen → Destino</th>
                <th className="px-4 py-3 font-semibold">Usuario</th>
                <th className="px-4 py-3 font-semibold">Referencia</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((movimiento) => {
                const config = tipoConfig[movimiento.tipo];
                const Icon = config.icon;
                return (
                  <tr
                    key={movimiento.id}
                    className="hover:bg-gray-50/70"
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-gray-500">
                      {formatDateTime(movimiento.fecha)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${config.className}`}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {config.label}
                      </span>
                      <p className="mt-0.5 text-[11px] text-gray-400">
                        {operacionLabel[movimiento.operacion] ?? movimiento.operacion}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-gray-900">
                        {movimiento.producto}
                      </p>
                      {movimiento.nota && (
                        <p className="text-xs text-gray-500">
                          {movimiento.nota}
                        </p>
                      )}
                    </td>
                    <td
                      className={`px-4 py-3 text-center font-semibold ${
                        movimiento.cantidad < 0
                          ? "text-red-600"
                          : "text-gray-900"
                      }`}
                    >
                      {movimiento.cantidad > 0 ? "+" : ""}
                      {movimiento.cantidad} {movimiento.unidad}
                      <p className="text-[11px] font-normal text-gray-400">
                        {movimiento.stockAntes} → {movimiento.stockDespues}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      <span className="inline-flex items-center gap-1.5">
                        {movimiento.origen}
                        <ArrowRight className="h-3.5 w-3.5 text-gray-400" />
                        {movimiento.destino}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {movimiento.usuario}
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-md bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-600">
                        {movimiento.referencia}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-10 text-center text-gray-500"
                  >
                    {mov.loading ? "Cargando..." : "No se encontraron movimientos."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}
