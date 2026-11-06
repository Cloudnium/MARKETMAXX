/**
 * Reserva AUTOMÁTICA de stock para vender sin internet. El cajero no hace nada: mientras hay conexión y tiene
 * una caja abierta, el sistema mantiene vigente una reserva (lease) de una parte del stock para esa caja y la
 * renueva antes de que venza o se agote. El servidor sigue siendo la verdad: otorga solo lo que hay.
 */
import { bloqueaEscrituras } from "@/lib/net/conexion";
import { listaPendientes } from "@/lib/net/pendientes";
import { conCerrojoReservas, crearReserva, leaseVigente, reservaDeCaja, restante } from "./motor";

/** Porción del stock de cada producto que se reserva para la caja, con tope por producto. */
export const RESERVA_PORCENTAJE = 0.25;
export const RESERVA_MAXIMO = 20;
/** Duración de cada reserva y margen de renovación (la reserva se renueva sola mucho antes de vencer). */
export const RESERVA_TTL_MIN = 240;
const RENOVAR_ANTES_MS = 90 * 60_000;
const REINTENTO_MS = 2 * 60_000;

let proximoIntento = 0;
let enCurso = false;

interface ProductoStock { id: string; stock: number; activo: boolean }

/** ¿La reserva actual de esta caja sigue sirviendo? (vigente, con margen de tiempo y sin haberse consumido) */
export async function reservaAlDia(sedeId: string, cajaId: string) {
  const l = await reservaDeCaja(sedeId, cajaId);
  if (!l || !leaseVigente(l)) return false;
  if (l.expiraMs - (Date.now() + l.offsetMs) < RENOVAR_ANTES_MS) return false;
  const total = Object.values(l.items).reduce((s, i) => s + i.otorgado, 0);
  const usado = Object.values(l.items).reduce((s, i) => s + i.usado, 0);
  return total > 0 && usado / total < 0.5;
}

/** Calcula cuánto reservar de cada producto (lo que ya estaba reservado vuelve al pool al renovar). */
export function itemsAReservar(productos: ProductoStock[], previa: Awaited<ReturnType<typeof reservaDeCaja>>) {
  return productos
    .filter((p) => p.activo)
    .map((p) => {
      const disponible = p.stock + (previa ? restante(previa, p.id) : 0);
      return { productoId: p.id, cantidad: Math.min(RESERVA_MAXIMO, Math.floor(disponible * RESERVA_PORCENTAJE)) };
    })
    .filter((i) => i.cantidad > 0);
}

/**
 * Mantiene la reserva al día. `cargarProductos` solo se llama si hace falta renovar (evita consultas inútiles).
 * Nunca lanza: un fallo (sin red, ventas por enviar…) se reintenta más tarde sin molestar al cajero.
 */
export async function mantenerReserva(p: { sedeId: string; cajaId: string; cargarProductos: () => Promise<ProductoStock[]> }): Promise<"vigente" | "renovada" | "omitida"> {
  // no se toca la reserva mientras haya una operación sin confirmar (cambiar de reserva a mitad cambiaría el pedido pendiente)
  if (enCurso || Date.now() < proximoIntento || bloqueaEscrituras() || listaPendientes().length > 0) return "omitida";
  enCurso = true;
  try {
    // un solo "dueño" de las reservas a la vez, aunque haya varias pestañas abiertas
    const r = await conCerrojoReservas(async (): Promise<"vigente" | "renovada" | "omitida"> => {
      if (await reservaAlDia(p.sedeId, p.cajaId)) return "vigente";
      const items = itemsAReservar(await p.cargarProductos(), await reservaDeCaja(p.sedeId, p.cajaId));
      if (items.length === 0) return "omitida";
      await crearReserva({ sedeId: p.sedeId, cajaId: p.cajaId, items, ttlMin: RESERVA_TTL_MIN });
      return "renovada";
    });
    return r ?? "omitida";
  } catch {
    proximoIntento = Date.now() + REINTENTO_MS;
    return "omitida";
  } finally {
    enCurso = false;
  }
}
