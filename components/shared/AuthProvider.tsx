"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Perfil, Sede } from "@/lib/types";
import { MENSAJES, clasificar } from "@/lib/net/errores";
import { alRevalidar, iniciarConexion } from "@/lib/net/conexion";
import { refrescarSesion } from "@/lib/data/db";

interface AuthContextValue {
  loading: boolean;
  /** true si no se pudo cargar el perfil por un fallo de red (la sesión NO se tocó). */
  errorRed: boolean;
  /** true solo cuando de verdad no hay sesión (cerrada o vencida): ahí sí corresponde ir a /login. */
  sinSesion: boolean;
  perfil: Perfil | null;
  permisos: Set<string>;
  /** Sedes activas a las que el usuario tiene acceso. */
  sedes: Sede[];
  can: (permiso: string) => boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [errorRed, setErrorRed] = useState(false);
  const [sinSesion, setSinSesion] = useState(false);
  const perfilRef = useRef<Perfil | null>(null);
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [permisos, setPermisos] = useState<Set<string>>(new Set());
  const [sedes, setSedes] = useState<Sede[]>([]);

  const cargar = useCallback(async () => {
    let sesionRes;
    try {
      sesionRes = await supabase.auth.getSession();
    } catch {
      // fallo de red al leer/refrescar la sesión: NO es "sin sesión"
      setErrorRed(true);
      setLoading(false);
      return;
    }
    const sesion = sesionRes.data;
    if (sesionRes.error && !sesion.session) {
      // No se pudo refrescar el token por red/servidor: conservamos todo lo que ya había
      setErrorRed(true);
      setLoading(false);
      return;
    }
    if (!sesion.session) {
      setPerfil(null);
      perfilRef.current = null;
      setPermisos(new Set());
      setSedes([]);
      setErrorRed(false);
      setSinSesion(true);
      setLoading(false);
      return;
    }
    setSinSesion(false);
    const uid = sesion.session.user.id;
    const [p, perm, s] = await Promise.all([
      supabase
        .from("perfiles")
        .select("id,codigo,nombre,email,estado,sede_predeterminada_id,roles(nombre,nivel)")
        .eq("id", uid)
        .maybeSingle(),
      supabase.rpc("mis_permisos"),
      supabase
        .from("sedes")
        .select("id,nombre,codigo,direccion,telefono,ciudad,activa,numero")
        .eq("activa", true)
        .order("numero"),
    ]);

    const fallo = [p, perm, s].find((r) => r.error);
    if (fallo) {
      const err = clasificar(fallo.error as { message: string; code?: string }, (fallo as { status?: number }).status);
      if (err.tipo === "auth") {
        const r = await refrescarSesion();
        if (r === "ok") return cargar();
      }
      if (err.tipo !== "negocio") {
        // red caída, servidor con problemas o sesión por revalidar: se mantiene el perfil actual
        setErrorRed(true);
        setLoading(false);
        return;
      }
    }
    setErrorRed(false);

    const row = p.data as any;
    if (!row || row.estado !== "activo") {
      setPerfil(null);
      perfilRef.current = null;
      setSinSesion(true);
      setPermisos(new Set());
      setSedes([]);
      setLoading(false);
      return;
    }
    const nuevoPerfil: Perfil = {
      id: row.id,
      codigo: row.codigo,
      nombre: row.nombre,
      email: row.email,
      rol: row.roles?.nombre ?? "Sin rol",
      rolNivel: row.roles?.nivel ?? 0,
      sedePredeterminadaId: row.sede_predeterminada_id,
    };
    perfilRef.current = nuevoPerfil;
    setPerfil(nuevoPerfil);
    setPermisos(new Set((perm.data as string[]) ?? []));
    setSedes(
      ((s.data as any[]) ?? []).map((x) => ({
        id: x.id,
        nombre: x.nombre,
        codigo: x.codigo,
        direccion: x.direccion ?? "",
        telefono: x.telefono ?? "",
        ciudad: x.ciudad ?? "",
        activa: x.activa,
      }))
    );
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    iniciarConexion();
    // al reconectar / volver a la pestaña: reintenta si el perfil no pudo cargarse
    const quitar = alRevalidar(() => {
      if (!perfilRef.current) cargar();
    });
    cargar();
    const { data: sub } = supabase.auth.onAuthStateChange((evento) => {
      if (evento === "SIGNED_IN" || evento === "SIGNED_OUT" || evento === "TOKEN_REFRESHED") {
        cargar();
      }
    });
    return () => {
      quitar();
      sub.subscription.unsubscribe();
    };
  }, [supabase, cargar]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      let error;
      try {
        ({ error } = await supabase.auth.signInWithPassword({ email, password }));
      } catch {
        return MENSAJES.red;
      }
      if (error) {
        if (error.name === "AuthRetryableFetchError" || /fetch|network/i.test(error.message)) return MENSAJES.red;
        return error.message === "Invalid login credentials"
          ? "Correo o contraseña incorrectos."
          : error.message;
      }
      await cargar();
      const { data } = await supabase.auth.getUser();
      const { data: p } = await supabase
        .from("perfiles")
        .select("estado")
        .eq("id", data.user?.id ?? "")
        .maybeSingle();
      if (!p || (p as any).estado !== "activo") {
        await supabase.auth.signOut();
        return "Tu usuario está inactivo. Contacta al administrador.";
      }
      await supabase.rpc("registrar_acceso");
      return null;
    },
    [supabase, cargar]
  );

  const signOut = useCallback(async () => {
    try {
      await supabase.auth.signOut();
    } catch {
      /* sin red: se cierra la sesión local igualmente */
    }
    setPerfil(null);
    perfilRef.current = null;
    setPermisos(new Set());
    router.replace("/login");
    router.refresh();
  }, [supabase, router]);

  const value = useMemo<AuthContextValue>(
    () => ({
      loading,
      errorRed,
      sinSesion,
      perfil,
      permisos,
      sedes,
      can: (permiso) => permisos.has(permiso),
      signIn,
      signOut,
      refresh: cargar,
    }),
    [loading, errorRed, sinSesion, perfil, permisos, sedes, signIn, signOut, cargar]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de AuthProvider");
  return ctx;
}
