/**
 * Operaciones de escritura cuyo resultado es INCIERTO (se perdió la respuesta).
 * Se guardan con su request_id para poder (a) reutilizarlo si el usuario vuelve a
 * enviar el mismo formulario y (b) verificar en la BD si llegaron a completarse.
 * Persisten en localStorage: sobreviven a recargas, a cerrar el modal y se ven en todas las pestañas.
 */
export interface Pendiente {
  id: string;
  fn: string;
  huella: string;
  etiqueta: string;
  creado: number;
}

const KEY = "market.ops.pendientes.v1";
const VIDA = 24 * 3600 * 1000;
const oyentes = new Set<() => void>();
let cache: Pendiente[] | null = null;

const leer = (): Pendiente[] => {
  if (cache) return cache;
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(KEY) : null;
    const lista = raw ? (JSON.parse(raw) as Pendiente[]) : [];
    cache = lista.filter((p) => Date.now() - p.creado < VIDA);
  } catch {
    cache = [];
  }
  return cache;
};
const guardar = (lista: Pendiente[]) => {
  cache = lista;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(lista));
  } catch {
    /* sin almacenamiento: queda solo en memoria */
  }
  oyentes.forEach((f) => f());
};

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) {
      cache = null;
      oyentes.forEach((f) => f());
    }
  });
}

export const listaPendientes = () => leer();
/** Olvida todas las operaciones inciertas (tras limpiar el sistema ya no existen en la BD). */
export const vaciarPendientes = () => guardar([]);
export const suscribirPendientes = (f: () => void) => {
  oyentes.add(f);
  return () => void oyentes.delete(f);
};

/** Hash corto y estable (cyrb53) del contenido de una operación. */
export function huellaDe(fn: string, args: unknown): string {
  const s = fn + "|" + JSON.stringify(args ?? {});
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36) + "." + s.length.toString(36);
}

export const nuevoId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      });

/** Si ya hay una operación incierta con el mismo contenido, se reutiliza su request_id. */
export const idExistente = (huella: string) => leer().find((p) => p.huella === huella)?.id;

export function registrarPendiente(p: Omit<Pendiente, "creado">) {
  const lista = leer().filter((x) => x.id !== p.id);
  guardar([...lista, { ...p, creado: Date.now() }]);
}
export function quitarPendiente(id: string) {
  if (leer().some((p) => p.id === id)) guardar(leer().filter((p) => p.id !== id));
}

export const ETIQUETAS: Record<string, string> = {
  registrar_venta: "Venta",
  anular_venta: "Anulación de venta",
  cambiar_metodo_pago: "Cambio de método de pago",
  abrir_caja: "Apertura de caja",
  abrir_mi_caja: "Apertura de caja",
  crear_caja: "Nueva caja",
  cerrar_caja: "Cierre de caja",
  registrar_egreso: "Egreso de caja",
  registrar_egreso_general: "Egreso",
  actualizar_egreso: "Edición de egreso",
  registrar_compra: "Compra",
  registrar_compra_completa: "Compra de insumos",
  recibir_compra: "Recepción de compra",
  anular_compra: "Anulación de compra",
  crear_producto: "Nuevo producto",
  actualizar_producto: "Edición de producto",
  ajustar_stock_producto: "Ajuste de stock",
  ajustar_almacen: "Ajuste de almacén",
  fijar_almacen: "Conteo de almacén",
  mover_almacen_tienda: "Traslado almacén/tienda",
  enviar_a_sede: "Envío entre sedes",
  crear_sede: "Nueva sede",
  actualizar_sede: "Edición de sede",
  guardar_cliente: "Cliente",
  desactivar_cliente: "Baja de cliente",
  crear_proveedor: "Proveedor",
  guardar_permisos_rol: "Permisos de rol",
  crear_rol: "Nuevo rol",
  backup_aplicar: "Restauración de backup",
  backup_registrar: "Registro de backup",
};
