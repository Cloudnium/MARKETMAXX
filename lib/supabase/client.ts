import { createBrowserClient } from "@supabase/ssr";
import { alPerderRed, reportarExito, reportarFalloRed } from "@/lib/net/conexion";

let client: ReturnType<typeof createBrowserClient> | null = null;

/** Rutas RPC de solo lectura (o idempotentes por naturaleza): seguro reintentarlas solas. */
const RPC_LECTURA =
  /\/rest\/v1\/rpc\/(listar_|reporte_|dashboard_|mis_permisos|sedes_destino|backup_tablas|backup_leer|backup_subir|consultar_operacion|caja_totales|resumen_)/;

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
const espera = (i: number, retryAfter?: string | null) => {
  const ra = retryAfter ? Number(retryAfter) * 1000 : NaN;
  const base = Number.isFinite(ra) ? ra : Math.min(500 * 2 ** i, 6000);
  return Math.min(base, 10_000) * (0.75 + Math.random() * 0.5);
};

function timeoutPara(url: string) {
  if (url.includes("/rpc/ejecutar_idempotente")) return 45_000;
  if (url.includes("/rpc/backup_")) return 120_000;
  if (url.includes("/auth/v1/")) return 15_000;
  return 25_000;
}

/**
 * fetch con: timeout (AbortController), reintentos con backoff SOLO para lecturas
 * (GET/HEAD y RPC de lectura) ante red caída, 429 y 502/503/504, y reporte de
 * conectividad. Las escrituras nunca se reintentan aquí: lo hace rpcMut con la
 * MISMA request_id.
 */
export async function fetchResiliente(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const metodo = (init.method ?? (typeof input !== "string" && !(input instanceof URL) ? input.method : "GET")).toUpperCase();
  const lectura = metodo === "GET" || metodo === "HEAD" || (metodo === "POST" && RPC_LECTURA.test(url));
  const intentos = lectura ? 4 : 1;
  const limite = timeoutPara(url);

  for (let i = 0; i < intentos; i++) {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      reportarFalloRed();
      throw new TypeError("Failed to fetch (sin conexión)");
    }
    const ctl = new AbortController();
    const externa = init.signal;
    const reenviar = () => ctl.abort();
    if (externa) {
      if (externa.aborted) ctl.abort();
      else externa.addEventListener("abort", reenviar, { once: true });
    }
    const t = setTimeout(() => ctl.abort(new DOMException("timeout", "TimeoutError")), limite);
    // si se pierde la red a mitad de la petición, se corta YA (no se espera al timeout). Backups y sesión quedan fuera.
    const cortar = limite <= 45_000 && !url.includes("/auth/v1/") ? alPerderRed(() => ctl.abort(new DOMException("sin red", "NetworkError"))) : null;
    try {
      const res = await fetch(input, { ...init, signal: ctl.signal });
      clearTimeout(t);
      if (res.status >= 500 && res.status !== 501) reportarFalloRed();
      else reportarExito();
      if (lectura && i < intentos - 1 && (res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504)) {
        await dormir(espera(i, res.headers.get("retry-after")));
        continue;
      }
      return res;
    } catch (e) {
      clearTimeout(t);
      if (externa?.aborted) throw e; // lo canceló quien llamó: no es un fallo de red
      reportarFalloRed();
      if (lectura && i < intentos - 1) {
        await dormir(espera(i));
        continue;
      }
      throw e;
    } finally {
      cortar?.();
      externa?.removeEventListener("abort", reenviar);
    }
  }
  throw new TypeError("Failed to fetch");
}

export function createClient() {
  if (!client) {
    client = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      global: { fetch: fetchResiliente },
    });
  }
  return client;
}
