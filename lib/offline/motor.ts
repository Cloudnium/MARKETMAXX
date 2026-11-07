/**
 * Motor de ventas sin conexión.
 *
 * Regla de oro: el SERVIDOR es la verdad. Offline solo se vende contra una RESERVA (lease) de stock que el
 * servidor descontó del pool mientras había internet y entregó a ESTA caja; ninguna otra caja puede usarla.
 * Cada venta offline se guarda completa en la outbox (IndexedDB) con su request_id y se envía al reconectar
 * con idempotencia (una venta por request_id). Si el servidor la rechaza pasa a CONFLICTOS: nunca se borra.
 */
import { ErrorApp, MENSAJE_INCIERTO } from "@/lib/net/errores";
import { consultarOperacion, rpc, rpcMut } from "@/lib/data/db";
import { alRevalidar, bloqueaEscrituras, iniciarConexion, revalidarTodo, suscribirConexion } from "@/lib/net/conexion";
import { nuevoId, quitarPendiente, vaciarPendientes } from "@/lib/net/pendientes";
import type { TicketData } from "@/lib/impresion/ticket";
import { leer, listar, guardar, STORES, transaccion } from "./idb";
import type {
  ConflictoLocal,
  EstadoOffline,
  LeaseLocal,
  OutboxItem,
  Snapshot,
  TipoConflicto,
  VentaLocal,
} from "./tipos";

// ---------------------------------------------------------------------
// Estado observable (para la UI) + aviso entre pestañas
// ---------------------------------------------------------------------
let estado: EstadoOffline = { pendientes: 0, conflictos: 0, sincronizando: false, pausaSesion: false, leases: [], ventas: [], ultimoSync: null };
const oyentes = new Set<() => void>();
let canal: BroadcastChannel | null = null;
let sincronizandoRemoto = false;
let pausaSesion = false;
let ultimoSync: number | null = null;

export const leerEstadoOffline = () => estado;
export const suscribirOffline = (f: () => void) => {
  oyentes.add(f);
  return () => void oyentes.delete(f);
};

export async function refrescar(difundir = true) {
  if (typeof indexedDB === "undefined") return;
  const [ventas, outbox, leases] = await Promise.all([listar<VentaLocal>("ventas"), listar<OutboxItem>("outbox"), listar<LeaseLocal>("leases")]);
  estado = {
    pendientes: outbox.length,
    conflictos: ventas.filter((v) => v.estado === "conflicto").length,
    sincronizando: sincronizandoLocal || sincronizandoRemoto,
    pausaSesion,
    leases,
    ventas: ventas.sort((a, b) => b.fecha.localeCompare(a.fecha)),
    ultimoSync,
  };
  oyentes.forEach((f) => f());
  if (difundir) canal?.postMessage({ t: "cambio" });
}

// ---------------------------------------------------------------------
// Snapshot del catálogo (precios/productos/cajas) para poder operar sin red
// ---------------------------------------------------------------------
export const guardarSnapshot = (s: Omit<Snapshot, "guardado">) => guardar("snapshot", { ...s, guardado: Date.now() });
export const leerSnapshot = (sedeId: string) => leer<Snapshot>("snapshot", sedeId);

// ---------------------------------------------------------------------
// Reservas de stock (leases)
// ---------------------------------------------------------------------
export const leaseVigente = (l: LeaseLocal, ahora = Date.now()) => ahora + l.offsetMs < l.expiraMs;
export const restante = (l: LeaseLocal, productoId: string) => {
  const it = l.items[productoId];
  return it ? Math.max(0, it.otorgado - it.usado) : 0;
};

/** Reserva vigente de una caja (la más reciente). */
export async function reservaDeCaja(sedeId: string, cajaId: string): Promise<LeaseLocal | null> {
  const todas = await listar<LeaseLocal>("leases");
  return todas.filter((l) => l.sedeId === sedeId && l.cajaId === cajaId && leaseVigente(l)).sort((a, b) => b.creadoMs - a.creadoMs)[0] ?? null;
}

/**
 * Pide al servidor que reserve stock para esta caja (solo con internet). Reemplaza la reserva anterior:
 * primero sincroniza lo pendiente y devuelve al pool lo no usado de la anterior.
 */
