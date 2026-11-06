"use client";

import {
  AlertTriangle,
  DollarSign,
  History,
  Package,
  Plus,
  Search,
} from "lucide-react";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Pagination } from "@/components/ui/Pagination";
import { ProductTable } from "./ProductTable";
import { ProductoForm } from "./ProductoForm";
import { HistorialProductosModal } from "./HistorialProductosModal";
import { useSede } from "@/components/shared/SedeProvider";
import { useAuth } from "@/components/shared/AuthProvider";
import { useAsync } from "@/lib/hooks/useAsync";
import { cambiarEstadoProducto, listarCategorias, listarProductos } from "@/lib/data/productos";
import type { Producto } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";

const PER_PAGE = 8;

export function ProductosView() {
  const { filtro, sede, isTodas } = useSede();
  const { can } = useAuth();
  const prods = useAsync(() => listarProductos(filtro), [filtro], []);
  const cats = useAsync(listarCategorias, [], []);
  const productos = prods.data ?? [];
  const categorias = (cats.data ?? []).map((c) => c.nombre);
  const [query, setQuery] = useState("");
  const [categoria, setCategoria] = useState("Todas");
  const [estado, setEstado] = useState("Todos");
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [historialOpen, setHistorialOpen] = useState(false);
  const [editing, setEditing] = useState<Producto | null>(null);

  const filtered = useMemo(
    () =>
      productos.filter((p) => {
        const matchQuery =
          p.nombre.toLowerCase().includes(query.toLowerCase()) ||
          p.codigo.toLowerCase().includes(query.toLowerCase());
        const matchCategoria = categoria === "Todas" || p.categoria === categoria;
        const matchEstado =
          estado === "Todos" ||
          (estado === "Activos" && p.activo) ||
          (estado === "Inactivos" && !p.activo);
        return matchQuery && matchCategoria && matchEstado;
      }),
    [productos, query, categoria, estado]
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const current = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const totalDe = (p: Producto) => p.stock + (p.stockAlmacen ?? 0);
  const stockBajo = productos.filter(
    (p) => totalDe(p) <= p.stockMinimo && totalDe(p) > 0
  ).length;
  const agotados = productos.filter((p) => totalDe(p) === 0).length;
  const valorInventario = productos.reduce(
    (acc, p) => acc + totalDe(p) * p.precioCompra,
    0
  );

  const valorVenta = productos.reduce((acc, p) => acc + totalDe(p) * p.precio, 0);

  const alternarEstado = async (producto: Producto) => {
    const accion = producto.activo ? "desactivar" : "activar";
    if (!window.confirm(`¿Deseas ${accion} el producto "${producto.nombre}"?`)) return;
    try {
      await cambiarEstadoProducto(producto.id, !producto.activo);
      prods.reload();
    } catch (e) {
      window.alert((e as Error).message);
    }
  };

  const openNew = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (producto: Producto) => {
    setEditing(producto);
    setModalOpen(true);
  };

  const metrics = [
    {
      label: "Total Productos",
      value: productos.length.toString(),
      icon: Package,
      bg: "bg-blue-100",
      color: "text-blue-600",
    },
    {
      label: "Stock Bajo / Agotado",
      value: `${stockBajo} / ${agotados}`,
      icon: AlertTriangle,
      bg: "bg-amber-100",
      color: "text-amber-600",
    },
    {
      label: "Valor del Inventario (costo)",
      value: formatCurrency(valorInventario),
      icon: DollarSign,
      bg: "bg-green-100",
      color: "text-green-600",
    },
    {
      label: "Valor del Inventario (venta)",
      value: formatCurrency(valorVenta),
      icon: DollarSign,
      bg: "bg-purple-100",
      color: "text-purple-600",
    },
  ];

  return (
    <div>
      <PageHeader
        title="Productos"
        subtitle={`Productos y stock de tienda · ${sede.nombre}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {can("productos.historial") && (
              <button
                onClick={() => setHistorialOpen(true)}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
              >
                <History className="h-4 w-4" /> Historial de movimientos
              </button>
            )}
            {can("productos.crear") && (
              <button
                onClick={openNew}
                disabled={isTodas}
                title={isTodas ? "Elige una sede concreta para crear un producto" : undefined}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus className="h-4 w-4" /> Nuevo Producto
              </button>
            )}
          </div>
        }
      />

      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {metrics.map((m) => {
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
                placeholder="Buscar por nombre o código..."
                className="w-full rounded-lg border border-gray-300 py-2.5 pl-10 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </div>
            <select
              value={categoria}
              onChange={(e) => {
                setCategoria(e.target.value);
                setPage(1);
              }}
              className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
            >
              {["Todas", ...categorias].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <select
              value={estado}
              onChange={(e) => {
                setEstado(e.target.value);
                setPage(1);
              }}
              className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
            >
              {["Todos", "Activos", "Inactivos"].map((e) => (
                <option key={e}>{e}</option>
              ))}
            </select>
          </div>

          <ProductTable
            productos={current}
            mostrarSede={isTodas}
            onEdit={can("productos.editar") ? openEdit : undefined}
            onToggle={can("productos.eliminar") ? alternarEstado : undefined}
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

      <HistorialProductosModal open={historialOpen} onClose={() => setHistorialOpen(false)} />
      <ProductoForm
        open={modalOpen}
        producto={editing}
        categorias={cats.data ?? []}
        onClose={() => setModalOpen(false)}
        onStockChanged={() => prods.reload()}
        onSaved={() => {
          setModalOpen(false);
          prods.reload();
        }}
      />
    </div>
  );
}
