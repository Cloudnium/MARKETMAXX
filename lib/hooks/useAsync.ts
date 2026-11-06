"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { alRevalidar, iniciarConexion } from "@/lib/net/conexion";

/**
 * Carga datos asíncronos y los recarga cuando cambian las dependencias.
 * Además se refresca solo (sin parpadeo) al reconectar, al volver a la pestaña o recuperar el foco.
 * Si una recarga falla, conserva los datos que ya tenía (no deja la pantalla vacía).
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[], initial?: T) {
  const [data, setData] = useState<T | undefined>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const silencioso = useRef(false);
  const enCurso = useRef(false);

  useEffect(() => {
    let vivo = true;
    const callada = silencioso.current;
    silencioso.current = false;
    if (!callada) setLoading(true);
    enCurso.current = true;
    fnRef
      .current()
      .then((d) => {
        if (!vivo) return;
        setData(d);
        setError(null);
      })
      .catch((e: Error) => vivo && setError(e.message))
      .finally(() => {
        enCurso.current = false;
        if (vivo) setLoading(false);
      });
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    iniciarConexion();
    return alRevalidar(() => {
      if (enCurso.current) return;
      silencioso.current = true;
      setTick((t) => t + 1);
    });
  }, []);

  return { data, loading, error, reload, setData };
}
