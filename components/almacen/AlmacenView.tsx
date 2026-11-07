"use client";

import {
  ArrowRightLeft,
  DollarSign,
  FileDown,
  FileSpreadsheet,
  Loader2,
  Warehouse,
  AlertTriangle,
  Boxes,
  History,
  Package,
  PackageX,
  Search,
  SlidersHorizontal,
  Store,
  Truck,
} from "lucide-react";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { ModalTraslado, type ModoTraslado } from "./ModalTraslado";
import { HistorialTrasladosModal } from "./HistorialTrasladosModal";
import { ModalAjusteStock } from "./ModalAjusteStock";
import { useAsync } from "@/lib/hooks/useAsync";
import { listarStockAlmacen } from "@/lib/data/almacen";
import { listarProductosConReservas } from "@/lib/data/productos";
import { excelStockAlmacen, pdfStockAlmacen, type FilaStock } from "@/lib/export/stock";
import { formatCurrency } from "@/lib/utils";
import { useAuth } from "@/components/shared/AuthProvider";
import type { StockItem } from "@/lib/types";
import { useSede } from "@/components/shared/SedeProvider";

export function AlmacenView() {
  const { filtro, sede, isTodas } = useSede();
  const { can } = useAuth();
  const [traspasoProducto, setTraspasoProducto] = useState<string | null>(null);
  const [modoTraslado, setModoTraslado] = useState<ModoTraslado>("a_tienda");
  const [ajuste, setAjuste] = useState<StockItem | null>(null);
  const [query, setQuery] = useState("");
  const [tienda, setTienda] = useState("Todas");
  const [modalOpen, setModalOpen] = useState(false);
  const [historialOpen, setHistorialOpen] = useState(false);

  const stock = useAsync(() => listarStockAlmacen(filtro), [filtro], []);
  const prods = useAsync(() => listarProductosConReservas(filtro), [filtro], []);
  const [exportando, setExportando] = useState<"excel" | "pdf" | null>(null);
  const stockSede = stock.data ?? [];
  const tiendas = Array.from(new Set(stockSede.map((s) => s.tienda)));

  const filtered = useMemo(
    () =>
      stockSede.filter((s) => {
        const matchQuery =
          s.producto.toLowerCase().includes(query.toLowerCase()) ||
          s.categoria.toLowerCase().includes(query.toLowerCase());
        const matchTienda = tienda === "Todas" || s.tienda === tienda;
        return matchQuery && matchTienda;
      }),
    [stockSede, query, tienda]
  );

  const abrirTraslado = (modo: ModoTraslado, productoId: string | null = null) => {
    setModoTraslado(modo);
    setTraspasoProducto(productoId);
    setModalOpen(true);
  };

  // Tarjetas: unidades y valores (el valor en tienda/almacén va a precio de venta)
  const lista = (prods.data ?? []).filter((p) => p.activo);
  const uTienda = lista.reduce((a, p) => a + p.stock, 0);
  const uAlmacen = lista.reduce((a, p) => a + (p.stockAlmacen ?? 0), 0);
  const valorCompra = lista.reduce((a, p) => a + (p.stock + (p.stockAlmacen ?? 0)) * p.precioCompra, 0);
  const valorTienda = lista.reduce((a, p) => a + p.stock * p.precio, 0);
  const valorAlmacen = lista.reduce((a, p) => a + (p.stockAlmacen ?? 0) * p.precio, 0);
  const sinStockTienda = lista.filter((p) => p.stock === 0).length;

  // Stock de tienda REAL (libre + apartado en cajas); mientras carga, el libre que trae la propia fila
  const tiendaReal = new Map((prods.data ?? []).map((p) => [p.id, p.stock]));
  const tiendaDe = (s: (typeof stockSede)[number]) => tiendaReal.get(s.productoId) ?? s.stockTienda ?? 0;
  const totalDe = (s: (typeof stockSede)[number]) => s.stock + tiendaDe(s);
  const estadoDe = (s: (typeof stockSede)[number]) =>
    totalDe(s) === 0 ? "Sin stock" : totalDe(s) <= s.stockMinimo ? "Stock bajo" : "Disponible";
  const precioDe = new Map(lista.map((p) => [p.id, p.precio]));

  const exportar = async (formato: "excel" | "pdf") => {
    setExportando(formato);
    try {
      const filas: FilaStock[] = filtered.map((s) => ({
        producto: s.producto,
        codigo: s.codigo,
        categoria: s.categoria,
        sede: s.tienda,
        almacen: s.stock,
        tienda: tiendaDe(s),
        total: totalDe(s),
        minimo: s.stockMinimo,
        estado: estadoDe(s),
        unidad: s.unidad,
        valorVenta: totalDe(s) * (precioDe.get(s.productoId) ?? 0),
      }));
      const datos = { negocio: sede.nombre, filas, mostrarSede: isTodas };
      if (formato === "pdf") await pdfStockAlmacen(datos);
      else await excelStockAlmacen(datos);
    } catch (e) {
      window.alert(`No se pudo generar el archivo: ${(e as Error).message}`);
    } finally {
      setExportando(null);
    }
  };

  const metrics = [
    { label: "Productos", value: lista.length.toLocaleString("es-PE"), sub: "Valor Compra", subValue: formatCurrency(valorCompra), subColor: "text-amber-600", icon: Package, bg: "bg-gray-100", color: "text-gray-500" },
    { label: "En Tienda", value: uTienda.toLocaleString("es-PE"), sub: "Valor Tienda", subValue: formatCurrency(valorTienda), subColor: "text-blue-600", icon: Store, bg: "bg-blue-500", color: "text-white" },
    { label: "En Almacén", value: uAlmacen.toLocaleString("es-PE"), icon: Warehouse, bg: "bg-orange-400", color: "text-white" },
    { label: "Sin stock tienda", value: sinStockTienda.toLocaleString("es-PE"), valueColor: "text-red-600", icon: AlertTriangle, bg: "bg-red-600", color: "text-white" },
    { label: "Valor Almacén", value: formatCurrency(valorAlmacen), valueColor: "text-emerald-600", icon: DollarSign, bg: "bg-emerald-500", color: "text-white" },
  ] as {
    label: string; value: string; sub?: string; subValue?: string; subColor?: string; valueColor?: string;
    icon: typeof Package; bg: string; color: string;
  }[];

  return (
    <div>
      <PageHeader
        title="Almacén"
        subtitle={`Stock del almacén, envíos a la tienda y entre sedes · ${sede.nombre}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {can("almacen.historial") && <button
              onClick={() => setHistorialOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
            >
              <History className="h-4 w-4" /> Historial de traslados
            </button>}
            <button
              onClick={() => exportar("excel")}
              disabled={!!exportando || filtered.length === 0}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {exportando === "excel" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />} Excel
            </button>
            <button
              onClick={() => exportar("pdf")}
              disabled={!!exportando || filtered.length === 0}
              className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {exportando === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />} PDF
            </button>
            {can("almacen.traspasar") && <button
              onClick={() => abrirTraslado("a_sede")}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
            >
              <Truck className="h-4 w-4" /> Enviar a otra sede
            </button>}
            {can("almacen.traspasar") && <button
              onClick={() => abrirTraslado("a_tienda")}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
            >
              <ArrowRightLeft className="h-4 w-4" /> Tienda ⇄ Almacén
            </button>}
          </div>
        }
      />

      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {metrics.map((m) => {
            const Icon = m.icon;
            return (
              <div
                key={m.label}
                className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
              >
                <div className="min-w-0">
                  <p className="text-sm text-gray-500">{m.label}</p>
                  <p className={`text-2xl font-bold ${m.valueColor ?? "text-gray-900"}`}>{m.value}</p>
                  {m.sub && (
                    <>
                      <p className="mt-1 text-[11px] text-gray-400">{m.sub}</p>
                      <p className={`text-sm font-bold ${m.subColor ?? "text-gray-700"}`}>{m.subValue}</p>
                    </>
                  )}
                </div>
                <div className={`shrink-0 rounded-xl p-3 ${m.bg}`}>
                  <Icon className={`h-6 w-6 ${m.color}`} />
                </div>
              </div>
            );
          })}
        </div>

        <Card>
          <div className="flex flex-col gap-3 border-b border-gray-100 p-4 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar producto, código o categoría..."
                className="w-full rounded-lg border border-gray-300 py-2.5 pl-10 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </div>
            {isTodas && <select
              value={tienda}
              onChange={(e) => setTienda(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
            >
              {["Todas", ...tiendas].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Producto</th>
                  <th className="px-4 py-3 font-semibold">Categoría</th>
                  {isTodas && <th className="px-4 py-3 font-semibold">Sede</th>}
                  <th className="px-4 py-3 text-center font-semibold">En Almacén</th>
                  <th className="px-4 py-3 text-center font-semibold">En Tienda</th>
                  <th className="px-4 py-3 text-center font-semibold">Total</th>
                  <th className="px-4 py-3 text-center font-semibold">Estado</th>
                  <th className="px-4 py-3 text-center font-semibold">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((item) => {
                  return (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-100">
                            <Package className="h-4 w-4 text-gray-400" />
                          </div>
                          <span className="font-semibold text-gray-900">
                            {item.producto}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {item.categoria}
                      </td>
                      {isTodas && <td className="px-4 py-3 text-gray-600">{item.tienda}</td>}
                      <td className="px-4 py-3 text-center font-semibold text-gray-900">
                        {item.stock} {item.unidad}
                      </td>
                      <td className="px-4 py-3 text-center text-gray-500">
                        {tiendaDe(item)} {item.unidad}
                      </td>
                      <td className="px-4 py-3 text-center font-bold text-gray-900">
                        {totalDe(item)} {item.unidad}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                            totalDe(item) === 0
                              ? "bg-red-100 text-red-700"
                              : totalDe(item) <= item.stockMinimo
                              ? "bg-amber-100 text-amber-700"
                              : "bg-green-100 text-green-700"
                          }`}
                        >
                          {totalDe(item) === 0
                            ? "Sin stock"
                            : totalDe(item) <= item.stockMinimo
                            ? "Stock bajo"
                            : "Disponible"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex justify-center gap-1.5">
                          {can("almacen.ajustar") && (
                            <button
                              onClick={() => setAjuste(item)}
                              className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                            >
                              <SlidersHorizontal className="h-3.5 w-3.5" /> Ajustar
                            </button>
                          )}
                          {can("almacen.traspasar") && item.stock > 0 && (
                            <button
                              onClick={() => abrirTraslado("a_tienda", item.productoId)}
                              className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                            >
                              <ArrowRightLeft className="h-3.5 w-3.5" /> Enviar
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td
                      colSpan={isTodas ? 8 : 7}
                      className="px-4 py-10 text-center text-gray-500"
                    >
                      No se encontraron productos.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <ModalTraslado
        open={modalOpen}
        modoInicial={modoTraslado}
        modosPermitidos={modoTraslado === "a_sede" ? ["a_sede"] : ["a_tienda", "a_almacen"]}
        productoInicial={traspasoProducto}
        onClose={() => setModalOpen(false)}
        onDone={() => {
          setModalOpen(false);
          stock.reload();
        }}
      />
      <ModalAjusteStock
        item={ajuste}
        open={!!ajuste}
        onClose={() => setAjuste(null)}
        onDone={() => {
          setAjuste(null);
          stock.reload();
        }}
      />
      <HistorialTrasladosModal
        open={historialOpen}
        onClose={() => setHistorialOpen(false)}
      />
    </div>
  );
}
