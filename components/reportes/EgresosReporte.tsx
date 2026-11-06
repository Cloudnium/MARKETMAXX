"use client";

import {
  Briefcase,
  DollarSign,
  Scale,
  ShoppingBasket,
  TrendingDown,
  Users,
  Wrench,
  Zap,
  Layers,
} from "lucide-react";
import { useAsync } from "@/lib/hooks/useAsync";
import { cargarReporteEgresos } from "@/lib/data/egresos";
import { useSede } from "@/components/shared/SedeProvider";
import { fmtIsoCorta } from "@/lib/fechas";
import { formatCurrency } from "@/lib/utils";
import type { FiltrosReporte } from "./ReportesFiltros";

const n = (v: unknown) => Number(v ?? 0);

interface Tarjeta {
  titulo: string;
  valor: string;
  badge: string;
  pie: [string, string];
  icon: typeof DollarSign;
  borde: string; // clase border-l-*
  tinte: string; // fondo icono
  color: string; // texto icono/badge
  valorColor?: string;
}

/** Reporte de EGRESOS: tarjetas por categoría, comparación con ventas y detalle. */
export function EgresosReporte({ filtros }: { filtros: FiltrosReporte }) {
  const { nombreSede } = useSede();
  const rep = useAsync(
    () => cargarReporteEgresos(filtros.sedeId, filtros.desde, filtros.hasta, filtros.categoria),
    [filtros.sedeId, filtros.desde, filtros.hasta, filtros.categoria]
  );
  const r = rep.data ?? {};
  const cats: { nombre: string; total: number; cantidad: number; porcentaje: number }[] = (r.por_categoria ?? []).map((c: any) => ({
    nombre: c.nombre, total: n(c.total), cantidad: n(c.cantidad), porcentaje: n(c.porcentaje),
  }));
  const cat = (nombre: string) => cats.find((c) => c.nombre === nombre) ?? { total: 0, cantidad: 0, porcentaje: 0 };
  const total = n(r.total);
  const dif = n(r.diferencia);
  const dias = Math.max(1, n(r.dias));
  const sup = dif >= 0;

  const tarjetas: Tarjeta[] = [
    { titulo: "Ventas totales (ingresos)", valor: formatCurrency(n(r.ventas)), badge: "Ventas", pie: ["Comprobantes:", String(n(r.comprobantes))], icon: DollarSign, borde: "border-l-green-500", tinte: "bg-green-50", color: "text-green-600" },
    { titulo: "Egresos", valor: formatCurrency(total), badge: "Total", pie: ["Registros:", String(n(r.cantidad))], icon: TrendingDown, borde: "border-l-red-400", tinte: "bg-red-50", color: "text-red-500" },
    { titulo: "Diferencia", valor: `${sup ? "+" : "-"}${formatCurrency(Math.abs(dif))}`, badge: sup ? "Superávit" : "Déficit", pie: ["Ingresos − Egresos:", `${sup ? "+" : "-"}${formatCurrency(Math.abs(dif))}`], icon: Scale, borde: sup ? "border-l-teal-500" : "border-l-red-500", tinte: sup ? "bg-teal-50" : "bg-red-50", color: sup ? "text-teal-600" : "text-red-600", valorColor: sup ? "text-teal-700" : "text-red-600" },
    { titulo: "Compras de insumos", valor: formatCurrency(cat("Compra de insumos").total), badge: "Insumos", pie: ["Compras:", String(cat("Compra de insumos").cantidad)], icon: ShoppingBasket, borde: "border-l-blue-500", tinte: "bg-blue-50", color: "text-blue-600" },
    { titulo: "Servicio / Pago terceros", valor: formatCurrency(cat("Servicio / Pago terceros").total), badge: "Servicios", pie: ["Registros:", String(cat("Servicio / Pago terceros").cantidad)], icon: Zap, borde: "border-l-purple-500", tinte: "bg-purple-50", color: "text-purple-600" },
    { titulo: "Pago a personal", valor: formatCurrency(cat("Pago a personal").total), badge: "Personal", pie: ["Registros:", String(cat("Pago a personal").cantidad)], icon: Users, borde: "border-l-amber-500", tinte: "bg-amber-50", color: "text-amber-600" },
    { titulo: "Mantenimiento", valor: formatCurrency(cat("Mantenimiento").total), badge: "Mant.", pie: ["Registros:", String(cat("Mantenimiento").cantidad)], icon: Wrench, borde: "border-l-orange-500", tinte: "bg-orange-50", color: "text-orange-600" },
    { titulo: "Otros gastos", valor: formatCurrency(cat("Otros gastos").total), badge: "Otros", pie: ["Registros:", String(cat("Otros gastos").cantidad)], icon: Layers, borde: "border-l-gray-400", tinte: "bg-gray-100", color: "text-gray-600" },
    { titulo: "Promedio diario", valor: formatCurrency(total / dias), badge: `${dias} días`, pie: ["Egreso del periodo:", formatCurrency(total)], icon: Briefcase, borde: "border-l-indigo-500", tinte: "bg-indigo-50", color: "text-indigo-600" },
  ];

  const maxDia = Math.max(1, ...(r.por_dia ?? []).map((d: any) => n(d.total)));

  return (
    <div className="space-y-4">
      {rep.error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{rep.error}</p>}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {tarjetas.map((t) => {
          const Icon = t.icon;
          return (
            <div key={t.titulo} className={`rounded-2xl border border-gray-200 border-l-4 ${t.borde} bg-white p-5 shadow-sm`}>
              <div className="flex items-start justify-between">
                <div className={`rounded-xl p-3 ${t.tinte}`}>
                  <Icon className={`h-5 w-5 ${t.color}`} />
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${t.tinte} ${t.color}`}>{t.badge}</span>
              </div>
              <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-gray-500">{t.titulo}</p>
              <p className={`mt-1 text-3xl font-extrabold ${t.valorColor ?? "text-gray-900"} ${rep.loading ? "opacity-40" : ""}`}>{t.valor}</p>
              <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-2 text-xs">
                <span className="text-gray-500">{t.pie[0]}</span>
                <span className="font-bold text-gray-800">{t.pie[1]}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="mb-4 font-semibold text-gray-900">Egresos por categoría</p>
          <div className="space-y-3">
            {cats.map((c) => (
              <div key={c.nombre}>
                <div className="mb-1 flex justify-between text-sm">
                  <span className="text-gray-700">{c.nombre}</span>
                  <span className="font-semibold text-gray-900">{formatCurrency(c.total)} <span className="text-xs text-gray-400">({c.porcentaje}%)</span></span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                  <div className="h-full rounded-full bg-red-400" style={{ width: `${c.porcentaje}%` }} />
                </div>
              </div>
            ))}
            {cats.length === 0 && <p className="py-6 text-center text-sm text-gray-400">Sin egresos en el periodo.</p>}
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="mb-4 font-semibold text-gray-900">Top proveedores</p>
          <div className="space-y-2.5">
            {(r.top_proveedores ?? []).map((p: any, i: number) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="truncate text-gray-700">{p.nombre} <span className="text-xs text-gray-400">· {n(p.cantidad)}</span></span>
                <span className="font-semibold text-gray-900">{formatCurrency(n(p.total))}</span>
              </div>
            ))}
            {(r.top_proveedores ?? []).length === 0 && <p className="py-6 text-center text-sm text-gray-400">Sin datos.</p>}
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="mb-4 font-semibold text-gray-900">Egresos por día</p>
          <div className="max-h-64 space-y-2 overflow-auto pr-1">
            {(r.por_dia ?? []).map((d: any) => (
              <div key={d.dia} className="flex items-center gap-2 text-xs">
                <span className="w-20 shrink-0 text-gray-500">{fmtIsoCorta(d.dia)}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
                  <div className="h-full rounded-full bg-red-400" style={{ width: `${(n(d.total) / maxDia) * 100}%` }} />
                </div>
                <span className="w-20 shrink-0 text-right font-semibold text-gray-800">{formatCurrency(n(d.total))}</span>
              </div>
            ))}
            {(r.por_dia ?? []).length === 0 && <p className="py-6 text-center text-sm text-gray-400">Sin datos.</p>}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-5 py-3 font-semibold text-gray-900">Detalle de egresos ({(r.detalle ?? []).length})</div>
        <div className="max-h-[28rem] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Fecha</th>
                <th className="px-4 py-3 font-semibold">Sede</th>
                <th className="px-4 py-3 font-semibold">Categoría</th>
                <th className="px-4 py-3 font-semibold">Concepto</th>
                <th className="px-4 py-3 font-semibold">Proveedor</th>
                <th className="px-4 py-3 font-semibold">Documento</th>
                <th className="px-4 py-3 text-right font-semibold">Monto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(r.detalle ?? []).map((d: any) => (
                <tr key={d.id}>
                  <td className="whitespace-nowrap px-4 py-2.5 text-gray-500">{fmtIsoCorta(d.fecha)}</td>
                  <td className="px-4 py-2.5 text-gray-600">{nombreSede(d.sede_id)}</td>
                  <td className="px-4 py-2.5 text-gray-700">{d.categoria}</td>
                  <td className="px-4 py-2.5 text-gray-900">{d.concepto}</td>
                  <td className="px-4 py-2.5 text-gray-600">{d.proveedor ?? "—"}</td>
                  <td className="px-4 py-2.5 text-gray-600">{d.documento || "—"}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-red-600">- {formatCurrency(n(d.monto))}</td>
                </tr>
              ))}
              {(r.detalle ?? []).length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">No hay egresos en este rango.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
