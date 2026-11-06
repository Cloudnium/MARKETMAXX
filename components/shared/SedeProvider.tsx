"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { TODAS_LAS_SEDES, sedeFiltro, sedeGlobal } from "@/lib/sede-utils";
import { createClient } from "@/lib/supabase/client";
import type { Sede } from "@/lib/types";
import { useAuth } from "./AuthProvider";

interface SedeContextValue {
  /** UUID de la sede activa, o "todas". */
  sedeId: string;
  sede: Sede;
  /** Sedes a las que el usuario puede acceder. */
  sedes: Sede[];
  sedesConTodas: Sede[];
  isTodas: boolean;
  /** UUID para filtrar consultas (null = todas las sedes visibles). */
  filtro: string | null;
  /** Sede concreta para operar (ventas, compras...). null si está en "todas". */
  sedeOperativa: Sede | null;
  setSedeId: (sedeId: string) => void;
  nombreSede: (id?: string | null) => string;
}

const SedeContext = createContext<SedeContextValue | null>(null);
const storageKey = (uid: string) => `market.sedeId.${uid}`;

export function SedeProvider({ children }: { children: ReactNode }) {
  const { perfil, sedes } = useAuth();
  const [sedeId, setSedeIdState] = useState<string>(TODAS_LAS_SEDES);

  const permiteTodas = sedes.length > 1;

  // Resuelve la sede inicial: guardada > predeterminada > primera
  useEffect(() => {
    if (!perfil || sedes.length === 0) return;
    const guardada = window.localStorage.getItem(storageKey(perfil.id));
    const valida = (id: string | null) =>
      !!id && ((id === TODAS_LAS_SEDES && permiteTodas) || sedes.some((s) => s.id === id));
    if (valida(guardada)) setSedeIdState(guardada!);
    else if (valida(perfil.sedePredeterminadaId)) setSedeIdState(perfil.sedePredeterminadaId!);
    else setSedeIdState(sedes[0].id);
  }, [perfil, sedes, permiteTodas]);

  const setSedeId = useCallback(
    (next: string) => {
      setSedeIdState(next);
      if (!perfil) return;
      window.localStorage.setItem(storageKey(perfil.id), next);
      if (next !== TODAS_LAS_SEDES) {
        // recuerda la sede elegida como predeterminada en la BD
        createClient().rpc("elegir_sede_predeterminada", { p_sede: next }).then(() => {});
      }
    },
    [perfil]
  );

  const value = useMemo<SedeContextValue>(() => {
    const sedesConTodas = permiteTodas ? [sedeGlobal, ...sedes] : sedes;
    const actual =
      sedeId === TODAS_LAS_SEDES ? sedeGlobal : sedes.find((s) => s.id === sedeId) ?? sedes[0] ?? sedeGlobal;
    const isTodas = actual.id === TODAS_LAS_SEDES;
    return {
      sedeId: actual.id,
      sede: actual,
      sedes,
      sedesConTodas,
      isTodas,
      filtro: sedeFiltro(actual.id),
      sedeOperativa: isTodas ? null : actual,
      setSedeId,
      nombreSede: (id) => sedes.find((s) => s.id === id)?.nombre ?? "—",
    };
  }, [sedeId, sedes, permiteTodas, setSedeId]);

  return <SedeContext.Provider value={value}>{children}</SedeContext.Provider>;
}

export function useSede() {
  const context = useContext(SedeContext);
  if (!context) throw new Error("useSede debe usarse dentro de SedeProvider");
  return context;
}
