"use client";

import { CalendarDays } from "lucide-react";
import { hoyLima, presetsFecha, rangoPreset } from "@/lib/fechas";

export interface RangoFechas {
  desde: string; // YYYY-MM-DD
  hasta: string;
}

const inputClass =
  "rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100";

/** Filtros por día o por rango: atajos (hoy, ayer, 7 días...) y fechas desde / hasta. */
export function FiltroFechas({
  valor,
  onChange,
}: {
  valor: RangoFechas;
  onChange: (r: RangoFechas) => void;
}) {
  const hoy = hoyLima();
  const activo = presetsFecha.find((p) => {
    const r = rangoPreset(p.value);
    return r.desde === valor.desde && r.hasta === valor.hasta;
  })?.value;

  const cambiarDesde = (desde: string) => {
    if (!desde) return;
    onChange({ desde, hasta: valor.hasta < desde ? desde : valor.hasta });
  };
  const cambiarHasta = (hasta: string) => {
    if (!hasta) return;
    onChange({ desde: valor.desde > hasta ? hasta : valor.desde, hasta });
  };

  return (
    <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
      <div className="flex flex-wrap gap-1.5">
        {presetsFecha.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => onChange(rangoPreset(p.value))}
            className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
              activo === p.value
                ? "bg-blue-600 text-white"
                : "border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <CalendarDays className="h-4 w-4 text-gray-400" />
        <label className="sr-only" htmlFor="fecha-desde">Desde</label>
        <input id="fecha-desde" type="date" max={hoy} value={valor.desde} onChange={(e) => cambiarDesde(e.target.value)} className={inputClass} />
        <span>al</span>
        <label className="sr-only" htmlFor="fecha-hasta">Hasta</label>
        <input id="fecha-hasta" type="date" max={hoy} value={valor.hasta} onChange={(e) => cambiarHasta(e.target.value)} className={inputClass} />
      </div>
    </div>
  );
}
