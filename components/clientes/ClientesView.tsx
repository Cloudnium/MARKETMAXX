"use client";

import { LayoutGrid, List, Plus, Search, Users, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Pagination } from "@/components/ui/Pagination";
import { ClienteCards } from "./ClienteCards";
import { ClienteTable } from "./ClienteTable";
import { ClienteForm } from "./ClienteForm";
import { useAsync } from "@/lib/hooks/useAsync";
import { desactivarCliente, listarClientes } from "@/lib/data/clientes";
import { useAuth } from "@/components/shared/AuthProvider";
import type { Cliente } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";

const PER_PAGE = 6;

export function ClientesView() {
  const { can } = useAuth();
  const lista = useAsync(listarClientes, [], []);
  const clientes = lista.data ?? [];
  const eliminar = async (c: Cliente) => {
    if (!window.confirm(`¿Desactivar al cliente "${c.nombre}"?`)) return;
    try {
      await desactivarCliente(c.id);
      lista.reload();
    } catch (e) {
      window.alert((e as Error).message);
    }
  };
  const [query, setQuery] = useState("");
  const [vista, setVista] = useState<"cards" | "tabla">("cards");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Cliente | null>(null);

  const filtered = useMemo(
    () =>
      clientes.filter(
        (c) =>
          c.nombre.toLowerCase().includes(query.toLowerCase()) ||
          c.documento.includes(query) ||
          c.email.toLowerCase().includes(query.toLowerCase())
      ),
    [clientes, query]
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const current = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const vip = clientes.filter((c) => c.tipo === "vip").length;
  const totalGastado = clientes.reduce((acc, c) => acc + c.totalGastado, 0);

  const openNew = () => {
    setEditing(null);
    setOpen(true);
  };

  const openEdit = (cliente: Cliente) => {
    setEditing(cliente);
    setOpen(true);
  };

  return (
    <div>
      <PageHeader
        title="Clientes"
        subtitle="Gestiona tu cartera de clientes"
        actions={
          can("clientes.crear") && (
            <button
              onClick={openNew}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
            >
              <Plus className="h-4 w-4" /> Nuevo Cliente
            </button>
          )
        }
      />

      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[
            {
              label: "Total Clientes",
              value: clientes.length.toString(),
              icon: Users,
              bg: "bg-blue-100",
              color: "text-blue-600",
            },
            {
              label: "Clientes VIP",
              value: vip.toString(),
              icon: Users,
              bg: "bg-purple-100",
              color: "text-purple-600",
            },
            {
              label: "Total Facturado",
              value: formatCurrency(totalGastado),
              icon: Wallet,
              bg: "bg-green-100",
              color: "text-green-600",
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
          <div className="flex flex-col gap-3 border-b border-gray-100 p-4 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
                placeholder="Buscar por nombre, documento o correo..."
                className="w-full rounded-lg border border-gray-300 py-2.5 pl-10 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </div>
            <div className="flex rounded-lg border border-gray-300 p-1">
              <button
                onClick={() => setVista("cards")}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold ${
                  vista === "cards"
                    ? "bg-blue-600 text-white"
                    : "text-gray-500 hover:bg-gray-50"
                }`}
              >
                <LayoutGrid className="h-3.5 w-3.5" /> Tarjetas
              </button>
              <button
                onClick={() => setVista("tabla")}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold ${
                  vista === "tabla"
                    ? "bg-blue-600 text-white"
                    : "text-gray-500 hover:bg-gray-50"
                }`}
              >
                <List className="h-3.5 w-3.5" /> Tabla
              </button>
            </div>
          </div>

          {vista === "cards" ? (
            <ClienteCards
              clientes={current}
              onEdit={can("clientes.editar") ? openEdit : undefined}
              onDelete={can("clientes.eliminar") ? eliminar : undefined}
            />
          ) : (
            <ClienteTable
              clientes={current}
              onEdit={can("clientes.editar") ? openEdit : undefined}
              onDelete={can("clientes.eliminar") ? eliminar : undefined}
            />
          )}

          <Pagination
            currentPage={page}
            totalPages={totalPages}
            onPageChange={setPage}
            totalItems={filtered.length}
            itemsPerPage={PER_PAGE}
          />
        </Card>
      </div>

      <ClienteForm
        open={open}
        cliente={editing}
        onClose={() => setOpen(false)}
        onSaved={() => {
          setOpen(false);
          lista.reload();
        }}
      />
    </div>
  );
}