export async function crearReserva(p: { sedeId: string; cajaId: string; items: { productoId: string; cantidad: number }[]; ttlMin?: number }) {
  if (bloqueaEscrituras()) throw new ErrorApp("offline", "Sin conexión: la reserva de stock solo se puede pedir con internet.");
  await sincronizar();
  const previas = (await listar<LeaseLocal>("leases")).filter((l) => l.sedeId === p.sedeId && l.cajaId === p.cajaId);
  const outbox = await listar<OutboxItem>("outbox");
  for (const l of previas) {
    if (outbox.some((o) => o.args.p_lease === l.leaseId))
      throw new ErrorApp("negocio", "Hay ventas offline sin sincronizar. Espera a que terminen de enviarse para cambiar la reserva.");
    await liquidarUna(l);
  }
  const items = p.items.filter((i) => i.cantidad > 0);
  const r = await rpcMut<{ lease_id: string; expira: string; servidor_ahora: string; items: { producto_id: string; solicitado: number; otorgado: number }[] }>(
    "crear_lease_offline",
    {
      p_sede: p.sedeId,
      p_caja: p.cajaId,
      p_items: items.map((i) => ({ producto_id: i.productoId, cantidad: i.cantidad })),
      p_ttl_min: p.ttlMin ?? 480,
      p_dispositivo: await dispositivo(),
    }
  );
  const lease: LeaseLocal = {
    leaseId: r.lease_id,
    sedeId: p.sedeId,
    cajaId: p.cajaId,
    expiraMs: Date.parse(r.expira),
    offsetMs: Date.parse(r.servidor_ahora) - Date.now(),
    creadoMs: Date.now(),
    items: Object.fromEntries(r.items.filter((i) => Number(i.otorgado) > 0).map((i) => [i.producto_id, { otorgado: Number(i.otorgado), usado: 0 }])),
  };
  await guardar("leases", lease);
  await guardar("meta", { key: `ultimaReserva:${p.sedeId}:${p.cajaId}`, items, ttlMin: p.ttlMin ?? 480 });
  await refrescar();
  return { lease, resultado: r.items };
}

export async function ultimaReserva(sedeId: string, cajaId: string) {
  return (await leer<{ items: { productoId: string; cantidad: number }[]; ttlMin: number }>("meta", `ultimaReserva:${sedeId}:${cajaId}`)) ?? null;
}

async function liquidarUna(l: LeaseLocal) {
  try {
    await rpcMut("liquidar_lease", { p_lease: l.leaseId });
  } catch (e) {
    const err = e as ErrorApp;
    if (!(err.tipo === "negocio" && /no existe/i.test(err.message))) throw err;
  }
  await transaccion(["leases"], "readwrite", (a) => a.del("leases", l.leaseId));
}

/** Devuelve al pool el stock reservado que no se vendió (tras enviar lo pendiente). */
export async function liberarReserva(leaseId: string) {
  await sincronizar();
  const l = await leer<LeaseLocal>("leases", leaseId);
  if (!l) return;
  if ((await listar<OutboxItem>("outbox")).some((o) => o.args.p_lease === leaseId))
    throw new ErrorApp("negocio", "Aún hay ventas offline por sincronizar con esta reserva.");
  await liquidarUna(l);
  await refrescar();
}

/** Tras limpiar el sistema: este equipo olvida reservas, ventas guardadas, cola de envío y conflictos (ya no existen en la BD). */
export async function vaciarDatosLocales() {
  await transaccion(["snapshot", "leases", "outbox", "ventas", "conflictos"], "readwrite", async (a) => {
    for (const s of ["snapshot", "leases", "outbox", "ventas", "conflictos"] as const) {
      const clave = STORES[s];
      for (const x of await a.all<Record<string, string>>(s)) await a.del(s, x[clave]);
    }
  });
  vaciarPendientes();
  await refrescar();
}

/** Al cerrar la caja: devuelve al stock lo reservado para ella (si hay red y nada pendiente; si no, vence solo). */
export async function liberarReservasDeCaja(cajaId: string) {
  try {
    await sincronizar();
    const outbox = await listar<OutboxItem>("outbox");
    for (const l of (await listar<LeaseLocal>("leases")).filter((x) => x.cajaId === cajaId)) {
      if (outbox.some((o) => o.args.p_lease === l.leaseId)) continue;
      await liquidarUna(l);
    }
    await refrescar();
  } catch {
    /* la reserva vence sola y el servidor devuelve el stock */
  }
}

