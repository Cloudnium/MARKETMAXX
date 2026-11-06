"use client";

import { CloudOff, Loader2, RefreshCw, ShieldAlert, Wifi } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { iniciarConexion, leerConexion, revalidarTodo, sesionVencida, suscribirConexion } from "@/lib/net/conexion";
import { listaPendientes, quitarPendiente, suscribirPendientes } from "@/lib/net/pendientes";
import { verificarOperacion } from "@/lib/data/db";

const usarConexion = () =>
  useSyncExternalStore(suscribirConexion, leerConexion, () => "online" as const);
const usarSesionVencida = () => useSyncExternalStore(suscribirConexion, sesionVencida, () => false);
const usarPendientes = () => useSyncExternalStore(suscribirPendientes, listaPendientes, () => []);

/**
 * Banner global: sin conexión / servidor caído, reconexión, sesión vencida (sin cerrar nada
 * por sí solo) y operaciones con resultado incierto con botón «Verificar estado».
 */
export function EstadoRed() {
  const conexion = usarConexion();
  const vencida = usarSesionVencida();
  const pendientes = usarPendientes();
  const [reconectado, setReconectado] = useState(false);
  const [previo, setPrevio] = useState(conexion);
  const [verificando, setVerificando] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Record<string, string>>({});

  useEffect(() => iniciarConexion(), []);
  useEffect(() => {
    if (previo !== "online" && conexion === "online") {
      setReconectado(true);
      const t = setTimeout(() => setReconectado(false), 3500);
      setPrevio(conexion);
      return () => clearTimeout(t);
    }
    setPrevio(conexion);
  }, [conexion]); // eslint-disable-line react-hooks/exhaustive-deps

  const verificar = async (id: string) => {
    setVerificando(id);
    try {
      const r = await verificarOperacion(id);
      setResultado((x) => ({
        ...x,
        [id]:
          r.estado === "completada"
            ? "✔ Se guardó correctamente. No hace falta repetirla."
            : "No se guardó. Puedes volver a enviar el mismo formulario con seguridad.",
      }));
    } catch (e) {
      setResultado((x) => ({ ...x, [id]: `No se pudo verificar: ${(e as Error).message}` }));
    } finally {
      setVerificando(null);
    }
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex flex-col items-center gap-2 p-2">
      {conexion !== "online" && (
        <div role="alert" className="pointer-events-auto flex max-w-xl items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-lg">
          <CloudOff className="h-4 w-4 shrink-0" />
          {conexion === "offline"
            ? "Sin conexión a internet. Puedes ver lo cargado, pero no guardar cambios."
            : "No hay respuesta del servidor. Reintentando… no se guardarán cambios hasta que vuelva."}
          <button onClick={() => revalidarTodo(true)} className="ml-2 inline-flex items-center gap-1 rounded bg-white/20 px-2 py-0.5 text-xs hover:bg-white/30">
            <RefreshCw className="h-3 w-3" /> Reintentar
          </button>
        </div>
      )}
      {reconectado && conexion === "online" && (
        <div role="status" className="pointer-events-auto flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white shadow-lg">
          <Wifi className="h-4 w-4" /> Conexión restablecida. Actualizando datos…
        </div>
      )}
      {vencida && conexion === "online" && (
        <div role="alert" className="pointer-events-auto flex max-w-xl items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white shadow-lg">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          Tu sesión venció. Tus datos en pantalla siguen ahí; inicia sesión para continuar.
          <a href="/login" className="ml-2 rounded bg-white/25 px-2 py-0.5 text-xs hover:bg-white/35">Iniciar sesión</a>
        </div>
      )}
      {pendientes.map((p) => (
        <div key={p.id} role="alert" className="pointer-events-auto max-w-xl rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 shadow-lg">
          <p className="font-semibold">{p.etiqueta}: no se pudo confirmar si se guardó</p>
          {resultado[p.id] ? (
            <p className="mt-1 text-xs">{resultado[p.id]}</p>
          ) : (
            <p className="mt-1 text-xs">Se perdió la respuesta del servidor. No la repitas con otros datos.</p>
          )}
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => verificar(p.id)}
              disabled={verificando === p.id || conexion !== "online"}
              className="inline-flex items-center gap-1 rounded bg-amber-600 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {verificando === p.id && <Loader2 className="h-3 w-3 animate-spin" />} Verificar estado
            </button>
            <button onClick={() => quitarPendiente(p.id)} disabled={!resultado[p.id]} title={resultado[p.id] ? undefined : "Primero verifica el estado"} className="rounded border border-amber-400 px-3 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-40">
              Descartar aviso
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
