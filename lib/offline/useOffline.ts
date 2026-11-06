"use client";

import { useEffect, useSyncExternalStore } from "react";
import { iniciarMotor, leerEstadoOffline, suscribirOffline } from "./motor";
import type { EstadoOffline } from "./tipos";

const vacio: EstadoOffline = { pendientes: 0, conflictos: 0, sincronizando: false, pausaSesion: false, leases: [], ventas: [], ultimoSync: null };

export function useOffline(): EstadoOffline {
  useEffect(() => iniciarMotor(), []);
  return useSyncExternalStore(suscribirOffline, leerEstadoOffline, () => vacio);
}
