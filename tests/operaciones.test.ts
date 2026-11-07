import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Producto } from "@/lib/types";

/**
 * Compras, traslados, caja y productos NO funcionan sin internet (es otro proyecto): aquí se prueba que, sin red,
 * la operación se BLOQUEA con un mensaje claro (sin enviar nada ni dejar nada a medias), y que ante un resultado
 * incierto la operación queda PENDIENTE y se resuelve con verificarOperacion, siempre con la MISMA request_id.
 */
const h = await vi.hoisted(async () => {
  const { crearServidor } = await import("./helpers/servidorFalso");
  const { crearIdb } = await import("./helpers/idbEnMemoria");
  return { srv: crearServidor(), idb: crearIdb() };
});
vi.mock("@/lib/supabase/client", () => ({ createClient: () => h.srv.fake }));
vi.mock("@/lib/offline/idb", () => h.idb); // cerrarCaja devuelve reservas locales

let D: typeof import("@/lib/data/db");
let P: typeof import("@/lib/net/pendientes");
let E: typeof import("@/lib/net/errores");
let compras: typeof import("@/lib/data/compras");
let almacen: typeof import("@/lib/data/almacen");
let cajas: typeof import("@/lib/data/cajas");
let productos: typeof import("@/lib/data/productos");

const PRODUCTO = { id: "p1", codigo: "A1", nombre: "Galletas", descripcion: "", categoriaId: null, precio: 5, precioCompra: 3, stockMinimo: 1, unidad: "Unidad", activo: true } as unknown as Producto;

const flush = () => vi.advanceTimersByTimeAsync(120_000);
async function correr<T>(p: Promise<T>) {
  const r = p.then((v) => ({ v }), (e) => ({ e }));
  await flush();
  return (await r) as { v?: T; e?: any };
}

const OPERACIONES: { nombre: string; fn: string; run: () => Promise<unknown> }[] = [
  { nombre: "compra de insumos", fn: "registrar_compra_completa", run: () => compras.registrarCompraCompleta({ sedeId: "s1", proveedorNombre: "Prov", comprobante: "F-1", fecha: "2026-11-06", recibida: true, items: [{ productoId: "p1", nombre: "Galletas", cantidad: 2, precio: 3 }] }) },
  { nombre: "recepción de compra", fn: "recibir_compra", run: () => compras.recibirCompra("compra-1") },
  { nombre: "anulación de compra", fn: "anular_compra", run: () => compras.anularCompra("compra-1", "error de digitación") },
  { nombre: "traslado entre sedes", fn: "enviar_a_sede", run: () => almacen.enviarASede("s1", "s2", [{ productoId: "p1", cantidad: 3 }], "reposición") },
  { nombre: "traslado almacén → tienda", fn: "mover_almacen_tienda", run: () => almacen.moverAlmacenTienda("s1", "a_tienda", [{ productoId: "p1", cantidad: 3 }], "") },
  { nombre: "ajuste de almacén", fn: "ajustar_almacen", run: () => almacen.ajustarAlmacen("s1", "p1", "ingreso", 4, "conteo") },
  { nombre: "apertura de caja", fn: "abrir_mi_caja", run: () => cajas.abrirMiCaja("s1", 50) },
  { nombre: "cierre de caja", fn: "cerrar_caja", run: () => cajas.cerrarCaja("caja-1", 120, "") },
  { nombre: "egreso de caja", fn: "registrar_egreso", run: () => cajas.registrarEgreso("caja-1", "taxi", 15) },
  { nombre: "producto nuevo", fn: "crear_producto", run: () => productos.crearProducto(PRODUCTO, "s1", 10) },
  { nombre: "edición de producto", fn: "actualizar_producto", run: () => productos.actualizarProducto(PRODUCTO, "s1", 12, "inventario") },
  { nombre: "ajuste de stock de producto", fn: "ajustar_stock_producto", run: () => productos.ajustarStockProducto("s1", "p1", "tienda", 2, "reposición") },
];

