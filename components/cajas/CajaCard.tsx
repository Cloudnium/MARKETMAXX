"use client";

import {
  ArrowDownCircle,
  ArrowUpCircle,
  Calendar,
  FileBarChart,
  Lock,
  Unlock,
  Wallet,
} from "lucide-react";
import { useAuth } from "@/components/shared/AuthProvider";
import { Badge } from "@/components/ui/Badge";
import type { Caja } from "@/lib/types";
import { formatCurrency, formatDateTime } from "@/lib/utils";

export function CajaCard({
  caja,
  onReporte,
  onEgresos,
  onCerrar,
  onAbrir,
}: {
  caja: Caja;
  onReporte: (caja: Caja) => void;
  onEgresos: (caja: Caja) => void;
  onCerrar: (caja: Caja) => void;
  onAbrir: (caja: Caja) => void;
}) {
  const { can } = useAuth();
  const abierta = caja.estado === "abierta";

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:shadow-md">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div
            className={`rounded-lg p-2.5 ${
              abierta ? "bg-green-100" : "bg-gray-100"
            }`}
          >
            <Wallet
              className={`h-5 w-5 ${
                abierta ? "text-green-600" : "text-gray-500"
              }`}
            />
          </div>
          <div>
            <p className="font-bold text-gray-900">{caja.nombre}</p>
            <p className="text-xs text-gray-500">{caja.tienda}</p>
          </div>
        </div>
        <Badge variant={caja.estado} />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="flex items-center justify-center gap-1 text-xs text-gray-500">
            <ArrowUpCircle className="h-3.5 w-3.5 text-green-500" /> Ingresos
          </p>
          <p className="text-sm font-semibold text-gray-900">
            {formatCurrency(caja.ingresos)}
          </p>
        </div>
        <div>
          <p className="flex items-center justify-center gap-1 text-xs text-gray-500">
            <ArrowDownCircle className="h-3.5 w-3.5 text-red-500" /> Egresos
          </p>
          <p className="text-sm font-semibold text-gray-900">
            {formatCurrency(caja.egresos)}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Ventas</p>
          <p className="text-sm font-semibold text-gray-900">{caja.ventas}</p>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-1.5 text-xs text-gray-400">
        <Calendar className="h-3.5 w-3.5" />
        {caja.fechaApertura ? `${formatDateTime(caja.fechaApertura)} · ${caja.usuario}` : "Sin turnos todavía"}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          onClick={() => onReporte(caja)}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-300 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
        >
          <FileBarChart className="h-3.5 w-3.5" /> Reporte
        </button>
        {can("cajas.egresos") && <button
          onClick={() => onEgresos(caja)}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-300 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
        >
          <ArrowDownCircle className="h-3.5 w-3.5" /> Egresos
        </button>}
        {abierta ? (
          can("cajas.cerrar") && <button
            onClick={() => onCerrar(caja)}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-red-600 py-2 text-xs font-semibold text-white hover:bg-red-700"
          >
            <Lock className="h-3.5 w-3.5" /> Cerrar
          </button>
        ) : (
          can("cajas.abrir") && <button
            onClick={() => onAbrir(caja)}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-green-600 py-2 text-xs font-semibold text-white hover:bg-green-700"
          >
            <Unlock className="h-3.5 w-3.5" /> Abrir
          </button>
        )}
      </div>
    </div>
  );
}
