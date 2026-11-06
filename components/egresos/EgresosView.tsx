"use client";

import { ArrowDownCircle, Pencil, Plus, Receipt, Search, ShoppingBasket } from "lucide-react";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Pagination } from "@/components/ui/Pagination";
import { ComprasMetricas } from "@/components/compras/ComprasMetricas";
import { ComprasTable } from "@/components/compras/ComprasTable";
import { ModalRegistrarEgreso } from "./ModalRegistrarEgreso";
import { ModalRegistrarCompra } from "@/components/compras/ModalRegistrarCompra";
import { Modal } from "@/components/ui/Modal";
import { useAuth } from "@/components/shared/AuthProvider";
import { useSede } from "@/components/shared/SedeProvider";
import { useAsync } from "@/lib/hooks/useAsync";
import { anularCompra, listarCompras, recibirCompra } from "@/lib/data/compras";
import { CATEGORIAS_EGRESO, listarEgresosSede, obtenerFotoEgreso } from "@/lib/data/egresos";
import { fmtIsoCorta, hoyLima, primerDiaDelMes } from "@/lib/fechas";
import type { Compra, Egreso } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";

const PER_PAGE = 8;

export function EgresosView() {
  const { filtro, sede, sedeOperativa } = useSede();
  const { can } = useAuth();
  const [tab, setTab] = useState<"egresos" | "compras">("egresos");
  const [query, setQuery] = useState("");
  const [categoria, setCategoria] = useState("Todas");
  const [estado, setEstado] = useState("Todos");
  const [desde, setDesde] = useState(primerDiaDelMes(hoyLima()));
  const [hasta, setHasta] = useState(hoyLima());
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [editar, setEditar] = useState<Egreso | null>(null);
  const puedeEditar = can("egresos.editar");
  const [foto, setFoto] = useState<string | null | undefined>(undefined);
  const verFoto = async (id: string) => {
    setFoto(null);
    try {
      setFoto(await obtenerFotoEgreso(id));
    } catch (e) {
      window.alert((e as Error).message);
      setFoto(undefined);
    }
  };

  const egresosQ = useAsync(() => listarEgresosSede(filtro, desde, hasta), [filtro, desde, hasta], []);
  const comprasQ = useAsync(() => listarCompras(filtro), [filtro], []);
  const egresos = egresosQ.data ?? [];
  const compras = comprasQ.data ?? [];

  const recargar = () => {
    egresosQ.reload();
    comprasQ.reload();
  };

  const recibir = async (c: Compra) => {
    if (!window.confirm(`¿Marcar ${c.numero} como recibida? Se ingresará el stock a la sede.`)) return;
    try {
      await recibirCompra(c.id);
      recargar();
    } catch (e) {
      window.alert((e as Error).message);
    }
  };
  const anular = async (c: Compra) => {
    const motivo = window.prompt(`Motivo de la anulación de ${c.numero} (obligatorio):`);
    if (!motivo) return;
    try {
      await anularCompra(c.id, motivo);
      recargar();
    } catch (e) {
      window.alert((e as Error).message);
    }
  };

  const egresosFiltrados = useMemo(
    () =>
      egresos.filter((e) => {
        const q = query.toLowerCase();
        const okQ = !q || [e.concepto, e.proveedor, e.numeroDocumento, e.usuario].some((t) => (t ?? "").toLowerCase().includes(q));
        return okQ && (categoria === "Todas" || e.categoria === categoria);
      }),
    [egresos, query, categoria]
  );
  const comprasFiltradas = useMemo(
    () =>
      compras.filter((c) => {
        const q = query.toLowerCase();
        return (!q || c.numero.toLowerCase().includes(q) || c.proveedor.toLowerCase().includes(q)) && (estado === "Todos" || c.estado === estado);
      }),
    [compras, query, estado]
  );

  const lista = tab === "egresos" ? egresosFiltrados : comprasFiltradas;
  const totalPages = Math.max(1, Math.ceil(lista.length / PER_PAGE));
  const pagina = lista.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const totalEgresos = egresosFiltrados.reduce((a, e) => a + e.monto, 0);
  const porCategoria = CATEGORIAS_EGRESO.map((c) => ({ c, t: egresos.filter((e) => e.categoria === c).reduce((a, e) => a + e.monto, 0) })).filter((x) => x.t > 0);

  const tabBtn = (k: "egresos" | "compras", texto: string, Icon: typeof Receipt) => (
    <button
      onClick={() => {
        setTab(k);
        setPage(1);
      }}
      className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold ${
        tab === k ? "bg-blue-600 text-white" : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
      }`}
    >
      <Icon className="h-4 w-4" /> {texto}
    </button>
  );

  return (
    <div>
      <PageHeader
        title="Egresos"
        subtitle={`Gastos, pagos y compras de insumos · ${sede.nombre}`}
        actions={
          (can("compras.crear") || can("cajas.egresos")) && (
            <button
              onClick={() => setOpen(true)}
              disabled={!sedeOperativa}
              title={sedeOperativa ? undefined : "Elige una sede concreta para registrar el egreso"}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-sm disabled:opacity-50 ${tab === "compras" ? "bg-blue-600 hover:bg-blue-700" : "bg-red-600 hover:bg-red-700"}`}
            >
              <Plus className="h-4 w-4" /> {tab === "compras" ? "Registrar Compra" : "Registrar Egreso"}
            </button>
          )
        }
      />

      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {tabBtn("egresos", "Egresos", ArrowDownCircle)}
          {tabBtn("compras", "Compras de insumos", ShoppingBasket)}
        </div>

        {tab === "compras" ? (
          <ComprasMetricas compras={compras} />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="rounded-lg bg-red-100 p-3"><ArrowDownCircle className="h-6 w-6 text-red-600" /></div>
              <div>
                <p className="text-sm text-gray-500">Total egresos</p>
                <p className="text-lg font-bold text-gray-900">{formatCurrency(totalEgresos)}</p>
              </div>
            </div>
            {porCategoria.slice(0, 3).map((x) => (
              <div key={x.c} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                <p className="text-sm text-gray-500">{x.c}</p>
                <p className="text-lg font-bold text-gray-900">{formatCurrency(x.t)}</p>
              </div>
            ))}
          </div>
        )}

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
                placeholder={tab === "egresos" ? "Buscar concepto, proveedor o documento..." : "Buscar por número o proveedor..."}
                className="w-full rounded-lg border border-gray-300 py-2.5 pl-10 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </div>
            {tab === "egresos" ? (
              <>
                <select value={categoria} onChange={(e) => { setCategoria(e.target.value); setPage(1); }} className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none">
                  {["Todas", ...CATEGORIAS_EGRESO].map((c) => <option key={c}>{c}</option>)}
                </select>
                <input type="date" value={desde} max={hasta} onChange={(e) => e.target.value && setDesde(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none" />
                <input type="date" value={hasta} min={desde} onChange={(e) => e.target.value && setHasta(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none" />
              </>
            ) : (
              <select value={estado} onChange={(e) => { setEstado(e.target.value); setPage(1); }} className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none">
                <option value="Todos">Todos los estados</option>
                <option value="recibida">Recibida</option>
                <option value="pendiente">Pendiente</option>
                <option value="anulada">Anulada</option>
              </select>
            )}
          </div>

          {tab === "compras" ? (
            <ComprasTable
              compras={pagina as Compra[]}
              onRecibir={can("compras.crear") ? recibir : undefined}
              onAnular={can("compras.anular") ? anular : undefined}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Fecha</th>
                    <th className="px-4 py-3 font-semibold">Categoría</th>
                    <th className="px-4 py-3 font-semibold">Concepto</th>
                    <th className="px-4 py-3 font-semibold">Proveedor / A nombre de</th>
                    <th className="px-4 py-3 font-semibold">Documento</th>
                    <th className="px-4 py-3 text-right font-semibold">Monto</th>
                    {puedeEditar && <th className="px-4 py-3 text-center font-semibold">Acciones</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {(pagina as typeof egresos).map((e) => (
                    <tr key={e.id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-4 py-3 text-gray-500">{e.fechaEgreso ? fmtIsoCorta(e.fechaEgreso) : "—"}</td>
                      <td className="px-4 py-3"><span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-700">{e.categoria}</span></td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{e.concepto}</p>
                        <p className="text-xs text-gray-400">{e.usuario}{e.enCaja ? " · descontado de caja" : ""}{e.observaciones ? ` · ${e.observaciones}` : ""}</p>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{e.proveedor || "—"}</td>
                      <td className="px-4 py-3 text-gray-600">
                        {[e.tipoDocumento, e.numeroDocumento].filter(Boolean).join(" ") || "—"}
                        {e.tieneFoto && (
                          <button onClick={() => verFoto(e.id)} className="ml-2 text-xs font-semibold text-blue-600 hover:underline">foto</button>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-red-600">- {formatCurrency(e.monto)}</td>
                      {puedeEditar && (
                        <td className="px-4 py-3 text-center">
                          {e.compraId ? (
                            <span className="text-xs text-gray-400" title="Se edita desde la compra">—</span>
                          ) : (
                            <button onClick={() => setEditar(e)} title="Editar egreso" className="rounded-lg p-2 text-gray-500 hover:bg-blue-50 hover:text-blue-600">
                              <Pencil className="h-4 w-4" />
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                  {egresosFiltrados.length === 0 && (
                    <tr><td colSpan={puedeEditar ? 7 : 6} className="px-4 py-10 text-center text-gray-500">No hay egresos en este rango.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} totalItems={lista.length} itemsPerPage={PER_PAGE} />
        </Card>
      </div>

      <ModalRegistrarEgreso
        open={open && tab === "egresos"}
        sedeId={sedeOperativa?.id ?? null}
        onClose={() => setOpen(false)}
        onDone={() => {
          setOpen(false);
          recargar();
        }}
      />
      <ModalRegistrarEgreso
        open={!!editar}
        egreso={editar}
        sedeId={editar?.sedeId ?? null}
        onClose={() => setEditar(null)}
        onDone={() => {
          setEditar(null);
          recargar();
        }}
      />
      <ModalRegistrarCompra
        open={open && tab === "compras"}
        sedeId={sedeOperativa?.id ?? null}
        onClose={() => setOpen(false)}
        onDone={() => {
          setOpen(false);
          recargar();
        }}
      />
      <Modal open={foto !== undefined} onClose={() => setFoto(undefined)} title="Foto del comprobante" size="lg">
        {foto ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={foto} alt="Comprobante" className="mx-auto max-h-[70vh] object-contain" />
        ) : (
          <p className="py-10 text-center text-sm text-gray-400">{foto === null ? "Cargando…" : ""}</p>
        )}
      </Modal>
    </div>
  );
}
