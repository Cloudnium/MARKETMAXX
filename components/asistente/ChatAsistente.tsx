"use client";

import { MessageCircleQuestion, RotateCcw, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CATEGORIAS, type Pregunta, type Respuesta } from "./preguntas";

type Mensaje = { id: number; rol: "bot"; respuesta: Respuesta } | { id: number; rol: "user"; texto: string };

const saludo: Mensaje = {
  id: 0,
  rol: "bot",
  respuesta: {
    intro: "¡Hola! Soy Markit, tu asistente del sistema. Elige una pregunta de la lista y te explico paso a paso cómo hacerlo.",
  },
};

/** Avatar del asistente (el GIF recortado en círculo). */
export function AvatarMarkit({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <span className={`relative block shrink-0 overflow-hidden rounded-full bg-white ring-1 ring-black/10 ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/asistente/markit.gif" alt="Asistente Markit" className="h-full w-full scale-[1.2] object-cover" style={{ transformOrigin: "50% 47%" }} draggable={false} />
    </span>
  );
}

/**
 * Conversación con preguntas predeterminadas (el usuario no escribe, solo elige).
 * Se usa en la pantalla «Asistente» y en la ventana flotante.
 */
export function ChatAsistente({ compacto = false, altura }: { compacto?: boolean; altura: string }) {
  const [mensajes, setMensajes] = useState<Mensaje[]>([saludo]);
  const [categoria, setCategoria] = useState(CATEGORIAS[0].id);
  const contenedor = useRef<HTMLDivElement>(null);
  const actual = CATEGORIAS.find((c) => c.id === categoria) ?? CATEGORIAS[0];

  useEffect(() => {
    const el = contenedor.current;
    if (el && mensajes.length > 1) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [mensajes]);

  const preguntar = (p: Pregunta) => {
    const id = Date.now();
    setMensajes((prev) => [...prev, { id, rol: "user", texto: p.texto }, { id: id + 1, rol: "bot", respuesta: p.respuesta }]);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="chat-asistente">
      <div ref={contenedor} className={`space-y-3 overflow-y-auto bg-gray-50 ${compacto ? "p-3" : "p-5"}`} style={{ height: altura, flex: compacto ? "1 1 auto" : undefined }}>
        {mensajes.map((m) => (
          <div key={m.id} className={`flex items-start gap-2 ${m.rol === "user" ? "flex-row-reverse" : ""}`}>
            {m.rol === "bot" ? (
              <AvatarMarkit className="h-8 w-8" />
            ) : (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600">
                <User className="h-4 w-4" />
              </div>
            )}
            <div
              className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ${
                m.rol === "bot" ? "rounded-tl-sm bg-white text-gray-700 shadow-sm" : "rounded-tr-sm bg-blue-600 text-white"
              }`}
            >
              {m.rol === "user" ? m.texto : <RespuestaBot r={m.respuesta} />}
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-gray-100 bg-white p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            <MessageCircleQuestion className="h-3.5 w-3.5" /> Elige un tema y una pregunta
          </p>
          <button
            onClick={() => setMensajes([saludo])}
            disabled={mensajes.length <= 1}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-gray-500 hover:bg-gray-100 disabled:opacity-40"
          >
            <RotateCcw className="h-3 w-3" /> Nueva consulta
          </button>
        </div>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {CATEGORIAS.map((c) => (
            <button
              key={c.id}
              onClick={() => setCategoria(c.id)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${c.id === categoria ? "bg-pink-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
            >
              {c.nombre}
            </button>
          ))}
        </div>
        <div className={`flex flex-wrap gap-1.5 ${compacto ? "max-h-28 overflow-y-auto" : ""}`}>
          {actual.preguntas.map((p) => (
            <button
              key={p.id}
              onClick={() => preguntar(p)}
              className="rounded-full border border-pink-200 bg-pink-50 px-3 py-1.5 text-left text-xs font-medium text-pink-700 transition-colors hover:bg-pink-100"
            >
              {p.texto}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function RespuestaBot({ r }: { r: Respuesta }) {
  return (
    <div className="space-y-2">
      {r.intro && <p>{r.intro}</p>}
      {r.pasos && (
        <ol className="list-decimal space-y-1 pl-5">
          {r.pasos.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ol>
      )}
      {r.nota && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">💡 {r.nota}</p>}
    </div>
  );
}

