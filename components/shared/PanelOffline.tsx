"use client";

import { AlertTriangle, CheckCircle2, Cloud, CloudOff, Loader2, Printer, RefreshCw, WifiOff, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/shared/AuthProvider";
import { useConexion } from "@/lib/net/useConexion";
import { useOffline } from "@/lib/offline/useOffline";
import { anularConflicto, leaseVigente, leerSnapshot, reenviarConflicto, sincronizar, ticketDe } from "@/lib/offline/motor";
import { imprimirTicket } from "@/lib/impresion/agente";
import type { Snapshot, TipoConflicto, VentaLocal } from "@/lib/offline/tipos";
import { formatCurrency } from "@/lib/utils";

const ETIQUETA_CONFLICTO: Record<TipoConflicto, string> = {
  stock: "Sin stock",
  precio: "Precio cambió",
  caja: "Caja cerrada",
  permiso: "Sin permiso",
  sesion: "Sesión",
  lease: "Reserva vencida",
  otro: "Rechazada",
};

const hora = (ms: number) => new Date(ms).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" });

/**
 * Indicador único de estado (En línea / Sin conexión / Sincronizando / Conflictos) + panel con reservas,
 * ventas pendientes, conflictos y reimpresión con número real. Es UN solo panel: no abre modales repetidos.
 */
export function PanelOffline() {
  const { perfil } = useAuth();
  const conexion = useConexion();
  const of = useOffline();
  const [abierto, setAbierto] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [ajustando, setAjustando] = useState<string | null>(null);

  if (!perfil) return null;
  const sinRed = conexion !== "online";
  const hayAlgo = of.pendientes > 0 || of.conflictos > 0 || of.leases.length > 0 || sinRed;

  let etiqueta = "En línea";
  let color = "bg-green-600";
  let Icono = Cloud;
  if (of.conflictos > 0) { etiqueta = `Conflictos (${of.conflictos})`; color = "bg-red-600"; Icono = AlertTriangle; }
  else if (of.sincronizando) { etiqueta = `Sincronizando${of.pendientes ? ` (${of.pendientes})` : "…"}`; color = "bg-blue-600"; Icono = RefreshCw; }
  else if (sinRed) { etiqueta = `Sin conexión${of.pendientes ? ` · ${of.pendientes} pendiente(s)` : ""}`; color = "bg-gray-700"; Icono = WifiOff; }
  else if (of.pendientes > 0) { etiqueta = `${of.pendientes} por enviar`; color = "bg-amber-600"; Icono = CloudOff; }

  const conflictos = of.ventas.filter((v) => v.estado === "conflicto");
  const pendientes = of.ventas.filter((v) => v.estado === "pendiente");
  const recientes = of.ventas.filter((v) => v.estado === "sincronizada" && v.provisional).slice(0, 8);

  const reimprimir = async (v: VentaLocal) => {
    const r = await imprimirTicket(ticketDe(v));
    setMsg(r.ok ? `Ticket ${v.numero ?? v.provisional} enviado a la impresora.` : `No se pudo imprimir (${r.ok === false ? r.error : ""}). Revisa el agente de impresión.`);
  };

  return (
    <div className="relative" data-testid="panel-offline">
      {abierto && (
        <div className="absolute right-0 top-full z-[95] mt-3 w-[min(24rem,calc(100vw-2rem))] max-h-[70vh] overflow-y-auto rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-900 shadow-2xl">
          <div className="mb-2 flex items-center justify-between">
            <p className="font-bold text-gray-900">Ventas y sincronización</p>
            <button onClick={() => setAbierto(false)} aria-label="Cerrar" className="text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
          </div>
          {msg && <p className="mb-2 rounded bg-blue-50 p-2 text-xs text-blue-800">{msg}</p>}
          {of.pausaSesion && (
            <p className="mb-2 rounded bg-amber-50 p-2 text-xs text-amber-800">Inicia sesión de nuevo para enviar las ventas guardadas. No se perdió ninguna.</p>
          )}

          {!hayAlgo && <p className="text-xs text-gray-500">Todo sincronizado. No hay reservas ni ventas pendientes.</p>}

          {of.leases.length > 0 && (
            <section className="mb-3">
              <p className="mb-1 text-xs font-semibold uppercase text-gray-500">Stock reservado automáticamente (para vender sin internet)</p>
              {of.leases.map((l) => {
                const vigente = leaseVigente(l);
                const total = Object.values(l.items).reduce((s, i) => s + i.otorgado, 0);
                const usado = Object.values(l.items).reduce((s, i) => s + i.usado, 0);
                return (
                  <div key={l.leaseId} className="mb-1 flex items-center justify-between rounded-lg bg-gray-50 p-2 text-xs">
                    <span>
                      {Object.keys(l.items).length} producto(s) · {usado}/{total} usados · {vigente ? `vence ${hora(l.expiraMs - l.offsetMs)}` : "vencida"}
                    </span>
                  </div>
                );
              })}
            </section>
          )}

          {pendientes.length > 0 && (
            <section className="mb-3">
              <p className="mb-1 text-xs font-semibold uppercase text-gray-500">Pendientes de enviar</p>
              {pendientes.map((v) => (
                <div key={v.localId} className="mb-1 flex items-center justify-between rounded-lg bg-amber-50 p-2 text-xs">
                  <span><b>{v.provisional}</b> · {formatCurrency(v.total)}</span>
                  <button onClick={() => reimprimir(v)} className="text-amber-800 hover:underline"><Printer className="inline h-3 w-3" /> Ticket</button>
                </div>
              ))}
              <button onClick={() => sincronizar()} disabled={sinRed || of.sincronizando} className="mt-1 text-xs font-semibold text-blue-700 hover:underline disabled:opacity-40">
                Enviar ahora
              </button>
            </section>
          )}

          {conflictos.length > 0 && (
            <section className="mb-3">
              <p className="mb-1 text-xs font-semibold uppercase text-red-600">Conflictos (la venta se conserva)</p>
              {conflictos.map((v) => (
                <div key={v.localId} className="mb-2 rounded-lg border border-red-200 bg-red-50 p-2 text-xs" data-testid="conflicto">
                  <div className="flex items-center justify-between">
                    <b>{v.provisional} · {formatCurrency(v.total)}</b>
                    <span className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-semibold text-white">{ETIQUETA_CONFLICTO[v.conflicto?.tipo ?? "otro"]}</span>
                  </div>
                  <p className="mt-1 text-red-800">{v.conflicto?.mensaje}</p>
                  {ajustando === v.localId ? (
                    <FormAjuste v={v} onCerrar={() => setAjustando(null)} />
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-1">
                      <button onClick={() => reenviarConflicto(v.localId).catch((e) => setMsg((e as Error).message))} disabled={sinRed} className="rounded bg-gray-900 px-2 py-1 font-semibold text-white disabled:opacity-40">Reintentar</button>
                      <button onClick={() => setAjustando(v.localId)} className="rounded border border-gray-400 px-2 py-1 font-semibold text-gray-800">Ajustar</button>
                      <button onClick={() => anularConflicto(v.localId).catch((e) => setMsg((e as Error).message))} className="rounded border border-red-400 px-2 py-1 font-semibold text-red-700">Anular</button>
                    </div>
                  )}
                </div>
              ))}
            </section>
          )}

          {recientes.length > 0 && (
            <section>
              <p className="mb-1 text-xs font-semibold uppercase text-gray-500">Sincronizadas · número real</p>
              {recientes.map((v) => (
                <div key={v.localId} className="mb-1 flex items-center justify-between rounded-lg bg-green-50 p-2 text-xs">
                  <span><CheckCircle2 className="mr-1 inline h-3 w-3 text-green-600" />{v.provisional} → <b>{v.numero}</b></span>
                  <button onClick={() => reimprimir(v)} className="text-green-800 hover:underline"><Printer className="inline h-3 w-3" /> Reimprimir</button>
                </div>
              ))}
            </section>
          )}
        </div>
      )}
      <button
        onClick={() => setAbierto((a) => !a)}
        data-testid="estado-red"
        aria-label={etiqueta}
        title={etiqueta}
        className={`inline-flex items-center gap-2 rounded-xl ${color} px-3 py-2 text-sm font-semibold text-white ring-1 ring-white/20 transition-opacity hover:opacity-90`}
      >
        {of.sincronizando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icono className="h-3.5 w-3.5" />}
        <span className="hidden sm:inline">{etiqueta}</span>
      </button>
    </div>
  );
}

function FormAjuste({ v, onCerrar }: { v: VentaLocal; onCerrar: () => void }) {
  const [snap, setSnap] = useState<Snapshot | undefined>();
  const [cant, setCant] = useState<Record<string, number>>(Object.fromEntries(v.items.map((i) => [i.productoId, i.cantidad])));
  const [precio, setPrecio] = useState(v.conflicto?.tipo === "precio");
  const [caja, setCaja] = useState(v.cajaId);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => void leerSnapshot(v.sedeId).then(setSnap), [v.sedeId]);

  const enviar = async () => {
    setError(null);
    try {
      await reenviarConflicto(v.localId, {
        aceptarPrecio: precio,
        cajaId: caja,
        cajaNombre: snap?.cajas.find((c) => c.id === caja)?.nombre,
        items: v.items.map((i) => ({ productoId: i.productoId, cantidad: cant[i.productoId] ?? i.cantidad })),
      });
      onCerrar();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="mt-2 space-y-2 rounded bg-white p-2">
      {v.items.map((i) => (
        <label key={i.productoId} className="flex items-center justify-between gap-2">
          <span className="truncate">{i.nombre}</span>
          <input type="number" min={0} value={cant[i.productoId]} onChange={(e) => setCant({ ...cant, [i.productoId]: Number(e.target.value) })} className="w-16 rounded border border-gray-300 px-1 py-0.5 text-right" />
        </label>
      ))}
      {snap && snap.cajas.length > 1 && (
        <label className="flex items-center justify-between gap-2">
          <span>Caja</span>
          <select value={caja} onChange={(e) => setCaja(e.target.value)} className="rounded border border-gray-300 px-1 py-0.5">
            {snap.cajas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </label>
      )}
      <label className="flex items-center gap-2"><input type="checkbox" checked={precio} onChange={(e) => setPrecio(e.target.checked)} /> Aceptar el precio actual del servidor</label>
      {error && <p className="text-red-700">{error}</p>}
      <div className="flex gap-1">
        <button onClick={enviar} className="rounded bg-gray-900 px-2 py-1 font-semibold text-white">Reenviar ajustada</button>
        <button onClick={onCerrar} className="rounded border border-gray-300 px-2 py-1">Cancelar</button>
      </div>
    </div>
  );
}
