"use client";

import { useSyncExternalStore } from "react";
import { leerConexion, suscribirConexion, type EstadoConexion } from "./conexion";

export const useConexion = (): EstadoConexion => useSyncExternalStore(suscribirConexion, leerConexion, () => "online" as const);
