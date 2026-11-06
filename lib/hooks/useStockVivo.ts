"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { db } from "@/lib/data/db";
import { obtenerStockVivo, type StockVivo } from "@/lib/data/stockVivo";
import { alRevalidar, leerConexion, suscribirConexion } from "@/lib/net/conexion";

/** Cada cuántos segundos se consulta el stock aunque Realtime no avise (respaldo seguro). */
export const SONDEO_STOCK_MS = 4000;

/**
 * Stock en tiempo real de una sede. Dos vías que se complementan:
 *  1) Realtime: en cuanto cambia `stock_sede` (una venta de otra caja, una compra, un traspaso…) se vuelve a consultar.
 *  2) Consulta cada pocos segundos mientras la pestaña está visible y hay conexión (por si Realtime no está activo).
 * Sin conexión conserva el último dato y se reanuda solo al volver.
 */
export function useStockVivo(sedeId: string | null) {
  const [vivo, setVivo] = useState<Map<string, StockVivo> | null>(null);
  const [actualizado, setActualizado] = useState<number | null>(null);
  const [activo, setActivo] = useState(true);
  const enCurso = useRef(false);
  const pendiente = useRef(false);

  const refrescar = useCallback(async () => {
    if (!sedeId || leerConexion() !== "online" || (typeof document !== "undefined" && document.visibilityState === "hidden")) return;
    if (enCurso.current) {
      pendiente.current = true; // llegó otro aviso mientras consultaba: se repite al terminar
      return;
    }
    enCurso.current = true;
    try {
      const m = await obtenerStockVivo(sedeId);
      setVivo(m);
      setActualizado(Date.now());
      setActivo(true);
    } catch {
      setActivo(false);
    } finally {
      enCurso.current = false;
      if (pendiente.current) {
        pendiente.current = false;
        void refrescar();
      }
    }
  }, [sedeId]);

  useEffect(() => {
    setVivo(null);
    if (!sedeId) return;
    void refrescar();
    const t = setInterval(() => void refrescar(), SONDEO_STOCK_MS);
    const quitar = alRevalidar(() => void refrescar());
    const quitarCx = suscribirConexion(() => {
      if (leerConexion() === "online") void refrescar();
    });

    // Realtime (si está habilitado en el proyecto): aviso inmediato; un pequeño margen agrupa ráfagas de cambios
    let temporizador: ReturnType<typeof setTimeout> | null = null;
    let canal: ReturnType<ReturnType<typeof db>["channel"]> | null = null;
    try {
      canal = db()
        .channel(`stock-${sedeId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "stock_sede", filter: `sede_id=eq.${sedeId}` }, () => {
          if (temporizador) return;
          temporizador = setTimeout(() => {
            temporizador = null;
            void refrescar();
          }, 250);
        })
        .subscribe();
    } catch {
      /* sin Realtime: queda la consulta periódica */
    }

    return () => {
      clearInterval(t);
      quitar();
      quitarCx();
      if (temporizador) clearTimeout(temporizador);
      if (canal) void db().removeChannel(canal);
    };
  }, [sedeId, refrescar]);

  return { vivo, actualizado, activo, refrescar };
}
