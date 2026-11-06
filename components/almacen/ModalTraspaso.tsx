"use client";

import { ModalTraslado } from "./ModalTraslado";

/**
 * Compatibilidad: el antiguo «Nuevo Traspaso» ahora es el modal de traslados.
 * Envía del almacén de esta sede al de otra sede.
 */
export function ModalTraspaso({
  open,
  onClose,
  onDone,
  productoInicial,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  productoInicial?: string | null;
}) {
  return (
    <ModalTraslado
      open={open}
      modoInicial="a_sede"
      modosPermitidos={["a_sede"]}
      productoInicial={productoInicial}
      onClose={onClose}
      onDone={onDone}
    />
  );
}
