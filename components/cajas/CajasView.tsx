"use client";

import { ArrowDownCircle, ArrowUpCircle, Search, Unlock, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { SesionCard } from "./SesionCard";
import { DetalleCajaModal } from "./DetalleCajaModal";
import { ModalAbrirMiCaja, ModalCierreCaja, ModalEgresosCaja } from "./CajaModals";
import { useAsync } from "@/lib/hooks/useAsync";
import { datosSesion, listarMovimientosSesiones, listarSesiones } from "@/lib/data/cajas";
import { imprimirTicketCaja, pdfReporteCaja, type DatosCaja } from "@/lib/export/pdfCaja";
import { useAuth } from "@/components/shared/AuthProvider";
import type { Caja, SesionCaja } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";
import { fmtHora, hoyLima } from "@/lib/fechas";
import { useSede } from "@/components/shared/SedeProvider";

/** El cierre y los egresos reutilizan los modales existentes, que trabajan con "Caja". */
const comoCaja = (s: SesionCaja): Caja => ({
  id: s.cajaId,
  nombre: s.caja,
  tienda: s.sede,
  sedeId: s.sedeId,
  estado: s.estado,
  ingresos: s.ingresos,
  ingresosEfectivo: s.ingresosEfectivo,
  egresos: s.egresos,
  ventas: s.ventas,
  fechaApertura: s.fechaApertura,
  usuario: s.usuario,
  usuarioId: s.usuarioId,
  sesionId: s.id,
  montoApertura: s.montoApertura,
});

type ModalType = "abrir" | "cierre" | "egresos" | null;

export function CajasView() {
  const { filtro, sede, sedes, isTodas, sedeOperativa } = useSede();
  const { can, perfil } = useAuth();
  const [query, setQuery] = useState("");
  const [fecha, setFecha] = useState(hoyLima());
  const [modal, setModal] = useState<ModalType>(null);
  const [selected, setSelected] = useState<SesionCaja | null>(null);
  const [detalleOpen, setDetalleOpen] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const lista = useAsync(() => listarSesiones(filtro, fecha, fecha), [filtro, fecha], []);
  const sesiones = lista.data ?? [];

  const filtered = useMemo(
    () =>
      sesiones.filter(
        (s) =>
          s.caja.toLowerCase().includes(query.toLowerCase()) ||
          s.usuario.toLowerCase().includes(query.toLowerCase()) ||
          s.sede.toLowerCase().includes(query.toLowerCase())
      ),
    [sesiones, query]
  );

  // se vuelve a cargar cuando cambian los totales del turno (nuevo egreso, venta, anulación…), no solo la lista de turnos
  const movs = useAsync(() => listarMovimientosSesiones(filtered), [filtered.map((s) => `${s.id}:${s.ventas}:${s.egresos}:${s.ingresos}`).join(",")], []);
  const cajaDe = new Map(sesiones.map((s) => [s.id, s.caja]));

  const ingresosTotales = filtered.reduce((a, s) => a + s.ingresos, 0);
  const egresosTotales = filtered.reduce((a, s) => a + s.egresos, 0);

  const negocio = (s: SesionCaja) => {
    const sd = sedes.find((x) => x.id === s.sedeId) ?? sede;
    return { negocio: sd.nombre, direccion: [sd.direccion, sd.ciudad].filter(Boolean).join(" - ") || undefined };
  };
  const armar = async (s: SesionCaja): Promise<DatosCaja> => ({
    ...negocio(s),
    sesion: s,
    ...(await datosSesion(s.id)),
  });
  const ticket = (s: SesionCaja) => armar(s).then(imprimirTicketCaja);
  const descargar = (s: SesionCaja) => armar(s).then(pdfReporteCaja);
  const desdeTarjeta = async (s: SesionCaja, fn: (s: SesionCaja) => Promise<void>) => {
    setOcupado(s.id);
    try {
      await fn(s);
    } catch (e) {
      window.alert((e as Error).message);
    } finally {
      setOcupado(null);
    }
  };

  const refrescar = () => {
    setModal(null);
    lista.reload();
    movs.reload();
  };

  // el turno elegido siempre con los datos más recientes de la lista (no la copia de cuando se hizo clic)
  const turno = selected ? sesiones.find((s) => s.id === selected.id) ?? selected : null;
  // cerrar o registrar egresos: solo en la caja propia (un supervisor puede en cualquiera); el servidor lo exige igual
  const puedeOperar = (s: SesionCaja) => !s.usuarioId || s.usuarioId === perfil?.id || can("cajas.supervisar");

  const metrics = [
    { label: "Cajas Abiertas", value: filtered.filter((s) => s.estado === "abierta").length.toString(), icon: Wallet, bg: "bg-green-100", color: "text-green-600" },
    { label: "Cajas Cerradas", value: filtered.filter((s) => s.estado === "cerrada").length.toString(), icon: Wallet, bg: "bg-gray-100", color: "text-gray-600" },
    { label: "Ingresos Totales", value: formatCurrency(ingresosTotales), icon: ArrowUpCircle, bg: "bg-blue-100", color: "text-blue-600" },
    { label: "Egresos Totales", value: formatCurrency(egresosTotales), icon: ArrowDownCircle, bg: "bg-red-100", color: "text-red-600" },
  ];

  return (
    <div>
      <PageHeader
        title="Cajas del Día"
        subtitle={`Aperturas, cierres y movimientos · ${sede.nombre}`}
        actions={
          can("cajas.abrir") && (
            <button
              onClick={() => setModal("abrir")}
              disabled={!sedeOperativa}
              title={sedeOperativa ? undefined : "Elige una sede concreta para abrir tu caja"}
              className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-green-700 disabled:opacity-50"
            >
              <Unlock className="h-4 w-4" /> Abrir mi caja
            </button>
          )
        }
      />

      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {metrics.map((m) => {
            const Icon = m.icon;
            return (
              <div key={m.label} className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className={`rounded-lg p-3 ${m.bg}`}>
                  <Icon className={`h-6 w-6 ${m.color}`} />
                </div>
                <div>
                  <p className="text-sm text-gray-500">{m.label}</p>
                  <p className="text-lg font-bold text-gray-900">{m.value}</p>
                </div>
              </div>
            );
          })}
        </div>

        <Card>
          <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar caja, usuario o sede..."
                className="w-full rounded-lg border border-gray-300 py-2.5 pl-10 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </div>
            <input
              type="date"
              value={fecha}
              max={hoyLima()}
              onChange={(e) => e.target.value && setFecha(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-700 focus:border-blue-500 focus:outline-none"
            />
            <button
              onClick={() => setFecha(hoyLima())}
              className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              Hoy
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 border-t border-gray-100 p-4 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((s) => (
              <SesionCard
                key={s.id}
                sesion={s}
                mostrarSede={isTodas}
                ocupado={ocupado === s.id}
                onDetalle={() => {
                  setSelected(s);
                  setDetalleOpen(true);
                }}
                onTicket={() => desdeTarjeta(s, ticket)}
                onDescargar={() => desdeTarjeta(s, descargar)}
                onCerrar={
                  can("cajas.cerrar") && puedeOperar(s)
                    ? () => {
                        setSelected(s);
                        setModal("cierre");
                      }
                    : undefined
                }
              />
            ))}
            {filtered.length === 0 && (
              <p className="col-span-full py-10 text-center text-sm text-gray-500">
                {lista.loading ? "Cargando…" : "No hay cajas en esta fecha."}
              </p>
            )}
          </div>
        </Card>

        <Card>
          <div className="border-b border-gray-100 px-4 py-3">
            <p className="font-semibold text-gray-900">Movimientos</p>
            <p className="text-xs text-gray-500">Apertura, ventas y egresos de las cajas mostradas</p>
          </div>
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Hora</th>
                  <th className="px-4 py-3 font-semibold">Caja</th>
                  <th className="px-4 py-3 font-semibold">Detalle</th>
                  <th className="px-4 py-3 font-semibold">Método</th>
                  <th className="px-4 py-3 text-right font-semibold">Monto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(movs.data ?? []).map((m) => (
                  <tr key={m.id} className={m.anulado ? "text-gray-400 line-through" : ""}>
                    <td className="whitespace-nowrap px-4 py-2.5 text-gray-500">{fmtHora(m.fecha)}</td>
                    <td className="px-4 py-2.5 text-gray-700">{cajaDe.get(m.sesionId) ?? "—"}</td>
                    <td className="px-4 py-2.5 text-gray-900">{m.detalle}</td>
                    <td className="px-4 py-2.5 text-gray-500">{m.metodo}</td>
                    <td className={`px-4 py-2.5 text-right font-semibold ${m.monto < 0 ? "text-red-600" : "text-green-600"}`}>
                      {m.monto < 0 ? "- " : "+ "}{formatCurrency(Math.abs(m.monto))}
                    </td>
                  </tr>
                ))}
                {(movs.data ?? []).length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Sin movimientos en esta fecha.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <ModalAbrirMiCaja open={modal === "abrir"} sede={sedeOperativa} onClose={() => setModal(null)} onDone={refrescar} />
      <DetalleCajaModal
        sesion={turno}
        open={detalleOpen}
        onClose={() => setDetalleOpen(false)}
        onTicket={() => (turno ? ticket(turno) : Promise.resolve())}
        onDescargar={() => (turno ? descargar(turno) : Promise.resolve())}
        onEgreso={can("cajas.egresos") && turno && puedeOperar(turno) ? () => setModal("egresos") : undefined}
      />
      <ModalCierreCaja
        caja={turno ? comoCaja(turno) : null}
        open={modal === "cierre"}
        onClose={() => setModal(null)}
        onDone={refrescar}
      />
      <ModalEgresosCaja
        caja={turno ? comoCaja(turno) : null}
        open={modal === "egresos"}
        onClose={() => setModal(null)}
        onDone={() => {
          lista.reload();
          movs.reload();
        }}
      />
    </div>
  );
}
