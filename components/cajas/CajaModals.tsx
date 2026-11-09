"use client";

import { useEffect, useState } from "react";
import { ArrowDownCircle, Loader2, Plus, Wallet } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useAsync } from "@/lib/hooks/useAsync";
import { useAuth } from "@/components/shared/AuthProvider";
import {
  abrirCaja,
  abrirMiCaja,
  cerrarCaja,
  crearCaja,
  listarEgresos,
  registrarEgreso,
} from "@/lib/data/cajas";
import type { Caja, Sede } from "@/lib/types";
import { formatCurrency, formatDateTime } from "@/lib/utils";

const inputClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100";

const btnCancel =
  "rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50";

/** Ejecuta una acción mostrando estado de carga y error dentro del modal. */
function useAccion(onDone: () => void) {
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ejecutar = async (fn: () => Promise<unknown>) => {
    setCargando(true);
    setError(null);
    try {
      await fn();
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  };
  return { cargando, error, ejecutar, setError };
}

const ErrorBox = ({ msg }: { msg: string | null }) =>
  msg ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{msg}</p> : null;

export function ModalNuevaCaja({
  open,
  sede,
  onClose,
  onDone,
}: {
  open: boolean;
  sede: Sede | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { perfil, can } = useAuth();
  const [nombre, setNombre] = useState("");
  const [monto, setMonto] = useState("");
  const { cargando, error, ejecutar, setError } = useAccion(onDone);

  useEffect(() => {
    if (open) {
      setNombre("");
      setMonto("");
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nueva Caja"
      subtitle="Crea una caja en la sede y, si quieres, ábrela de inmediato"
      size="md"
      footer={
        <>
          <button onClick={onClose} className={btnCancel}>Cancelar</button>
          <button
            disabled={cargando || !sede || !nombre.trim()}
            onClick={() =>
              ejecutar(() =>
                crearCaja(sede!.id, nombre, can("cajas.abrir") && monto !== "" ? Number(monto) : null)
              )
            }
            className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-60"
          >
            {cargando && <Loader2 className="h-4 w-4 animate-spin" />}
            {monto !== "" ? "Crear y abrir caja" : "Crear caja"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorBox msg={error} />
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">Nombre de la caja</label>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Caja 5" className={inputClass} />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">Sede</label>
          <input value={sede?.nombre ?? ""} disabled className={`${inputClass} bg-gray-50 text-gray-500`} />
        </div>
        {can("cajas.abrir") && (
          <>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                Monto de apertura (S/) <span className="font-normal text-gray-400">· opcional, abre la caja</span>
              </label>
              <input type="number" min={0} value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="Dejar vacío para no abrirla" className={inputClass} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">Usuario responsable</label>
              <input value={perfil?.nombre ?? ""} disabled className={`${inputClass} bg-gray-50 text-gray-500`} />
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

export function ModalCierreCaja({
  caja,
  open,
  onClose,
  onDone,
}: {
  caja: Caja | null;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [contado, setContado] = useState("");
  const [obs, setObs] = useState("");
  const { cargando, error, ejecutar, setError } = useAccion(onDone);

  useEffect(() => {
    if (open) {
      setContado("");
      setObs("");
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!caja) return null;
  // lo que debe haber en la gaveta: apertura + lo cobrado en EFECTIVO - egresos (tarjeta, Yape y transferencia no entran)
  const efectivo = caja.ingresosEfectivo ?? caja.ingresos;
  const digital = Math.max(0, caja.ingresos - efectivo);
  const esperado = Math.round(((caja.montoApertura ?? 0) + efectivo - caja.egresos) * 100) / 100;
  const diferencia = contado === "" ? null : Math.round((Number(contado) - esperado) * 100) / 100;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Cierre de ${caja.nombre}`}
      subtitle={`${caja.tienda} · ${caja.usuario}`}
      size="md"
      footer={
        <>
          <button onClick={onClose} className={btnCancel}>Cancelar</button>
          <button
            disabled={cargando}
            onClick={() => ejecutar(() => cerrarCaja(caja.id, contado === "" ? null : Number(contado), obs))}
            className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
          >
            {cargando && <Loader2 className="h-4 w-4 animate-spin" />} Confirmar cierre
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorBox msg={error} />
        <div className="rounded-lg border border-gray-200">
          <div className="space-y-2.5 p-4 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Apertura</span>
              <span className="font-semibold text-gray-700">{formatCurrency(caja.montoApertura ?? 0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Ventas en efectivo</span>
              <span className="font-semibold text-green-600">+ {formatCurrency(efectivo)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Egresos</span>
              <span className="font-semibold text-red-600">- {formatCurrency(caja.egresos)}</span>
            </div>
            <div className="flex justify-between border-t border-dashed border-gray-200 pt-2.5">
              <span className="font-bold text-gray-900">Efectivo que debe haber</span>
              <span className="text-lg font-bold text-green-600">{formatCurrency(esperado)}</span>
            </div>
            {digital > 0 && (
              <p className="text-xs text-gray-400">
                Además hubo {formatCurrency(digital)} en tarjeta, Yape o transferencia (no entra a la gaveta). Total vendido: {formatCurrency(caja.ingresos)}.
              </p>
            )}
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">
            Efectivo contado (S/) <span className="font-normal text-gray-400">· opcional, para calcular diferencia</span>
          </label>
          <input type="number" min={0} value={contado} onChange={(e) => setContado(e.target.value)} className={inputClass} />
          {diferencia !== null && (
            <p className={`mt-1 text-xs font-semibold ${diferencia === 0 ? "text-green-600" : "text-amber-600"}`}>
              {diferencia === 0 ? "Cuadra exacto." : `Diferencia: ${diferencia > 0 ? "+" : "-"} ${formatCurrency(Math.abs(diferencia))} (${diferencia > 0 ? "sobra" : "falta"})`}
            </p>
          )}
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">Observaciones</label>
          <textarea rows={3} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Observaciones del cierre (opcional)" className={inputClass} />
        </div>
      </div>
    </Modal>
  );
}

export function ModalReporteCaja({
  caja,
  open,
  onClose,
}: {
  caja: Caja | null;
  open: boolean;
  onClose: () => void;
}) {
  const egresos = useAsync(
    () => (open && caja?.sesionId ? listarEgresos(caja.sesionId) : Promise.resolve([])),
    [open, caja?.sesionId],
    []
  );
  if (!caja) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Reporte de ${caja.nombre}`}
      subtitle={`${caja.tienda}${caja.fechaApertura ? ` · ${formatDateTime(caja.fechaApertura)}` : ""}`}
      size="lg"
      footer={
        <button onClick={onClose} className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
          Cerrar reporte
        </button>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            { label: "Ingresos", value: formatCurrency(caja.ingresos), color: "text-green-600" },
            { label: "Egresos", value: formatCurrency(caja.egresos), color: "text-red-600" },
            { label: "Ventas", value: caja.ventas.toString(), color: "text-blue-600" },
          ].map((m) => (
            <div key={m.label} className="rounded-lg bg-gray-50 p-3">
              <p className="text-xs text-gray-500">{m.label}</p>
              <p className={`text-sm font-bold ${m.color}`}>{m.value}</p>
            </div>
          ))}
        </div>

        <div className="overflow-hidden rounded-lg border border-gray-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Concepto</th>
                <th className="px-4 py-2.5 font-semibold">Fecha</th>
                <th className="px-4 py-2.5 text-right font-semibold">Monto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              <tr>
                <td className="px-4 py-2.5 text-gray-700">Apertura de caja</td>
                <td className="px-4 py-2.5 text-gray-500">{caja.fechaApertura ? formatDateTime(caja.fechaApertura) : "—"}</td>
                <td className="px-4 py-2.5 text-right font-semibold text-gray-700">{formatCurrency(caja.montoApertura ?? 0)}</td>
              </tr>
              <tr>
                <td className="px-4 py-2.5 text-gray-700">Ventas del turno ({caja.ventas})</td>
                <td className="px-4 py-2.5 text-gray-500">—</td>
                <td className="px-4 py-2.5 text-right font-semibold text-green-600">+ {formatCurrency(caja.ingresos)}</td>
              </tr>
              {(egresos.data ?? []).map((e) => (
                <tr key={e.id}>
                  <td className="px-4 py-2.5 text-gray-700">{e.concepto}</td>
                  <td className="px-4 py-2.5 text-gray-500">{formatDateTime(e.fecha)}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-red-600">- {formatCurrency(e.monto)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between rounded-lg bg-green-50 px-4 py-3">
          <span className="text-sm font-bold text-gray-900">Saldo final</span>
          <span className="text-xl font-bold text-green-600">{formatCurrency(caja.ingresos - caja.egresos)}</span>
        </div>
      </div>
    </Modal>
  );
}

export function ModalEgresosCaja({
  caja,
  open,
  onClose,
  onDone,
}: {
  caja: Caja | null;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { can, perfil } = useAuth();
  const [showForm, setShowForm] = useState(false);
  const [concepto, setConcepto] = useState("");
  const [monto, setMonto] = useState("");
  const egresos = useAsync(
    () => (open && caja?.sesionId ? listarEgresos(caja.sesionId) : Promise.resolve([])),
    [open, caja?.sesionId],
    []
  );
  const { cargando, error, ejecutar, setError } = useAccion(() => {
    setShowForm(false);
    setConcepto("");
    setMonto("");
    egresos.reload();
    onDone();
  });

  useEffect(() => {
    if (!open) {
      setShowForm(false);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!caja) return null;
  const lista = egresos.data ?? [];
  const total = lista.reduce((a, e) => a + e.monto, 0);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Egresos de ${caja.nombre}`}
      subtitle="Registra y revisa los egresos del turno"
      size="lg"
      footer={
        <button onClick={onClose} className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
          Cerrar
        </button>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-lg bg-red-50 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-red-700">
            <ArrowDownCircle className="h-5 w-5" /> Total egresos
          </div>
          <span className="text-lg font-bold text-red-600">{formatCurrency(total)}</span>
        </div>

        {caja.estado === "abierta" && can("cajas.egresos") && (!caja.usuarioId || caja.usuarioId === perfil?.id || can("cajas.supervisar")) && (
          <button
            onClick={() => setShowForm((v) => !v)}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" /> Registrar egreso
          </button>
        )}

        {showForm && (
          <div className="grid grid-cols-1 gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4 sm:grid-cols-3">
            {error && <div className="sm:col-span-3"><ErrorBox msg={error} /></div>}
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-gray-700">Concepto</label>
              <input value={concepto} onChange={(e) => setConcepto(e.target.value)} placeholder="Ej. Pago de movilidad" className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">Monto (S/)</label>
              <input type="number" min={0} value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="0.00" className={inputClass} />
            </div>
            <div className="flex justify-end sm:col-span-3">
              <button
                disabled={cargando || !concepto.trim() || !(Number(monto) > 0)}
                onClick={() => ejecutar(() => registrarEgreso(caja.id, concepto, Number(monto)))}
                className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-60"
              >
                {cargando && <Loader2 className="h-4 w-4 animate-spin" />} Guardar egreso
              </button>
            </div>
          </div>
        )}

        <div className="overflow-hidden rounded-lg border border-gray-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Concepto</th>
                <th className="px-4 py-2.5 font-semibold">Fecha</th>
                <th className="px-4 py-2.5 font-semibold">Usuario</th>
                <th className="px-4 py-2.5 text-right font-semibold">Monto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lista.map((e) => (
                <tr key={e.id}>
                  <td className="px-4 py-2.5 text-gray-700">{e.concepto}</td>
                  <td className="px-4 py-2.5 text-gray-500">{formatDateTime(e.fecha)}</td>
                  <td className="px-4 py-2.5 text-gray-500">{e.usuario}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-red-600">- {formatCurrency(e.monto)}</td>
                </tr>
              ))}
              {lista.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400">Sin egresos en este turno.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}

export function ModalAbrirCaja({
  caja,
  open,
  onClose,
  onDone,
}: {
  caja: Caja | null;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { perfil } = useAuth();
  const [monto, setMonto] = useState("0");
  const { cargando, error, ejecutar, setError } = useAccion(onDone);

  useEffect(() => {
    if (open) {
      setMonto("0");
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!caja) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Abrir ${caja.nombre}`}
      subtitle={`${caja.tienda} · ${perfil?.nombre ?? ""}`}
      size="sm"
      footer={
        <>
          <button onClick={onClose} className={btnCancel}>Cancelar</button>
          <button
            disabled={cargando}
            onClick={() => ejecutar(() => abrirCaja(caja.id, Number(monto) || 0))}
            className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-60"
          >
            {cargando && <Loader2 className="h-4 w-4 animate-spin" />} Abrir caja
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorBox msg={error} />
        <div className="flex items-center gap-3 rounded-lg bg-green-50 p-4">
          <Wallet className="h-6 w-6 text-green-600" />
          <div>
            <p className="text-sm font-semibold text-green-800">¿Deseas abrir esta caja?</p>
            <p className="text-xs text-green-700">Se iniciará un nuevo turno de ventas a tu nombre.</p>
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">Monto de apertura (S/)</label>
          <input type="number" min={0} value={monto} onChange={(e) => setMonto(e.target.value)} className={inputClass} />
        </div>
      </div>
    </Modal>
  );
}

/** "Abrir mi caja": el sistema asigna solo el siguiente número de caja de la sede. */
export function ModalAbrirMiCaja({
  open,
  sede,
  onClose,
  onDone,
}: {
  open: boolean;
  sede: Sede | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { perfil } = useAuth();
  const [monto, setMonto] = useState("0");
  const { cargando, error, ejecutar, setError } = useAccion(onDone);

  useEffect(() => {
    if (open) {
      setMonto("0");
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Abrir mi caja"
      subtitle={`${sede?.nombre ?? ""} · ${perfil?.nombre ?? ""}`}
      size="sm"
      footer={
        <>
          <button onClick={onClose} className={btnCancel}>Cancelar</button>
          <button
            disabled={cargando || !sede}
            onClick={() => ejecutar(() => abrirMiCaja(sede!.id, Number(monto) || 0))}
            className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-60"
          >
            {cargando && <Loader2 className="h-4 w-4 animate-spin" />} Abrir caja
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorBox msg={error} />
        <div className="flex items-center gap-3 rounded-lg bg-green-50 p-4">
          <Wallet className="h-6 w-6 shrink-0 text-green-600" />
          <div>
            <p className="text-sm font-semibold text-green-800">El sistema asigna tu número de caja</p>
            <p className="text-xs text-green-700">Se te asignará la siguiente caja del correlativo y empezarás a vender de inmediato.</p>
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">Monto de apertura (S/)</label>
          <input type="number" min={0} value={monto} onChange={(e) => setMonto(e.target.value)} className={inputClass} />
        </div>
      </div>
    </Modal>
  );
}
