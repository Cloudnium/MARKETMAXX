"use client";

import { Banknote, CreditCard, Download, Landmark, Loader2, Plus, Receipt, Smartphone } from "lucide-react";
import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useAsync } from "@/lib/hooks/useAsync";
import { datosSesion } from "@/lib/data/cajas";
import { resumenCaja } from "@/lib/export/resumenCaja";
import type { SesionCaja } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";
import { fmtFechaLarga, fmtHora } from "@/lib/fechas";

const iconos: Record<string, typeof Banknote> = {
  Efectivo: Banknote,
  Yape: Smartphone,
  Tarjeta: CreditCard,
  Transferencia: Landmark,
};

/** "Ver detalle": cuánto va en efectivo y en tarjetas/yape/transferencia, y los movimientos del turno. */
export function DetalleCajaModal({
  sesion,
  open,
  onClose,
  onTicket,
  onDescargar,
  onEgreso,
}: {
  sesion: SesionCaja | null;
  open: boolean;
  onClose: () => void;
  onTicket: () => Promise<void>;
  onDescargar: () => Promise<void>;
  onEgreso?: () => void;
}) {
  const datos = useAsync(
    () => (open && sesion ? datosSesion(sesion.id) : Promise.resolve({ ventas: [], egresos: [] })),
    [open, sesion?.id],
    { ventas: [], egresos: [] }
  );
  const [accion, setAccion] = useState<"ticket" | "pdf" | null>(null);
  if (!sesion) return null;
  const { ventas, egresos } = datos.data ?? { ventas: [], egresos: [] };
  const r = resumenCaja(sesion, ventas, egresos);
  const correr = async (tipo: "ticket" | "pdf", fn: () => Promise<void>) => {
    setAccion(tipo);
    try {
      await fn();
    } catch (e) {
      window.alert((e as Error).message);
    } finally {
      setAccion(null);
    }
  };
  const btn =
    "inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Detalle de ${sesion.caja}`}
      subtitle={`${sesion.sede} · ${sesion.usuario} · ${fmtFechaLarga(sesion.fechaApertura)} ${fmtHora(sesion.fechaApertura)}${sesion.fechaCierre ? ` → ${fmtHora(sesion.fechaCierre)}` : ""}`}
      size="xl"
      footer={
        <>
          <button onClick={onClose} className={btn}>Cerrar</button>
          <button onClick={() => correr("ticket", onTicket)} disabled={!!accion || datos.loading} className={btn}>
            {accion === "ticket" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Receipt className="h-4 w-4" />} Ticket
          </button>
          <button
            onClick={() => correr("pdf", onDescargar)}
            disabled={!!accion || datos.loading}
            className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
          >
            {accion === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Descargar
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {r.metodos.map((m) => {
            const Icon = iconos[m.metodo] ?? CreditCard;
            return (
              <div key={m.metodo} className="rounded-xl border border-gray-200 p-3">
                <p className="flex items-center gap-1.5 text-xs font-semibold uppercase text-gray-500">
                  <Icon className="h-3.5 w-3.5" /> {m.metodo}
                </p>
                <p className="mt-1 text-lg font-bold text-gray-900">{formatCurrency(m.total)}</p>
                <p className="text-xs text-gray-400">{m.ventas} venta{m.ventas === 1 ? "" : "s"}</p>
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-emerald-50 p-3">
            <p className="text-xs text-emerald-700">En efectivo</p>
            <p className="text-lg font-bold text-emerald-700">{formatCurrency(r.efectivo)}</p>
          </div>
          <div className="rounded-xl bg-blue-50 p-3">
            <p className="text-xs text-blue-700">Tarjetas / Yape / Transferencia</p>
            <p className="text-lg font-bold text-blue-700">{formatCurrency(r.digital)}</p>
          </div>
          <div className="rounded-xl bg-red-50 p-3">
            <p className="text-xs text-red-700">Egresos</p>
            <p className="text-lg font-bold text-red-700">- {formatCurrency(r.egresos)}</p>
          </div>
        </div>

        <div className="space-y-2 rounded-xl border border-gray-200 p-4 text-sm">
          <div className="flex justify-between"><span className="text-gray-500">Apertura</span><span className="font-semibold">{formatCurrency(sesion.montoApertura)}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Total ingresos</span><span className="font-semibold text-green-600">{formatCurrency(r.totalIngresos)}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Neto (ingresos − egresos)</span><span className="font-semibold">{formatCurrency(r.neto)}</span></div>
          {r.anuladas > 0 && <div className="flex justify-between"><span className="text-gray-500">Anulado ({r.anuladas})</span><span className="font-semibold text-red-600">{formatCurrency(r.anulado)}</span></div>}
          <div className="flex justify-between border-t border-dashed border-gray-200 pt-2">
            <span className="font-bold text-gray-900">Efectivo a entregar</span>
            <span className="text-lg font-bold text-green-600">{formatCurrency(r.efectivoEntregar)}</span>
          </div>
          {sesion.montoContado !== null && (
            <div className="flex justify-between text-xs text-gray-500">
              <span>Contado al cierre: {formatCurrency(sesion.montoContado)}</span>
              <span>Diferencia: {formatCurrency(sesion.diferencia ?? 0)}</span>
            </div>
          )}
        </div>

        <div>
          <p className="mb-2 text-sm font-semibold text-gray-700">Ventas ({ventas.length})</p>
          <div className="max-h-64 overflow-auto rounded-lg border border-gray-200">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-gray-50 uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2">Fecha y hora</th>
                  <th className="px-3 py-2">Comprobante</th>
                  <th className="px-3 py-2">Productos</th>
                  <th className="px-3 py-2 text-center">Cant.</th>
                  <th className="px-3 py-2">Método</th>
                  <th className="px-3 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {datos.loading && <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-400">Cargando…</td></tr>}
                {ventas.map((v) => (
                  <tr key={v.id} className={v.estado === "anulado" ? "bg-red-50/50 text-gray-400 line-through" : ""}>
                    <td className="whitespace-nowrap px-3 py-2">{fmtFechaLarga(v.fecha)} {fmtHora(v.fecha)}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-semibold">{v.numero}</td>
                    <td className="px-3 py-2">{v.items.map((i) => `${i.cantidad} × ${i.producto} (${i.precio.toFixed(2)})`).join(", ")}</td>
                    <td className="px-3 py-2 text-center">{v.items.reduce((a, i) => a + i.cantidad, 0)}</td>
                    <td className="px-3 py-2">{v.metodoPago}</td>
                    <td className="px-3 py-2 text-right font-semibold">{formatCurrency(v.total)}</td>
                  </tr>
                ))}
                {!datos.loading && ventas.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-400">Sin ventas en este turno.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-700">Egresos ({egresos.length})</p>
            {sesion.estado === "abierta" && onEgreso && (
              <button onClick={onEgreso} className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700">
                <Plus className="h-3.5 w-3.5" /> Registrar egreso
              </button>
            )}
          </div>
          <div className="overflow-hidden rounded-lg border border-gray-200">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2">Hora</th>
                  <th className="px-3 py-2">Categoría</th>
                  <th className="px-3 py-2">Concepto</th>
                  <th className="px-3 py-2 text-right">Monto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {egresos.map((e) => (
                  <tr key={e.id}>
                    <td className="px-3 py-2">{fmtHora(e.fecha)}</td>
                    <td className="px-3 py-2">{e.categoria}</td>
                    <td className="px-3 py-2">{e.concepto}{e.proveedor ? ` · ${e.proveedor}` : ""}</td>
                    <td className="px-3 py-2 text-right font-semibold text-red-600">- {formatCurrency(e.monto)}</td>
                  </tr>
                ))}
                {egresos.length === 0 && <tr><td colSpan={4} className="px-3 py-5 text-center text-gray-400">Sin egresos en este turno.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Modal>
  );
}
