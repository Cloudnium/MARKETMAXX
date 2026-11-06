import type {
  Caja,
  Cliente,
  Compra,
  Comprobante,
  Egreso,
  Producto,
  Sede,
  StockItem,
  MovimientoAlmacen,
  Usuario,
  VentaReciente,
} from "./types";

export const sedes: Sede[] = [
  {
    id: "sede-central",
    nombre: "Tienda Central",
    codigo: "TC",
    direccion: "Av. Principal 120",
    telefono: "987 100 200",
    activa: true,
  },
  {
    id: "sede-norte",
    nombre: "Tienda Norte",
    codigo: "TN",
    direccion: "Av. Los Andes 458",
    telefono: "987 300 400",
    activa: true,
  },
  {
    id: "sede-sur",
    nombre: "Tienda Sur",
    codigo: "TS",
    direccion: "Jr. Progreso 890",
    telefono: "987 500 600",
    activa: true,
  },
];

export const tiendas = sedes.map((sede) => sede.nombre);

export const categorias = [
  "Abarrotes",
  "Bebidas",
  "Limpieza",
  "Lácteos",
  "Snacks",
  "Cuidado Personal",
];

export const productos: Producto[] = [
  { id: "P001", codigo: "779001", nombre: "Arroz Extra 5kg", descripcion: "Arroz extra seleccionado", categoria: "Abarrotes", precio: 24.9, precioCompra: 19.5, stock: 120, stockMinimo: 20, unidad: "Bolsa", activo: true },
  { id: "P002", codigo: "779002", nombre: "Aceite Vegetal 1L", descripcion: "Aceite vegetal refinado", categoria: "Abarrotes", precio: 9.5, precioCompra: 7.2, stock: 85, stockMinimo: 15, unidad: "Botella", activo: true },
  { id: "P003", codigo: "779003", nombre: "Leche Entera 1L", descripcion: "Leche entera UHT", categoria: "Lácteos", precio: 4.8, precioCompra: 3.6, stock: 40, stockMinimo: 25, unidad: "Caja", activo: true },
  { id: "P004", codigo: "779004", nombre: "Gaseosa 3L", descripcion: "Bebida gaseosa familiar", categoria: "Bebidas", precio: 8.9, precioCompra: 6.4, stock: 12, stockMinimo: 18, unidad: "Botella", activo: true },
  { id: "P005", codigo: "779005", nombre: "Agua Mineral 625ml", descripcion: "Agua mineral sin gas", categoria: "Bebidas", precio: 1.5, precioCompra: 0.9, stock: 240, stockMinimo: 40, unidad: "Botella", activo: true },
  { id: "P006", codigo: "779006", nombre: "Detergente 900g", descripcion: "Detergente en polvo", categoria: "Limpieza", precio: 11.9, precioCompra: 8.5, stock: 55, stockMinimo: 12, unidad: "Bolsa", activo: true },
  { id: "P007", codigo: "779007", nombre: "Papel Higiénico x4", descripcion: "Papel higiénico doble hoja", categoria: "Limpieza", precio: 7.5, precioCompra: 5.1, stock: 8, stockMinimo: 20, unidad: "Paquete", activo: true },
  { id: "P008", codigo: "779008", nombre: "Galletas Surtidas", descripcion: "Galletas de diferentes sabores", categoria: "Snacks", precio: 2.2, precioCompra: 1.4, stock: 180, stockMinimo: 30, unidad: "Unidad", activo: true },
  { id: "P009", codigo: "779009", nombre: "Chocolate Barra", descripcion: "Chocolate con leche", categoria: "Snacks", precio: 3.5, precioCompra: 2.1, stock: 96, stockMinimo: 24, unidad: "Unidad", activo: true },
  { id: "P010", codigo: "779010", nombre: "Shampoo 750ml", descripcion: "Shampoo para cabello normal", categoria: "Cuidado Personal", precio: 15.9, precioCompra: 11.2, stock: 30, stockMinimo: 10, unidad: "Botella", activo: true },
  { id: "P011", codigo: "779011", nombre: "Jabón de Tocador", descripcion: "Jabón hidratante", categoria: "Cuidado Personal", precio: 2.8, precioCompra: 1.7, stock: 64, stockMinimo: 20, unidad: "Unidad", activo: true },
  { id: "P012", codigo: "779012", nombre: "Azúcar Rubia 1kg", descripcion: "Azúcar rubia doméstica", categoria: "Abarrotes", precio: 5.4, precioCompra: 4.1, stock: 0, stockMinimo: 15, unidad: "Bolsa", activo: false },
];