// ---------------------------------------------------------------------
// Venta offline
// ---------------------------------------------------------------------
export interface EntradaVentaOffline {
  sedeId: string;
  cajaId: string;
  tipo: VentaLocal["tipo"];
  metodo: string;
  descuento: number;
  clienteId: string | null;
  clienteNombre: string | null;
  clienteDocumento: string | null;
  items: { productoId: string; cantidad: number }[];
}

async function dispositivo() {
  let d = await leer<{ key: string; id: string }>("meta", "dispositivo");
  if (!d) {
    d = { key: "dispositivo", id: nuevoId().slice(0, 4).toUpperCase() };
    await guardar("meta", d);
  }
  return d.id;
}

export function argsVenta(v: VentaLocal, o: { conLease: boolean; aceptarPrecio: boolean }): Record<string, unknown> {
  return {
    p_sede: v.sedeId,
    p_caja: v.cajaId,
    p_tipo: v.tipo,
    p_cliente: v.clienteId || null,
    p_metodo_pago: v.metodo,
    p_descuento_pct: v.descuento,
    // precio_esperado: el precio que vio el cliente; si en el servidor cambió, la venta pasa a CONFLICTO de precio
    p_items: v.items.map((i) => ({ producto_id: i.productoId, cantidad: i.cantidad, precio_esperado: i.precio })),
    p_notas: null,
    p_cliente_nombre: v.clienteNombre,
    p_cliente_documento: v.clienteDocumento,
    p_lease: o.conLease ? v.leaseId : null,
    p_fecha_offline: v.fecha,
    p_aceptar_precio: o.aceptarPrecio,
    p_numero_provisional: v.provisional,
  };
}

const redondear = (n: number) => Math.round(n * 100) / 100;

/** Guarda la venta en el dispositivo (atómico: venta + outbox + consumo local de la reserva). */
export interface OpcionesGuardado {
  /** Reutiliza la request_id de un envío cuyo resultado quedó incierto (así el servidor lo reconoce y no duplica). */
  requestId?: string;
  /** Pedido EXACTO que se envió en línea (mismos datos = mismo hash en el servidor). */
  args?: Record<string, unknown>;
  /** Guarda la venta aunque no haya reserva o no alcance: se envía tal cual y el servidor decide. */
  tolerante?: boolean;
}

export async function venderOffline(e: EntradaVentaOffline, op: OpcionesGuardado = {}): Promise<VentaLocal> {
  const snap = await leerSnapshot(e.sedeId);
  if (!snap) throw new ErrorApp("negocio", "No hay datos guardados de esta sede en el dispositivo. Conéctate una vez para poder vender sin internet.");
  const caja = snap.cajas.find((c) => c.id === e.cajaId);
  const agregados = new Map<string, number>();
  for (const i of e.items) agregados.set(i.productoId, (agregados.get(i.productoId) ?? 0) + i.cantidad);

  const venta = await transaccion(["leases", "outbox", "ventas", "meta"], "readwrite", async (a) => {
    const leases = (await a.all<LeaseLocal>("leases"))
      .filter((l) => l.sedeId === e.sedeId && l.cajaId === e.cajaId && leaseVigente(l))
      .sort((x, y) => y.creadoMs - x.creadoMs);
    const lease = leases[0];
    if (!lease && !op.tolerante) throw new ErrorApp("negocio", "Sin reserva de stock vigente para esta caja: no se puede vender sin conexión.", { codigo: "SIN_LEASE" });
    // un pedido ya enviado en línea solo consume la reserva con la que se envió
    const usaLease = !!lease && (!op.args || op.args.p_lease === lease.leaseId);
    const consumoLease: Record<string, number> = {};

    const items = [...agregados].map(([productoId, cantidad]) => {
      const p = snap.productos.find((x) => x.id === productoId);
      if (!p || !p.activo) throw new ErrorApp("negocio", "Hay un producto no disponible en la venta.");
      if (usaLease) {
        const quedan = restante(lease!, productoId);
        if (!op.tolerante && cantidad > quedan)
          throw new ErrorApp("negocio", `Stock reservado insuficiente de "${p.nombre}": quedan ${quedan} en esta caja.`, { codigo: "LEASE_INSUFICIENTE" });
        const toma = Math.min(cantidad, quedan);
        if (toma > 0) {
          lease!.items[productoId].usado += toma;
          consumoLease[productoId] = toma;
        }
      }
      return { productoId, nombre: p.nombre, cantidad, precio: p.precio };
    });

    const bruto = items.reduce((s, i) => s + redondear(i.precio * i.cantidad), 0);
    const total = redondear(bruto - redondear((bruto * (e.descuento || 0)) / 100));
    const seq = ((await a.get<{ key: string; n: number }>("meta", "seq"))?.n ?? 0) + 1;
    await a.put("meta", { key: "seq", n: seq });
    const disp = (await a.get<{ key: string; id: string }>("meta", "dispositivo"))?.id ?? "OFF0";
    const v: VentaLocal = {
      localId: nuevoId(),
      requestId: op.requestId ?? nuevoId(),
      sedeId: e.sedeId,
      cajaId: e.cajaId,
      cajaNombre: caja?.nombre ?? "—",
      leaseId: usaLease ? lease!.leaseId : null,
      consumoLease,
      provisional: `OFF-${disp}-${String(seq).padStart(5, "0")}`,
      fecha: new Date().toISOString(),
      estado: "pendiente",
      total,
      tipo: e.tipo,
      metodo: e.metodo,
      descuento: e.descuento || 0,
      clienteId: e.clienteId,
      clienteNombre: e.clienteNombre,
      clienteDocumento: e.clienteDocumento,
      items,
      sede: snap.sede,
      vendedor: snap.vendedor,
      intentos: 0,
    };
    if (lease) await a.put("leases", lease);
    await a.put("ventas", v);
    await a.put<OutboxItem>("outbox", { requestId: v.requestId, localId: v.localId, fn: "registrar_venta", args: op.args ?? argsVenta(v, { conLease: true, aceptarPrecio: false }), creado: Date.now(), intentos: 0 });
    return v;
  });
  await refrescar();
  void sincronizar(); // si en realidad ya hay red, sale de inmediato
  return venta;
}

