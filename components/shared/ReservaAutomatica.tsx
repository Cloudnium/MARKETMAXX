"use client";

import { useEffect } from "react";
import { useAuth } from "./AuthProvider";
import { useSede } from "./SedeProvider";
import { useConexion } from "@/lib/net/useConexion";
import { listarCajas } from "@/lib/data/cajas";
import { listarProductos } from "@/lib/data/productos";
import { mantenerReserva } from "@/lib/offline/auto";
import { iniciarMotor } from "@/lib/offline/motor";
import { useOffline } from "@/lib/offline/useOffline";

/**
 * No dibuja nada. Con internet y una caja abierta en la sede activa, deja reservado en segundo plano el stock
 * que la caja podrá vender si se cae el internet (sin botones ni pasos manuales).
 */
export function ReservaAutomatica() {
  const { perfil, can } = useAuth();
  const { sedeOperativa } = useSede();
  const conexion = useConexion();
  const of = useOffline();
  // cuando la reserva se usa/devuelve, se vuelve a evaluar enseguida (sin esperar al ciclo de 5 min)
  const reservas = of.leases.length;
  const sedeId = sedeOperativa?.id;
  const activo = !!perfil && !!sedeId && can("ventas.crear") && conexion === "online";

  useEffect(() => {
    if (!activo || !sedeId) return;
    iniciarMotor();
    let vivo = true;
    const tick = async () => {
      try {
        const cajas = (await listarCajas(sedeId)).filter((c) => c.estado === "abierta");
        if (!vivo || cajas.length === 0) return;
        // la caja de este cajero (si hay varias abiertas en la sede, la suya; si no, la primera)
        const caja = cajas.find((c) => c.usuario === perfil?.nombre) ?? cajas[0];
        await mantenerReserva({ sedeId, cajaId: caja.id, cargarProductos: () => listarProductos(sedeId) });
      } catch {
        /* se reintenta en el siguiente ciclo */
      }
    };
    void tick();
    const t = setInterval(tick, 5 * 60_000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [activo, sedeId, perfil?.nombre, reservas]);

  return null;
}