export const clientes: Cliente[] = [
  { id: "C001", nombre: "María Fernández", documento: "45872136", telefono: "987 654 321", email: "maria.fernandez@correo.com", direccion: "Av. Los Álamos 245", tipo: "vip", compras: 34, totalGastado: 2840.5 },
  { id: "C002", nombre: "Carlos Ramírez", documento: "40125876", telefono: "912 345 678", email: "carlos.ramirez@correo.com", direccion: "Jr. Puno 118", tipo: "regular", compras: 12, totalGastado: 865.2 },
  { id: "C003", nombre: "Ana Torres", documento: "73215489", telefono: "956 789 123", email: "ana.torres@correo.com", direccion: "Calle Lima 903", tipo: "vip", compras: 28, totalGastado: 1920.0 },
  { id: "C004", nombre: "Luis Mendoza", documento: "44556677", telefono: "934 567 890", email: "luis.mendoza@correo.com", direccion: "Av. Grau 452", tipo: "regular", compras: 7, totalGastado: 410.8 },
  { id: "C005", nombre: "Rosa Quispe", documento: "41237896", telefono: "978 123 456", email: "rosa.quispe@correo.com", direccion: "Jr. Amazonas 77", tipo: "regular", compras: 15, totalGastado: 1120.4 },
  { id: "C006", nombre: "Jorge Salazar", documento: "45678912", telefono: "965 432 187", email: "jorge.salazar@correo.com", direccion: "Av. Brasil 1580", tipo: "vip", compras: 41, totalGastado: 3560.9 },
  { id: "C007", nombre: "Elena Rojas", documento: "70123456", telefono: "943 210 876", email: "elena.rojas@correo.com", direccion: "Calle San Martín 321", tipo: "regular", compras: 5, totalGastado: 295.0 },
  { id: "C008", nombre: "Pedro Castillo", documento: "40987654", telefono: "921 876 543", email: "pedro.castillo@correo.com", direccion: "Jr. Cusco 654", tipo: "regular", compras: 19, totalGastado: 1435.6 },
];

export const usuarios: Usuario[] = [
  { id: "U001", nombre: "Bryan Admin", email: "admin@market.com", rol: "Administrador", telefono: "987 111 222", estado: "activo", iniciales: "BA" },
  { id: "U002", nombre: "Lucía Vargas", email: "lucia@market.com", rol: "Cajero", telefono: "987 333 444", estado: "activo", iniciales: "LV", sedeId: "sede-central" },
  { id: "U003", nombre: "Miguel Santos", email: "miguel@market.com", rol: "Almacenero", telefono: "987 555 666", estado: "activo", iniciales: "MS", sedeId: "sede-norte" },
  { id: "U004", nombre: "Paola Díaz", email: "paola@market.com", rol: "Cajero", telefono: "987 777 888", estado: "inactivo", iniciales: "PD", sedeId: "sede-central" },
  { id: "U005", nombre: "Renzo Flores", email: "renzo@market.com", rol: "Almacenero", telefono: "987 999 000", estado: "activo", iniciales: "RF", sedeId: "sede-sur" },
];

