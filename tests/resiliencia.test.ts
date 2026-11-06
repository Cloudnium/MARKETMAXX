import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** BD simulada con la misma semántica que ejecutar_idempotente (SQL 24). */
const h = vi.hoisted(() => {
  const state = {
    commits: new Map<string, { hash: string; resp: unknown }>(),
    escrituras: 0, // veces que realmente se "escribió" en la BD
    script: [] as any[],
    llamadas: [] as { fn: string; id?: string }[],
    refresh: { error: null as any },
    signOut: 0,
    contador: 0,
  };
  const net = { message: "TypeError: Failed to fetch", code: "" };
  const hash = (fn: string, a: unknown) => fn + JSON.stringify(a);
  const fake = {
    auth: {
      refreshSession: async () => ({ error: state.refresh.error }),
      signOut: async () => void state.signOut++,
    },
    rpc: async (fn: string, args: any) => {
      state.llamadas.push({ fn, id: args?.p_request_id });
      if (fn === "consultar_operacion") {
        const c = state.commits.get(args.p_request_id);
        const x = state.script[0];
        if (x === "consulta-falla") {
          state.script.shift();
          return { data: null, error: net, status: 0 };
        }
        return { data: c ? { estado: "completada", respuesta: c.resp } : { estado: "no_encontrada" }, error: null, status: 200 };
      }
      const accion = state.script.shift() ?? "ok";
      const confirmar = () => {
        const h2 = hash(args.p_fn, args.p_args);
        const prev = state.commits.get(args.p_request_id);
        if (prev) {
          if (prev.hash !== h2) return { error: { message: "ya se usó con datos distintos", code: "P0409" }, status: 409 };
          return { data: { repetida: true, respuesta: prev.resp }, error: null, status: 200 };
        }
        state.escrituras++;
        const resp = `fila-${++state.contador}`;
        state.commits.set(args.p_request_id, { hash: h2, resp });
        return { data: { repetida: false, respuesta: resp }, error: null, status: 200 };
      };
      switch (accion) {
        case "timeout-tras-commit": {
          confirmar();
          return { data: null, error: { message: "AbortError: signal timed out", code: "" }, status: 0 };
        }
        case "red-antes": return { data: null, error: net, status: 0 };
        case "503-tras-commit": confirmar(); return { data: null, error: { message: "Bad gateway", code: "" }, status: 503 };
        case "503": return { data: null, error: { message: "unavailable", code: "" }, status: 503 };
        case "429": return { data: null, error: { message: "too many", code: "" }, status: 429 };
        case "401": return { data: null, error: { message: "JWT expired", code: "PGRST301" }, status: 401 };
        case "negocio": return { data: null, error: { message: "Stock insuficiente de \"X\"", code: "23514" }, status: 400 };
        default: return { data: undefined, ...confirmar() };
      }
    },
  };
  return { state, fake };
});

vi.mock("@/lib/supabase/client", () => ({ createClient: () => h.fake, fetchResiliente: undefined }));

let M: typeof import("@/lib/data/db");
let C: typeof import("@/lib/net/conexion");
let P: typeof import("@/lib/net/pendientes");

const setOnLine = (v: boolean) => Object.defineProperty(navigator, "onLine", { value: v, configurable: true });
/** Ejecuta una promesa que usa timers (backoff) avanzando el reloj simulado. */
async function correr<T>(p: Promise<T>) {
  const r = p.then((v) => ({ v }), (e) => ({ e }));
  await vi.advanceTimersByTimeAsync(60_000);
  return (await r) as { v?: T; e?: any };
}
const ARGS = { p_sede: "s1", p_items: [{ producto_id: "p1", cantidad: 1 }] };

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  localStorage.clear();
  setOnLine(true);
  Object.assign(h.state, { commits: new Map(), escrituras: 0, script: [], llamadas: [], contador: 0, signOut: 0 });
  h.state.refresh.error = null;
  M = await import("@/lib/data/db");
  C = await import("@/lib/net/conexion");
  P = await import("@/lib/net/pendientes");
});
afterEach(() => vi.useRealTimers());

