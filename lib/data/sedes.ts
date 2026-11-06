import type { SedeResumen } from "@/lib/types";
import { check, db,  num, rpc, rpcMut } from "./db";

export async function listarSedesResumen(): Promise<SedeResumen[]> {
  const rows = check(await db().from("v_sedes_resumen").select("*").order("numero")) as any[];
  return rows.map((r) => ({
    id: r.id,
    numero: r.numero,
    codigo: r.codigo,
    nombre: r.nombre,
    direccion: r.direccion ?? "",
    telefono: r.telefono ?? "",
    ciudad: r.ciudad ?? "",
    activa: r.activa,
    usuarios: num(r.usuarios),
    cajas: num(r.cajas),
    cajasAbiertas: num(r.cajas_abiertas),
    unidadesStock: num(r.unidades_stock),
    ventasHoy: num(r.ventas_hoy),
    createdAt: r.created_at,
  }));
}

export interface SedeForm {
  nombre: string;
  codigo: string;
  direccion: string;
  telefono: string;
  ciudad: string;
}

export const crearSede = (f: SedeForm) =>
  rpcMut<string>("crear_sede", {
    p_nombre: f.nombre,
    p_codigo: f.codigo,
    p_direccion: f.direccion,
    p_telefono: f.telefono,
    p_ciudad: f.ciudad,
  });

export const actualizarSede = (id: string, f: SedeForm, activa: boolean) =>
  rpcMut<string>("actualizar_sede", {
    p_id: id,
    p_nombre: f.nombre,
    p_direccion: f.direccion,
    p_telefono: f.telefono,
    p_ciudad: f.ciudad,
    p_activa: activa,
  });
