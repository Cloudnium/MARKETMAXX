"use client";

import { Download, FileText, Receipt, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Pagination } from "@/components/ui/Pagination";
import { ComprobanteTable } from "./ComprobanteTable";
import { ComprobanteDetail } from "./ComprobanteDetail";
import { ModalCambiarMetodo } from "./ModalCambiarMetodo";
import { useAsync } from "@/lib/hooks/useAsync";
import { listarComprobantes } from "@/lib/data/ventas";
import type { Comprobante } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";
import { useSede } from "@/components/shared/SedeProvider";

const PER_PAGE = 6;

export function ComprobantesView() {
  const { filtro, sede } = useSede();
  const [query, setQuery] = useState("");
  const [tipo, setTipo] = useState("Todos");
  const [estado, setEstado] = useState("Todos");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Comprobante | null>(null);
  const [cambiar, setCambiar] = useState<Comprobante | null>(null);

  const lista = useAsync(() => listarComprobantes(filtro), [filtro], []);
  const comprobantesSede = lista.data ?? [];

  const filtered = useMemo(
    () =>
      comprobantesSede.filter((c) => {
        const matchQuery =
          c.numero.toLowerCase().includes(query.toLowerCase()) ||
          c.cliente.toLowerCase().includes(query.toLowerCase()) ||
          c.documento.includes(query);
        const matchTipo = tipo === "Todos" || c.tipo === tipo;
        const matchEstado = estado === "Todos" || c.estado === estado;
        return matchQuery && matchTipo && matchEstado;
      }),
    [comprobantesSede, query, tipo, estado]
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const current = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const totalFacturado = comprobantesSede
    .filter((c) => c.estado === "pagado")
    .reduce((acc, c) => acc + c.total, 0);
  const facturas = comprobantesSede.filter((c) => c.tipo === "factura").length;
  const boletas = comprobantesSede.filter((c) => c.tipo === "boleta").length;

  return (
    <div>
      <PageHeader
        title="Comprobantes"
        subtitle={`Consulta y gestiona los comprobantes emitidos · ${sede.nombre}`}
        actions={
          <button className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50">
            <Download className="h-4 w-4" /> Exportar
          </button>
        }
      />

      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[
            {
              label: "Total Comprobantes",
              value: comprobantesSede.length.toString(),
              icon: Receipt,
              bg: "bg-blue-100",
              color: "text-blue-600",
            },
            {
              label: "Facturado",
              value: formatCurrency(totalFacturado),
              icon: FileText,
              bg: "bg-green-100",
              color: "text-green-600",
            },
            {
              label: "Facturas / Boletas",
              value: `${facturas} / ${boletas}`,
              icon: FileText,
              bg: "bg-purple-100",
              color: "text-purple-600",
            },
          ].map((m) => {
            const Icon = m.icon;
            return (
              <div
                key={m.label}
                className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
              >
                <div className={`rounded-lg p-3 ${m.bg}`}>
                  <Icon className={`h-6 w-6 ${m.color}`} />
                </div>
                <div>
                  <p className="text-sm text-gray-500">{m.label}</p>
                  <p className="text-xl font-bold text-gray-900">{m.value}</p>
                </div>
              </div>
            );
          })}
        </div>

        <Card>
          <div className="flex flex-col gap-3 border-b border-gray-100 p-4 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
                placeholder="Buscar por número, cliente o documento..."
                className="w-full rounded-lg border border-gray-300 py-2.5 pl-10 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </div>
            <select
              value={tipo}
              onChange={(e) => {
                setTipo(e.target.value);
                setPage(1);
              }}
              className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="Todos">Todos los tipos</option>
              <option value="factura">Factura</option>
              <option value="boleta">Boleta</option>
              <option value="nota_venta">Nota de Venta</option>
            </select>
            <select
              value={estado}
              onChange={(e) => {
                setEstado(e.target.value);
                setPage(1);
              }}
              className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="Todos">Todos los estados</option>
              <option value="pagado">Pagado</option>
              <option value="anulado">Anulado</option>
              <option value="pendiente">Pendiente</option>
            </select>
          </div>

          <ComprobanteTable comprobantes={current} onView={setSelected} onCambiarMetodo={setCambiar} />
          <Pagination
            currentPage={page}
            totalPages={totalPages}
            onPageChange={setPage}
            totalItems={filtered.length}
            itemsPerPage={PER_PAGE}
          />
        </Card>
      </div>

      <ModalCambiarMetodo
        comprobante={cambiar}
        onClose={() => setCambiar(null)}
        onDone={() => {
          setCambiar(null);
          lista.reload();
        }}
      />
      <ComprobanteDetail
        comprobante={selected}
        onClose={() => setSelected(null)}
        onAnulado={() => {
          setSelected(null);
          lista.reload();
        }}
      />
    </div>
  );
}
