"use client";

import { Bot, MessageCircleQuestion, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/shared/AuthProvider";
import { CATEGORIAS, type Pregunta, type Respuesta } from "./preguntas";
import { RespuestaBot } from "./ChatAsistente";

type Mensaje = { id: number; rol: "bot"; respuesta: Respuesta } | { id: number; rol: "user"; texto: string };

const saludo: Mensaje = {
  id: 0,
  rol: "bot",
  respuesta: {
    intro: "¡Hola! Soy Markit, tu asistente del sistema. Elige una pregunta y te explico paso a paso cómo hacerlo.",
  },
};

/** Botón flotante que abre el asistente virtual con sus preguntas predeterminadas. */
export function AsistenteFlotante() {
  const { perfil } = useAuth();
  const [abierto, setAbierto] = useState(false);
  const [mensajes, setMensajes] = useState<Mensaje[]>([saludo]);
  const [categoria, setCategoria] = useState(CATEGORIAS[0].id);
  const contenedor = useRef<HTMLDivElement>(null);
  const actual = CATEGORIAS.find((c) => c.id === categoria) ?? CATEGORIAS[0];

  useEffect(() => {
    if (!abierto) return;
    const el = contenedor.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [abierto, mensajes]);

  useEffect(() => {
    if (!abierto) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAbierto(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [abierto]);

  if (!perfil) return null;

  const preguntar = (p: Pregunta) => {
    const id = Date.now();
    setMensajes((prev) => [...prev, { id, rol: "user", texto: p.texto }, { id: id + 1, rol: "bot", respuesta: p.respuesta }]);
  };

  return (
    <div className="fixed bottom-4 right-4 z-[95] flex flex-col items-end gap-3 print:hidden">
      {abierto && (
        <div
          role="dialog"
          aria-label="Asistente Markit"
          data-testid="chat-asistente"
          className="flex h-[min(34rem,calc(100dvh_-_6rem))] w-[min(23rem,calc(100vw_-_2rem))] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl"
        >
          <div className="flex shrink-0 items-center justify-between gap-2 bg-gradient-to-r from-pink-600 to-pink-500 px-4 py-3 text-white">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="relative rounded-lg bg-white/20 p-2">
                <Bot className="h-5 w-5" />
                <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-pink-600 bg-green-400" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold">Asistente Markit</p>
                <p className="truncate text-xs text-pink-100">Preguntas frecuentes del sistema</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                onClick={() => setMensajes([saludo])}
                disabled={mensajes.length <= 1}
                title="Nueva consulta"
                aria-label="Nueva consulta"
                className="rounded-lg p-1.5 text-white/90 transition-colors hover:bg-white/20 disabled:opacity-40"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
              <button
                onClick={() => setAbierto(false)}
                title="Cerrar asistente"
                aria-label="Cerrar asistente"
                className="rounded-lg p-1.5 text-white/90 transition-colors hover:bg-white/20"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div ref={contenedor} className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-gray-50 p-3">
            {mensajes.map((m) => (
              <div key={m.id} className={`flex items-start gap-2 ${m.rol === "user" ? "flex-row-reverse" : ""}`}>
                <div
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                    m.rol === "bot" ? "bg-pink-100 text-pink-600" : "bg-blue-100 text-blue-600"
                  }`}
                >
                  <Bot className="h-3.5 w-3.5" />
                </div>
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-xs leading-relaxed ${
                    m.rol === "bot" ? "rounded-tl-sm bg-white text-gray-700 shadow-sm" : "rounded-tr-sm bg-blue-600 text-white"
                  }`}
                >
                  {m.rol === "user" ? m.texto : <RespuestaBot r={m.respuesta} />}
                </div>
              </div>
            ))}
          </div>

          <div className="shrink-0 border-t border-gray-100 bg-white p-3">
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              <MessageCircleQuestion className="h-3.5 w-3.5" /> Elige una pregunta
            </p>
            <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
              {CATEGORIAS.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setCategoria(c.id)}
                  className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                    c.id === categoria ? "bg-pink-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {c.nombre}
                </button>
              ))}
            </div>
            <div className="max-h-32 space-y-1.5 overflow-y-auto pr-1">
              {actual.preguntas.map((p) => (
                <button
                  key={p.id}
                  onClick={() => preguntar(p)}
                  className="w-full rounded-lg border border-pink-200 bg-pink-50 px-2.5 py-2 text-left text-[11px] font-medium text-pink-700 transition-colors hover:bg-pink-100"
                >
                  {p.texto}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <button
        onClick={() => setAbierto((a) => !a)}
        aria-label={abierto ? "Cerrar asistente virtual" : "Abrir asistente virtual"}
        aria-expanded={abierto}
        data-testid="btn-asistente"
        className="flex h-14 w-14 items-center justify-center rounded-full bg-pink-600 text-white shadow-xl shadow-pink-600/30 transition-colors hover:bg-pink-700 focus:outline-none focus:ring-4 focus:ring-pink-200"
      >
        {abierto ? <X className="h-6 w-6" /> : <Bot className="h-6 w-6" />}
      </button>
    </div>
  );
}
