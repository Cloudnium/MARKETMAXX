"use client";

import { MapPin } from "lucide-react";
import { useSede } from "./SedeProvider";

export function SedeSelector() {
  const { sedeId, sedesConTodas, setSedeId } = useSede();

  return (
    <div className="flex items-center gap-2 rounded-xl bg-white/15 px-2.5 py-2 ring-1 ring-white/10">
      <MapPin className="h-4 w-4 shrink-0 text-white/70" />
      <select
        value={sedeId}
        onChange={(event) => setSedeId(event.target.value)}
        className="max-w-[130px] bg-transparent text-sm font-semibold text-white focus:outline-none sm:max-w-none [&>option]:text-gray-900"
        aria-label="Sede activa"
      >
        {sedesConTodas.map((sede) => (
          <option key={sede.id} value={sede.id}>
            {sede.nombre}
          </option>
        ))}
      </select>
    </div>
  );
}
