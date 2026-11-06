"use client";

import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { AvatarMarkit, ChatAsistente } from "./ChatAsistente";

/** Pantalla «Asistente»: preguntas predeterminadas sobre cómo usar el sistema. */
export function AsistenteView() {
  return (
    <div>
      <PageHeader title="Asistente Markit" subtitle="Aprende a usar el sistema eligiendo una pregunta" />
      <Card className="mx-auto flex max-w-4xl flex-col overflow-hidden">
        <div className="flex items-center gap-3 border-b border-gray-100 bg-gradient-to-r from-pink-50 to-white px-5 py-4">
          <AvatarMarkit className="h-11 w-11" />
          <div>
            <p className="text-sm font-bold text-gray-900">Asistente Markit</p>
            <p className="text-xs text-gray-500">Guía rápida del sistema</p>
          </div>
        </div>
        <ChatAsistente altura="420px" />
      </Card>
    </div>
  );
}