export const cajas: Caja[] = [
  { id: "CJ01", nombre: "Caja 1", tienda: "Tienda Central", sedeId: "sede-central", estado: "abierta", ingresos: 1285.5, egresos: 0, ventas: 42, fechaApertura: "2026-10-31T08:00:00", usuario: "Lucía Vargas" },
  { id: "CJ02", nombre: "Caja 2", tienda: "Tienda Central", sedeId: "sede-central", estado: "abierta", ingresos: 780.0, egresos: 0, ventas: 31, fechaApertura: "2026-10-31T08:15:00", usuario: "Paola Díaz" },
  { id: "CJ03", nombre: "Caja 3", tienda: "Tienda Norte", sedeId: "sede-norte", estado: "cerrada", ingresos: 2140.0, egresos: 120.0, ventas: 58, fechaApertura: "2026-10-30T08:00:00", usuario: "Miguel Santos" },
  { id: "CJ04", nombre: "Caja 4", tienda: "Tienda Sur", sedeId: "sede-sur", estado: "cerrada", ingresos: 1620.5, egresos: 60.0, ventas: 39, fechaApertura: "2026-10-30T08:10:00", usuario: "Renzo Flores" },
];

export const egresos: Egreso[] = [
  { id: "E001", concepto: "Pago de movilidad", monto: 25.0, fecha: "2026-10-31T09:30:00", usuario: "Lucía Vargas", sedeId: "sede-central" },
  { id: "E002", concepto: "Compra de útiles", monto: 48.5, fecha: "2026-10-31T10:45:00", usuario: "Lucía Vargas", sedeId: "sede-central" },
  { id: "E003", concepto: "Servicio de limpieza", monto: 60.0, fecha: "2026-10-30T17:00:00", usuario: "Miguel Santos", sedeId: "sede-norte" },
];

export const comprobantes: Comprobante[] = [
  {
    id: "CP001", numero: "F001-0001245", tipo: "factura", cliente: "María Fernández", documento: "45872136", fecha: "2026-10-31T09:12:00", total: 124.5, estado: "pagado", metodoPago: "Efectivo", caja: "Caja 1", sedeId: "sede-central",
    items: [
      { producto: "Arroz Extra 5kg", cantidad: 2, precio: 24.9 },
      { producto: "Aceite Vegetal 1L", cantidad: 3, precio: 9.5 },
      { producto: "Leche Entera 1L", cantidad: 6, precio: 4.8 },
      { producto: "Galletas Surtidas", cantidad: 5, precio: 2.2 },
    ],
  },
  {
    id: "CP002", numero: "B001-0003872", tipo: "boleta", cliente: "Carlos Ramírez", documento: "40125876", fecha: "2026-10-31T10:05:00", total: 68.4, estado: "pagado", metodoPago: "Yape", caja: "Caja 1", sedeId: "sede-central",
    items: [
      { producto: "Detergente 900g", cantidad: 2, precio: 11.9 },
      { producto: "Papel Higiénico x4", cantidad: 3, precio: 7.5 },
      { producto: "Jabón de Tocador", cantidad: 4, precio: 2.8 },
      { producto: "Gaseosa 3L", cantidad: 2, precio: 8.9 },
    ],
  },
  {
    id: "CP003", numero: "NV001-0000451", tipo: "nota_venta", cliente: "Cliente Varios", documento: "-", fecha: "2026-10-31T11:20:00", total: 32.6, estado: "pagado", metodoPago: "Efectivo", caja: "Caja 2", sedeId: "sede-central",
    items: [
      { producto: "Agua Mineral 625ml", cantidad: 6, precio: 1.5 },
      { producto: "Chocolate Barra", cantidad: 4, precio: 3.5 },
      { producto: "Galletas Surtidas", cantidad: 4, precio: 2.2 },
    ],
  },
  {
    id: "CP004", numero: "F001-0001244", tipo: "factura", cliente: "Jorge Salazar", documento: "45678912", fecha: "2026-10-30T16:40:00", total: 215.8, estado: "pagado", metodoPago: "Transferencia", caja: "Caja 3", sedeId: "sede-norte",
    items: [
      { producto: "Shampoo 750ml", cantidad: 4, precio: 15.9 },
      { producto: "Arroz Extra 5kg", cantidad: 4, precio: 24.9 },
      { producto: "Aceite Vegetal 1L", cantidad: 6, precio: 9.5 },
      { producto: "Leche Entera 1L", cantidad: 8, precio: 4.8 },
    ],
  },
  {
    id: "CP005", numero: "B001-0003871", tipo: "boleta", cliente: "Elena Rojas", documento: "70123456", fecha: "2026-10-30T15:10:00", total: 47.2, estado: "anulado", metodoPago: "Efectivo", caja: "Caja 4", sedeId: "sede-sur",
    items: [
      { producto: "Detergente 900g", cantidad: 2, precio: 11.9 },
      { producto: "Jabón de Tocador", cantidad: 5, precio: 2.8 },
      { producto: "Papel Higiénico x4", cantidad: 2, precio: 7.5 },
    ],
  },
  {
    id: "CP006", numero: "F001-0001243", tipo: "factura", cliente: "Ana Torres", documento: "73215489", fecha: "2026-10-29T12:30:00", total: 158.9, estado: "pagado", metodoPago: "Tarjeta", caja: "Caja 1", sedeId: "sede-central",
    items: [
      { producto: "Shampoo 750ml", cantidad: 3, precio: 15.9 },
      { producto: "Arroz Extra 5kg", cantidad: 2, precio: 24.9 },
      { producto: "Gaseosa 3L", cantidad: 4, precio: 8.9 },
      { producto: "Chocolate Barra", cantidad: 6, precio: 3.5 },
    ],
  },
];

