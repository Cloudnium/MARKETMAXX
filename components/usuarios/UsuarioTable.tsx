"use client";

import { Pencil, Power } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import type { Usuario } from "@/lib/types";

export function UsuarioTable({
  usuarios,
  onEdit,
  onToggle,
}: {
  usuarios: Usuario[];
  onEdit?: (usuario: Usuario) => void;
  onToggle?: (usuario: Usuario) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="bg-gray-50 text-xs uppercase text-gray-500">
          <tr>
            <th className="px-4 py-3 font-semibold">Usuario</th>
            <th className="px-4 py-3 font-semibold">Correo</th>
            <th className="px-4 py-3 font-semibold">Rol</th>
            <th className="px-4 py-3 font-semibold">Teléfono</th>
            <th className="px-4 py-3 font-semibold">Estado</th>
            <th className="px-4 py-3 text-center font-semibold">Acciones</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {usuarios.map((usuario) => (
            <tr key={usuario.id} className="hover:bg-gray-50">
              <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-pink-100 text-xs font-bold text-pink-600">
                    {usuario.iniciales}
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">
                      {usuario.nombre}
                    </p>
                    <p className="text-xs text-gray-400">{usuario.codigo ?? usuario.id.slice(0, 6)}</p>
                  </div>
                </div>
              </td>
              <td className="px-4 py-3 text-gray-600">{usuario.email}</td>
              <td className="px-4 py-3">
                <Badge
                  variant={
                    usuario.rol === "Administrador"
                      ? "blue"
                      : usuario.rol === "Cajero"
                      ? "green"
                      : usuario.rol === "Supervisor"
                      ? "vip"
                      : "amber"
                  }
                >
                  {usuario.rol}
                </Badge>
              </td>
              <td className="px-4 py-3 text-gray-600">{usuario.telefono}</td>
              <td className="px-4 py-3">
                <Badge variant={usuario.estado} />
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center justify-center gap-1">
                  {onEdit && (
                    <button
                      onClick={() => onEdit(usuario)}
                      className="rounded-lg p-1.5 text-blue-600 hover:bg-blue-50"
                      title="Editar"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  )}
                  {onToggle && (
                    <button
                      onClick={() => onToggle(usuario)}
                      className={`rounded-lg p-1.5 ${
                        usuario.estado === "activo" ? "text-red-500 hover:bg-red-50" : "text-green-600 hover:bg-green-50"
                      }`}
                      title={usuario.estado === "activo" ? "Desactivar" : "Activar"}
                    >
                      <Power className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
          {usuarios.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-10 text-center text-gray-500">
                No se encontraron usuarios.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
