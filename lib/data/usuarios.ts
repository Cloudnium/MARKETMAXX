import type { RolInfo, Usuario } from "@/lib/types";
import { check, db, rpcMut } from "./db";
import { ErrorApp, MENSAJES, desdeExcepcion } from "@/lib/net/errores";
import { bloqueaEscrituras } from "@/lib/net/conexion";

const iniciales = (n: string) =>
  n.split(" ").filter(Boolean).slice(0, 2).map((x) => x[0]).join("").toUpperCase();

export async function listarUsuarios(): Promise<Usuario[]> {
  const rows = check(
    await db()
      .from("perfiles")
      .select("id,codigo,nombre,email,telefono,estado,rol_id,sede_predeterminada_id,roles(nombre,nivel),usuario_sedes(sede_id)")
      .order("codigo")
  ) as any[];
  return rows.map((r) => ({
    id: r.id,
    codigo: r.codigo,
    nombre: r.nombre,
    email: r.email,
    rol: r.roles?.nombre ?? "Sin rol",
    rolId: r.rol_id,
    rolNivel: r.roles?.nivel ?? 0,
    telefono: r.telefono ?? "",
    estado: r.estado,
    iniciales: iniciales(r.nombre),
    sedeId: r.sede_predeterminada_id ?? undefined,
    sedeIds: (r.usuario_sedes ?? []).map((s: any) => s.sede_id),
  }));
}

export async function listarRoles(conPermisos = false): Promise<RolInfo[]> {
  const rows = check(
    await db()
      .from("roles")
      .select(conPermisos ? "id,nombre,nivel,descripcion,es_sistema,rol_permisos(permiso_codigo)" : "id,nombre,nivel,descripcion,es_sistema")
      .eq("activo", true)
      .order("nivel", { ascending: false })
  ) as any[];
  return rows.map((r) => ({
    id: r.id,
    nombre: r.nombre,
    nivel: r.nivel,
    descripcion: r.descripcion ?? "",
    esSistema: r.es_sistema,
    permisos: (r.rol_permisos ?? []).map((p: any) => p.permiso_codigo),
  }));
}

export interface PermisoDef {
  codigo: string;
  modulo: string;
  descripcion: string;
}

export async function listarPermisos(): Promise<PermisoDef[]> {
  return check(await db().from("permisos").select("codigo,modulo,descripcion").order("orden")) as PermisoDef[];
}

/** Reemplaza los permisos del rol en una sola transacción (antes: borrar + insertar por separado). */
export async function guardarPermisosRol(rolId: string, permisos: string[], _actuales?: string[]) {
  await rpcMut<number>("guardar_permisos_rol", { p_rol: rolId, p_permisos: [...permisos].sort() });
}

export async function crearRol(nombre: string, descripcion: string, nivel: number) {
  return rpcMut<string>("crear_rol", { p_nombre: nombre.trim(), p_descripcion: descripcion, p_nivel: nivel });
}

export interface UsuarioPayload {
  id?: string;
  nombre: string;
  email: string;
  telefono: string;
  rolId: string;
  estado: "activo" | "inactivo";
  sedeIds: string[];
  password?: string;
}

async function llamar(metodo: "POST" | "PATCH", body: UsuarioPayload) {
  if (bloqueaEscrituras()) throw new ErrorApp("offline", MENSAJES.offline);
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 30_000);
  let res: Response;
  try {
    res = await fetch("/api/usuarios", {
      method: metodo,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
  } catch (e) {
    // La petición pudo llegar al servidor: no sabemos si el usuario se creó/editó.
    const err = desdeExcepcion(e);
    throw new ErrorApp(err.tipo, `${err.message} Revisa la lista de usuarios antes de repetir la operación.`, { incierto: true });
  } finally {
    clearTimeout(t);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) throw new ErrorApp("auth", MENSAJES.auth, { status: 401 });
    if (res.status === 429) throw new ErrorApp("rate_limit", MENSAJES.rate_limit, { status: 429 });
    if (res.status >= 500 && !json.error) throw new ErrorApp("servidor", MENSAJES.servidor, { status: res.status, incierto: true });
    throw new ErrorApp("negocio", json.error ?? "No se pudo guardar el usuario.", { status: res.status });
  }
}

export const crearUsuario = (u: UsuarioPayload) => llamar("POST", u);
export const actualizarUsuario = (u: UsuarioPayload) => llamar("PATCH", u);