export const compras: Compra[] = [
  { id: "CO001", numero: "C001-000021", proveedor: "Distribuidora Andina SAC", fecha: "2026-10-31T08:30:00", total: 2450.0, estado: "recibida", items: 18, usuario: "Miguel Santos", sedeId: "sede-central" },
  { id: "CO002", numero: "C001-000022", proveedor: "Comercial del Sur EIRL", fecha: "2026-10-30T09:15:00", total: 1180.5, estado: "recibida", items: 12, usuario: "Renzo Flores", sedeId: "sede-sur" },
  { id: "CO003", numero: "C001-000023", proveedor: "Bebidas del Norte SAC", fecha: "2026-10-29T14:00:00", total: 890.0, estado: "pendiente", items: 9, usuario: "Miguel Santos", sedeId: "sede-norte" },
  { id: "CO004", numero: "C001-000020", proveedor: "Distribuidora Andina SAC", fecha: "2026-10-28T10:45:00", total: 3200.0, estado: "recibida", items: 24, usuario: "Renzo Flores", sedeId: "sede-central" },
  { id: "CO005", numero: "C001-000019", proveedor: "Lácteos Unidos SA", fecha: "2026-10-27T16:20:00", total: 640.0, estado: "anulada", items: 6, usuario: "Miguel Santos", sedeId: "sede-central" },
];

export const ventasRecientes: VentaReciente[] = [
  { id: "V001", numero: "F001-0001245", cliente: "María Fernández", fecha: "2026-10-31T09:12:00", total: 124.5, tipo: "factura", metodoPago: "Efectivo", estado: "pagado", sedeId: "sede-central" },
  { id: "V002", numero: "B001-0003872", cliente: "Carlos Ramírez", fecha: "2026-10-31T10:05:00", total: 68.4, tipo: "boleta", metodoPago: "Yape", estado: "pagado", sedeId: "sede-central" },
  { id: "V003", numero: "NV001-0000451", cliente: "Cliente Varios", fecha: "2026-10-31T11:20:00", total: 32.6, tipo: "nota_venta", metodoPago: "Efectivo", estado: "pagado", sedeId: "sede-central" },
  { id: "V004", numero: "F001-0001244", cliente: "Jorge Salazar", fecha: "2026-10-30T16:40:00", total: 215.8, tipo: "factura", metodoPago: "Transferencia", estado: "pagado", sedeId: "sede-norte" },
  { id: "V005", numero: "B001-0003871", cliente: "Elena Rojas", fecha: "2026-10-30T15:10:00", total: 47.2, tipo: "boleta", metodoPago: "Efectivo", estado: "anulado", sedeId: "sede-sur" },
  { id: "V006", numero: "F001-0001243", cliente: "Ana Torres", fecha: "2026-10-29T12:30:00", total: 158.9, tipo: "factura", metodoPago: "Tarjeta", estado: "pagado", sedeId: "sede-central" },
];

