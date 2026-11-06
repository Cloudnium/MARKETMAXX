export type Rol = string;
export type TipoComprobante = "factura" | "boleta" | "nota_venta";

export interface Sede {
  id: string;
  nombre: string;
  codigo: string;
  direccion: string;
  telefono: string;
  activa: boolean;
  ciudad?: string;
}

export interface SedeResumen extends Sede {
  numero: number;
  usuarios: number;
  cajas: number;
  cajasAbiertas: number;
  unidadesStock: number;
  ventasHoy: number;
  createdAt: string;
}

export interface Categoria {
  id: string;
  nombre: string;
}

export interface Producto {
  id: string;
  codigo: string;
  nombre: string;
  descripcion: string;
  categoria: string;
  categoriaId?: string | null;
  precio: number;
  precioCompra: number;
  /** Stock en la sede activa (o suma de las sedes visibles si es "todas"). */
  stock: number;
  /** Unidades reservadas en OTRAS cajas para vender sin internet (no se pueden vender aquí). */
  reservadoOtros?: number;
  /** Stock en el almacén (bodega) de la sede del producto. */
  stockAlmacen?: number;
  stockMinimo: number;
  unidad: string;
  activo: boolean;
  /** Sede (negocio) a la que pertenece el producto. */
  sedeId?: string;
  sedeNombre?: string;
}

export interface Cliente {
  id: string;
  nombre: string;
  documento: string;
  telefono: string;
  email: string;
  direccion: string;
  tipo: "regular" | "vip";
  compras: number;
  totalGastado: number;
}

export interface RolInfo {
  id: string;
  nombre: string;
  nivel: number;
  descripcion?: string;
  esSistema?: boolean;
  permisos?: string[];
}

export interface Usuario {
  id: string;
  codigo?: string;
  nombre: string;
  email: string;
  rol: Rol;
  rolId?: string | null;
  rolNivel?: number;
  telefono: string;
  estado: "activo" | "inactivo";
  iniciales: string;
  sedeId?: string;
  sedeIds?: string[];
}

export interface Caja {
  id: string;
  nombre: string;
  tienda: string;
  sedeId?: string;
  estado: "abierta" | "cerrada";
  ingresos: number;
  egresos: number;
  ventas: number;
  fechaApertura: string;
  usuario: string;
  sesionId?: string | null;
  montoApertura?: number;
}

export interface Egreso {
  id: string;
  concepto: string;
  monto: number;
  fecha: string;
  usuario: string;
  sedeId?: string;
  categoria?: string;
  proveedor?: string;
  tipoDocumento?: string;
  numeroDocumento?: string;
  observaciones?: string;
  /** Fecha elegida al registrar (YYYY-MM-DD). */
  fechaEgreso?: string;
  /** true si descuenta de una caja (turno) abierta. */
  enCaja?: boolean;
  proveedorDocumento?: string;
  tieneFoto?: boolean;
  compraId?: string | null;
}

/** Turno de caja (una apertura/cierre). */
export interface SesionCaja {
  id: string;
  cajaId: string;
  caja: string;
  sedeId: string;
  sede: string;
  usuario: string;
  fechaApertura: string;
  fechaCierre: string | null;
  estado: "abierta" | "cerrada";
  dia: string;
  montoApertura: number;
  montoSistema: number | null;
  montoContado: number | null;
  diferencia: number | null;
  observaciones: string;
  ingresos: number;
  ingresosEfectivo: number;
  egresos: number;
  ventas: number;
}

export interface VentaCaja {
  id: string;
  numero: string;
  tipo: string;
  fecha: string;
  total: number;
  estado: string;
  metodoPago: string;
  cliente: string;
  usuario: string;
  items: { producto: string; cantidad: number; precio: number }[];
}

export interface Comprobante {
  id: string;
  numero: string;
  tipo: TipoComprobante;
  cliente: string;
  documento: string;
  fecha: string;
  total: number;
  estado: "pagado" | "anulado" | "pendiente";
  metodoPago: string;
  caja: string;
  sedeId?: string;
  vendedor?: string;
  descuento?: number;
  motivoAnulacion?: string;
  anuladoPor?: string;
  items: { producto: string; cantidad: number; precio: number }[];
}

export interface Compra {
  id: string;
  numero: string;
  proveedor: string;
  fecha: string;
  total: number;
  estado: "recibida" | "pendiente" | "anulada";
  items: number;
  usuario: string;
  sedeId?: string;
  comprobante?: string;
  motivoAnulacion?: string;
}

export interface Proveedor {
  id: string;
  nombre: string;
}

export interface VentaReciente {
  id: string;
  numero: string;
  cliente: string;
  fecha: string;
  total: number;
  tipo: TipoComprobante;
  metodoPago: string;
  estado: "pagado" | "anulado" | "pendiente";
  sedeId?: string;
}

export interface StockItem {
  id: string;
  productoId: string;
  producto: string;
  codigo: string;
  categoria: string;
  tienda: string;
  sedeId?: string;
  /** Stock de la ubicación consultada (tienda en v_stock, almacén en v_stock_almacen). */
  stock: number;
  /** Solo en el almacén: unidades que la sede tiene en la tienda. */
  stockTienda?: number;
  /** Solo en el stock total: unidades en el almacén. */
  stockAlmacen?: number;
  stockMinimo: number;
  unidad: string;
}

export type TipoMovimiento = "entrada" | "salida" | "traspaso" | "ajuste";

export interface MovimientoAlmacen {
  id: string;
  fecha: string;
  tipo: TipoMovimiento;
  operacion: string;
  producto: string;
  cantidad: number;
  unidad: string;
  origen: string;
  destino: string;
  usuario: string;
  referencia: string;
  sedeId?: string;
  stockAntes: number;
  stockDespues: number;
  nota?: string;
  codigo?: string;
  categoria?: string;
  sedeNombre?: string;
  productoId?: string;
}

export type TipoMovimientoBodega = "entrada" | "salida" | "ajuste";

/** Un movimiento del ALMACÉN (bodega) de una sede. */
export interface MovimientoBodega {
  id: string;
  numero: number;
  fecha: string;
  tipo: TipoMovimientoBodega;
  operacion: string;
  producto: string;
  codigo: string;
  categoria: string;
  unidad: string;
  /** Con signo: + entra al almacén, - sale. */
  cantidad: number;
  stockAntes: number;
  stockDespues: number;
  /** Stock de la tienda antes/después (solo en Almacén <-> Tienda). */
  stockTiendaAntes?: number;
  stockTiendaDespues?: number;
  origen: string;
  destino: string;
  /** Texto del tipo de traslado: "Almacén > Tienda", "Almacén > Tienda Norte"... */
  traslado: string;
  usuario: string;
  referencia: string;
  nota?: string;
  sedeId?: string;
  sedeNombre?: string;
}

export interface Perfil {
  id: string;
  codigo: string;
  nombre: string;
  email: string;
  rol: string;
  rolNivel: number;
  sedePredeterminadaId: string | null;
}