describe("Idempotencia y escrituras", () => {
  it("camino feliz: una escritura, sin pendientes", async () => {
    const r = await correr(M.rpcMut("registrar_venta", ARGS));
    expect(r.v).toBe("fila-1");
    expect(h.state.escrituras).toBe(1);
    expect(P.listaPendientes()).toHaveLength(0);
  });

  it("offline: no envía nada y no pierde datos (error 'offline', no incierto)", async () => {
    setOnLine(false);
    const r = await correr(M.rpcMut("registrar_venta", ARGS));
    expect(r.e.tipo).toBe("offline");
    expect(r.e.incierto).toBe(false);
    expect(h.state.llamadas).toHaveLength(0);
    expect(P.listaPendientes()).toHaveLength(0);
  });

  it("timeout DESPUÉS del commit: el reintento con la MISMA request_id no duplica y devuelve la misma respuesta", async () => {
    h.state.script = ["timeout-tras-commit"];
    const r = await correr(M.rpcMut("registrar_venta", ARGS));
    expect(r.v).toBe("fila-1");
    expect(h.state.escrituras).toBe(1);
    const ids = new Set(h.state.llamadas.filter((l) => l.fn === "ejecutar_idempotente").map((l) => l.id));
    expect(ids.size).toBe(1);
  });

  it("503 tras commit y luego caída total: queda INCIERTA, pero consultar_operacion la resuelve sin duplicar", async () => {
    h.state.script = ["503-tras-commit", "red-antes", "red-antes", "red-antes"];
    const r = await correr(M.rpcMut("registrar_venta", ARGS));
    expect(r.v).toBe("fila-1"); // la consulta final encontró la operación completada
    expect(h.state.escrituras).toBe(1);
    expect(P.listaPendientes()).toHaveLength(0);
  });

  it("resultado incierto sin poder consultar: ErrorApp.incierto + pendiente persistida; al repetir el mismo formulario reutiliza el id y no duplica", async () => {
    h.state.script = ["timeout-tras-commit", "red-antes", "red-antes", "red-antes", "consulta-falla"];
    const r1 = await correr(M.rpcMut("registrar_venta", ARGS));
    expect(r1.e.incierto).toBe(true);
    expect(r1.e.message).toMatch(/Verificar estado/);
    const pend = P.listaPendientes();
    expect(pend).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem("market.ops.pendientes.v1")!)).toHaveLength(1); // sobrevive a recargas
    // el usuario vuelve a pulsar "guardar" con los MISMOS datos
    const r2 = await correr(M.rpcMut("registrar_venta", ARGS));
    expect(r2.v).toBe("fila-1");
    expect(h.state.escrituras).toBe(1);
    expect(P.listaPendientes()).toHaveLength(0);
  });

  it("'Verificar estado' encuentra la operación completada y limpia el aviso", async () => {
    h.state.script = ["timeout-tras-commit", "red-antes", "red-antes", "red-antes", "consulta-falla"];
    await correr(M.rpcMut("registrar_venta", ARGS));
    const id = P.listaPendientes()[0].id;
    const reval = vi.fn();
    C.alRevalidar(reval);
    const q = await correr(M.verificarOperacion(id));
    expect(q.v!.estado).toBe("completada");
    expect(P.listaPendientes()).toHaveLength(0);
    expect(reval).toHaveBeenCalled(); // refresca las pantallas
  });

  it("mismo request_id con datos distintos se rechaza (conflicto) y no escribe", async () => {
    await correr(M.rpcMut("registrar_venta", ARGS, "req-1"));
    const r = await correr(M.rpcMut("registrar_venta", { ...ARGS, p_sede: "otra" }, "req-1"));
    expect(r.e.tipo).toBe("conflicto");
    expect(h.state.escrituras).toBe(1);
  });

  it("doble clic simultáneo: una sola ejecución", async () => {
    const [a, b] = await correr(Promise.all([M.rpcMut("registrar_venta", ARGS), M.rpcMut("registrar_venta", ARGS)])).then((x) => x.v!);
    expect(a).toBe(b);
    expect(h.state.escrituras).toBe(1);
  });

  it("dos ventas iguales PERO consecutivas (la primera ya terminó) son dos operaciones distintas", async () => {
    await correr(M.rpcMut("registrar_venta", ARGS));
    await correr(M.rpcMut("registrar_venta", ARGS));
    expect(h.state.escrituras).toBe(2);
  });

  it("429 y 5xx: backoff con la misma request_id y finalmente éxito (sin incertidumbre si nunca llegó)", async () => {
    h.state.script = ["429", "503", "429"];
    const r = await correr(M.rpcMut("registrar_venta", ARGS));
    expect(r.v).toBe("fila-1");
    expect(new Set(h.state.llamadas.map((l) => l.id)).size).toBe(1);
  });

  it("429 permanente: error 'rate_limit' NO incierto y sin pendientes", async () => {
    h.state.script = ["429", "429", "429", "429"];
    const r = await correr(M.rpcMut("registrar_venta", ARGS));
    expect(r.e.tipo).toBe("rate_limit");
    expect(r.e.incierto).toBe(false);
    expect(P.listaPendientes()).toHaveLength(0);
  });

  it("error de negocio (última unidad ya vendida): no se reintenta, mensaje de la BD intacto", async () => {
    h.state.script = ["negocio"];
    const r = await correr(M.rpcMut("registrar_venta", ARGS));
    expect(r.e.tipo).toBe("negocio");
    expect(r.e.message).toMatch(/Stock insuficiente/);
    expect(h.state.llamadas.filter((l) => l.fn === "ejecutar_idempotente")).toHaveLength(1);
  });

  it("última unidad: dos cajeros distintos, solo uno la vende (BD serializa); el otro recibe error de negocio", async () => {
    h.state.script = ["ok", "negocio"];
    const a = await correr(M.rpcMut("registrar_venta", { ...ARGS, p_caja: "A" }));
    const b = await correr(M.rpcMut("registrar_venta", { ...ARGS, p_caja: "B" }));
    expect(a.v).toBe("fila-1");
    expect(b.e.tipo).toBe("negocio");
    expect(h.state.escrituras).toBe(1);
  });

  it("compra interrumpida a mitad: se reintenta completa con el mismo id (una sola compra)", async () => {
    h.state.script = ["red-antes", "timeout-tras-commit"];
    const r = await correr(M.rpcMut("registrar_compra_completa", { p_sede: "s1", p_items: [{ nombre: "X", cantidad: 2, precio: 3 }] }));
    expect(r.v).toBe("fila-1");
    expect(h.state.escrituras).toBe(1);
  });

  it("backup_aplicar usa el token como request_id: reintento tras corte no se aplica dos veces", async () => {
    h.state.script = ["timeout-tras-commit"];
    const r = await correr(M.rpcMut("backup_aplicar", { p_token: "t1", p_archivo: "a.json.gz", p_bytes: 10 }, "t1"));
    expect(r.v).toBe("fila-1");
    expect(h.state.escrituras).toBe(1);
    expect(new Set(h.state.llamadas.map((l) => l.id))).toEqual(new Set(["t1"]));
  });
});

