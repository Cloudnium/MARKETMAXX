"use client";

import { useMemo, useState } from "react";
import { History, Search } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { BotonesExportar } from "@/components/shared/BotonesExportar";
import { useSede } from "@/components/shared/SedeProvider";
import { useAsync } from "@/lib/hooks/useAsync";
import { esMovimientoInterno, listarMovimientos, operacionLabel } from "@/lib/data/almacen";
import { listarProductos } from "@/lib/data/productos";
import type { TipoMovimiento } from "@/lib/types";
import { fmtFecha, fmtHora, hoyLima } from "@/lib/fechas";
import { fmtCantidad, fmtConSigno } from "@/lib/export/comun";
import { excelMovimientosProductos } from "@/lib/export/excel";
import { pdfMovimientosProductos, totalesMovimientos } from "@/lib/export/pdfMovimientos";

const tipoBadge: Record<TipoMovimiento, { label: string; className: string }> = {
  entrada: { label: "Entrada", className: "bg-green-100 text-green-700" },
  salida: { label: "Salida", className: "bg-red-100 text-red-600" },
  traspaso: { label: "Traspaso", className: "bg-blue-100 text-blue-700" },
  ajuste: { label: "Ajuste", className: "bg-amber-100 text-amber-700" },
};

const campo =
  "w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-pink-500 focus:outline-none focus:ring-2 focus:ring-pink-100";
const etiqueta = "mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500";
const MAX_FILAS = 1000;

