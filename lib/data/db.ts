import { createClient } from "@/lib/supabase/client";
import { ErrorApp, MENSAJES, MENSAJE_INCIERTO, clasificar, desdeExcepcion } from "@/lib/net/errores";
import { bloqueaEscrituras, marcarSesionInvalida, revalidarTodo } from "@/lib/net/conexion";
import { ETIQUETAS, huellaDe, idExistente, nuevoId, quitarPendiente, registrarPendiente } from "@/lib/net/pendientes";

export const db = () => createClient();
export { ErrorApp } from "@/lib/net/errores";

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Respuesta<T> = { data: T; error: { message: string; code?: string } | null; status?: number };

/** Lanza un ErrorApp (con mensaje legible) si la respuesta trae error. */
export function check<T>(res: Respuesta<T>): T {
  if (res.error) throw clasificar(res.error, res.status);
  return res.data;
}

// ---------------------------------------------------------------------
// Sesión: distinguir "se cayó la red" de "la sesión ya no vale"
// ---------------------------------------------------------------------
let refrescando: Promise<"ok" | "red" | "invalida"> | null = null;
export function refrescarSesion() {
  if (!refrescando) {
    refrescando = (async () => {
      try {
        const { error } = await db().auth.refreshSession();
        if (!error) {
          marcarSesionInvalida(false);
          return "ok" as const;
        }
        const e = error as { status?: number; name?: string; message?: string };
        if (e.name === "AuthRetryableFetchError" || e.status === 0 || (e.status ?? 0) >= 500 || /fetch|network/i.test(e.message ?? ""))
          return "red" as const;
        marcarSesionInvalida(true);
        return "invalida" as const;
      } catch {
        return "red" as const;
      } finally {
        setTimeout(() => (refrescando = null), 0);
      }
    })();
  }
  return refrescando;
}

// ---------------------------------------------------------------------
// LECTURAS: el reintento con backoff vive en fetchResiliente (solo GET / RPC de lectura)
// ---------------------------------------------------------------------
export async function rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T> {
  for (let intento = 0; ; intento++) {
    const res = (await db().rpc(fn, args ?? {})) as Respuesta<T>;
    if (!res.error) return res.data;
    const err = clasificar(res.error, res.status);
    if (err.tipo === "auth" && intento === 0) {
      const r = await refrescarSesion();
      if (r === "ok") continue;
      if (r === "red") throw new ErrorApp("red", MENSAJES.red, { status: 0 });
    }
    throw err;
  }
}

// ---------------------------------------------------------------------
// ESCRITURAS: siempre con request_id (idempotentes en la BD)
// ---------------------------------------------------------------------
export interface EstadoOperacion {
  estado: "completada" | "no_encontrada";
  funcion?: string;
  respuesta?: unknown;
}

export async function consultarOperacion(requestId: string): Promise<EstadoOperacion> {
  return rpc<EstadoOperacion>("consultar_operacion", { p_request_id: requestId });
}

/** "Verificar estado": si llegó a completarse, la quita de pendientes y refresca las pantallas. */
export async function verificarOperacion(requestId: string): Promise<EstadoOperacion> {
  const r = await consultarOperacion(requestId);
  if (r.estado === "completada") {
    quitarPendiente(requestId);
    revalidarTodo(true);
  }
  return r;
}

const enVuelo = new Map<string, Promise<unknown>>();
const MAX_INTENTOS = 4;

/**
 * Ejecuta una mutación con garantía de "a lo sumo una vez".
 *  - requestId: el del formulario. Si no se pasa, se deriva del contenido: repetir EXACTAMENTE
 *    la misma operación tras un resultado incierto reutiliza el mismo id.
 *  - Reintenta (backoff) ante red/timeout/5xx/429 siempre con la MISMA request_id.
 *  - Si al final no se sabe el resultado, lanza ErrorApp{incierto:true} y la deja en "pendientes".
 *  - Sin conexión no envía nada.
 */
export function rpcMut<T = unknown>(fn: string, args: Record<string, unknown> = {}, requestId?: string): Promise<T> {
  const huella = huellaDe(fn, args);
  const previo = enVuelo.get(huella);
  if (previo) return previo as Promise<T>; // doble clic / doble pestaña lógica: una sola ejecución
  const p = ejecutarMut<T>(fn, args, huella, requestId).finally(() => enVuelo.delete(huella));
  enVuelo.set(huella, p);
  return p;
}

async function ejecutarMut<T>(fn: string, args: Record<string, unknown>, huella: string, requestId?: string): Promise<T> {
  if (bloqueaEscrituras()) throw new ErrorApp("offline", MENSAJES.offline);
  const id = requestId ?? idExistente(huella) ?? nuevoId();
  let incierto = false;
  let ultimo: ErrorApp | null = null;
  let refrescoIntentado = false;

  for (let i = 0; i < MAX_INTENTOS; i++) {
    if (i > 0) {
      await dormir(Math.min(700 * 2 ** (i - 1), 5000) * (0.75 + Math.random() * 0.5));
      if (bloqueaEscrituras()) break;
    }
    try {
      const res = (await db().rpc("ejecutar_idempotente", { p_request_id: id, p_fn: fn, p_args: args })) as Respuesta<{
        repetida: boolean;
        respuesta: T;
      }>;
      if (res.error) throw clasificar(res.error, res.status);
      quitarPendiente(id);
      return res.data.respuesta;
    } catch (e) {
      const err = desdeExcepcion(e);
      err.requestId = id;
      if (err.tipo === "auth" && !refrescoIntentado) {
        refrescoIntentado = true;
        const r = await refrescarSesion();
        if (r === "ok") {
          i--; // el intento de refresco no cuenta
          continue;
        }
        if (r === "red") {
          ultimo = new ErrorApp("red", MENSAJES.red, { incierto: false, requestId: id });
          continue;
        }
      }
      if (!err.reintentable) {
        if (!incierto) quitarPendiente(id);
        throw err; // negocio / conflicto / auth: la BD NO ejecutó nada
      }
      if (err.incierto) incierto = true;
      ultimo = err;
    }
  }

  if (incierto) {
    // última oportunidad: preguntar si la operación llegó a completarse
    try {
      const q = await consultarOperacion(id);
      if (q.estado === "completada") {
        quitarPendiente(id);
        return q.respuesta as T;
      }
    } catch {
      /* seguimos sin saberlo */
    }
    registrarPendiente({ id, fn, huella, etiqueta: ETIQUETAS[fn] ?? fn });
    throw new ErrorApp(ultimo?.tipo ?? "red", MENSAJE_INCIERTO, { status: ultimo?.status, incierto: true, requestId: id });
  }
  throw ultimo ?? new ErrorApp("red", MENSAJES.red);
}

export const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

/** Trae todas las filas de una consulta paginando de a 1000 (límite de PostgREST). */
export async function traerTodo<T>(
  pagina: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null; status?: number }>,
  tope = 20000
): Promise<T[]> {
  const paso = 1000;
  const filas: T[] = [];
  for (let desde = 0; desde < tope; desde += paso) {
    const res = await pagina(desde, desde + paso - 1);
    const lote = check(res as Respuesta<T[]>);
    filas.push(...lote);
    if (lote.length < paso) break;
  }
  return filas;
}

export interface FiltroFechas {
  /** YYYY-MM-DD (hora de Lima), incluido. */
  desde?: string;
  hasta?: string;
}