describe("Sesión / token", () => {
  it("token expirado: refresca la sesión y reintenta con la MISMA request_id, sin cerrar sesión", async () => {
    h.state.script = ["401"];
    const r = await correr(M.rpcMut("registrar_venta", ARGS));
    expect(r.v).toBe("fila-1");
    expect(h.state.signOut).toBe(0);
    expect(new Set(h.state.llamadas.map((l) => l.id)).size).toBe(1);
  });

  it("token expirado y refresco SIN red: es un error de red (reintentable), NO sesión inválida", async () => {
    h.state.script = ["401", "ok"];
    h.state.refresh.error = { name: "AuthRetryableFetchError", status: 0, message: "fetch failed" };
    const r = await correr(M.rpcMut("registrar_venta", ARGS));
    expect(C.sesionVencida()).toBe(false);
    expect(h.state.signOut).toBe(0);
    expect(r.v).toBe("fila-1");
  });

  it("refresh token inválido: error 'auth' + sesión vencida visible, sin signOut ni redirección automática", async () => {
    h.state.script = ["401"];
    h.state.refresh.error = { name: "AuthApiError", status: 400, message: "Invalid Refresh Token" };
    const r = await correr(M.rpcMut("registrar_venta", ARGS));
    expect(r.e.tipo).toBe("auth");
    expect(C.sesionVencida()).toBe(true);
    expect(h.state.signOut).toBe(0);
  });
});

