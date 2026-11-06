"use client";

import { Clock, Download, Eye, Lock, Receipt, User, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import type { SesionCaja } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";
import { fmtHora } from "@/lib/fechas";

/** Tarjeta de un turno de caja (como "Cajas del Día"). */
export function SesionCard({
  sesion,
  mostrarSede,
  onDetalle,
  onTicket,
  onDescargar,
  onCerrar,
  ocupado,
}: {
  sesion: SesionCaja;
  mostrarSede: boolean;
  onDetalle: () => void;
  onTicket: () => void;
  onDescargar: () => void;
  onCerrar?: () => void;
  ocupado?: boolean;
}) {
  const abierta = sesion.estado === "abierta";
  const btn =
    "inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-300 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60";
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:shadow-md">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className={`rounded-lg p-2.5 ${abierta ? "bg-green-100" : "bg-gray-100"}`}>
            <Wallet className={`h-5 w-5 ${abierta ? "text-green-600" : "text-gray-500"}`} />
          </div>
          <div>
            <p className="font-bold text-gray-900">{sesion.caja}</p>
            <p className="flex items-center gap-1 text-xs text-gray-500">
              <User className="h-3 w-3" /> {sesion.usuario}
              {mostrarSede && <span> · {sesion.sede}</span>}
            </p>
          </div>
        </div>
        <Badge variant={sesion.estado} />
      </div>

      <div className="mt-4">
        <p className="text-xs text-gray-500">Ingresos del turno</p>
        <p className="text-2xl font-bold text-gray-900">{formatCurrency(sesion.ingresos)}</p>
        <p className="mt-0.5 text-xs text-gray-400">
          {sesion.ventas} venta{sesion.ventas === 1 ? "" : "s"} · egresos {formatCurrency(sesion.egresos)}
        </p>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-500">
        <div className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5 text-green-500" /> Apertura {fmtHora(sesion.fechaApertura)}
        </div>
        <div className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5 text-red-400" /> Cierre {sesion.fechaCierre ? fmtHora(sesion.fechaCierre) : "—"}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button onClick={onDetalle} className={btn}>
          <Eye className="h-3.5 w-3.5" /> Ver detalle
        </button>
        <button onClick={onTicket} disabled={ocupado} className={btn}>
          <Receipt className="h-3.5 w-3.5" /> Ticket
        </button>
        <button onClick={onDescargar} disabled={ocupado} className={btn}>
          <Download className="h-3.5 w-3.5" /> Descargar
        </button>
        {abierta && onCerrar && (
          <button
            onClick={onCerrar}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-red-600 py-2 text-xs font-semibold text-white hover:bg-red-700"
          >
            <Lock className="h-3.5 w-3.5" /> Cerrar caja
          </button>
        )}
      </div>
    </div>
  );
}
