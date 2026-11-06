"use client";

import { useState } from "react";
import { AlertTriangle, Loader2, Printer } from "lucide-react";
import { useAuth } from "@/components/shared/AuthProvider";
import { useSede } from "@/components/shared/SedeProvider";
import { anularVenta } from "@/lib/data/ventas";
import { Modal } from "@/components/ui/Modal";
import { Toast } from "@/components/ui/Toast";
import { TicketPreview } from "./TicketPreview";
import type { Comprobante } from "@/lib/types";
import { imprimirTicket, type TicketData } from "@/lib/impresion/agente";
import { formatDateTime } from "@/lib/utils";

export function ComprobanteDetail({
  comprobante,
  onClose,
  onAnulado,
}: {
  comprobante: Comprobante | null;
  onClose: () => void;
  onAnulado: () => void;
}) {
  const { can, perfil } = useAuth();
  const { sede, sedes } = useSede();
  const [anulando, setAnulando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imprimiendo, setImprimiendo] = useState(false);
  const [notificacion, setNotificacion] = useState<{
    mensaje: string;
    tono: "success" | "error" | "info";
  } | null>(null);
  if (!comprobante) return null;

  const sedeDocumento =
    (comprobante.sedeId && sedes.find((s) => s.id === comprobante.sedeId)) || sede;

  const ticket: TicketData = {
    numero: comprobante.numero,
    tipo: comprobante.tipo,
    fecha: comprobante.fecha,
    cliente: comprobante.cliente,
    documento: comprobante.documento,
    caja: comprobante.caja,
    vendedor: comprobante.vendedor ?? perfil?.nombre,
    metodoPago: comprobante.metodoPago,
    descuentoPct: comprobante.descuento ?? 0,
    total: comprobante.total,
    sede: {
      nombre: sedeDocumento.nombre,
      direccion: sedeDocumento.direccion,
      telefono: sedeDocumento.telefono,
      ciudad: sedeDocumento.ciudad,
    },
    items: comprobante.items.map((item) => ({
      nombre: item.producto,
      cantidad: item.cantidad,
      precio: item.precio,
    })),
  };

  const anular = async () => {
    setCargando(true);
    setError(null);
    try {
      await anularVenta(comprobante.id, motivo);
      setAnulando(false);
      setMotivo("");
      onAnulado();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  };

  const imprimir = async () => {
    setImprimiendo(true);
    const resultado = await imprimirTicket(ticket);
    setImprimiendo(false);

    if (resultado.ok) {
      setNotificacion({
        mensaje: "Comprobante enviado a la impresora.",
        tono: "success",
      });
    } else {
      setNotificacion({
        mensaje:
          "motivo" in resultado && resultado.motivo === "sin-agente"
            ? "No hay un agente vinculado. Configúralo en el módulo Impresión."
            : "No se pudo imprimir. El comprobante sigue guardado.",
        tono: "error",
      });
    }
  };

  return (
    <>
      <Modal
        open={!!comprobante}
        onClose={onClose}
        title="Vista previa del comprobante"
        subtitle={`${comprobante.numero} · ${formatDateTime(comprobante.fecha)}`}
        size="md"
        footer={
          <>
            <button
              onClick={onClose}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              Cerrar
            </button>
            {comprobante.estado === "pagado" && can("ventas.anular") && (
              <button
                onClick={() => setAnulando((v) => !v)}
                className="inline-flex items-center gap-2 rounded-lg border border-red-300 bg-white px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50"
              >
                <AlertTriangle className="h-4 w-4" /> Anular venta
              </button>
            )}
            <button
              onClick={imprimir}
              disabled={imprimiendo}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {imprimiendo ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Printer className="h-4 w-4" />
              )}
              Imprimir
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {comprobante.estado === "anulado" && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <p className="font-semibold">
                Venta anulada
                {comprobante.anuladoPor ? ` por ${comprobante.anuladoPor}` : ""}
              </p>
              {comprobante.motivoAnulacion && (
                <p className="mt-0.5 text-xs">Motivo: {comprobante.motivoAnulacion}</p>
              )}
            </div>
          )}

          {anulando && (
            <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-4">
              <p className="text-sm font-semibold text-red-700">
                Al anular, el stock vuelve al almacén de la sede y queda registrado en el
                historial.
              </p>
              {error && <p className="rounded bg-white p-2 text-xs text-red-700">{error}</p>}
              <input
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Motivo de la anulación (obligatorio)"
                className="w-full rounded-lg border border-red-300 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-100"
              />
              <button
                onClick={anular}
                disabled={cargando || motivo.trim().length < 5}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
              >
                {cargando && <Loader2 className="h-4 w-4 animate-spin" />} Confirmar anulación
              </button>
            </div>
          )}

          <TicketPreview data={ticket} />
        </div>
      </Modal>
      <Toast
        open={!!notificacion}
        message={notificacion?.mensaje ?? ""}
        tone={notificacion?.tono ?? "success"}
        onClose={() => setNotificacion(null)}
      />
    </>
  );
}
