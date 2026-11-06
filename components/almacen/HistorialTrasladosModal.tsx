"use client";

import { useMemo, useState } from "react";
import { ArrowRightLeft, CalendarDays, ClipboardList, LayoutGrid, Search, Store, Warehouse, Truck } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { BotonesExportar } from "@/components/shared/BotonesExportar";
import { useSede } from "@/components/shared/SedeProvider";
import { useAsync } from "@/lib/hooks/useAsync";
import { listarMovimientosBodega } from "@/lib/data/almacen";
import { fmtFechaLarga, fmtHora, hoyLima } from "@/lib/fechas";
import { excelTrasladosAlmacen } from "@/lib/export/excel";
import { pdfTrasladosAlmacen } from "@/lib/export/pdfTraslados";
import type { MovimientoBodega } from "@/lib/types";

type Grupo = "todos" | "a_tienda" | "desde_tienda" | "sedes";

const opciones: { value: Grupo; titulo: string; ayuda: string; icon: typeof Store; color: string; activo: string }[] = [
  { value: "todos", titulo: "Todos", ayuda: "Traslados en todas las direcciones", icon: LayoutGrid, color: "text-emerald-600", activo: "border-emerald-500 bg-emerald-50" },
  { value: "a_tienda", titulo: "Almacén → Tienda", ayuda: "Solo traspasos al punto de venta", icon: Store, color: "text-blue-600", activo: "border-blue-500 bg-blue-50" },
  { value: "desde_tienda", titulo: "Tienda → Almacén", ayuda: "Solo devoluciones a bodega", icon: Warehouse, color: "text-orange-500", activo: "border-orange-500 bg-orange-50" },
  { value: "sedes", titulo: "Entre sedes", ayuda: "Envíos y recepciones de otras sedes", icon: Truck, color: "text-purple-600", activo: "border-purple-500 bg-purple-50" },
];

const esSede = (m: MovimientoBodega) => m.operacion === "envio_sede" || m.operacion === "recepcion_sede";
const esTraslado = (m: MovimientoBodega) => esSede(m) || m.operacion === "a_tienda" || m.operacion === "desde_tienda";
const coincide = (m: MovimientoBodega, g: Grupo) =>
  g === "todos" ? true : g === "sedes" ? esSede(m) : m.operacion === g;

const badge = (m: MovimientoBodega) =>
  m.operacion === "a_tienda" ? "bg-blue-100 text-blue-700"
  : m.operacion === "desde_tienda" ? "bg-orange-100 text-orange-700"
  : esSede(m) ? "bg-purple-100 text-purple-700"
  : "bg-amber-100 text-amber-700";

const campo =
  "rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-pink-500 focus:outline-none focus:ring-2 focus:ring-pink-100";

