"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Loader2 } from "lucide-react";
import { guardarCliente } from "@/lib/data/clientes";
import type { Cliente } from "@/lib/types";

const empty: Cliente = {
  id: "",
  nombre: "",
  documento: "",
  telefono: "",
  email: "",
  direccion: "",
  tipo: "regular",
  compras: 0,
  totalGastado: 0,
};

export function ClienteForm({
  open,
  cliente,
  onClose,
  onSaved,
}: {
  open: boolean;
  cliente: Cliente | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Cliente>(empty);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(cliente ?? empty);
      setError(null);
    }
  }, [open, cliente]);

  const update = (field: keyof Cliente, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const guardar = async () => {
    if (form.nombre.trim().length < 2) return setError("El nombre es obligatorio.");
    setGuardando(true);
    setError(null);
    try {
      await guardarCliente(form);
      onSaved();
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg.includes("clientes_documento_uq") ? "Ya existe un cliente con ese documento." : msg);
    } finally {
      setGuardando(false);
    }
  };

  const inputClass =
    "w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={cliente ? "Editar Cliente" : "Nuevo Cliente"}
      subtitle={
        cliente
          ? "Actualiza los datos del cliente"
          : "Registra un nuevo cliente en el sistema"
      }
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
            {cliente ? "Guardar cambios" : "Registrar cliente"}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 sm:col-span-2">{error}</p>}
        <div className="sm:col-span-2">
          <label className="mb-1.5 block text-sm font-medium text-gray-700">
            Nombre completo
          </label>
          <input
            value={form.nombre}
            onChange={(e) => update("nombre", e.target.value)}
            placeholder="Ej. María Fernández"
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">
            Documento (DNI/RUC)
          </label>
          <input
            value={form.documento}
            onChange={(e) => update("documento", e.target.value)}
            placeholder="Ej. 45872136"
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">
            Teléfono
          </label>
          <input
            value={form.telefono}
            onChange={(e) => update("telefono", e.target.value)}
            placeholder="Ej. 987 654 321"
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">
            Correo electrónico
          </label>
          <input
            value={form.email}
            onChange={(e) => update("email", e.target.value)}
            placeholder="Ej. cliente@correo.com"
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">
            Tipo de cliente
          </label>
          <select
            value={form.tipo}
            onChange={(e) => update("tipo", e.target.value)}
            className={inputClass}
          >
            <option value="regular">Regular</option>
            <option value="vip">VIP</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1.5 block text-sm font-medium text-gray-700">
            Dirección
          </label>
          <input
            value={form.direccion}
            onChange={(e) => update("direccion", e.target.value)}
            placeholder="Ej. Av. Los Álamos 245"
            className={inputClass}
          />
        </div>
      </div>
    </Modal>
  );
}
