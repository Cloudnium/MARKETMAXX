"use client";

import { Calendar, Filter, RotateCcw } from "lucide-react";
import { SelectConBuscador } from "@/components/ui/SelectConBuscador";
import { useSede } from "@/components/shared/SedeProvider";
import { useEffect, useRef, useState } from "react";
import { CATEGORIAS_EGRESO } from "@/lib/data/egresos";

export interface FiltrosReporte {
  desde: string;
  hasta: string;
  /** UUID de sede, o null = todas las sedes del usuario */
  sedeId: string | null;
  /** factura | boleta | nota_venta | null */
  tipo: string | null;
  /** ventas | egresos */
  reporte: "ventas" | "egresos";
  /** Solo en el reporte de egresos: categoría o null = todas. */
  categoria: string | null;
}

const hoy = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Lima" });
const hace = (dias: number) => {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return d.toLocaleDateString("en-CA", { timeZone: "America/Lima" });
};

export const filtrosIniciales = (sedeId: string | null): FiltrosReporte => ({
  desde: hace(29),
  hasta: hoy(),
  sedeId,
  tipo: null,
  reporte: "ventas",
  categoria: null,
});

const tipos: Record<string, string | null> = {
  "Todos los comprobantes": null,
  Factura: "factura",
  Boleta: "boleta",
  "Nota de Venta": "nota_venta",
};

export function ReportesFiltros({ onApply }: { onApply: (f: FiltrosReporte) => void }) {
  const { sedes, sedesConTodas, filtro, sede } = useSede();
  const [desde, setDesde] = useState(hace(29));
  const [hasta, setHasta] = useState(hoy());
  const [tienda, setTienda] = useState(sede.nombre);
  const [tipo, setTipo] = useState("Todos los comprobantes");
  const [reporte, setReporte] = useState<"ventas" | "egresos">("ventas");
  const [categoria, setCategoria] = useState("Todas las categorías");

  // sigue a la sede activa del selector superior
  useEffect(() => setTienda(sede.nombre), [sede.nombre]);

  const sedeIdSeleccionada = () => {
    const encontrada = sedesConTodas.find((s) => s.nombre === tienda);
    return encontrada && encontrada.id !== "todas" ? encontrada.id : null;
  };

  // Los filtros se aplican solos al cambiar cualquier valor (sin botón "Aplicar")
  const primera = useRef(true);
  useEffect(() => {
    if (primera.current) {
      primera.current = false;
      return;
    }
    if (!desde || !hasta || desde > hasta) return;
    onApply({
      desde,
      hasta,
      sedeId: sedeIdSeleccionada(),
      tipo: tipos[tipo],
      reporte,
      categoria: categoria === "Todas las categorías" ? null : categoria,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desde, hasta, tienda, tipo, reporte, categoria]);
  const reset = () => {
    setDesde(hace(29));
    setHasta(hoy());
    setTienda(sede.nombre);
    setTipo("Todos los comprobantes");
    setReporte("ventas");
    setCategoria("Todas las categorías");
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex items-center gap-2">
        <div className="rounded-lg bg-blue-100 p-2">
          <Filter className="h-4 w-4 text-blue-600" />
        </div>
        <h2 className="text-sm font-bold text-gray-900">Filtros del reporte</h2>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-gray-600">Tipo de reporte</label>
          <select
            value={reporte}
            onChange={(e) => setReporte(e.target.value as "ventas" | "egresos")}
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
          >
            <option value="ventas">Ventas</option>
            <option value="egresos">Egresos</option>
          </select>
        </div>
        <div>
          <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-gray-600">
            <Calendar className="h-3.5 w-3.5" /> Desde
          </label>
          <input
            type="date"
            value={desde}
            onChange={(e) => e.target.value && setDesde(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-gray-600">
            <Calendar className="h-3.5 w-3.5" /> Hasta
          </label>
          <input
            type="date"
            value={hasta}
            onChange={(e) => e.target.value && setHasta(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>
        <SelectConBuscador
          label="Sede"
          value={tienda}
          onChange={setTienda}
          options={sedesConTodas.length ? sedesConTodas.map((s) => s.nombre) : sedes.map((s) => s.nombre)}
        />
        {reporte === "ventas" ? (
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-600">Comprobante</label>
            <select
              value={tipo}
              onChange={(e) => setTipo(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
            >
              {Object.keys(tipos).map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
        ) : (
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-600">Categoría</label>
            <select
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
            >
              {["Todas las categorías", ...CATEGORIAS_EGRESO].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
        )}
        <div className="flex items-end gap-2">
          <button onClick={reset} className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-gray-300 px-3 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50" title="Restablecer filtros">
            <RotateCcw className="h-4 w-4" /> Restablecer
          </button>
        </div>
      </div>
    </div>
  );
}
