"use client";

import { useEffect, useRef } from "react";

const MIN_LENGTH = 4;
const MAX_GAP_MS = 150;
const MAX_AVG_MS = 50;
const IGNORED_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock"]);

/**
 * Detecta una pistola lectora en segundo plano: acumula las teclas que llegan
 * muy rápido y, al recibir Enter (o Tab), entrega el código leído.
 */
export function useBarcodeScanner(onScan: (codigo: string) => void) {
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    let buffer = "";
    let firstAt = 0;
    let lastAt = 0;

    const reset = () => {
      buffer = "";
      firstAt = 0;
      lastAt = 0;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey) {
        reset();
        return;
      }

      if (event.key === "Enter" || event.key === "Tab") {
        if (buffer.length >= MIN_LENGTH) {
          const duracion = lastAt - firstAt;
          const promedio = buffer.length > 1 ? duracion / (buffer.length - 1) : Infinity;

          if (promedio <= MAX_AVG_MS) {
            const codigo = buffer;
            reset();
            event.preventDefault();
            event.stopPropagation();
            onScanRef.current(codigo);
            return;
          }
        }

        reset();
        return;
      }

      if (event.key.length !== 1) {
        if (!IGNORED_KEYS.has(event.key)) reset();
        return;
      }

      const now = performance.now();
      if (!lastAt || now - lastAt > MAX_GAP_MS) {
        buffer = "";
        firstAt = now;
      }

      buffer += event.key;
      lastAt = now;
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, []);
}
