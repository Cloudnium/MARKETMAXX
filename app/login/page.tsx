"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AlertCircle, ArrowRight, Check, Eye, EyeOff, Loader2, Lock, MapPin, Mail } from "lucide-react";
import { useAuth } from "@/components/shared/AuthProvider";
import { useSede } from "@/components/shared/SedeProvider";
import { TODAS_LAS_SEDES } from "@/lib/sede-utils";

const inputClass =
  "w-full rounded-xl border border-gray-200 bg-gray-50 py-3 pl-11 pr-4 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-pink-400 focus:bg-white focus:ring-4 focus:ring-pink-500/10";

const columnOne = [
  { src: "/login/pos.jpg", alt: "Punto de venta" },
  { src: "/login/checkout.jpg", alt: "Caja" },
  { src: "/login/warehouse.jpg", alt: "Almacén" },
];

const columnTwo = [
  { src: "/login/grocery.jpg", alt: "Inventario" },
  { src: "/login/store.jpg", alt: "Tienda" },
  { src: "/login/pos.jpg", alt: "Atención al cliente" },
];

function ImageColumn({
  images,
  duration,
  offset,
}: {
  images: { src: string; alt: string }[];
  duration: number;
  offset?: boolean;
}) {
  return (
    <div
      className={`relative flex-1 overflow-hidden ${offset ? "pt-10" : ""}`}
    >
      <div
        className="animate-scroll-down flex flex-col hover:[animation-play-state:paused]"
        style={{ animationDuration: `${duration}s` }}
      >
        {[0, 1].map((copy) =>
          images.map((image, index) => (
            <div
              key={`${copy}-${index}`}
              className="relative mb-4 aspect-[4/5] shrink-0 overflow-hidden rounded-3xl ring-1 ring-white/10"
            >
              <Image
                src={image.src}
                alt={copy === 0 ? image.alt : ""}
                fill
                sizes="(min-width: 1024px) 25vw, 50vw"
                className="object-cover"
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const { signIn, signOut, perfil, sedes } = useAuth();
  const { setSedeId } = useSede();
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [paso, setPaso] = useState<"credenciales" | "esperando" | "sede">("credenciales");

  // Tras iniciar sesión: 1 sede => entra directo; varias => elige con cuál trabajar
  useEffect(() => {
    if (paso !== "esperando" || !perfil) return;
    if (sedes.length === 0) {
      setError("Tu usuario no tiene sedes asignadas. Pide a un administrador que te asigne una.");
      signOut().then(() => setPaso("credenciales"));
    } else if (sedes.length === 1) {
      setSedeId(sedes[0].id);
      router.replace("/");
    } else {
      setPaso("sede");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paso, perfil, sedes]);

  const entrar = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setPaso("esperando");
    const err = await signIn(email.trim(), password);
    if (err) {
      setError(err);
      setPaso("credenciales");
    }
  };

  const elegirSede = (id: string) => {
    setSedeId(id);
    router.replace("/");
  };

  return (
    <div className="min-h-screen bg-white lg:grid lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-[#160a12] lg:sticky lg:top-0 lg:block lg:h-screen">
        <div className="absolute inset-0 bg-gradient-to-br from-pink-600/25 via-transparent to-fuchsia-700/20" />

        <div className="relative flex h-full gap-4 p-6 xl:p-8">
          <ImageColumn images={columnOne} duration={44} />
          <ImageColumn images={columnTwo} duration={58} offset />
        </div>

        <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-[#160a12] to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#160a12] to-transparent" />
      </div>

      <div className="relative h-40 overflow-hidden lg:hidden">
        <Image
          src="/login/grocery.jpg"
          alt="Market Maxx"
          fill
          priority
          sizes="100vw"
          className="object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#160a12] via-[#160a12]/40 to-transparent" />
      </div>

      <div className="flex min-h-[calc(100vh-10rem)] items-center justify-center px-6 py-10 sm:px-10 lg:min-h-screen lg:px-16">
        <div className="w-full max-w-md">
          <div className="mb-8">
            <div className="mb-6 inline-flex rounded-2xl bg-pink-600 px-5 py-3 shadow-lg shadow-pink-500/25">
              <Image
                src="/icon/maxx.png"
                alt="Market Maxx"
                width={180}
                height={44}
                className="h-8 w-auto object-contain"
                priority
              />
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-gray-900">
              {paso === "sede" ? `Hola, ${perfil?.nombre.split(" ")[0] ?? ""}` : "Bienvenido de nuevo"}
            </h1>
            <p className="mt-2 text-sm text-gray-500">
              {paso === "sede"
                ? "¿En qué sede vas a trabajar hoy? Podrás cambiarla cuando quieras."
                : "Ingresa tus credenciales para acceder al sistema."}
            </p>
          </div>

          {paso === "sede" ? (
            <div className="space-y-3">
              {sedes.map((sede) => (
                <button
                  key={sede.id}
                  onClick={() => elegirSede(sede.id)}
                  className="group flex w-full items-center gap-4 rounded-2xl border border-gray-200 p-4 text-left transition hover:border-pink-300 hover:bg-pink-50/50 hover:shadow-md"
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-pink-100 text-sm font-bold text-pink-600">
                    {sede.codigo}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-gray-900">{sede.nombre}</span>
                    <span className="flex items-center gap-1 truncate text-xs text-gray-500">
                      <MapPin className="h-3 w-3 shrink-0" /> {sede.direccion || "Sin dirección"}
                    </span>
                  </span>
                  <ArrowRight className="h-4 w-4 text-gray-300 transition group-hover:translate-x-0.5 group-hover:text-pink-500" />
                </button>
              ))}
              <button
                onClick={() => elegirSede(TODAS_LAS_SEDES)}
                className="flex w-full items-center gap-3 rounded-2xl border border-dashed border-gray-300 p-3.5 text-sm font-medium text-gray-600 transition hover:border-pink-300 hover:text-pink-600"
              >
                <Check className="h-4 w-4" /> Ver todas mis sedes (solo consulta y reportes)
              </button>
              <button
                onClick={() => signOut().then(() => setPaso("credenciales"))}
                className="w-full pt-2 text-center text-xs text-gray-400 hover:text-gray-600"
              >
                Usar otra cuenta
              </button>
            </div>
          ) : (
            <form onSubmit={entrar} className="space-y-5">
              {error && (
                <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
                </div>
              )}
              <div>
                <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-gray-700">
                  Correo electrónico
                </label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input
                    id="email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="admin@marketmaxx.com"
                    className={inputClass}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-gray-700">
                  Contraseña
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="••••••••"
                    className={`${inputClass} pr-11`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-gray-400 transition-colors hover:text-pink-600"
                    aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={paso === "esperando"}
                className="group flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-pink-600 to-pink-500 py-3 text-sm font-semibold text-white shadow-lg shadow-pink-500/30 transition hover:from-pink-500 hover:to-pink-600 disabled:opacity-70"
              >
                {paso === "esperando" ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Ingresando...
                  </>
                ) : (
                  <>
                    Iniciar sesión
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </>
                )}
              </button>
            </form>
          )}

          <p className="mt-8 text-center text-xs text-gray-400">Sistema Market Maxx · v1.0.0</p>
        </div>
      </div>
    </div>
  );
}
