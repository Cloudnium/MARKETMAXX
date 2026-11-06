/** Errores tipados de la capa de red. `message` siempre es legible para el usuario. */
export type TipoError =
  | "offline" // sin conexión: no se envió nada
  | "red" // falló la red / DNS / corte durante la petición
  | "timeout" // el servidor no respondió a tiempo
  | "servidor" // 5xx
  | "rate_limit" // 429
  | "auth" // sesión inválida o vencida (no es un fallo de red)
  | "conflicto" // mismo request_id con otros datos / conflicto de estado
  | "negocio"; // regla de negocio o validación (mensaje de la BD)

export class ErrorApp extends Error {
  tipo: TipoError;
  status?: number;
  /** true = la petición pudo llegar a la BD y NO sabemos si se guardó. */
  incierto: boolean;
  requestId?: string;
  /** SQLSTATE / código de PostgREST (P0424 = precio cambió, P0426 = reserva ajena, 23514 = stock…). */
  codigo?: string;
  constructor(tipo: TipoError, mensaje: string, opts: { status?: number; incierto?: boolean; requestId?: string; codigo?: string } = {}) {
    super(mensaje);
    this.name = "ErrorApp";
    this.tipo = tipo;
    this.status = opts.status;
    this.incierto = !!opts.incierto;
    this.requestId = opts.requestId;
    this.codigo = opts.codigo;
  }
  /** ¿Tiene sentido reintentar (con la misma request_id)? */
  get reintentable() {
    return this.tipo === "red" || this.tipo === "timeout" || this.tipo === "servidor" || this.tipo === "rate_limit";
  }
}

export const MENSAJES: Record<Exclude<TipoError, "negocio" | "conflicto">, string> = {
  offline: "Sin conexión a internet. No se pudo guardar; tus datos siguen en pantalla.",
  red: "No se pudo conectar con el servidor. Revisa tu internet e inténtalo de nuevo.",
  timeout: "El servidor tardó demasiado en responder.",
  servidor: "El servidor tuvo un problema momentáneo. Inténtalo en unos segundos.",
  rate_limit: "Demasiadas solicitudes seguidas. Espera unos segundos e inténtalo de nuevo.",
  auth: "Tu sesión venció. Inicia sesión de nuevo (tus datos en pantalla no se pierden hasta que recargues).",
};

export const MENSAJE_INCIERTO =
  "No pudimos confirmar si la operación se guardó. No la repitas con otros datos: pulsa «Verificar estado».";

interface ErrorCrudo {
  message?: string;
  code?: string;
  details?: string;
}

/** Convierte la respuesta de supabase-js ({error, status}) en un ErrorApp. */
export function clasificar(error: ErrorCrudo, status?: number): ErrorApp {
  const msg = error.message ?? "";
  const code = error.code ?? "";
  const st = status ?? 0;

  if (st === 0 && !code) {
    if (/abort|timeout|timed out/i.test(msg)) return new ErrorApp("timeout", MENSAJES.timeout, { status: 0, incierto: true });
    return new ErrorApp("red", MENSAJES.red, { status: 0, incierto: true });
  }
  // deadlock / fallo de serialización: la BD ya deshizo la transacción; se reintenta con la misma request_id
  if (code === "40P01" || code === "40001")
    return new ErrorApp("servidor", "Conflicto momentáneo de concurrencia. Reintentando…", { status: st, incierto: false });
  if (st === 401 || code === "PGRST301" || code === "PGRST303" || /jwt (expired|invalid)|invalid jwt/i.test(msg))
    return new ErrorApp("auth", MENSAJES.auth, { status: st });
  if (st === 429) return new ErrorApp("rate_limit", MENSAJES.rate_limit, { status: st });
  if (st === 408 || st === 504) return new ErrorApp("timeout", MENSAJES.timeout, { status: st, incierto: true });
  if (st >= 500) return new ErrorApp("servidor", MENSAJES.servidor, { status: st, incierto: true });
  if (code === "P0409" || st === 409) return new ErrorApp("conflicto", msg || "Conflicto con el estado actual.", { status: st, codigo: code });
  return new ErrorApp("negocio", msg || "Error desconocido.", { status: st, codigo: code });
}

/** Convierte cualquier excepción (fetch caído, abort, etc.) en ErrorApp. */
export function desdeExcepcion(e: unknown): ErrorApp {
  if (e instanceof ErrorApp) return e;
  const m = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  return clasificar({ message: m }, 0);
}
