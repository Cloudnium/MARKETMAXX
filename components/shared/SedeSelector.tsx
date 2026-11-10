"use client";

import { Check, ChevronDown, Layers, MapPin, Store } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { TODAS_LAS_SEDES } from "@/lib/sede-utils";
import { useSede } from "./SedeProvider";

/** Selector de sede del encabezado: botón con menú propio (en lugar del desplegable nativo del navegador). */
export function SedeSelector() {
  const { sedeId, sedesConTodas, setSedeId } = useSede();
  const [abierto, setAbierto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);

  const actual = sedesConTodas.find((s) => s.id === sedeId) ?? sedesConTodas[0];
  const hayQueElegir = sedesConTodas.length > 1;

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent | TouchEvent) => {
      if (raiz.current && !raiz.current.contains(e.target as Node)) setAbierto(false);
    };
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && setAbierto(false);
    document.addEventListener("mousedown", fuera);
    document.addEventListener("touchstart", fuera);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("touchstart", fuera);
      document.removeEventListener("keydown", tecla);
    };
  }, [abierto]);

  const pildora = "flex items-center gap-2 rounded-xl bg-white/15 px-3 py-2 text-sm font-semibold text-white ring-1 ring-white/10";

  if (!actual) return null;
  if (!hayQueElegir)
    return (
      <div className={pildora} aria-label="Sede activa">
        <MapPin className="h-4 w-4 shrink-0 text-white/70" />
        <span className="max-w-[130px] truncate sm:max-w-none">{actual.nombre}</span>
      </div>
    );

  return (
    <div ref={raiz} className="relative">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className={cn(pildora, "transition-colors hover:bg-white/25", abierto && "bg-white/25")}
        aria-haspopup="listbox"
        aria-expanded={abierto}
        aria-label="Sede activa"
      >
        <MapPin className="h-4 w-4 shrink-0 text-white/70" />
        <span className="max-w-[110px] truncate sm:max-w-[200px]">{actual.nombre}</span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-white/70 transition-transform", abierto && "rotate-180")} />
      </button>

      {abierto && (
        <div
          role="listbox"
          aria-label="Elegir sede"
          className="absolute right-0 top-full z-[95] mt-3 w-64 max-w-[calc(100vw-2rem)] rounded-xl border border-gray-200 bg-white p-1.5 text-sm text-gray-900 shadow-2xl"
        >
          <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Sede</p>
          {sedesConTodas.map((sede) => {
            const activa = sede.id === actual.id;
            const esTodas = sede.id === TODAS_LAS_SEDES;
            const Icono = esTodas ? Layers : Store;
            const detalle = "ciudad" in sede && sede.ciudad ? sede.ciudad : "direccion" in sede && sede.direccion ? sede.direccion : "";
            return (
              <button
                key={sede.id}
                type="button"
                role="option"
                aria-selected={activa}
                onClick={() => {
                  setAbierto(false);
                  if (!activa) setSedeId(sede.id);
                }}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors",
                  activa ? "bg-brand/5" : "hover:bg-gray-50"
                )}
              >
                <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", activa ? "bg-brand/10 text-brand" : "bg-gray-100 text-gray-500")}>
                  <Icono className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate font-semibold", activa ? "text-brand-dark" : "text-gray-900")}>{sede.nombre}</span>
                  {detalle && <span className="block truncate text-xs text-gray-500">{detalle}</span>}
                </span>
                {activa && <Check className="h-4 w-4 shrink-0 text-brand" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