/** Historial del almacén: traslados a la tienda y a otras sedes. */
export function HistorialTrasladosModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { filtro, sede, isTodas } = useSede();
  const hoy = hoyLima();
  const [grupo, setGrupo] = useState<Grupo>("todos");
  const [form, setForm] = useState({ desde: hoy, hasta: hoy });
  const [rangoAbierto, setRangoAbierto] = useState(false);
  const [aplicado, setAplicado] = useState(form);
  const [query, setQuery] = useState("");
  const [exportando, setExportando] = useState<"excel" | "pdf" | null>(null);
  const [errorExport, setErrorExport] = useState<string | null>(null);

  const mov = useAsync(
    () => (open ? listarMovimientosBodega(filtro, aplicado) : Promise.resolve([])),
    [open, filtro, aplicado.desde, aplicado.hasta],
    []
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (mov.data ?? []).filter(
      (m) => coincide(m, grupo) && (!q || m.producto.toLowerCase().includes(q) || m.codigo.toLowerCase().includes(q))
    );
  }, [mov.data, grupo, query]);

  const buscar = () => {
    const desde = form.desde || hoy;
    setAplicado({ desde, hasta: rangoAbierto && form.hasta >= desde ? form.hasta : desde });
  };

  const exportar = async (formato: "excel" | "pdf") => {
    setErrorExport(null);
    setExportando(formato);
    try {
      const datos = {
        negocio: sede.nombre,
        direccion: isTodas ? undefined : sede.direccion,
        filas: filtered,
        desde: aplicado.desde,
        hasta: aplicado.hasta,
        mostrarSede: isTodas,
      };
      if (formato === "pdf") await pdfTrasladosAlmacen(datos);
      else await excelTrasladosAlmacen(datos);
    } catch (e) {
      setErrorExport(`No se pudo generar el archivo: ${(e as Error).message}`);
    } finally {
      setExportando(null);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={
        <span className="flex items-center gap-3 text-2xl">
          <ClipboardList className="h-6 w-6 text-pink-600" /> Historial de Traslados
        </span>
      }
      subtitle="Registro de movimientos entre tienda, almacén y otras sedes"
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <p className="text-sm text-gray-400">{filtered.length} movimientos encontrados</p>
          <div className="flex items-center gap-3">
            <BotonesExportar
              onClose={onClose}
              onExcel={() => exportar("excel")}
              onPdf={() => exportar("pdf")}
              exportando={exportando}
              deshabilitado={filtered.length === 0 || mov.loading}
            />
          </div>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {opciones.map((o) => {
          const Icon = o.icon;
          const activo = grupo === o.value;
          return (
            <button
              key={o.value}
              onClick={() => setGrupo(o.value)}
              className={`flex items-center gap-3 rounded-2xl border-2 p-3 text-left transition-colors ${activo ? o.activo : "border-gray-200 bg-white hover:bg-gray-50"}`}
            >
              <Icon className={`h-6 w-6 shrink-0 ${o.color}`} />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-gray-900">{o.titulo}</span>
                <span className="block truncate text-xs text-gray-400">{o.ayuda}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <CalendarDays className="h-5 w-5 text-gray-400" />
        <input type="date" max={hoy} value={form.desde} onChange={(e) => setForm({ desde: e.target.value, hasta: form.hasta < e.target.value ? e.target.value : form.hasta })} className={campo} />
        {rangoAbierto && (
          <>
            <span className="text-sm text-gray-500">al</span>
            <input type="date" max={hoy} min={form.desde} value={form.hasta} onChange={(e) => setForm({ ...form, hasta: e.target.value })} className={campo} />
          </>
        )}
        <button
          onClick={() => setRangoAbierto((v) => !v)}
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50"
        >
          {rangoAbierto ? "Un solo día" : "Rango de fechas"}
        </button>
        <button
          onClick={() => {
            setForm({ desde: hoy, hasta: hoy });
            setAplicado({ desde: hoy, hasta: hoy });
          }}
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
        >
          Hoy
        </button>
        <button onClick={buscar} aria-label="Buscar" className="flex h-[42px] w-12 items-center justify-center rounded-xl bg-pink-600 text-white hover:bg-pink-700">
          <Search className="h-5 w-5" />
        </button>
      </div>

      <div className="relative mt-3">
        <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por nombre..."
          className={`${campo} w-full py-3 pl-10`}
        />
      </div>

      {(mov.error || errorExport) && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{mov.error ?? errorExport}</p>}

      <div className="mt-4 max-h-[36vh] space-y-3 overflow-auto pr-1">
        {filtered.map((m) => {
          const traslado = esTraslado(m);
          return (
            <div key={m.id} className="rounded-2xl border border-gray-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900">{m.producto}</p>
                  <p className="text-sm text-gray-400">
                    {m.categoria}
                    {isTodas && m.sedeNombre ? ` · ${m.sedeNombre}` : ""}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <span className={`inline-flex items-center gap-1 rounded-full px-3 py-0.5 text-xs font-semibold ${badge(m)}`}>
                    {m.traslado.replace(">", "→")}
                  </span>
                  <p className="mt-1 text-xs text-gray-400">{fmtFechaLarga(m.fecha)}, {fmtHora(m.fecha)}</p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-3 text-center">
                <div className="rounded-xl bg-pink-50 p-2">
                  <p className="text-xs text-gray-400">Cantidad</p>
                  <p className="text-xl font-bold text-pink-600">
                    {traslado ? Math.abs(m.cantidad) : `${m.cantidad > 0 ? "+" : ""}${m.cantidad}`}
                  </p>
                </div>
                {m.stockTiendaAntes !== undefined ? (
                  <div className="rounded-xl bg-blue-50 p-2">
                    <p className="text-xs text-gray-400">Tienda</p>
                    <p className="text-sm font-semibold text-blue-700">{m.stockTiendaAntes} → {m.stockTiendaDespues}</p>
                  </div>
                ) : (
                  <div className="rounded-xl bg-gray-50 p-2">
                    <p className="text-xs text-gray-400">{esSede(m) ? "Sede" : "Usuario"}</p>
                    <p className="truncate text-sm font-semibold text-gray-700">
                      {esSede(m) ? (m.operacion === "envio_sede" ? m.destino : m.origen.replace("Almacén · ", "")) : m.usuario}
                    </p>
                  </div>
                )}
                <div className="rounded-xl bg-orange-50 p-2">
                  <p className="text-xs text-gray-400">Almacén</p>
                  <p className="text-sm font-semibold text-orange-700">{m.stockAntes} → {m.stockDespues}</p>
                </div>
              </div>
              {(m.nota || m.referencia !== "—") && (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-gray-400">
                  <ArrowRightLeft className="h-3 w-3" /> {m.referencia} · {m.usuario}
                  {m.nota ? ` · ${m.nota}` : ""}
                </p>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <p className="py-10 text-center text-gray-500">{mov.loading ? "Cargando..." : "No hay traslados en la fecha elegida."}</p>
        )}
      </div>
    </Modal>
  );
}
