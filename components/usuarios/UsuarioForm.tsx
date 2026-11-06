"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useAuth } from "@/components/shared/AuthProvider";
import { actualizarUsuario, crearUsuario } from "@/lib/data/usuarios";
import type { RolInfo, Usuario } from "@/lib/types";

const empty: Usuario = {
  id: "",
  nombre: "",
  email: "",
  rol: "",
  rolId: "",
  telefono: "",
  estado: "activo",
  iniciales: "",
  sedeIds: [],
};

export function UsuarioForm({
  open,
  usuario,
  roles,
  esUnoMismo,
  onClose,
  onSaved,
}: {
  open: boolean;
  usuario: Usuario | null;
  roles: RolInfo[];
  esUnoMismo?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { sedes } = useAuth();
  const [form, setForm] = useState<Usuario>(empty);
  const [password, setPassword] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(usuario ?? { ...empty, rolId: roles[roles.length - 1]?.id ?? "", sedeIds: [] });
      setPassword("");
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, usuario]);

  const update = (field: keyof Usuario, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const toggleSede = (id: string) =>
    setForm((prev) => {
      const actuales = prev.sedeIds ?? [];
      return { ...prev, sedeIds: actuales.includes(id) ? actuales.filter((x) => x !== id) : [...actuales, id] };
    });

  const guardar = async () => {
    setError(null);
    setGuardando(true);
    try {
      const payload = {
        id: usuario?.id,
        nombre: form.nombre,
        email: form.email,
        telefono: form.telefono,
        rolId: form.rolId ?? "",
        estado: form.estado,
        sedeIds: form.sedeIds ?? [],
        password: password || undefined,
      };
      if (usuario) await actualizarUsuario(payload);
      else await crearUsuario(payload);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  };

  const inputClass =
    "w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:bg-gray-50 disabled:text-gray-500";
  const rolActual = roles.find((r) => r.id === form.rolId);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={usuario ? "Editar Usuario" : "Nuevo Usuario"}
      subtitle={usuario ? "Actualiza la información del usuario" : "Registra un nuevo usuario en el sistema"}
      size="lg"
      footer={
        <>
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            Cancelar
          </button>
          <button
            onClick={guardar}
            disabled={guardando}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
            {usuario ? "Guardar cambios" : "Registrar usuario"}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 sm:col-span-2">{error}</p>}
        <div className="sm:col-span-2">
          <label className="mb-1.5 block text-sm font-medium text-gray-700">Nombre completo</label>
          <input value={form.nombre} onChange={(e) => update("nombre", e.target.value)} placeholder="Ej. Lucía Vargas" className={inputClass} />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">Correo electrónico</label>
          <input
            type="email"
            value={form.email}
            disabled={!!usuario}
            onChange={(e) => update("email", e.target.value)}
            placeholder="Ej. usuario@market.com"
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">Teléfono</label>
          <input value={form.telefono} onChange={(e) => update("telefono", e.target.value)} placeholder="Ej. 987 111 222" className={inputClass} />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">Rol</label>
          <select
            value={form.rolId ?? ""}
            disabled={esUnoMismo}
            onChange={(e) => update("rolId", e.target.value)}
            className={inputClass}
          >
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.nombre}
              </option>
            ))}
          </select>
          {rolActual?.descripcion && <p className="mt-1 text-xs text-gray-500">{rolActual.descripcion}</p>}
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">Estado</label>
          <select value={form.estado} disabled={esUnoMismo} onChange={(e) => update("estado", e.target.value)} className={inputClass}>
            <option value="activo">Activo</option>
            <option value="inactivo">Inactivo</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1.5 block text-sm font-medium text-gray-700">
            Sedes donde puede trabajar
          </label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {sedes.map((sede) => {
              const marcada = (form.sedeIds ?? []).includes(sede.id);
              return (
                <label
                  key={sede.id}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm transition ${
                    marcada ? "border-pink-300 bg-pink-50 text-pink-700" : "border-gray-200 text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  <input type="checkbox" checked={marcada} onChange={() => toggleSede(sede.id)} className="h-4 w-4 accent-pink-600" />
                  <span className="font-medium">{sede.nombre}</span>
                  <span className="ml-auto text-xs text-gray-400">{sede.codigo}</span>
                </label>
              );
            })}
          </div>
          <p className="mt-1 text-xs text-gray-500">
            El usuario podrá elegir entre estas sedes al iniciar sesión. Los roles con acceso a “todas las sedes” no necesitan asignación.
          </p>
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1.5 block text-sm font-medium text-gray-700">
            {usuario ? "Nueva contraseña" : "Contraseña temporal"}
          </label>
          <input
            type="password"
            value={password}
            autoComplete="new-password"
            onChange={(e) => setPassword(e.target.value)}
            placeholder={usuario ? "Dejar en blanco para mantener la actual" : "Mínimo 8 caracteres"}
            className={inputClass}
          />
          {usuario && <p className="mt-1 text-xs text-gray-500">Completa este campo solo si deseas cambiar la contraseña.</p>}
        </div>
      </div>
    </Modal>
  );
}
