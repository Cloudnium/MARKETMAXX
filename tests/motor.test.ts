import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LeaseLocal, OutboxItem, VentaLocal } from "@/lib/offline/tipos";

const h = await vi.hoisted(async () => {
  const { crearServidor } = await import("./helpers/servidorFalso");
  const { crearIdb } = await import("./helpers/idbEnMemoria");
  return { srv: crearServidor(), idb: crearIdb() };
});
vi.mock("@/lib/supabase/client", () => ({ createClient: () => h.srv.fake }));
vi.mock("@/lib/offline/idb", () => h.idb);

let M: typeof import("@/lib/offline/motor");
let D: typeof import("@/lib/data/db");
let P: typeof import("@/lib/net/pendientes");

const SEDE = "s1", CAJA = "c1", PROD = "p1";
const entrada = (cantidad = 1) => ({
  sedeId: SEDE, cajaId: CAJA, tipo: "boleta" as const, metodo: "Efectivo", descuento: 0,
  clienteId: null, clienteNombre: null, clienteDocumento: null, items: [{ productoId: PROD, cantidad }],
});
const lease = (otorgado = 5): LeaseLocal => ({
  leaseId: "lease-A", sedeId: SEDE, cajaId: CAJA, expiraMs: Date.now() + 4 * 3600_000, offsetMs: 0, creadoMs: Date.now(), items: { [PROD]: { otorgado, usado: 0 } },
});