// ---------------------------------------------------------------------
// Venta "a prueba de cortes": una sola función para vender con o sin internet
// ---------------------------------------------------------------------
export type ResultadoVenta =
  | { modo: "enviada"; id: string; numero: string; total: number }
  | { modo: "guardada"; venta: VentaLocal; motivo: "sin_conexion" | "sin_confirmar" };

/** Pedido que se envía EN LÍNEA. Si el envío queda incierto, este mismo pedido (y su request_id) se reenvía luego. */
export function argsConectado(e: EntradaVentaOffline, leaseId: string | null): Record<string, unknown> {
  return {
    p_sede: e.sedeId,
    p_caja: e.cajaId,
    p_tipo: e.tipo,
    p_cliente: e.clienteId,
    p_metodo_pago: e.metodo,
    p_descuento_pct: e.descuento,
    p_items: e.items.map((i) => ({ producto_id: i.productoId, cantidad: i.cantidad })),
    p_notas: null,
    p_cliente_nombre: e.clienteNombre,
    p_cliente_documento: e.clienteDocumento,
    ...(leaseId ? { p_lease: leaseId } : {}),
  };
}

async function consumirReservaLocal(leaseId: string, items: { productoId: string; cantidad: number }[]) {
  await transaccion(["leases"], "readwrite", async (a) => {
    const l = await a.get<LeaseLocal>("leases", leaseId);
    if (!l) return;
    for (const i of items) if (l.items[i.productoId]) l.items[i.productoId].usado += Math.min(i.cantidad, restante(l, i.productoId));
    await a.put("leases", l);
  });
  await refrescar();
}

/**
 * Registra la venta con garantía de UNA sola vez, pase lo que pase con la red:
 *  - Con internet: se envía con su request_id (y, si hay, contra la reserva de MI caja primero).
 *  - Sin internet desde el inicio: se guarda en el equipo (contra la reserva) y se envía sola al volver.
 *  - Si la conexión se corta a mitad del envío (no sabemos si llegó): se guarda en el equipo con la MISMA request_id y los
 *    MISMOS datos. Al reconectar el servidor la reconoce: si ya estaba registrada responde "repetida" y no descuenta stock otra vez.
 */
