/**
 * Estado de conectividad compartido (sin React): navigator.onLine + resultado de
 * las últimas peticiones + latido (heartbeat) cuando el servidor no responde.
 * `revalidar` avisa a las pantallas que deben volver a pedir sus datos
 * (al reconectar, al volver a la pestaña o al recuperar el foco).
 */
export type EstadoConexion = "online" | "offline" | "caido";

type Oyente = () => void;
const oyentes = new Set<Oyente>();
const revalidadores = new Set<Oyente>();

let estado: EstadoConexion = typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "online";
let ultimoFallo = 0;
let ultimoExito = 0;
const perdidas = new Set<Oyente>();
let latido: ReturnType<typeof setTimeout> | null = null;
let sesionInvalida = false;

const emitir = () => oyentes.forEach((f) => f());

export const suscribirConexion = (f: Oyente) => {
  oyentes.add(f);
  return () => void oyentes.delete(f);
};
export const leerConexion = () => estado;
export const sesionVencida = () => sesionInvalida;
export const marcarSesionInvalida = (v: boolean) => {
  if (sesionInvalida !== v) {
    sesionInvalida = v;
    emitir();
  }
};

function poner(nuevo: EstadoConexion) {
  if (estado === nuevo) return;
  const antes = estado;
  estado = nuevo;
  emitir();
  if (nuevo === "online" && antes !== "online") revalidarTodo();
  // al perder la red se cortan de inmediato las peticiones en vuelo (no esperan su timeout de 25-45 s)
  if (nuevo !== "online" && antes === "online") [...perdidas].forEach((f) => f());
}

/** Avisa en cuanto se pierde la conexión (para abortar peticiones en vuelo). Devuelve la función para dejar de avisar. */
export const alPerderRed = (f: Oyente) => {
  perdidas.add(f);
  return () => void perdidas.delete(f);
};

/** ¿Debemos negarnos a enviar escrituras ahora mismo? */
export const bloqueaEscrituras = () =>
  estado === "offline" || (typeof navigator !== "undefined" && navigator.onLine === false) || (estado === "caido" && Date.now() - ultimoFallo < 10_000);

export const reportarExito = () => {
  ultimoExito = Date.now();
  poner(typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "online");
};

export function reportarFalloRed() {
  ultimoFallo = Date.now();
  poner(typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "caido");
  programarLatido();
}

/** Tiempos de detección (ms): rápidos a propósito para que el indicador no se quede atrasado. */
export const TIEMPOS = { sondeo: 3000, timeoutSondeo: 2500, confirmar: 400, latido: 2000, latidoMax: 4000 };

/** ¿Llegamos al servidor? Cualquier respuesta HTTP cuenta como "hay conexión"; solo un fallo de red/timeout es "sin conexión". */
export async function sondear(): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIEMPOS.timeoutSondeo);
  try {
    await fetch(`${url}/auth/v1/health`, { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "" }, signal: ctl.signal, cache: "no-store" });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/** Mientras no haya conexión, prueba cada pocos segundos hasta que vuelva. */
function programarLatido(espera: number = TIEMPOS.latido) {
  if (typeof window === "undefined" || latido) return;
  latido = setTimeout(async () => {
    latido = null;
    if (estado === "online") return;
    if (await sondear()) {
      reportarExito();
      poner("online");
    } else {
      programarLatido(Math.min(espera * 1.25, TIEMPOS.latidoMax));
    }
  }, espera);
}

/** Con el sistema "en línea", comprueba de verdad que haya conexión (el navegador puede decir "online" sin internet). */
async function verificarEnLinea() {
  if (estado !== "online") return;
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
  if (Date.now() - ultimoExito < TIEMPOS.sondeo - 200) return; // una petición real acaba de salir bien
  if (await sondear()) return reportarExito();
  await new Promise((r) => setTimeout(r, TIEMPOS.confirmar)); // 2º intento para no marcar "sin conexión" por un tropiezo
  if (await sondear()) return reportarExito();
  reportarFalloRed();
}

/** Registra una función que se ejecuta cuando conviene refrescar datos. */
export const alRevalidar = (f: Oyente) => {
  revalidadores.add(f);
  return () => void revalidadores.delete(f);
};

let ultimaRevalidacion = 0;
export function revalidarTodo(forzar = false) {
  const ahora = Date.now();
  if (!forzar && ahora - ultimaRevalidacion < 4000) return;
  ultimaRevalidacion = ahora;
  revalidadores.forEach((f) => f());
}

let iniciado = false;
export function iniciarConexion() {
  if (iniciado || typeof window === "undefined") return;
  iniciado = true;
  window.addEventListener("online", async () => {
    const antes = estado;
    if (await sondear()) {
      reportarExito();
      poner("online"); // si venía caído/offline, poner() ya revalida
      if (antes === "online") revalidarTodo(true);
    } else {
      reportarFalloRed(); // wifi conectado pero sin internet
    }
  });
  window.addEventListener("offline", () => poner("offline"));
  window.addEventListener("focus", () => {
    revalidarTodo();
    void verificarEnLinea();
  });
  setInterval(() => void verificarEnLinea(), TIEMPOS.sondeo);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      revalidarTodo();
      void verificarEnLinea();
    }
  });
}