/** Deja correr los timers (backoff de reintentos y ciclos de sincronización). */
const flush = () => vi.advanceTimersByTimeAsync(120_000);
async function correr<T>(p: Promise<T>) {
  const r = p.then((v) => ({ v }), (e) => ({ e }));
  await flush();
  return (await r) as { v?: T; e?: any };
}
const ventasLocales = () => h.idb.listar<VentaLocal>("ventas");
const outbox = () => h.idb.listar<OutboxItem>("outbox");
const idsEnviados = (fn = "registrar_venta") => h.srv.state.llamadas.filter((l) => l.rpc === "ejecutar_idempotente" && l.fn === fn).map((l) => l.id);
const escrituras = () => h.srv.total("registrar_venta");

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  localStorage.clear();
  h.srv.reiniciar();
  h.idb.reset();
  vi.stubGlobal("indexedDB", {});
  Object.defineProperty(navigator, "locks", { value: { request: async (_n: string, _o: unknown, cb: (l: unknown) => unknown) => cb({}) }, configurable: true });
  M = await import("@/lib/offline/motor");
  D = await import("@/lib/data/db");
  P = await import("@/lib/net/pendientes");
  await M.guardarSnapshot({
    sedeId: SEDE,
    productos: [{ id: PROD, nombre: "Gaseosa", precio: 5, stock: 100, activo: true } as any],
    cajas: [{ id: CAJA, nombre: "Caja 1" } as any],
    metodos: ["Efectivo"],
    sede: { nombre: "Sede" },
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("POS: cortes de red durante la venta", () => {
  it("CORTE 1 · antes de enviar (sin internet): queda en cola, no sale nada, y al volver se envía UNA vez", async () => {
    await h.idb.guardar("leases", lease());
    h.srv.setOnLine(false);
    const r = await correr(M.registrarVentaSegura(entrada()));
    expect(r.v).toMatchObject({ modo: "guardada", motivo: "sin_conexion" });
    expect(h.srv.state.llamadas.filter((l) => l.rpc === "ejecutar_idempotente")).toHaveLength(0);
    expect(await outbox()).toHaveLength(1);
    expect((await h.idb.listar<LeaseLocal>("leases"))[0].items[PROD].usado).toBe(1); // la reserva local descuenta

    h.srv.setOnLine(true);
    await correr(M.sincronizar());
    expect(escrituras()).toBe(1);
    expect(await outbox()).toHaveLength(0);
    const v = (await ventasLocales())[0];
    expect(v.estado).toBe("sincronizada");
    expect(v.numero).toMatch(/^B001-/);
  });

  it("CORTE 2 · el servidor guardó pero la respuesta se perdió (y se cayó internet): al volver NO se duplica y usa la MISMA request_id", async () => {
    h.srv.state.script = ["corte-tras-commit"];
    const r = await correr(M.registrarVentaSegura(entrada()));
    expect(r.v).toMatchObject({ modo: "guardada" });
    expect(escrituras()).toBe(1); // el servidor ya la tenía
    const [pedido] = await outbox();
    expect(pedido.requestId).toBe(idsEnviados()[0]); // la cola conserva el id con el que se envió

    h.srv.setOnLine(true);
    await correr(M.sincronizar());
    expect(escrituras()).toBe(1);
    expect(new Set(idsEnviados()).size).toBe(1);
    expect(await outbox()).toHaveLength(0);
    expect((await ventasLocales())[0]).toMatchObject({ estado: "sincronizada" });
    expect(P.listaPendientes()).toHaveLength(0);
  });

  it("CORTE 3 · se corta DURANTE un reintento (1.º intento guardó con 503, 2.º se cae internet): una sola venta, un solo id", async () => {
    h.srv.state.script = ["503-tras-commit", "corte-antes"];
    const r = await correr(M.registrarVentaSegura(entrada()));
    expect(r.v).toMatchObject({ modo: "guardada" });
    expect(escrituras()).toBe(1);
    h.srv.setOnLine(true);
    await correr(M.sincronizar());
    expect(escrituras()).toBe(1);
    expect(new Set(idsEnviados()).size).toBe(1);
    expect((await ventasLocales())[0].estado).toBe("sincronizada");
  });

  it("incierto SIN cortar internet y sin poder consultar: queda en cola con el mismo id y se resuelve solo", async () => {
    h.srv.state.script = ["timeout-tras-commit", "red-antes", "red-antes", "red-antes"];
    h.srv.state.consultas = ["falla"];
    const r = await correr(M.registrarVentaSegura(entrada()));
    expect(r.v).toMatchObject({ modo: "guardada" });
    expect(escrituras()).toBe(1);
    expect(new Set(idsEnviados()).size).toBe(1);
    expect((await ventasLocales())[0].estado).toBe("sincronizada");
    expect(P.listaPendientes()).toHaveLength(0);
  });

  it("si guardar en el equipo falla tras un resultado incierto, la operación sigue PENDIENTE y repetir usa el MISMO id (nunca uno nuevo)", async () => {
    h.idb.reset(); // sin copia local del catálogo: venderOffline no puede guardar la venta
    h.srv.state.script = ["corte-tras-commit"];
    const r1 = await correr(M.registrarVentaSegura(entrada()));
    expect(r1.e).toBeDefined(); // el cajero ve un error, no un "éxito"
    expect(escrituras()).toBe(1);
    expect(P.listaPendientes()).toHaveLength(1); // sigue visible para «Verificar estado»
    const id = P.listaPendientes()[0].id;

    h.srv.setOnLine(true);
    const r2 = await correr(M.registrarVentaSegura(entrada())); // el cajero vuelve a pulsar «Cobrar»
    expect(r2.v).toMatchObject({ modo: "enviada" });
    expect(escrituras()).toBe(1); // no se duplicó
    expect(new Set(idsEnviados())).toEqual(new Set([id]));
    expect(P.listaPendientes()).toHaveLength(0);
  });
});

describe("POS: request_id", () => {
  it("una venta idéntica NUEVA no adopta el id de una venta que está en la cola (no se traga la venta)", async () => {
    // venta 1: el servidor la guardó, se perdió la respuesta; queda en cola con su id
    h.srv.state.script = ["corte-tras-commit"];
    await correr(M.registrarVentaSegura(entrada()));
    expect(escrituras()).toBe(1);
    // vuelve internet pero el envío de la cola vuelve a quedar incierto
    h.srv.setOnLine(true);
    h.srv.state.script = ["red-antes", "red-antes", "red-antes", "red-antes"];
    h.srv.state.consultas = ["falla"];
    await correr(M.sincronizar());
    expect((await outbox())).toHaveLength(1);
    // el cajero cobra OTRA venta de lo mismo
    h.srv.state.script = [];
    const r = await correr(M.registrarVentaSegura(entrada()));
    expect(r.v).toMatchObject({ modo: "enviada" });
    expect(h.srv.total("registrar_venta")).toBe(2); // son DOS ventas distintas
    const numeros = [...h.srv.state.commits.values()].map((c: any) => c.resp.numero);
    expect(new Set(numeros).size).toBe(2);
  });

  it("rpcMut con request_id explícito no se confunde con otra operación en vuelo de igual contenido", async () => {
    const a = D.rpcMut("registrar_venta", { p_sede: SEDE });
    const b = D.rpcMut("registrar_venta", { p_sede: SEDE }, "id-explicito");
    await correr(Promise.all([a, b]));
    expect(escrituras()).toBe(2);
  });

  it("doble clic (sin request_id) sigue siendo UNA sola ejecución", async () => {
    const a = D.rpcMut("registrar_venta", { p_sede: SEDE });
    const b = D.rpcMut("registrar_venta", { p_sede: SEDE });
    await correr(Promise.all([a, b]));
    expect(escrituras()).toBe(1);
  });
});

describe("POS: P0409 (mismo request_id con datos distintos)", () => {
  /** Deja en la cola una venta (R, args) y en el servidor la misma R con OTROS datos. */
  async function colaConServidorDistinto() {
    const viejo = { p_sede: SEDE, p_caja: CAJA, p_items: [{ producto_id: PROD, cantidad: 1 }] };
    await h.srv.fake.rpc("ejecutar_idempotente", { p_request_id: "R-1", p_fn: "registrar_venta", p_args: viejo });
    h.srv.state.llamadas = [];
    h.srv.setOnLine(false);
    await h.idb.guardar("leases", lease());
    await M.venderOffline(entrada(2), { requestId: "R-1", args: { ...viejo, p_items: [{ producto_id: PROD, cantidad: 2 }] }, tolerante: true });
    await flush(); // deja terminar el intento de envío (bloqueado por estar sin internet) antes de reconectar
  }

  it("el servidor ya tenía esa operación: la venta se da por registrada, NO pasa a conflicto y NO se reenvía con otro id", async () => {
    await colaConServidorDistinto();
    h.srv.setOnLine(true);
    await correr(M.sincronizar());
    const v = (await ventasLocales())[0];
    expect(v.estado).toBe("sincronizada");
    expect(v.numero).toMatch(/^B001-/);
    expect(await outbox()).toHaveLength(0);
    expect(escrituras()).toBe(1); // sigue habiendo UNA sola venta en el servidor
    expect(new Set(idsEnviados())).toEqual(new Set(["R-1"]));
    expect((await h.idb.listar("conflictos"))).toHaveLength(0);
  });

  it("si no se puede confirmar con el servidor, la venta se CONSERVA en la cola (no pasa a conflicto ni pierde su id)", async () => {
    await colaConServidorDistinto();
    h.srv.setOnLine(true);
    h.srv.state.consultas = ["falla"];
    await correr(M.sincronizar());
    expect((await outbox())[0].requestId).toBe("R-1");
    expect((await ventasLocales())[0].estado).toBe("pendiente");
    expect(escrituras()).toBe(1);
  });

  it("P0409 sin operación registrada (inconsistente): se conserva en la cola con su id y no bloquea las demás ventas", async () => {
    h.srv.setOnLine(false);
    await h.idb.guardar("leases", lease());
    await M.venderOffline(entrada(1), { requestId: "R-raro", args: { p_sede: SEDE, p_items: [{ producto_id: PROD, cantidad: 1 }] }, tolerante: true });
    await M.venderOffline(entrada(1));
    await flush();
    h.srv.setOnLine(true);
    // el servidor responde P0409 SOLO a la primera, pero la consulta dice que no existe
    const orig = h.srv.fake.rpc;
    let primera = true;
    h.srv.fake.rpc = async (rpc: string, a: any) => {
      if (rpc === "ejecutar_idempotente" && a.p_request_id === "R-raro" && primera) {
        primera = false;
        return { data: null, error: { message: "Este identificador de operación ya se usó con datos distintos.", code: "P0409" }, status: 409 };
      }
      return orig(rpc, a);
    };
    await correr(M.sincronizar());
    h.srv.fake.rpc = orig;
    const cola = await outbox();
    expect(cola.map((o) => o.requestId)).toContain("R-raro");
    expect((await ventasLocales()).filter((v) => v.estado === "sincronizada")).toHaveLength(1); // la otra sí salió
    expect((await ventasLocales()).filter((v) => v.estado === "conflicto")).toHaveLength(0);
  });
});

describe("POS: «Reintentar» un conflicto", () => {
  async function ventaEnCola(requestId?: string, args?: Record<string, unknown>) {
    h.srv.setOnLine(false);
    await h.idb.guardar("leases", lease());
    const v = await M.venderOffline(entrada(1), requestId ? { requestId, args, tolerante: true } : {});
    await flush(); // termina el intento de envío bloqueado por estar sin internet
    return v;
  }

  it("un conflicto antiguo por P0409 (guardado por versiones anteriores) se confirma en el servidor ANTES de reenviar con id nuevo", async () => {
    const viejo = { p_sede: SEDE, p_items: [{ producto_id: PROD, cantidad: 1 }] };
    await h.srv.fake.rpc("ejecutar_idempotente", { p_request_id: "R-viejo", p_fn: "registrar_venta", p_args: viejo });
    const v = await ventaEnCola("R-viejo", { ...viejo, p_caja: CAJA });
    // así lo dejaba la versión anterior: conflicto «otro» y fuera de la cola
    await h.idb.guardar("ventas", { ...v, estado: "conflicto", conflicto: { tipo: "otro", mensaje: "Este identificador de operación ya se usó con datos distintos." } });
    await h.idb.transaccion(["outbox"], "readwrite", async (a: any) => a.del("outbox", "R-viejo"));
    h.srv.setOnLine(true);
    h.srv.state.llamadas = [];

    await M.reenviarConflicto(v.localId);
    await flush();

    expect((await ventasLocales())[0]).toMatchObject({ estado: "sincronizada", numero: expect.stringMatching(/^B001-/) });
    expect(await outbox()).toHaveLength(0);
    expect(escrituras()).toBe(1); // NO se duplicó
    expect(idsEnviados()).toHaveLength(0); // y no se envió nada con un id nuevo
  });

  it("si no se puede confirmar (sin internet) NO reenvía con id nuevo: falla y la venta sigue en conflicto", async () => {
    const v = await ventaEnCola();
    await h.idb.guardar("ventas", { ...v, estado: "conflicto", conflicto: { tipo: "otro", mensaje: "Este identificador de operación ya se usó con datos distintos." } });
    await h.idb.transaccion(["outbox"], "readwrite", async (a: any) => a.del("outbox", v.requestId));
    // sigue sin internet
    const r = await correr(M.reenviarConflicto(v.localId));
    expect(r.e).toBeDefined();
    expect(await outbox()).toHaveLength(0);
    expect((await ventasLocales())[0].estado).toBe("conflicto");
  });

  it("un conflicto LEGÍTIMO (stock agotado en el servidor) sigue reenviándose con un id nuevo, como antes", async () => {
    const v = await ventaEnCola();
    const primerId = v.requestId;
    h.srv.setOnLine(true);
    h.srv.state.script = ["negocio"];
    await correr(M.sincronizar());
    expect((await ventasLocales())[0]).toMatchObject({ estado: "conflicto", conflicto: { tipo: "stock" } });
    expect(escrituras()).toBe(0); // el servidor revirtió: no guardó nada

    await M.reenviarConflicto(v.localId);
    await flush();
    expect(escrituras()).toBe(1);
    expect((await ventasLocales())[0].estado).toBe("sincronizada");
    expect(idsEnviados().at(-1)).not.toBe(primerId); // id nuevo: la anterior NO se grabó
  });
});