const idsEnviados = () => h.srv.state.llamadas.filter((l) => l.rpc === "ejecutar_idempotente").map((l) => l.id);

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  localStorage.clear();
  h.srv.reiniciar();
  h.idb.reset();
  vi.stubGlobal("indexedDB", {});
  Object.defineProperty(navigator, "locks", { value: { request: async (_n: string, _o: unknown, cb: (l: unknown) => unknown) => cb({}) }, configurable: true });
  D = await import("@/lib/data/db");
  P = await import("@/lib/net/pendientes");
  E = await import("@/lib/net/errores");
  compras = await import("@/lib/data/compras");
  almacen = await import("@/lib/data/almacen");
  cajas = await import("@/lib/data/cajas");
  productos = await import("@/lib/data/productos");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe.each(OPERACIONES)("$nombre", ({ fn, run }) => {
  it("SIN INTERNET: se bloquea con un mensaje claro, no se envía nada y no queda nada a medias", async () => {
    h.srv.setOnLine(false);
    const r = await correr(run());
    expect(r.e).toBeInstanceOf(E.ErrorApp);
    expect(r.e.tipo).toBe("offline");
    expect(r.e.incierto).toBe(false); // seguro: no salió nada
    expect(r.e.message).toMatch(/Sin conexión a internet/);
    expect(r.e.message).toMatch(/tus datos siguen en pantalla/);
    expect(h.srv.state.llamadas).toHaveLength(0); // ni una petición
    expect(h.srv.total()).toBe(0);
    expect(P.listaPendientes()).toHaveLength(0); // nada pendiente: no hay nada que verificar
  });

  it("CORTE 1 · antes de enviar: se bloquea; al volver internet y repetir, se guarda UNA sola vez", async () => {
    h.srv.setOnLine(false);
    await correr(run());
    h.srv.setOnLine(true);
    const r = await correr(run());
    expect(r.e).toBeUndefined();
    expect(h.srv.total(fn)).toBe(1);
    expect(P.listaPendientes()).toHaveLength(0);
  });

  it("CORTE 2 · el servidor guardó pero la respuesta se perdió: queda PENDIENTE (no se reintenta a ciegas) y 'Verificar estado' la resuelve", async () => {
    h.srv.state.script = ["corte-tras-commit"];
    const r = await correr(run());
    expect(r.e.incierto).toBe(true);
    expect(r.e.message).toBe(E.MENSAJE_INCIERTO); // «No pudimos confirmar… pulsa «Verificar estado»»
    expect(h.srv.total(fn)).toBe(1); // el servidor sí la tiene
    expect(P.listaPendientes()).toHaveLength(1);
    expect(idsEnviados()).toHaveLength(1); // no hubo un 2.º envío a ciegas mientras no había internet

    h.srv.setOnLine(true);
    const id = P.listaPendientes()[0].id;
    const q = await correr(D.verificarOperacion(id));
    expect(q.v!.estado).toBe("completada");
    expect(P.listaPendientes()).toHaveLength(0);
    expect(h.srv.total(fn)).toBe(1);
  });

  it("CORTE 2b · tras el resultado incierto, repetir EL MISMO formulario reutiliza la request_id y no duplica", async () => {
    h.srv.state.script = ["corte-tras-commit"];
    await correr(run());
    h.srv.setOnLine(true);
    const r = await correr(run());
    expect(r.e).toBeUndefined();
    expect(h.srv.total(fn)).toBe(1);
    expect(new Set(idsEnviados()).size).toBe(1); // jamás un id nuevo
    expect(P.listaPendientes()).toHaveLength(0);
  });

  it("CORTE 3 · se corta DURANTE un reintento: queda pendiente con el mismo id y se resuelve sin duplicar", async () => {
    h.srv.state.script = ["503-tras-commit", "corte-antes"]; // 1.º guardó (503), 2.º se cae internet
    const r = await correr(run());
    expect(r.e.incierto).toBe(true);
    expect(h.srv.total(fn)).toBe(1);
    expect(P.listaPendientes()).toHaveLength(1);
    h.srv.setOnLine(true);
    const r2 = await correr(run());
    expect(r2.e).toBeUndefined();
    expect(h.srv.total(fn)).toBe(1);
    expect(new Set(idsEnviados()).size).toBe(1);
  });

  it("incierto y NO guardado: 'Verificar estado' dice 'no encontrada' y repetir usa el MISMO id (una sola escritura)", async () => {
    h.srv.state.script = ["corte-antes"]; // se cayó antes de llegar: no se sabe si llegó
    const r = await correr(run());
    expect(r.e.incierto).toBe(true);
    expect(h.srv.total(fn)).toBe(0);
    const id = P.listaPendientes()[0].id;
    h.srv.setOnLine(true);
    expect((await correr(D.verificarOperacion(id))).v!.estado).toBe("no_encontrada");
    expect(P.listaPendientes()).toHaveLength(1); // se conserva hasta resolverla
    const r2 = await correr(run());
    expect(r2.e).toBeUndefined();
    expect(h.srv.total(fn)).toBe(1);
    expect(new Set(idsEnviados())).toEqual(new Set([id]));
  });

  it("error de negocio: no se reintenta, no queda pendiente y el mensaje de la BD llega intacto", async () => {
    h.srv.state.script = ["negocio"];
    const r = await correr(run());
    expect(r.e.tipo).toBe("negocio");
    expect(r.e.message).toMatch(/Stock insuficiente/);
    expect(idsEnviados()).toHaveLength(1);
    expect(P.listaPendientes()).toHaveLength(0);
  });
});

describe("avisos de operaciones pendientes", () => {
  it("toda operación que puede quedar pendiente tiene una etiqueta legible (no el nombre técnico)", () => {
    for (const { fn } of OPERACIONES) expect(P.ETIQUETAS[fn], fn).toBeTruthy();
    expect(P.ETIQUETAS.crear_lease_offline).toMatch(/Reserva/);
    expect(P.ETIQUETAS.liquidar_lease).toBeTruthy();
  });

  it("el aviso queda guardado con su request_id, su etiqueta y sobrevive a recargar la página", async () => {
    h.srv.state.script = ["corte-tras-commit"];
    await correr(compras.registrarCompraCompleta({ sedeId: "s1", proveedorNombre: "Prov", comprobante: "F-1", fecha: "2026-11-06", recibida: true, items: [{ productoId: "p1", nombre: "Galletas", cantidad: 2, precio: 3 }] }));
    const guardado = JSON.parse(localStorage.getItem("market.ops.pendientes.v1")!);
    expect(guardado).toHaveLength(1);
    expect(guardado[0]).toMatchObject({ fn: "registrar_compra_completa", etiqueta: "Compra de insumos", id: idsEnviados()[0] });
  });
});
