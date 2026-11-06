"use client";

import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

const estilos = {
  success: {
    contenedor: "border-green-200 bg-white",
    icono: "bg-green-100 text-green-600",
    Icono: CheckCircle2,
  },
  error: {
    contenedor: "border-red-200 bg-white",
    icono: "bg-red-100 text-red-600",
    Icono: AlertCircle,
  },
  info: {
    contenedor: "border-blue-200 bg-white",
    icono: "bg-blue-100 text-blue-600",
    Icono: Info,
  },
};

export function Toast({
  open,
  message,
  tone = "success",
  onClose,
  duration = 6000,
}: {
  open: boolean;
  message: string;
  tone?: keyof typeof estilos;
  onClose: () => void;
  duration?: number;
}) {
  const onCloseRef = useRef(onClose);
  const estilo = estilos[tone];
  const Icono = estilo.Icono;

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => onCloseRef.current(), duration);
    return () => clearTimeout(timer);
  }, [open, duration, message]);

  if (!open) return null;

  return (
    <div
      role="status"
      className={cn(
        "fixed bottom-6 right-6 z-[100] flex w-[calc(100vw-3rem)] max-w-sm items-start gap-3 rounded-xl border p-4 shadow-2xl shadow-gray-900/15",
        estilo.contenedor
      )}
    >
      <div className={cn("rounded-lg p-2", estilo.icono)}>
        <Icono className="h-5 w-5" />
      </div>
      <p className="flex-1 pt-1 text-sm font-semibold text-gray-900">{message}</p>
      <button
        type="button"
        onClick={onClose}
        className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
        aria-label="Cerrar notificación"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
