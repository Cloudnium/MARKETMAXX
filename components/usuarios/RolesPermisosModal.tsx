"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Lock, Plus } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useAuth } from "@/components/shared/AuthProvider";
import { useAsync } from "@/lib/hooks/useAsync";
import { crearRol, guardarPermisosRol, listarPermisos, listarRoles } from "@/lib/data/usuarios";

/** Editor de roles (rangos) y de las funciones que cada uno puede usar. */
export function RolesPermisosModal({
  open,
  onClose,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { perfil, refresh } = useAuth();
  const roles = useAsync(() => (open ? listarRoles(true) : Promise.resolve([])), [open], []);
  const permisos = useAsync(() => (open ? listarPermisos() : Promise.resolve([])), [open], []);
  const [rolId, setRolId] = useState("");
  const [marcados, setMarcados] = useState<string[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState<{ nombre: string; nivel: number } | null>(null);

  const lista = roles.data ?? [];
  const rol = lista.find((r) => r.id === rolId);
  const nivelPropio = perfil?.rolNivel ?? 0;
  const editable = !!rol && rol.nivel <= nivelPropio && rol.nombre !== "Administrador";

  useEffect(() => {
    if (open && lista.length && !lista.some((r) => r.id === rolId)) setRolId(lista[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lista]);

  useEffect(() => {
    setMarcados(rol?.permisos ?? []);
    setError(null);
  }, [rolId, rol?.permisos]);

  const porModulo = useMemo(() => {
    const m = new Map<string, { codigo: string; descripcion: string }[]>();
    (permisos.data ?? []).forEach((p) => m.set(p.modulo, [...(m.get(p.modulo) ?? []), p]));
    return [...m.entries()];
  }, [permisos.data]);

  const alternar = (codigo: string) =>
    setMarcados((prev) => (prev.includes(codigo) ? prev.filter((c) => c !== codigo) : [...prev, codigo]));

  const guardar = async () => {
    if (!rol) return;
    setGuardando(true);
    setError(null);
    try {
      await guardarPermisosRol(rol.id, marcados, rol.permisos ?? []);
      roles.reload();
      onChanged();
      if (rol.id === lista.find((r) => r.nombre === perfil?.rol)?.id) refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  };

  const crear = async () => {
    if (!nuevo || nuevo.nombre.trim().length < 2) return;
    setError(null);
    try {
      const id = await crearRol(nuevo.nombre, "", Math.min(nuevo.nivel, nivelPropio));
      setNuevo(null);
      roles.reload();
      setRolId(id);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const cambios = JSON.stringify([...marcados].sort()) !== JSON.stringify([...(rol?.permisos ?? [])].sort());

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Roles y permisos"
      subtitle="Define qué funciones puede usar cada rango. La BD hace respetar estas reglas."
      size="lg"
      footer={
        <>
          <button onClick={onClose} className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50">
            Cerrar
          </button>
          <button
            onClick={guardar}
            disabled={!editable || !cambios || guardando}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {guardando && <Loader2 className="h-4 w-4 animate-spin" />} Guardar permisos
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <div className="flex flex-wrap items-center gap-2">
          {lista.map((r) => (
            <button
              key={r.id}
              onClick={() => setRolId(r.id)}
              className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${
                r.id === rolId ? "bg-pink-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {r.nombre} <span className="opacity-60">· {r.nivel}</span>
            </button>
          ))}
          {nuevo ? (
            <span className="flex items-center gap-1.5">
              <input
                autoFocus
                value={nuevo.nombre}
                onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })}
                placeholder="Nombre del rol"
                className="w-36 rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm"
              />
              <input
                type="number"
                min={0}
                max={nivelPropio}
                value={nuevo.nivel}
                onChange={(e) => setNuevo({ ...nuevo, nivel: Number(e.target.value) })}
                title="Nivel jerárquico (0-100)"
                className="w-16 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
              />
              <button onClick={crear} className="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-semibold text-white">Crear</button>
            </span>
          ) : (
            <button onClick={() => setNuevo({ nombre: "", nivel: 10 })} className="inline-flex items-center gap-1 rounded-full border border-dashed border-gray-300 px-3 py-1.5 text-sm text-gray-500 hover:border-pink-300 hover:text-pink-600">
              <Plus className="h-3.5 w-3.5" /> Nuevo rol
            </button>
          )}
        </div>

        {rol && (
          <p className="text-xs text-gray-500">
            {rol.descripcion || "Sin descripción"} · Nivel {rol.nivel}: solo puede gestionar usuarios de nivel igual o menor.
          </p>
        )}
        {rol && !editable && (
          <p className="flex items-center gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
            <Lock className="h-4 w-4" />
            {rol.nombre === "Administrador"
              ? "El rol Administrador siempre conserva todos los permisos."
              : "No puedes modificar un rol de rango superior al tuyo."}
          </p>
        )}

        {(roles.loading || permisos.loading) && <div className="flex justify-center py-6 text-gray-400"><Loader2 className="h-5 w-5 animate-spin" /></div>}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {porModulo.map(([modulo, items]) => (
            <div key={modulo} className="rounded-xl border border-gray-200 p-3">
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">{modulo}</p>
              <div className="space-y-1.5">
                {items.map((p) => (
                  <label key={p.codigo} className={`flex items-start gap-2 text-sm ${editable ? "cursor-pointer" : "opacity-70"}`}>
                    <input
                      type="checkbox"
                      checked={marcados.includes(p.codigo)}
                      disabled={!editable}
                      onChange={() => alternar(p.codigo)}
                      className="mt-0.5 h-4 w-4 accent-pink-600"
                    />
                    <span className="text-gray-700">{p.descripcion}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
