"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { AvatarMarkit, ChatAsistente } from "@/components/asistente/ChatAsistente";

const KEY = "market.asistente.visto";

/**
 * Botón flotante (como el de WhatsApp) que abre al Asistente Markit en cualquier pantalla.
 * Pequeño y discreto: solo un círculo con el GIF; la ventana se abre al pulsarlo.
 */
export function BotonAsistente({ oculto = false }: { oculto?: boolean }) {
  const [abierto, setAbierto] = useState(false);
  const [nuevo, setNuevo] = useState(false);

  useEffect(() => {
    try {
      setNuevo(window.localStorage.getItem(KEY) !== "1");
    } catch {
      /* sin almacenamiento */
    }
  }, []);

  useEffect(() => {
    if (!abierto) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setAbierto(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [abierto]);

  const alternar = () => {
    setAbierto((v) => !v);
    if (nuevo) {
      setNuevo(false);
      try {
        window.localStorage.setItem(KEY, "1");
      } catch {
        /* sin almacenamiento */
      }
    }
  };

  if (oculto) return null;

  return (
    <>
      {abierto && (
        <section
          role="dialog"
          aria-label="Asistente Markit"
          data-testid="ventana-asistente"
          className="fixed bottom-[5.25rem] right-4 z-[85] flex w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl sm:right-6"
          style={{ height: "min(34rem, calc(100vh - 7.5rem))" }}
        >
          <header className="flex items-center gap-3 bg-gradient-to-r from-pink-600 to-pink-500 px-4 py-3 text-white">
            <AvatarMarkit className="h-10 w-10" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold leading-tight">Asistente Markit</p>
              <p className="text-[11px] text-pink-100">Elige una pregunta y te explico</p>
            </div>
            <button onClick={() => setAbierto(false)} aria-label="Cerrar asistente" className="rounded-full p-1.5 text-white/90 hover:bg-white/20">
              <X className="h-5 w-5" />
            </button>
          </header>
          <ChatAsistente compacto altura="auto" />
        </section>
      )}

      <button
        onClick={alternar}
        aria-label={abierto ? "Cerrar asistente" : "Abrir Asistente Markit"}
        title="Asistente Markit"
        data-testid="btn-asistente"
        className="fixed bottom-5 right-4 z-[85] h-[3.25rem] w-[3.25rem] rounded-full bg-white shadow-lg ring-2 ring-pink-500 transition-transform hover:scale-105 active:scale-95 sm:right-6"
      >
        {nuevo && !abierto && <span className="absolute inset-0 animate-ping rounded-full bg-pink-400/50" />}
        <AvatarMarkit className="relative h-full w-full ring-0" />
        {nuevo && !abierto && <span className="absolute -right-0.5 -top-0.5 h-3.5 w-3.5 rounded-full border-2 border-white bg-green-500" />}
      </button>
    </>
  );
}
