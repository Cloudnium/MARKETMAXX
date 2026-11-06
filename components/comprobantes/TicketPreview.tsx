"use client";

import { useEffect, useState } from "react";
import { cargarLogoBase64 } from "@/lib/impresion/logo";
import { construirTicket, type TicketData } from "@/lib/impresion/ticket";
import { cn } from "@/lib/utils";

export function TicketPreview({ data, className }: { data: TicketData; className?: string }) {
  const [logoBase64, setLogoBase64] = useState<string | null>(null);

  useEffect(() => {
    let activo = true;
    cargarLogoBase64().then((logo) => {
      if (activo) setLogoBase64(logo);
    });
    return () => {
      activo = false;
    };
  }, []);

  const elementos = construirTicket(data, 48, {
    logoBase64: logoBase64 ?? undefined,
  });

  return (
    <div
      role="document"
      aria-label="Vista previa del ticket"
      className={cn(
        "mx-auto w-full max-w-[380px] rounded-lg border border-gray-200 bg-[#fffdf7] p-5 font-mono text-[11px] leading-[1.45] text-gray-900 shadow-inner",
        className
      )}
    >
      {elementos.map((elemento, index) => {
        if (elemento.type === "text") {
          return (
            <p
              key={index}
              className={cn(
                "whitespace-pre",
                elemento.bold && "font-bold",
                elemento.underline && "underline",
                elemento.size === "double" && "text-[15px] leading-6"
              )}
              style={{ textAlign: elemento.align ?? "left" }}
            >
              {elemento.value}
            </p>
          );
        }

        if (elemento.type === "image") {
          return (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={index}
              src={`data:image/png;base64,${elemento.base64}`}
              alt="Logo del ticket"
              className="mx-auto my-1 w-[220px] max-w-full object-contain"
            />
          );
        }

        if (elemento.type === "line") {
          return <div key={index} className="my-1.5 border-t border-dashed border-gray-400" />;
        }

        if (elemento.type === "feed") {
          return <div key={index} style={{ height: (elemento.lines ?? 1) * 6 }} />;
        }

        if (elemento.type === "cut") {
          return <div key={index} className="mt-4 border-t border-dashed border-gray-400" />;
        }

        if (elemento.type === "qr" || elemento.type === "barcode") {
          return (
            <p key={index} className="text-center text-[10px]">
              [{elemento.value}]
            </p>
          );
        }

        return null;
      })}
    </div>
  );
}
