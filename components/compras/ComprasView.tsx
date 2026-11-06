"use client";

import { Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Pagination } from "@/components/ui/Pagination";
import { ComprasMetricas } from "./ComprasMetricas";
import { ComprasTable } from "./ComprasTable";
import { ModalRegistrarCompra } from "./ModalRegistrarCompra";
import { MapPin } from "lucide-react";
import { useAuth } from "@/components/shared/AuthProvider";
import { useAsync } from "@/lib/hooks/useAsync";
import { anularCompra, listarCompras, recibirCompra } from "@/lib/data/compras";
import type { Compra } from "@/lib/types";
import { useSede } from "@/components/shared/SedeProvider";

const PER_PAGE = 5;

export function ComprasView() {
  const { filtro, sede, sedeOperativa } = useSede();
  const { can } = useAuth();
  const [query, setQuery] = useState("");
  const [estado, setEstado] = useState("Todos");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);

  const lista = useAsync(() => listarCompras(filtro), [filtro], []);
  const comprasSede = lista.data ?? [];

  const recibir = async (c: Compra) => {
    if (!window.confirm(`¿Marcar ${c.numero} como recibida? Se ingresará el stock a la sede.`)) return;
    try {
      await recibirCompra(c.id);
      lista.reload();
    } catch (e) {
      window.alert((e as Error).message);
    }
  };
  const anular = async (c: Compra) => {
    const motivo = window.prompt(`Motivo de la anulación de ${c.numero} (obligatorio):`);
    if (!motivo) return;
    try {
      await anularCompra(c.id, motivo);
      lista.reload();
    } catch (e) {
      window.alert((e as Error).message);
    }
  };

  const filtered = useMemo(
    () =>
      comprasSede.filter((c) => {
        const matchQuery =
          c.numero.toLowerCase().includes(query.toLowerCase()) ||
          c.proveedor.toLowerCase().includes(query.toLowerCase());
        const matchEstado = estado === "Todos" || c.estado === estado;
        return matchQuery && matchEstado;
      }),
    [comprasSede, query, estado]
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const current = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  return (
    <div>
      <PageHeader
        title="Compras"
        subtitle={`Registra y controla las compras a proveedores · ${sede.nombre}`}
        actions={
          can("compras.crear") && (
            <button
              onClick={() => setOpen(true)}
              disabled={!sedeOperativa}
              title={sedeOperativa ? undefined : "Elige una sede concreta para registrar la compra"}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" /> Registrar Compra
            </button>
          )
        }
      />

      <div className="space-y-4">
        <ComprasMetricas compras={comprasSede} />

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
                placeholder="Buscar por número o proveedor..."
                className="w-full rounded-lg border border-gray-300 py-2.5 pl-10 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </div>
            <select
              value={estado}
              onChange={(e) => {
                setEstado(e.target.value);
                setPage(1);
              }}
              className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="Todos">Todos los estados</option>
              <option value="recibida">Recibida</option>
              <option value="pendiente">Pendiente</option>
              <option value="anulada">Anulada</option>
            </select>
          </div>

          <ComprasTable
            compras={current}
            onRecibir={can("compras.crear") ? recibir : undefined}
            onAnular={can("compras.anular") ? anular : undefined}
          />
          <Pagination
            currentPage={page}
            totalPages={totalPages}
            onPageChange={setPage}
            totalItems={filtered.length}
            itemsPerPage={PER_PAGE}
          />
        </Card>
      </div>

      <ModalRegistrarCompra
        open={open}
        sedeId={sedeOperativa?.id ?? null}
        onClose={() => setOpen(false)}
        onDone={() => {
          setOpen(false);
          lista.reload();
        }}
      />
    </div>
  );
}
