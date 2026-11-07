"use client";

import { useEffect } from "react";
import { useAuth } from "./AuthProvider";
import { useSede } from "./SedeProvider";
import { useConexion } from "@/lib/net/useConexion";
import { iniciarMotor } from "@/lib/offline/motor";

/**
 * No dibuja nada. Con internet arranca el motor offline (cola de ventas y sincronización).
 * Ya NO aparta stock por adelantado: el stock queda 100% libre para todas las cajas, ajustes y traslados.
 * Si se cae el internet se vende con el último stock conocido y, al volver, las ventas se envían solas;
 * cualquier reserva que haya quedado de antes se devuelve sola al stock general al sincronizar.
 */
export function ReservaAutomatica() {
  const { perfil, can } = useAuth();
  const { sedeOperativa } = useSede();
  const conexion = useConexion();
  const activo = !!perfil && !!sedeOperativa?.id && can("ventas.crear") && conexion === "online";

  useEffect(() => {
    if (activo) iniciarMotor();
  }, [activo]);

  return null;
}
