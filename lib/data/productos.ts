import type { Categoria, Producto } from "@/lib/types";
import { check, db,  num, rpc, rpcMut, traerTodo } from "./db";

export async function listarCategorias(): Promise<Categoria[]> {
  const rows = check(
    await db().from("categorias").select("id,nombre").eq("activa", true).order("nombre")
  ) as any[];
  return rows;
}

/**
 * Productos de UNA sede con su stock de tienda. Con sedeId = null devuelve los de todas
 * las sedes visibles (cada producto pertenece a una sola sede: no se mezclan ni se suman).
 */
export async function listarProductos(sedeId: string | null): Promise<Producto[]> {
  const rows = await traerTodo<any>((a, b) => {
    let q = db()
      .from("productos")
      .select(
        "id,codigo,nombre,descripcion,categoria_id,precio_venta,precio_compra,unidad,stock_minimo,activo,sede_id,categorias(nombre),sedes!productos_sede_id_fkey(nombre),stock_sede(sede_id,stock,stock_minimo),almacen_sede(sede_id,stock)"
      )
      .order("nombre")
      .order("id")
      .range(a, b);
    if (sedeId) q = q.eq("sede_id", sedeId);
    return q;
  });

  return rows.map((r) => {
    const fila = ((r.stock_sede ?? []) as any[]).find((s) => s.sede_id === r.sede_id);
    return {
      id: r.id,
      codigo: r.codigo,
      nombre: r.nombre,
      descripcion: r.descripcion ?? "",
      categoria: r.categorias?.nombre ?? "Sin categoría",
      categoriaId: r.categoria_id,
      precio: num(r.precio_venta),
      precioCompra: num(r.precio_compra),
      stock: num(fila?.stock),
      stockAlmacen: num(((r.almacen_sede ?? []) as any[]).find((s) => s.sede_id === r.sede_id)?.stock),
      stockMinimo: num(fila?.stock_minimo ?? r.stock_minimo),
      unidad: r.unidad,
      activo: r.activo,
      sedeId: r.sede_id,
      sedeNombre: r.sedes?.nombre ?? "",
    };
  });
}

const datos = (p: Producto) => ({
  codigo: p.codigo,
  nombre: p.nombre,
  descripcion: p.descripcion,
  categoria_id: p.categoriaId ?? null,
  precio_venta: p.precio,
  precio_compra: p.precioCompra,
  unidad: p.unidad,
  stock_minimo: p.stockMinimo,
  activo: p.activo,
});

export const crearProducto = (p: Producto, sedeId: string, stockInicial: number) =>
  rpcMut<string>("crear_producto", { p_datos: datos(p), p_sede: sedeId, p_stock_inicial: stockInicial });

export const actualizarProducto = (
  p: Producto,
  sedeId: string | null,
  nuevoStock: number | null,
  motivo: string | null
) =>
  rpcMut<string>("actualizar_producto", {
    p_id: p.id,
    p_datos: datos(p),
    p_sede: sedeId,
    p_nuevo_stock: nuevoStock,
    p_motivo: motivo,
  });

export const cambiarEstadoProducto = (id: string, activo: boolean) =>
  rpcMut<string>("actualizar_producto", { p_id: id, p_datos: { activo } });

/** Agrega (+) o resta (−) stock de la tienda o del almacén. Restar: solo administrador/supervisor. */
export const ajustarStockProducto = (
  sedeId: string,
  productoId: string,
  ubicacion: "tienda" | "almacen",
  delta: number,
  motivo: string | null
) =>
  rpcMut<string>("ajustar_stock_producto", {
    p_sede: sedeId,
    p_producto: productoId,
    p_ubicacion: ubicacion,
    p_delta: delta,
    p_motivo: motivo,
  });
