import { NextResponse } from "next/server";
import { createAdminSupabase, createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

interface Body {
  id?: string;
  nombre?: string;
  email?: string;
  telefono?: string;
  rolId?: string;
  estado?: "activo" | "inactivo";
  sedeIds?: string[];
  password?: string;
}

const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });

/** Verifica sesión y devuelve el cliente del usuario que llama. */
async function autenticar() {
  const sb = await createServerSupabase();
  const { data } = await sb.auth.getUser();
  if (!data.user) return null;
  return { sb, uid: data.user.id };
}

// ---- Crear usuario ----------------------------------------------------
export async function POST(req: Request) {
  const ctx = await autenticar();
  if (!ctx) return fail("Sesión no válida.", 401);
  const b = (await req.json()) as Body;

  if (!b.nombre?.trim() || !b.email?.trim()) return fail("Nombre y correo son obligatorios.");
  if (!b.password || b.password.length < 8) return fail("La contraseña debe tener al menos 8 caracteres.");
  if (!b.rolId) return fail("Selecciona un rol.");
  if (!b.sedeIds?.length) return fail("Asigna al menos una sede al usuario.");

  const { data: permitido, error: e1 } = await ctx.sb.rpc("validar_gestion_usuario", {
    p_permiso: "usuarios.crear",
    p_rol_destino: b.rolId,
    p_usuario_destino: null,
  });
  if (e1) return fail(e1.message, 500);
  if (!permitido) return fail("No tienes permiso para crear usuarios con ese rol.", 403);

  const admin = createAdminSupabase();
  const { data: creado, error: e2 } = await admin.auth.admin.createUser({
    email: b.email.trim().toLowerCase(),
    password: b.password,
    email_confirm: true,
    user_metadata: {
      nombre: b.nombre.trim(),
      telefono: b.telefono ?? "",
      rol_id: b.rolId,
      estado: b.estado ?? "activo",
    },
  });
  if (e2 || !creado.user) {
    const msg = e2?.message?.includes("already") ? "Ya existe un usuario con ese correo." : e2?.message;
    return fail(msg ?? "No se pudo crear el usuario.");
  }

  const nuevoId = creado.user.id;
  const { error: e3 } = await ctx.sb.rpc("asignar_sedes_usuario", { p_usuario: nuevoId, p_sedes: b.sedeIds });
  if (e3) {
    await admin.auth.admin.deleteUser(nuevoId); // deshace para no dejar un usuario a medias
    return fail(e3.message);
  }
  await admin.from("perfiles").update({ sede_predeterminada_id: b.sedeIds[0] }).eq("id", nuevoId);

  return NextResponse.json({ id: nuevoId });
}

// ---- Editar usuario -----------------------------------------------------
export async function PATCH(req: Request) {
  const ctx = await autenticar();
  if (!ctx) return fail("Sesión no válida.", 401);
  const b = (await req.json()) as Body;
  if (!b.id || !b.rolId) return fail("Datos incompletos.");
  if (b.password && b.password.length < 8) return fail("La nueva contraseña debe tener al menos 8 caracteres.");
  if (!b.sedeIds?.length) return fail("Asigna al menos una sede al usuario.");

  // 1) Datos del perfil (valida rango y permisos dentro de la BD; queda en auditoría)
  const { error: e1 } = await ctx.sb.rpc("actualizar_usuario", {
    p_id: b.id,
    p_nombre: b.nombre ?? "",
    p_telefono: b.telefono ?? "",
    p_rol: b.rolId,
    p_estado: b.estado ?? "activo",
  });
  if (e1) return fail(e1.message, e1.code === "42501" ? 403 : 400);

  // 2) Sedes
  const { error: e2 } = await ctx.sb.rpc("asignar_sedes_usuario", { p_usuario: b.id, p_sedes: b.sedeIds });
  if (e2) return fail(e2.message);

  // 3) Auth: contraseña y bloqueo de acceso
  const admin = createAdminSupabase();
  const cambios: { password?: string; ban_duration?: string } = {
    ban_duration: b.estado === "inactivo" ? "876000h" : "none",
  };
  if (b.password) cambios.password = b.password;
  const { error: e3 } = await admin.auth.admin.updateUserById(b.id, cambios);
  if (e3) return fail(e3.message, 500);

  return NextResponse.json({ ok: true });
}
