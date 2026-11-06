import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Producto } from "@/lib/types";

const prod = (id: string, stock: number): Producto =>
  ({ id, codigo: id, nombre: id, descripcion: "", categoria: "", precio: 1, precioCompra: 0, stock, stockMinimo: 0, unidad: "Unidad", activo: true, sedeId: "s", sedeNombre: "" }) as Producto;

describe("Stock en vivo", () => {
  it("el cajero ve stock general + su propia reserva; lo reservado por otros se informa aparte", async () => {
    const { aplicarStockVivo } = await import("@/lib/data/stockVivo");
    const vivo = new Map([
      ["a", { stock: 4, reservado: 3, mio: 1 }],
      ["b", { stock: 0, reservado: 0, mio: 0 }],
    ]);
    const r = aplicarStockVivo([prod("a", 99), prod("b", 99), prod("c", 7)], vivo, (id) => (id === "c" ? 2 : 0));
    expect(r.map((p) => p.stock)).toEqual([5, 0, 9]); // a: 4+1 · b: 0 · c: sin dato en vivo → su valor + reserva local
    expect(r[0].reservadoOtros).toBe(2); // 3 reservados en total - 1 mío
    expect(r[1].reservadoOtros).toBe(0);
  });
});

describe("Detección de conexión y venta cortada", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://servidor.test");
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("detecta 'sin conexión' en pocos segundos aunque el navegador diga que hay red", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
    const c = await import("@/lib/net/conexion");
    c.iniciarConexion();
    expect(c.leerConexion()).toBe("online");
    await vi.advanceTimersByTimeAsync(c.TIEMPOS.sondeo + c.TIEMPOS.confirmar + 100);
    expect(c.leerConexion()).toBe("caido");
    expect(c.TIEMPOS.sondeo + c.TIEMPOS.confirmar + 2 * c.TIEMPOS.timeoutSondeo).toBeLessThanOrEqual(9000); // peor caso
  });

  it("al volver la red se pasa a 'en línea' en unos segundos", async () => {
    let hay = false;
    vi.stubGlobal("fetch", vi.fn(() => (hay ? Promise.resolve(new Response("{}")) : Promise.reject(new TypeError("x")))));
    const c = await import("@/lib/net/conexion");
    c.iniciarConexion();
    c.reportarFalloRed();
    expect(c.leerConexion()).toBe("caido");
    hay = true;
    await vi.advanceTimersByTimeAsync(c.TIEMPOS.latido + 100);
    expect(c.leerConexion()).toBe("online");
  });

  it("si no hay internet pero el servidor responde algo (401, 404…) sigue 'en línea'", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("no", { status: 401 }))));
    const c = await import("@/lib/net/conexion");
    c.iniciarConexion();
    await vi.advanceTimersByTimeAsync(c.TIEMPOS.sondeo * 3);
    expect(c.leerConexion()).toBe("online");
  });

  it("al perder la red se corta al instante la petición en vuelo (no espera 45 s)", async () => {
    const colgada = vi.fn((_u: unknown, init?: RequestInit) => new Promise((_, rej) => init?.signal?.addEventListener("abort", () => rej(new DOMException("sin red", "NetworkError")))));
    vi.stubGlobal("fetch", colgada);
    const c = await import("@/lib/net/conexion");
    c.iniciarConexion();
    const { fetchResiliente } = await import("@/lib/supabase/client");
    const p = fetchResiliente("http://servidor.test/rest/v1/rpc/ejecutar_idempotente", { method: "POST", body: "{}" });
    const resultado = p.then(() => "ok", (e: Error) => e.name);
    await vi.advanceTimersByTimeAsync(300);
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    window.dispatchEvent(new Event("offline"));
    await vi.advanceTimersByTimeAsync(10);
    expect(await resultado).toBe("NetworkError"); // cortó sin esperar el timeout de 45 s
    expect(c.leerConexion()).toBe("offline");
  });
});