describe("Conectividad y errores tipados", () => {
  it("clasifica red, timeout, servidor, rate_limit, auth, conflicto y negocio", async () => {
    const { clasificar } = await import("@/lib/net/errores");
    expect(clasificar({ message: "TypeError: Failed to fetch" }, 0).tipo).toBe("red");
    expect(clasificar({ message: "AbortError: timed out" }, 0).tipo).toBe("timeout");
    expect(clasificar({ message: "x" }, 502).tipo).toBe("servidor");
    expect(clasificar({ message: "x" }, 429).tipo).toBe("rate_limit");
    expect(clasificar({ message: "JWT expired", code: "PGRST301" }, 401).tipo).toBe("auth");
    expect(clasificar({ message: "x", code: "P0409" }, 409).tipo).toBe("conflicto");
    expect(clasificar({ message: "Stock insuficiente", code: "23514" }, 400).tipo).toBe("negocio");
  });

  it("al reconectar (evento online) y al volver a la pestaña se dispara la revalidación de datos", async () => {
    C.iniciarConexion();
    const f = vi.fn();
    C.alRevalidar(f);
    setOnLine(false);
    window.dispatchEvent(new Event("offline"));
    expect(C.leerConexion()).toBe("offline");
    expect(C.bloqueaEscrituras()).toBe(true);
    setOnLine(true);
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("{}")))); // el servidor responde
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(50); // el evento "online" verifica de verdad el servidor antes de marcar "en línea"
    expect(C.leerConexion()).toBe("online");
    expect(f).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(f).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(5000);
    window.dispatchEvent(new Event("focus"));
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("servidor caído (fallo de red con navegador 'online') bloquea escrituras un momento y se recupera", async () => {
    C.reportarFalloRed();
    expect(C.leerConexion()).toBe("caido");
    expect(C.bloqueaEscrituras()).toBe(true);
    C.reportarExito();
    expect(C.leerConexion()).toBe("online");
    expect(C.bloqueaEscrituras()).toBe(false);
  });
});

describe("fetchResiliente (timeouts y reintentos solo en lecturas)", () => {
  let F: typeof import("@/lib/supabase/client");
  beforeEach(async () => {
    vi.doUnmock("@/lib/supabase/client");
    vi.resetModules();
    F = await vi.importActual("@/lib/supabase/client");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("GET: reintenta ante 503 y red caída con backoff", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", f);
    const r = await correr(F.fetchResiliente("https://x.supabase.co/rest/v1/productos"));
    expect(r.v!.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("RPC de lectura (reporte_*) se reintenta; la ESCRITURA ejecutar_idempotente NO se reintenta a este nivel", async () => {
    const f = vi.fn().mockResolvedValue(new Response("", { status: 503 }));
    vi.stubGlobal("fetch", f);
    await correr(F.fetchResiliente("https://x.supabase.co/rest/v1/rpc/reporte_ventas", { method: "POST", body: "{}" }));
    const rest = () => f.mock.calls.filter((c) => String(c[0]).includes("/rest/v1")).length; // el latido de conectividad no cuenta
    expect(rest()).toBe(4);
    f.mockClear();
    const w = await correr(F.fetchResiliente("https://x.supabase.co/rest/v1/rpc/ejecutar_idempotente", { method: "POST", body: "{}" }));
    expect(rest()).toBe(1);
    expect(w.v!.status).toBe(503);
  });

  it("timeout: aborta con AbortController cuando el servidor no responde", async () => {
    const f = vi.fn((_u: any, init: any) => new Promise((_ok, mal) => init.signal.addEventListener("abort", () => mal(new DOMException("timeout", "TimeoutError")))));
    vi.stubGlobal("fetch", f);
    const r = await correr(F.fetchResiliente("https://x.supabase.co/rest/v1/rpc/ejecutar_idempotente", { method: "POST", body: "{}" }));
    expect(r.e).toBeDefined();
    expect(f.mock.calls.filter((c) => String(c[0]).includes("/rest/v1"))).toHaveLength(1);
  });

  it("offline: ni siquiera intenta la petición", async () => {
    setOnLine(false);
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const r = await correr(F.fetchResiliente("https://x.supabase.co/rest/v1/productos"));
    expect(r.e).toBeInstanceOf(TypeError);
    expect(f).not.toHaveBeenCalled();
  });
});