export const stockAlmacen: StockItem[] = sedes.flatMap((sede, sedeIndex) =>
  productos.map((producto) => {
    const base = Math.floor(producto.stock / sedes.length);
    const remainder = producto.stock % sedes.length;
    return {
      id: `${sede.codigo}-${producto.id}`,
      producto: producto.nombre,
      categoria: producto.categoria,
      tienda: sede.nombre,
      sedeId: sede.id,
      stock: base + (sedeIndex < remainder ? 1 : 0),
      stockMinimo: Math.ceil(producto.stockMinimo / sedes.length),
      unidad: producto.unidad,
    };
  })
);

export const movimientosAlmacen: MovimientoAlmacen[] = [
  {
    id: "M001",
    fecha: "2026-10-31T08:30:00",
    tipo: "entrada",
    producto: "Aceite Vegetal 1L",
    cantidad: 60,
    unidad: "Botella",
    origen: "Distribuidora Andina",
    destino: "Tienda Norte",
    usuario: "Bryan Admin",
    referencia: "COMP-0013",
    sedeId: "sede-norte",
    nota: "Compra recibida",
  },
  {
    id: "M002",
    fecha: "2026-10-31T09:10:00",
    tipo: "salida",
    producto: "Agua Mineral 625ml",
    cantidad: 48,
    unidad: "Botella",
    origen: "Tienda Norte",
    destino: "Venta",
    usuario: "Carla Méndez",
    referencia: "B002-00459",
    sedeId: "sede-norte",
  },
  {
    id: "M003",
    fecha: "2026-10-31T10:25:00",
    tipo: "traspaso",
    producto: "Detergente 900g",
    cantidad: 18,
    unidad: "Bolsa",
    origen: "Tienda Central",
    destino: "Tienda Sur",
    usuario: "Bryan Admin",
    referencia: "TR-0032",
    sedeId: "sede-central",
  },
  {
    id: "M004",
    fecha: "2026-10-31T11:40:00",
    tipo: "salida",
    producto: "Chocolate Barra",
    cantidad: 12,
    unidad: "Unidad",
    origen: "Tienda Sur",
    destino: "Venta",
    usuario: "Luis Paredes",
    referencia: "B003-00460",
    sedeId: "sede-sur",
  },
  {
    id: "M005",
    fecha: "2026-10-31T12:15:00",
    tipo: "ajuste",
    producto: "Azúcar Rubia 1kg",
    cantidad: -5,
    unidad: "Bolsa",
    origen: "Tienda Central",
    destino: "Tienda Central",
    usuario: "Bryan Admin",
    referencia: "AJ-0008",
    sedeId: "sede-central",
    nota: "Producto vencido",
  },
  {
    id: "M006",
    fecha: "2026-10-30T08:05:00",
    tipo: "entrada",
    producto: "Arroz Extra 5kg",
    cantidad: 80,
    unidad: "Bolsa",
    origen: "Distribuidora Andina",
    destino: "Tienda Central",
    usuario: "Bryan Admin",
    referencia: "COMP-0012",
    sedeId: "sede-central",
    nota: "Compra recibida",
  },
  {
    id: "M007",
    fecha: "2026-10-30T09:35:00",
    tipo: "salida",
    producto: "Gaseosa 3L",
    cantidad: 6,
    unidad: "Botella",
    origen: "Tienda Central",
    destino: "Venta",
    usuario: "Carla Méndez",
    referencia: "B001-00458",
    sedeId: "sede-central",
  },
  {
    id: "M008",
    fecha: "2026-10-30T10:20:00",
    tipo: "traspaso",
    producto: "Leche Entera 1L",
    cantidad: 24,
    unidad: "Caja",
    origen: "Tienda Norte",
    destino: "Tienda Central",
    usuario: "Luis Paredes",
    referencia: "TR-0031",
    sedeId: "sede-norte",
  },
  {
    id: "M009",
    fecha: "2026-10-30T11:50:00",
    tipo: "ajuste",
    producto: "Papel Higiénico x4",
    cantidad: -2,
    unidad: "Paquete",
    origen: "Tienda Central",
    destino: "Tienda Central",
    usuario: "Bryan Admin",
    referencia: "AJ-0007",
    sedeId: "sede-central",
    nota: "Producto dañado",
  },
  {
    id: "M010",
    fecha: "2026-10-30T14:10:00",
    tipo: "entrada",
    producto: "Galletas Surtidas",
    cantidad: 120,
    unidad: "Unidad",
    origen: "Comercial del Sur",
    destino: "Tienda Sur",
    usuario: "Luis Paredes",
    referencia: "COMP-0014",
    sedeId: "sede-sur",
    nota: "Compra recibida",
  },
  {
    id: "M011",
    fecha: "2026-10-29T08:45:00",
    tipo: "traspaso",
    producto: "Shampoo 750ml",
    cantidad: 10,
    unidad: "Botella",
    origen: "Tienda Sur",
    destino: "Tienda Central",
    usuario: "Bryan Admin",
    referencia: "TR-0033",
    sedeId: "sede-sur",
  },
  {
    id: "M012",
    fecha: "2026-10-29T10:30:00",
    tipo: "salida",
    producto: "Arroz Extra 5kg",
    cantidad: 15,
    unidad: "Bolsa",
    origen: "Tienda Central",
    destino: "Venta",
    usuario: "Carla Méndez",
    referencia: "F001-00210",
    sedeId: "sede-central",
  },
  {
    id: "M013",
    fecha: "2026-10-29T12:05:00",
    tipo: "ajuste",
    producto: "Jabón de Tocador",
    cantidad: 3,
    unidad: "Unidad",
    origen: "Tienda Norte",
    destino: "Tienda Norte",
    usuario: "Luis Paredes",
    referencia: "AJ-0009",
    sedeId: "sede-norte",
    nota: "Conteo físico",
  },
  {
    id: "M014",
    fecha: "2026-10-28T09:00:00",
    tipo: "entrada",
    producto: "Papel Higiénico x4",
    cantidad: 40,
    unidad: "Paquete",
    origen: "Distribuidora Andina",
    destino: "Tienda Central",
    usuario: "Bryan Admin",
    referencia: "COMP-0015",
    sedeId: "sede-central",
    nota: "Compra recibida",
  },
  {
    id: "M015",
    fecha: "2026-10-28T11:15:00",
    tipo: "salida",
    producto: "Gaseosa 3L",
    cantidad: 10,
    unidad: "Botella",
    origen: "Tienda Sur",
    destino: "Venta",
    usuario: "Luis Paredes",
    referencia: "B003-00461",
    sedeId: "sede-sur",
  },
  {
    id: "M016",
    fecha: "2026-10-28T15:20:00",
    tipo: "traspaso",
    producto: "Agua Mineral 625ml",
    cantidad: 60,
    unidad: "Botella",
    origen: "Tienda Central",
    destino: "Tienda Norte",
    usuario: "Bryan Admin",
    referencia: "TR-0034",
    sedeId: "sede-central",
  },
];

