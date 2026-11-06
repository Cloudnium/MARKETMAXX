import type { Cliente } from "@/lib/types";
import { check, db, num, rpcMut } from "./db";

const map = (r: any): Cliente => ({
  id: r.id,
  nombre: r.nombre,
  documento: r.documento ?? "",
  telefono: r.telefono ?? "",
  email: r.email ?? "",
  direccion: r.direccion ?? "",
  tipo: r.tipo,
  compras: num(r.compras),
  totalGastado: num(r.total_gastado),
});

export async function listarClientes(): Promise<Cliente[]> {
  const rows = check(
    await db().from("v_clientes").select("*").eq("activo", true).order("nombre")
  ) as any[];
  return rows.map(map);
}

const datos = (c: Cliente) => ({
  nombre: c.nombre.trim(),
  documento: c.documento.trim() || null,
  telefono: c.telefono.trim() || null,
  email: c.email.trim() || null,
  direccion: c.direccion.trim() || null,
  tipo: c.tipo,
});

export async function guardarCliente(c: Cliente) {
  await rpcMut<string>("guardar_cliente", { p_id: c.id || null, p_datos: datos(c) });
}

export async function desactivarCliente(id: string) {
  await rpcMut<string>("desactivar_cliente", { p_id: id });
}
