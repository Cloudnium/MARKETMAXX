import type { Caja, Producto, TipoComprobante } from "@/lib/types";

export type TipoConflicto = "stock" | "precio" | "caja" | "permiso" | "sesion" | "lease" | "otro";

export interface Snapshot {
  sedeId: string;
  productos: Producto[];
  cajas: Caja[];
  metodos: string[];
  sede: { nombre: string; direccion?: string; telefono?: string; ciudad?: string };
  vendedor?: string;
  guardado: number;
}

/** Reserva de stock para esta caja (espejo de stock_leases_offline en el servidor). */
export interface LeaseLocal {
  leaseId: string;
  sedeId: string;
  cajaId: string;
  /** Vencimiento según el reloj del SERVIDOR (ms). */
  expiraMs: number;
  /** servidor_ahora − Date.now() al crear la reserva: corrige relojes desajustados. */
  offsetMs: number;
  items: Record<string, { otorgado: number; usado: number }>;
  creadoMs: number;
}

export type EstadoVentaLocal = "pendiente" | "sincronizada" | "conflicto" | "anulada_local";

export interface ItemVentaLocal {
  productoId: string;
  nombre: string;
  cantidad: number;
  precio: number;
}

export interface VentaLocal {
  localId: string;
  requestId: string;
  sedeId: string;
  cajaId: string;
  cajaNombre: string;
  leaseId: string | null;
  /** Unidades que esta venta tomó de la reserva local (para liberarlas si pasa a conflicto). */
  consumoLease?: Record<string, number>;
  provisional: string;
  fecha: string; // ISO (reloj del dispositivo)
  estado: EstadoVentaLocal;
  numero?: string; // número REAL, tras sincronizar
  total: number;
  tipo: TipoComprobante;
  metodo: string;
  descuento: number;
  clienteId: string | null;
  clienteNombre: string | null;
  clienteDocumento: string | null;
  items: ItemVentaLocal[];
  sede: Snapshot["sede"];
  vendedor?: string;
  conflicto?: { tipo: TipoConflicto; mensaje: string };
  intentos: number;
}

export interface OutboxItem {
  requestId: string;
  localId: string;
  fn: "registrar_venta";
  args: Record<string, unknown>;
  creado: number;
  intentos: number;
  ultimoError?: string;
}

export interface ConflictoLocal {
  localId: string;
  tipo: TipoConflicto;
  mensaje: string;
  creado: number;
  resuelto?: "reintentado" | "ajustado" | "anulada";
}

export interface EstadoOffline {
  pendientes: number;
  conflictos: number;
  sincronizando: boolean;
  pausaSesion: boolean;
  leases: LeaseLocal[];
  ventas: VentaLocal[];
  ultimoSync: number | null;
}