export async function registrarVentaSegura(e: EntradaVentaOffline): Promise<ResultadoVenta> {
  const lease = await reservaDeCaja(e.sedeId, e.cajaId);
  const usaLease = !!lease && e.items.some((i) => restante(lease, i.productoId) > 0);
  const args = argsConectado(e, usaLease ? lease!.leaseId : null);
  try {
    const res = await rpcMut<{ id: string; numero: string; total: number }>("registrar_venta", args);
    if (usaLease) await consumirReservaLocal(lease!.leaseId, e.items);
    return { modo: "enviada", ...res };
  } catch (err) {
    if (!(err instanceof ErrorApp)) throw err;
    if (err.tipo === "offline" || (err.tipo === "red" && !err.incierto))
      return { modo: "guardada", motivo: "sin_conexion", venta: await venderOffline(e) }; // no salió nada: venta offline normal
    if (err.incierto && err.requestId) {
      let venta: VentaLocal;
      try {
        venta = await venderOffline(e, { requestId: err.requestId, args, tolerante: true });
      } catch {
        // NO se pudo guardar en la cola del equipo: la operación sigue PENDIENTE con su request_id (el aviso «Verificar estado»
        // se conserva y repetir la misma venta reutiliza ese id). Quitarla aquí haría que el reintento use un id nuevo y duplique.
        throw new ErrorApp(err.tipo, MENSAJE_INCIERTO, { status: err.status, incierto: true, requestId: err.requestId });
      }
      quitarPendiente(err.requestId); // ya está en la cola del equipo: desde aquí se encarga ella (sin «Verificar estado» manual)
      return { modo: "guardada", motivo: bloqueaEscrituras() ? "sin_conexion" : "sin_confirmar", venta };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------
// Reconciliación de reservas con el servidor
// ---------------------------------------------------------------------
/** Una reserva "huérfana" (se perdió la respuesta al crearla) se devuelve sola pasado este tiempo. */
export const configMotor = { edadHuerfanaMs: 90_000 };

interface FilaLeaseServidor {
  lease_id: string;
  producto_id: string;
  cantidad: number | string;
  usada: number | string;
  dispositivo?: string | null;
  creado?: string | null;
}

/** Ejecuta `fn` solo si nadie más (otra pestaña) está tocando las reservas. */
export async function conCerrojoReservas<T>(fn: () => Promise<T>): Promise<T | undefined> {
  const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  if (!locks) return fn();
  let r: T | undefined;
  await locks.request("market-reservas", { ifAvailable: true }, async (lock) => {
    if (lock) r = await fn();
  });
  return r;
}

/**
 * Compara las reservas del equipo con las del servidor:
 *  - ajusta lo "usado" local a lo que el servidor ya consumió (ventas en línea, otra pestaña…);
 *  - devuelve al stock las reservas huérfanas de ESTE equipo que el servidor creó pero el equipo nunca recibió.
 */
export async function reconciliarReservas() {
  if (bloqueaEscrituras()) return;
  const filas = await rpc<FilaLeaseServidor[]>("mis_leases_offline");
  const srv = new Map<string, FilaLeaseServidor[]>();
  for (const f of filas) srv.set(f.lease_id, [...(srv.get(f.lease_id) ?? []), f]);
  const miDisp = await dispositivo();

  const huerfanas = await transaccion(["leases", "ventas", "outbox"], "readwrite", async (a) => {
    const locales = await a.all<LeaseLocal>("leases");
    const ventas = await a.all<VentaLocal>("ventas");
    const conocidas = new Set<string>([...locales.map((l) => l.leaseId), ...ventas.filter((v) => v.estado === "pendiente" && v.leaseId).map((v) => v.leaseId!)]);
    for (const l of locales) {
      const filasL = srv.get(l.leaseId);
      if (!filasL) continue;
      let cambio = false;
      for (const f of filasL) {
        const it = l.items[f.producto_id];
        if (!it) continue;
        const pendiente = ventas.filter((v) => v.estado === "pendiente" && v.leaseId === l.leaseId).reduce((s, v) => s + (v.consumoLease?.[f.producto_id] ?? 0), 0);
        const usado = Math.min(it.otorgado, Number(f.usada) + pendiente);
        if (usado !== it.usado) {
          it.usado = usado;
          cambio = true;
        }
      }
      if (cambio) await a.put("leases", l);
    }
    return [...srv.entries()]
      .filter(([id, fs]) => !conocidas.has(id) && fs[0].dispositivo === miDisp && Date.now() - Date.parse(fs[0].creado ?? "") >= configMotor.edadHuerfanaMs)
      .map(([id]) => id);
  });

  for (const id of huerfanas) await liquidarUna({ leaseId: id } as LeaseLocal);
  await refrescar();
}

/** Garantiza el número de dispositivo antes de la primera venta offline. */
export const prepararDispositivo = dispositivo;

// ---------------------------------------------------------------------
// Sincronización (UNA sola pestaña a la vez)
// ---------------------------------------------------------------------
let sincronizandoLocal = false;
let enCurso: Promise<void> | null = null;
const NOMBRE_LOCK = "market-offline-sync";

async function conCerrojo(fn: () => Promise<void>) {
  const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  if (locks) {
    await locks.request(NOMBRE_LOCK, { ifAvailable: true }, async (lock) => {
      if (lock) await fn(); // si otra pestaña ya sincroniza, esta no hace nada
    });
    return;
  }
  // Respaldo sin Web Locks: cerrojo con caducidad en localStorage
  const k = "market.offline.sync.lock";
  const yo = nuevoId();
  const ahora = Date.now();
  const actual = JSON.parse(localStorage.getItem(k) ?? "null") as { id: string; t: number } | null;
  if (actual && ahora - actual.t < 30_000) return;
  localStorage.setItem(k, JSON.stringify({ id: yo, t: ahora }));
  await new Promise((r) => setTimeout(r, 30));
  if (JSON.parse(localStorage.getItem(k) ?? "null")?.id !== yo) return;
  try {
    await fn();
  } finally {
    localStorage.removeItem(k);
  }
}

export function sincronizar(): Promise<void> {
  if (typeof indexedDB === "undefined") return Promise.resolve();
  if (enCurso) return enCurso;
  enCurso = conCerrojo(ciclo).finally(() => {
    enCurso = null;
  });
  return enCurso;
}

function tipoConflicto(e: ErrorApp): TipoConflicto {
  const m = e.message;
  if (e.codigo === "P0424") return "precio";
  if (e.codigo === "P0426") return "lease";
  if (e.codigo === "P0422" || /caja/i.test(m)) return "caja";
  if (e.codigo === "42501" || /permiso/i.test(m)) return "permiso";
  if (/stock|disponible/i.test(m) || e.codigo === "23514") return "stock";
  return "otro";
}

async function marcarSincronizada(it: OutboxItem, res: { id: string; numero: string; total: number }) {
  await transaccion(["ventas", "outbox"], "readwrite", async (a) => {
    const v = await a.get<VentaLocal>("ventas", it.localId);
    if (v) await a.put("ventas", { ...v, estado: "sincronizada", numero: res.numero, total: Number(res.total), conflicto: undefined });
    await a.del("outbox", it.requestId);
  });
}

async function moverAConflicto(it: OutboxItem, err: ErrorApp) {
  const tipo = tipoConflicto(err);
  await transaccion(["ventas", "outbox", "conflictos", "leases"], "readwrite", async (a) => {
    const v = await a.get<VentaLocal>("ventas", it.localId);
    if (v) {
      // se LIBERA la reserva local que ocupaba esta venta (la venta nunca se borra)
      if (v.leaseId) {
        const l = await a.get<LeaseLocal>("leases", v.leaseId);
        if (l) {
          for (const i of v.items) if (l.items[i.productoId]) l.items[i.productoId].usado = Math.max(0, l.items[i.productoId].usado - (v.consumoLease?.[i.productoId] ?? i.cantidad));
          await a.put("leases", l);
        }
      }
      await a.put("ventas", { ...v, estado: "conflicto", conflicto: { tipo, mensaje: err.message } });
    }
    await a.put<ConflictoLocal>("conflictos", { localId: it.localId, tipo, mensaje: err.message, creado: Date.now() });
    await a.del("outbox", it.requestId);
  });
}

/** Pregunta al servidor si esta venta de la cola ya está registrada; si lo está, la da por sincronizada con su número real. */
async function confirmarEnServidor(it: OutboxItem): Promise<boolean> {
  try {
    const q = await consultarOperacion(it.requestId);
    if (q.estado !== "completada" || q.funcion !== it.fn || !q.respuesta) return false;
    await marcarSincronizada(it, q.respuesta as { id: string; numero: string; total: number });
    quitarPendiente(it.requestId);
    return true;
  } catch {
    return false; // sin red o sin respuesta: se queda en la cola con su id y se vuelve a preguntar luego
  }
}

async function ciclo() {
  if (bloqueaEscrituras()) return;
  sincronizandoLocal = true;
  canal?.postMessage({ t: "sync", v: true });
  await refrescar(false);
  try {
    pausaSesion = false;
    let huboCambios = false;
    const cola = (await listar<OutboxItem>("outbox")).sort((a, b) => a.creado - b.creado);
    for (const it of cola) {
      if (bloqueaEscrituras()) break;
      try {
        const res = await rpcMut<{ id: string; numero: string; total: number }>(it.fn, it.args, it.requestId);
        await marcarSincronizada(it, res);
        ultimoSync = Date.now();
        huboCambios = true;
      } catch (e) {
        const err = e as ErrorApp;
        if (err.tipo === "auth" || (err.tipo === "negocio" && /sesi[oó]n/i.test(err.message))) {
          pausaSesion = true; // hay que iniciar sesión: la venta se conserva intacta
          break;
        }
        if (err.codigo === "P0409") {
          // El servidor YA tiene una operación con este request_id (con otros datos). Nunca es un conflicto de negocio ni se
          // reenvía con un id nuevo (duplicaría la venta): se confirma con consultar_operacion y, si no se puede, sigue en la cola.
          if (await confirmarEnServidor(it)) {
            ultimoSync = Date.now();
            huboCambios = true;
          } else {
            await transaccion(["outbox"], "readwrite", async (a) => a.put("outbox", { ...it, intentos: it.intentos + 1, ultimoError: err.message }));
          }
        } else if (err.tipo === "offline" || err.reintentable || err.incierto) {
          // Esta venta ya es de la cola: el aviso «sin confirmar» que dejó rpcMut se quita para que NO lo adopte (por tener igual
          // contenido) otra venta nueva y distinta, que quedaría "repetida" y se perdería.
          quitarPendiente(it.requestId);
          await transaccion(["outbox"], "readwrite", async (a) => a.put("outbox", { ...it, intentos: it.intentos + 1, ultimoError: err.message }));
          break; // sin red / servidor caído: se reintenta luego con la MISMA request_id
        } else {
          await moverAConflicto(it, err);
        }
      }
      await refrescar(false);
    }
    if (!pausaSesion && !bloqueaEscrituras()) {
      await conCerrojoReservas(async () => {
        await reconciliarReservas().catch(() => {});
        await liquidarReservas();
      });
    }
    if (huboCambios) revalidarTodo(true); // el stock y los comprobantes cambiaron en el servidor
  } finally {
    sincronizandoLocal = false;
    canal?.postMessage({ t: "sync", v: false });
    await refrescar();
  }
}

/**
 * Con todo enviado, devuelve al pool el stock no vendido de las reservas que se USARON sin internet o que ya
 * vencieron. Una reserva vigente sin uso se mantiene: es la que protege a la caja si luego se cae la red.
 */
async function liquidarReservas() {
  const outbox = await listar<OutboxItem>("outbox");
  for (const l of await listar<LeaseLocal>("leases")) {
    if (outbox.some((o) => o.args.p_lease === l.leaseId)) continue; // aún hay ventas que lo usan
    const sinUso = Object.values(l.items).every((i) => i.usado === 0);
    if (sinUso && leaseVigente(l)) continue;
    try {
      await liquidarUna(l);
    } catch {
      return; // sin red: se reintenta en el próximo ciclo
    }
  }
}

// ---------------------------------------------------------------------
// Conflictos: reintentar / ajustar / anular (la venta jamás se borra)
// ---------------------------------------------------------------------
export interface Ajuste {
  aceptarPrecio?: boolean;
  cajaId?: string;
  cajaNombre?: string;
  items?: { productoId: string; cantidad: number }[];
}

/** Los conflictos que dejó un P0409 (versiones anteriores) pueden ser ventas que el servidor YA tiene. */
const ERA_P0409 = /identificador de operaci[oó]n ya se us[oó]/i;

export async function reenviarConflicto(localId: string, ajuste: Ajuste = {}) {
  const previa = await leer<VentaLocal>("ventas", localId);
  if (previa?.estado === "conflicto" && previa.conflicto && ERA_P0409.test(previa.conflicto.mensaje)) {
    // reenviar con un id nuevo duplicaría la venta si el servidor ya la registró: primero se confirma
    const q = await consultarOperacion(previa.requestId);
    if (q.estado === "completada" && q.funcion === "registrar_venta" && q.respuesta) {
      await marcarSincronizada({ requestId: previa.requestId, localId } as OutboxItem, q.respuesta as { id: string; numero: string; total: number });
      await refrescar();
      return;
    }
  }
  await transaccion(["ventas", "outbox", "conflictos"], "readwrite", async (a) => {
    const v = await a.get<VentaLocal>("ventas", localId);
    if (!v || v.estado !== "conflicto") throw new ErrorApp("negocio", "Esta venta ya no está en conflicto.");
    let items = v.items;
    if (ajuste.items) {
      items = v.items
        .map((i) => ({ ...i, cantidad: ajuste.items!.find((x) => x.productoId === i.productoId)?.cantidad ?? i.cantidad }))
        .filter((i) => i.cantidad > 0);
      if (items.length === 0) throw new ErrorApp("negocio", "La venta quedaría sin productos. Usa «Anular» si el cliente no se llevó nada.");
    }
    const bruto = items.reduce((s, i) => s + redondear(i.precio * i.cantidad), 0);
    const nueva: VentaLocal = {
      ...v,
      items,
      cajaId: ajuste.cajaId ?? v.cajaId,
      cajaNombre: ajuste.cajaNombre ?? v.cajaNombre,
      total: redondear(bruto - redondear((bruto * v.descuento) / 100)),
      requestId: nuevoId(), // el envío anterior no se grabó en el servidor: nuevo id para el contenido nuevo
      estado: "pendiente",
      conflicto: undefined,
      leaseId: null, // la reserva ya se liberó: se vende contra el stock actual del servidor
      intentos: 0,
    };
    await a.put("ventas", nueva);
    await a.put<OutboxItem>("outbox", {
      requestId: nueva.requestId,
      localId,
      fn: "registrar_venta",
      args: argsVenta(nueva, { conLease: false, aceptarPrecio: !!ajuste.aceptarPrecio }),
      creado: Date.now(),
      intentos: 0,
    });
    const c = await a.get<ConflictoLocal>("conflictos", localId);
    if (c) await a.put("conflictos", { ...c, resuelto: Object.keys(ajuste).length ? "ajustado" : "reintentado" });
  });
  await refrescar();
  void sincronizar();
}

/** El cliente no se llevó la mercadería / se descarta la venta: queda registrada como anulada localmente. */
export async function anularConflicto(localId: string) {
  await transaccion(["ventas", "conflictos"], "readwrite", async (a) => {
    const v = await a.get<VentaLocal>("ventas", localId);
    if (!v || v.estado !== "conflicto") throw new ErrorApp("negocio", "Esta venta ya no está en conflicto.");
    await a.put("ventas", { ...v, estado: "anulada_local" });
    const c = await a.get<ConflictoLocal>("conflictos", localId);
    if (c) await a.put("conflictos", { ...c, resuelto: "anulada" });
  });
  await refrescar();
}

// ---------------------------------------------------------------------
// Ticket (provisional o con número real)
// ---------------------------------------------------------------------
export function ticketDe(v: VentaLocal): TicketData {
  return {
    numero: v.numero ?? v.provisional,
    provisional: !v.numero,
    tipo: v.tipo,
    fecha: new Date(v.fecha),
    cliente: v.clienteNombre || "Cliente Varios",
    documento: v.clienteDocumento || "-",
    caja: v.cajaNombre,
    vendedor: v.vendedor,
    metodoPago: v.metodo,
    descuentoPct: v.descuento,
    total: v.total,
    sede: v.sede,
    items: v.items.map((i) => ({ nombre: i.nombre, cantidad: i.cantidad, precio: i.precio })),
  };
}

// ---------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------
let iniciado = false;
export function iniciarMotor() {
  if (iniciado || typeof window === "undefined" || typeof indexedDB === "undefined") return;
  iniciado = true;
  iniciarConexion();
  if (typeof BroadcastChannel !== "undefined") {
    canal = new BroadcastChannel("market-offline");
    canal.onmessage = (m) => {
      if (m.data?.t === "sync") sincronizandoRemoto = !!m.data.v;
      void refrescar(false);
    };
  }
  void refrescar(false);
  alRevalidar(() => void sincronizar()); // al reconectar, volver a la pestaña o recuperar el foco
  suscribirConexion(() => void sincronizar());
  setInterval(() => {
    if (estado.pendientes > 0 || estado.leases.length > 0) void sincronizar();
  }, 20_000);
  void sincronizar();
}