export const ventasSemanales = [
  { dia: "Lun", ventas: 2450, comprobantes: 38 },
  { dia: "Mar", ventas: 3120, comprobantes: 45 },
  { dia: "Mié", ventas: 2890, comprobantes: 41 },
  { dia: "Jue", ventas: 3680, comprobantes: 52 },
  { dia: "Vie", ventas: 4250, comprobantes: 61 },
  { dia: "Sáb", ventas: 5120, comprobantes: 74 },
  { dia: "Dom", ventas: 3980, comprobantes: 57 },
];

export const ventasMensuales = [
  { mes: "May", ventas: 18200 },
  { mes: "Jun", ventas: 21400 },
  { mes: "Jul", ventas: 19800 },
  { mes: "Ago", ventas: 24600 },
  { mes: "Sep", ventas: 23100 },
  { mes: "Oct", ventas: 27450 },
];

export const topProductos = [
  { nombre: "Arroz Extra 5kg", cantidad: 320, total: 7968 },
  { nombre: "Aceite Vegetal 1L", cantidad: 280, total: 2660 },
  { nombre: "Leche Entera 1L", cantidad: 245, total: 1176 },
  { nombre: "Gaseosa 3L", cantidad: 190, total: 1691 },
  { nombre: "Detergente 900g", cantidad: 142, total: 1689.8 },
];

