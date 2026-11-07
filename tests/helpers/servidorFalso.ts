/**
 * Servidor falso para tests de resiliencia. Reproduce la semántica de ejecutar_idempotente / consultar_operacion
 * (SQL 24/26): una operación por request_id, hash del contenido NORMALIZADO como jsonb (orden de claves irrelevante),
 * P0409 si el mismo request_id llega con datos distintos, y "repetida" si llega igual.
 *
 * `script` dicta, llamada a llamada, qué pasa con cada ejecutar_idempotente (por defecto "ok").
 */
export type Accion =
  | "ok"
  | "red-antes" // la petición nunca llega al servidor
  | "corte-antes" // se cae internet justo antes de enviar: no llega y el equipo queda offline
  | "timeout-tras-commit" // el servidor guardó, la respuesta se pierde
  | "corte-tras-commit" // el servidor guardó y se cae internet: la respuesta se pierde y el equipo queda offline
  | "503-tras-commit"
  | "503"
  | "429"
  | "401"
  | "negocio";

const canonico = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canonico)
    : v && typeof v === "object"
      ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canonico((v as Record<string, unknown>)[k])]))
      : v;
const hashDe = (fn: string, args: unknown) => fn + "|" + JSON.stringify(canonico(args ?? {}));

export interface Llamada {
  /** "ejecutar_idempotente" | "consultar_operacion" | … */
  rpc: string;
  id?: string;
  fn?: string;
  args?: Record<string, unknown>;
}

export function crearServidor() {
  const state = {
    commits: new Map<string, { hash: string; fn: string; resp: unknown }>(),
    /** Escrituras REALES (filas nuevas) por función. */
    escrituras: {} as Record<string, number>,
    script: [] as Accion[],
    /** "falla" hace que la próxima consultar_operacion no llegue. */
    consultas: [] as ("falla" | "ok")[],
    llamadas: [] as Llamada[],
    contador: 0,
    refresh: { error: null as unknown },
    signOut: 0,
  };
  const setOnLine = (v: boolean) => Object.defineProperty(navigator, "onLine", { value: v, configurable: true });
  const reiniciar = () => {
    state.commits = new Map();
    state.escrituras = {};
    state.script = [];
    state.consultas = [];
    state.llamadas = [];
    state.contador = 0;
    state.refresh = { error: null };
    state.signOut = 0;
    setOnLine(true);
  };
  const total = (fn?: string) => (fn ? (state.escrituras[fn] ?? 0) : Object.values(state.escrituras).reduce((a, b) => a + b, 0));
  const net = { message: "TypeError: Failed to fetch", code: "" };

  const respuestaDe = (fn: string, n: number): unknown => {
    if (fn === "registrar_venta") return { id: `venta-${n}`, numero: `B001-${String(n).padStart(5, "0")}`, total: 10 };
    if (fn === "crear_lease_offline") return { lease_id: `lease-${n}`, expira: new Date(Date.now() + 4 * 3600_000).toISOString(), servidor_ahora: new Date().toISOString(), items: [] };
    return `fila-${n}`;
  };

  const confirmar = (id: string, fn: string, args: unknown) => {
    const h2 = hashDe(fn, args);
    const prev = state.commits.get(id);
    if (prev) {
      if (prev.hash !== h2) return { error: { message: "Este identificador de operación ya se usó con datos distintos.", code: "P0409" }, status: 409 as const, data: null };
      return { data: { repetida: true, respuesta: prev.resp }, error: null, status: 200 };
    }
    state.escrituras[fn] = (state.escrituras[fn] ?? 0) + 1;
    const resp = respuestaDe(fn, ++state.contador);
    state.commits.set(id, { hash: h2, fn, resp });
    return { data: { repetida: false, respuesta: resp }, error: null, status: 200 };
  };

  const fake = {
    auth: {
      refreshSession: async () => ({ error: state.refresh.error }),
      signOut: async () => void state.signOut++,
    },
    rpc: async (rpc: string, a: any) => {
      // sin internet el navegador ni siquiera envía la petición (fetchResiliente)
      if (typeof navigator !== "undefined" && navigator.onLine === false) return { data: null, error: net, status: 0 };
      if (rpc === "mis_leases_offline") return { data: [], error: null, status: 200 };
      if (rpc === "consultar_operacion") {
        state.llamadas.push({ rpc, id: a.p_request_id });
        if (state.consultas.shift() === "falla") return { data: null, error: net, status: 0 };
        const c = state.commits.get(a.p_request_id);
        return { data: c ? { estado: "completada", funcion: c.fn, respuesta: c.resp } : { estado: "no_encontrada" }, error: null, status: 200 };
      }
      state.llamadas.push({ rpc, id: a.p_request_id, fn: a.p_fn, args: a.p_args });
      const accion = state.script.shift() ?? "ok";
      const { p_request_id: id, p_fn: fn, p_args: args } = a;
      switch (accion) {
        case "red-antes": return { data: null, error: net, status: 0 };
        case "corte-antes": setOnLine(false); return { data: null, error: net, status: 0 };
        case "timeout-tras-commit": confirmar(id, fn, args); return { data: null, error: { message: "AbortError: signal timed out", code: "" }, status: 0 };
        case "corte-tras-commit": confirmar(id, fn, args); setOnLine(false); return { data: null, error: net, status: 0 };
        case "503-tras-commit": confirmar(id, fn, args); return { data: null, error: { message: "Bad gateway", code: "" }, status: 503 };
        case "503": return { data: null, error: { message: "unavailable", code: "" }, status: 503 };
        case "429": return { data: null, error: { message: "too many", code: "" }, status: 429 };
        case "401": return { data: null, error: { message: "JWT expired", code: "PGRST301" }, status: 401 };
        case "negocio": return { data: null, error: { message: 'Stock insuficiente de "X"', code: "23514" }, status: 400 };
        default: return confirmar(id, fn, args);
      }
    },
  };
  return { state, fake, setOnLine, total, hashDe, reiniciar };
}
