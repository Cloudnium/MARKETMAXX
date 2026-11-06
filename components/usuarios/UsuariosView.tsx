"use client";

import { KeyRound, Plus, Search, ShieldCheck, UserCheck, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Pagination } from "@/components/ui/Pagination";
import { UsuarioTable } from "./UsuarioTable";
import { UsuarioForm } from "./UsuarioForm";
import { RolesPermisosModal } from "./RolesPermisosModal";
import { useAuth } from "@/components/shared/AuthProvider";
import { useAsync } from "@/lib/hooks/useAsync";
import { actualizarUsuario, listarRoles, listarUsuarios } from "@/lib/data/usuarios";
import type { Usuario } from "@/lib/types";

const PER_PAGE = 6;

export function UsuariosView() {
  const { can, perfil } = useAuth();
  const lista = useAsync(listarUsuarios, [], []);
  const rolesQ = useAsync(() => listarRoles(), [], []);
  const usuarios = lista.data ?? [];
  const [rolesOpen, setRolesOpen] = useState(false);
  const nivelPropio = perfil?.rolNivel ?? 0;
  // solo se puede gestionar a usuarios de igual o menor rango, y no a uno mismo
  const gestionable = (u: Usuario) => (u.rolNivel ?? 0) <= nivelPropio;
  const alternarEstado = async (u: Usuario) => {
    const accion = u.estado === "activo" ? "desactivar" : "activar";
    if (!window.confirm(`¿Deseas ${accion} a ${u.nombre}?`)) return;
    try {
      await actualizarUsuario({
        id: u.id, nombre: u.nombre, email: u.email, telefono: u.telefono, rolId: u.rolId ?? "",
        estado: u.estado === "activo" ? "inactivo" : "activo", sedeIds: u.sedeIds ?? [],
      });
      lista.reload();
    } catch (e) {
      window.alert((e as Error).message);
    }
  };
  const [query, setQuery] = useState("");
  const [rol, setRol] = useState("Todos");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Usuario | null>(null);

  const filtered = useMemo(
    () =>
      usuarios.filter((u) => {
        const matchQuery =
          u.nombre.toLowerCase().includes(query.toLowerCase()) ||
          u.email.toLowerCase().includes(query.toLowerCase());
        const matchRol = rol === "Todos" || u.rol === rol;
        return matchQuery && matchRol;
      }),
    [usuarios, query, rol]
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const current = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const activos = usuarios.filter((u) => u.estado === "activo").length;
  const admins = usuarios.filter((u) => u.rol === "Administrador").length;

  const openNew = () => {
    setEditing(null);
    setOpen(true);
  };

  const openEdit = (usuario: Usuario) => {
    setEditing(usuario);
    setOpen(true);
  };

  return (
    <div>
      <PageHeader
        title="Usuarios"
        subtitle="Administra los usuarios y sus permisos"
        actions={
          <div className="flex gap-2">
            {can("roles.gestionar") && (
              <button
                onClick={() => setRolesOpen(true)}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                <KeyRound className="h-4 w-4" /> Roles y permisos
              </button>
            )}
            {can("usuarios.crear") && (
              <button
                onClick={openNew}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
              >
                <Plus className="h-4 w-4" /> Nuevo Usuario
              </button>
            )}
          </div>
        }
      />

      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[
            {
              label: "Total Usuarios",
              value: usuarios.length.toString(),
              icon: Users,
              bg: "bg-blue-100",
              color: "text-blue-600",
            },
            {
              label: "Usuarios Activos",
              value: activos.toString(),
              icon: UserCheck,
              bg: "bg-green-100",
              color: "text-green-600",
            },
            {
              label: "Administradores",
              value: admins.toString(),
              icon: ShieldCheck,
              bg: "bg-purple-100",
              color: "text-purple-600",
            },
          ].map((m) => {
            const Icon = m.icon;
            return (
              <div
                key={m.label}
                className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
              >
                <div className={`rounded-lg p-3 ${m.bg}`}>
                  <Icon className={`h-6 w-6 ${m.color}`} />
                </div>
                <div>
                  <p className="text-sm text-gray-500">{m.label}</p>
                  <p className="text-xl font-bold text-gray-900">{m.value}</p>
                </div>
              </div>
            );
          })}
        </div>

        <Card>
          <div className="flex flex-col gap-3 border-b border-gray-100 p-4 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
                placeholder="Buscar por nombre o correo..."
                className="w-full rounded-lg border border-gray-300 py-2.5 pl-10 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </div>
            <select
              value={rol}
              onChange={(e) => {
                setRol(e.target.value);
                setPage(1);
              }}
              className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
            >
              {["Todos", ...(rolesQ.data ?? []).map((r) => r.nombre)].map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </div>

          <UsuarioTable
            usuarios={current}
            onEdit={can("usuarios.editar") ? (u) => (gestionable(u) ? openEdit(u) : window.alert("No puedes editar a un usuario de rango superior al tuyo.")) : undefined}
            onToggle={can("usuarios.eliminar") ? (u) => (u.id === perfil?.id ? window.alert("No puedes desactivarte a ti mismo.") : gestionable(u) ? alternarEstado(u) : window.alert("No puedes gestionar a un usuario de rango superior al tuyo.")) : undefined}
          />
          <Pagination
            currentPage={page}
            totalPages={totalPages}
            onPageChange={setPage}
            totalItems={filtered.length}
            itemsPerPage={PER_PAGE}
          />
        </Card>
      </div>

      <UsuarioForm
        open={open}
        usuario={editing}
        roles={(rolesQ.data ?? []).filter((r) => r.nivel <= nivelPropio)}
        esUnoMismo={editing?.id === perfil?.id}
        onClose={() => setOpen(false)}
        onSaved={() => {
          setOpen(false);
          lista.reload();
        }}
      />
      <RolesPermisosModal open={rolesOpen} onClose={() => setRolesOpen(false)} onChanged={() => rolesQ.reload()} />
    </div>
  );
}