export const topCategorias = [
  { nombre: "Abarrotes", total: 8450, porcentaje: 34 },
  { nombre: "Bebidas", total: 6210, porcentaje: 25 },
  { nombre: "Limpieza", total: 3980, porcentaje: 16 },
  { nombre: "Lácteos", total: 3110, porcentaje: 12.5 },
  { nombre: "Snacks", total: 1860, porcentaje: 7.5 },
  { nombre: "Cuidado Personal", total: 1240, porcentaje: 5 },
];

export const topClientes = [
  { nombre: "Jorge Salazar", compras: 41, total: 3560.9 },
  { nombre: "María Fernández", compras: 34, total: 2840.5 },
  { nombre: "Ana Torres", compras: 28, total: 1920.0 },
  { nombre: "Pedro Castillo", compras: 19, total: 1435.6 },
  { nombre: "Rosa Quispe", compras: 15, total: 1120.4 },
];

export const metodosPago = [
  { nombre: "Efectivo", total: 11240, porcentaje: 45, color: "#22c55e" },
  { nombre: "Yape", total: 5480, porcentaje: 22, color: "#8b5cf6" },
  { nombre: "Tarjeta", total: 4230, porcentaje: 17, color: "#3b82f6" },
  { nombre: "Transferencia", total: 3990, porcentaje: 16, color: "#f59e0b" },
];

export const ventasPorCaja = [
  { caja: "Caja 1", total: 8420, comprobantes: 128 },
  { caja: "Caja 2", total: 6210, comprobantes: 96 },
  { caja: "Caja 3", total: 5140, comprobantes: 82 },
  { caja: "Caja 4", total: 3170, comprobantes: 54 },
];

export const ventasPorComprobante = [
  { tipo: "Factura", total: 12140, cantidad: 64 },
  { tipo: "Boleta", total: 8940, cantidad: 186 },
  { tipo: "Nota de Venta", total: 1860, cantidad: 110 },
];

export const alertasStock = productos
  .filter((p) => p.stock <= p.stockMinimo)
  .map((p) => ({
    producto: p.nombre,
    stock: p.stock,
    stockMinimo: p.stockMinimo,
    unidad: p.unidad,
  }));

export const resumenPeriodo = {
  ventasTotales: 27450,
  comprobantes: 360,
  ticketPromedio: 76.25,
  utilidad: 8235,
  variacionVentas: 12.4,
  variacionComprobantes: 8.2,
  variacionTicket: 3.6,
  variacionUtilidad: 15.1,
};

export const dashboardMetrics = {
  ventasHoy: 4850,
  comprobantesHoy: 63,
  clientesHoy: 48,
  productosVendidos: 214,
  variacionVentas: 12.4,
  variacionComprobantes: 8.2,
  variacionClientes: 5.1,
  variacionProductos: 9.8,
};

export const comprasMetricas = {
  totalCompras: 8360.5,
  comprasRecibidas: 3,
  comprasPendientes: 1,
  proveedores: 4,
};

export const cajaMetricas = {
  cajasAbiertas: 2,
  cajasCerradas: 2,
  ingresosTotales: 5790.5,
  egresosTotales: 180,
};