/** Historial de movimientos de stock de la tienda (se abre desde PRODUCTOS). */
export function HistorialProductosModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { filtro, sede, isTodas } = useSede();
  const hoy = hoyLima();
  const [form, setForm] = useState({ desde: hoy, hasta: hoy, producto: "todos", tipo: "todos" });
  const [aplicado, setAplicado] = useState(form);
  const [verInternos, setVerInternos] = useState(false);
  const [exportando, setExportando] = useState<"excel" | "pdf" | null>(null);
  const [errorExport, setErrorExport] = useState<string | null>(null);

  const productos = useAsync(() => (open ? listarProductos(filtro) : Promise.resolve([])), [open, filtro], []);
  const mov = useAsync(
    () => (open ? listarMovimientos(filtro, { desde: aplicado.desde, hasta: aplicado.hasta }) : Promise.resolve([])),
    [open, filtro, aplicado.desde, aplicado.hasta],
    []
  );

  const filtered = useMemo(
    () =>
      (mov.data ?? []).filter(
        (m) =>
          (aplicado.producto === "todos" || m.productoId === aplicado.producto) &&
          (aplicado.tipo === "todos" || m.tipo === aplicado.tipo) &&
          (verInternos || !esMovimientoInterno(m.operacion))
      ),
    [mov.data, aplicado.producto, aplicado.tipo, verInternos]
  );
  const ocultos = (mov.data ?? []).filter((m) => esMovimientoInterno(m.operacion)).length;
  const { ingresadas, salidas } = totalesMovimientos(filtered);

  const buscar = () => {
    const desde = form.desde || hoy;
    const hasta = !form.hasta || form.hasta < desde ? desde : form.hasta;
    setAplicado({ ...form, desde, hasta });
  };

  const textoFiltros = [
    aplicado.tipo !== "todos" ? `Tipo: ${tipoBadge[aplicado.tipo as TipoMovimiento].label}` : "",
    aplicado.producto !== "todos"
      ? `Producto: ${productos.data?.find((p) => p.id === aplicado.producto)?.nombre ?? ""}`
      : "",
  ].filter(Boolean).join(" · ");

  const exportar = async (formato: "excel" | "pdf") => {
    setErrorExport(null);
    setExportando(formato);
    try {
      const datos = {
        negocio: sede.nombre,
        filas: filtered,
        desde: aplicado.desde,
        hasta: aplicado.hasta,
        mostrarSede: isTodas,
        filtros: textoFiltros || undefined,
      };
      if (formato === "pdf") await pdfMovimientosProductos(datos);
      else await excelMovimientosProductos(datos);
    } catch (e) {
      setErrorExport(`No se pudo generar el archivo: ${(e as Error).message}`);
    } finally {
      setExportando(null);
    }
  };

  const visibles = filtered.slice(0, MAX_FILAS);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="2xl"
      title={
        <span className="flex items-center gap-3 text-2xl">
          <History className="h-6 w-6 text-pink-600" /> Historial de Movimientos de Almacén
        </span>
      }
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
      <div className="grid grid-cols-2 items-end gap-3 border-b border-gray-100 pb-5 lg:grid-cols-[1fr_1fr_1.4fr_1fr_auto]">
        <div>
          <label className={etiqueta}>Desde</label>
          <input type="date" max={hoy} value={form.desde} onChange={(e) => setForm({ ...form, desde: e.target.value })} className={campo} />
        </div>
        <div>
          <label className={etiqueta}>Hasta</label>
          <input type="date" max={hoy} value={form.hasta} onChange={(e) => setForm({ ...form, hasta: e.target.value })} className={campo} />
        </div>
        <div>
          <label className={etiqueta}>Producto</label>
          <select value={form.producto} onChange={(e) => setForm({ ...form, producto: e.target.value })} className={campo}>
            <option value="todos">Todos los productos</option>
            {(productos.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
                {isTodas && p.sedeNombre ? ` (${p.sedeNombre})` : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={etiqueta}>Tipo</label>
          <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })} className={campo}>
            <option value="todos">Todos</option>
            <option value="entrada">Entrada</option>
            <option value="salida">Salida</option>
            <option value="traspaso">Traspaso</option>
            <option value="ajuste">Ajuste</option>
          </select>
        </div>
        <button
          onClick={buscar}
          aria-label="Buscar"
          className="flex h-[42px] w-12 items-center justify-center rounded-xl bg-pink-600 text-white hover:bg-pink-700"
        >
          <Search className="h-5 w-5" />
        </button>
      </div>
      {(ocultos > 0 || verInternos) && (
        <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-gray-500">
          <input type="checkbox" checked={verInternos} onChange={(e) => setVerInternos(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-pink-600 focus:ring-pink-500" />
          Mostrar movimientos internos de reservas para vender sin internet (apartar, consumir y devolver)
          {!verInternos && ocultos > 0 && <span className="font-semibold text-gray-400">· {ocultos} ocultos</span>}
        </label>
      )}

      <div className="my-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl bg-gradient-to-br from-pink-50 to-pink-100 p-4 ring-1 ring-pink-100">
          <p className="text-xs font-semibold uppercase tracking-wide text-pink-600">Total movimientos</p>
          <p className="mt-1 text-3xl font-bold text-gray-900">{filtered.length}</p>
        </div>
        <div className="rounded-2xl bg-gradient-to-br from-green-50 to-emerald-100 p-4 ring-1 ring-emerald-100">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Unidades ingresadas</p>
          <p className="mt-1 text-3xl font-bold text-emerald-700">+{fmtCantidad(ingresadas)}</p>
        </div>
        <div className="rounded-2xl bg-gradient-to-br from-red-50 to-red-100 p-4 ring-1 ring-red-100">
          <p className="text-xs font-semibold uppercase tracking-wide text-red-600">Unidades salidas</p>
          <p className="mt-1 text-3xl font-bold text-red-700">-{fmtCantidad(Math.abs(salidas))}</p>
        </div>
      </div>

      {(mov.error || errorExport) && <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{mov.error ?? errorExport}</p>}

      <div className="max-h-[38vh] overflow-auto">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 z-10 bg-white text-xs uppercase text-gray-500">
            <tr className="border-b border-gray-200">
              <th className="px-2 py-3 font-semibold">Fecha</th>
              <th className="px-2 py-3 font-semibold">Hora</th>
              <th className="px-2 py-3 font-semibold">Producto</th>
              <th className="px-2 py-3 font-semibold">Categoría</th>
              {isTodas && <th className="px-2 py-3 font-semibold">Sede</th>}
              <th className="px-2 py-3 font-semibold">Tipo</th>
              <th className="px-2 py-3 font-semibold">Motivo</th>
              <th className="px-2 py-3 text-right font-semibold">Cantidad</th>
              <th className="px-2 py-3 text-center font-semibold">Stock</th>
              <th className="px-2 py-3 font-semibold">Usuario</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {visibles.map((m) => {
              const b = tipoBadge[m.tipo];
              return (
                <tr key={m.id} className="hover:bg-gray-50/70">
                  <td className="whitespace-nowrap px-2 py-3 text-gray-700">{fmtFecha(m.fecha)}</td>
                  <td className="whitespace-nowrap px-2 py-3 text-gray-500">{fmtHora(m.fecha)}</td>
                  <td className="px-2 py-3 font-bold text-gray-900">{m.producto}</td>
                  <td className="px-2 py-3 text-gray-500">{m.categoria}</td>
                  {isTodas && <td className="px-2 py-3 text-gray-500">{m.sedeNombre}</td>}
                  <td className="px-2 py-3">
                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${b.className}`}>{b.label}</span>
                  </td>
                  <td className="px-2 py-3 text-gray-700" title={m.nota}>{operacionLabel[m.operacion] ?? m.operacion}</td>
                  <td className={`px-2 py-3 text-right font-bold ${m.cantidad < 0 ? "text-red-600" : "text-emerald-600"}`}>{fmtConSigno(m.cantidad)}</td>
                  <td className="whitespace-nowrap px-2 py-3 text-center text-gray-500">{m.stockAntes} → {m.stockDespues}</td>
                  <td className="px-2 py-3 text-gray-500">{m.usuario}</td>
                </tr>
              );
            })}
            {visibles.length === 0 && (
              <tr>
                <td colSpan={isTodas ? 10 : 9} className="px-4 py-10 text-center text-gray-500">
                  {mov.loading ? "Cargando..." : "No hay movimientos con estos filtros."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {filtered.length > MAX_FILAS && (
          <p className="py-2 text-center text-xs text-gray-400">Mostrando los primeros {MAX_FILAS}; Excel y PDF incluyen todos.</p>
        )}
      </div>
    </Modal>
  );
}
