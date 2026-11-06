"use client";

import {
  Building2,
  CheckCircle2,
  Loader2,
  MapPin,
  Package2,
  Pencil,
  Phone,
  Plus,
  Power,
  Users,
  Wallet,
} from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Modal } from "@/components/ui/Modal";
import { useAuth } from "@/components/shared/AuthProvider";
import { useSede } from "@/components/shared/SedeProvider";
import { useAsync } from "@/lib/hooks/useAsync";
import {
  actualizarSede,
  crearSede,
  listarSedesResumen,
  type SedeForm,
} from "@/lib/data/sedes";
import type { SedeResumen } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";

const inputClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100";

const vacio: SedeForm = { nombre: "", codigo: "", direccion: "", telefono: "", ciudad: "" };

function sugerirCodigo(nombre: string) {
  const palabras = nombre
    .replace(/^tienda\s+/i, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const code = palabras.length > 1 ? palabras.map((p) => p[0]).join("") : (palabras[0] ?? "").slice(0, 3);
  return code.toUpperCase().slice(0, 10);
}

export function SedesView() {
  const { can, refresh } = useAuth();
  const { sedeId, setSedeId } = useSede();
  const { data, loading, error, reload } = useAsync(listarSedesResumen, [], [] as SedeResumen[]);
  const sedes = data ?? [];

  const [modal, setModal] = useState<{ sede: SedeResumen | null } | null>(null);
  const [form, setForm] = useState<SedeForm>(vacio);
  const [codigoManual, setCodigoManual] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const abrir = (sede: SedeResumen | null) => {
    setErr(null);
    setCodigoManual(!!sede);
    setForm(
      sede
        ? { nombre: sede.nombre, codigo: sede.codigo, direccion: sede.direccion, telefono: sede.telefono, ciudad: sede.ciudad ?? "" }
        : vacio
    );
    setModal({ sede });
  };

  const guardar = async () => {
    if (!modal) return;
    setGuardando(true);
    setErr(null);
    try {
      if (modal.sede) {
        await actualizarSede(modal.sede.id, form, modal.sede.activa);
        setAviso("Sede actualizada.");
      } else {
        await crearSede(form);
        setAviso(`Sede "${form.nombre}" creada: ya tiene series, stock en 0 y una caja lista.`);
      }
      setModal(null);
      reload();
      refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setGuardando(false);
    }
  };

  const alternarActiva = async (sede: SedeResumen) => {
    const accion = sede.activa ? "desactivar" : "activar";
    if (!window.confirm(`¿Seguro que deseas ${accion} la sede "${sede.nombre}"?`)) return;
    setToggling(sede.id);
    try {
      await actualizarSede(
        sede.id,
        { nombre: sede.nombre, codigo: sede.codigo, direccion: sede.direccion, telefono: sede.telefono, ciudad: sede.ciudad ?? "" },
        !sede.activa
      );
      reload();
      refresh();
    } catch (e) {
      window.alert((e as Error).message);
    } finally {
      setToggling(null);
    }
  };

  const activas = sedes.filter((s) => s.activa);
  const metrics = [
    { label: "Sedes activas", value: activas.length.toString(), icon: Building2, bg: "bg-blue-100", color: "text-blue-600" },
    { label: "Cajas abiertas", value: sedes.reduce((a, s) => a + s.cajasAbiertas, 0).toString(), icon: Wallet, bg: "bg-green-100", color: "text-green-600" },
    { label: "Ventas de hoy", value: formatCurrency(sedes.reduce((a, s) => a + s.ventasHoy, 0)), icon: CheckCircle2, bg: "bg-purple-100", color: "text-purple-600" },
  ];

  return (
    <div>
      <PageHeader
        title="Sedes"
        subtitle="Administra las tiendas y sucursales del negocio"
        actions={
          can("sedes.crear") && (
            <button
              onClick={() => abrir(null)}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
            >
              <Plus className="h-4 w-4" /> Nueva Sede
            </button>
          )
        }
      />

      {aviso && (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm font-semibold text-green-700">
          <span className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5" /> {aviso}</span>
          <button onClick={() => setAviso(null)} className="text-green-600 hover:text-green-800">✕</button>
        </div>
      )}
      {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {metrics.map((m) => {
            const Icon = m.icon;
            return (
              <div key={m.label} className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className={`rounded-lg p-3 ${m.bg}`}><Icon className={`h-6 w-6 ${m.color}`} /></div>
                <div>
                  <p className="text-sm text-gray-500">{m.label}</p>
                  <p className="text-xl font-bold text-gray-900">{m.value}</p>
                </div>
              </div>
            );
          })}
        </div>

        {loading && sedes.length === 0 ? (
          <div className="flex justify-center py-16 text-gray-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {sedes.map((sede) => {
              const actual = sede.id === sedeId;
              return (
                <div
                  key={sede.id}
                  className={`rounded-xl border bg-white p-5 shadow-sm transition-all hover:shadow-md ${
                    actual ? "border-pink-300 ring-2 ring-pink-100" : "border-gray-200"
                  } ${sede.activa ? "" : "opacity-70"}`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-pink-100 text-sm font-bold text-pink-600">
                        {sede.codigo}
                      </div>
                      <div>
                        <p className="font-bold text-gray-900">{sede.nombre}</p>
                        <p className="text-xs text-gray-400">
                          Series F{String(sede.numero).padStart(3, "0")} · B{String(sede.numero).padStart(3, "0")}
                        </p>
                      </div>
                    </div>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${sede.activa ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
                      {sede.activa ? "Activa" : "Inactiva"}
                    </span>
                  </div>

                  <div className="mt-4 space-y-1.5 text-sm text-gray-600">
                    <p className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5 text-gray-400" /> {sede.direccion || "Sin dirección"}{sede.ciudad ? `, ${sede.ciudad}` : ""}</p>
                    <p className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 text-gray-400" /> {sede.telefono || "Sin teléfono"}</p>
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-2 rounded-lg bg-gray-50 p-3 text-center">
                    <div>
                      <p className="flex items-center justify-center gap-1 text-xs text-gray-500"><Users className="h-3 w-3" /> Usuarios</p>
                      <p className="text-sm font-bold text-gray-900">{sede.usuarios}</p>
                    </div>
                    <div>
                      <p className="flex items-center justify-center gap-1 text-xs text-gray-500"><Wallet className="h-3 w-3" /> Cajas</p>
                      <p className="text-sm font-bold text-gray-900">{sede.cajasAbiertas}/{sede.cajas}</p>
                    </div>
                    <div>
                      <p className="flex items-center justify-center gap-1 text-xs text-gray-500"><Package2 className="h-3 w-3" /> Stock</p>
                      <p className="text-sm font-bold text-gray-900">{sede.unidadesStock.toLocaleString("es-PE")}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-sm">
                    <span className="text-gray-500">Ventas de hoy</span>
                    <span className="font-bold text-green-600">{formatCurrency(sede.ventasHoy)}</span>
                  </div>

                  <div className="mt-4 flex gap-2">
                    {sede.activa && (
                      <button
                        onClick={() => setSedeId(sede.id)}
                        disabled={actual}
                        className="flex-1 rounded-lg bg-pink-600 py-2 text-xs font-semibold text-white hover:bg-pink-700 disabled:bg-pink-100 disabled:text-pink-600"
                      >
                        {actual ? "Sede actual" : "Trabajar aquí"}
                      </button>
                    )}
                    {can("sedes.editar") && (
                      <>
                        <button
                          onClick={() => abrir(sede)}
                          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                        >
                          <Pencil className="h-3.5 w-3.5" /> Editar
                        </button>
                        <button
                          onClick={() => alternarActiva(sede)}
                          disabled={toggling === sede.id}
                          title={sede.activa ? "Desactivar" : "Activar"}
                          className="rounded-lg border border-gray-300 p-2 text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                        >
                          <Power className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
            {sedes.length === 0 && (
              <p className="col-span-full py-10 text-center text-sm text-gray-500">No hay sedes registradas.</p>
            )}
          </div>
        )}
      </div>

      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title={modal?.sede ? "Editar Sede" : "Nueva Sede"}
        subtitle={modal?.sede ? "Actualiza los datos de la sede" : "Registra una nueva tienda o sucursal"}
        size="lg"
        footer={
          <>
            <button onClick={() => setModal(null)} className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50">
              Cancelar
            </button>
            <button
              onClick={guardar}
              disabled={guardando || !form.nombre.trim() || !form.codigo.trim()}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
              {modal?.sede ? "Guardar cambios" : "Crear sede"}
            </button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {err && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 sm:col-span-2">{err}</p>}
          <div className="sm:col-span-2">
            <label className="mb-1.5 block text-sm font-medium text-gray-700">Nombre de la sede</label>
            <input
              value={form.nombre}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  nombre: e.target.value,
                  codigo: codigoManual ? f.codigo : sugerirCodigo(e.target.value),
                }))
              }
              placeholder="Ej. Tienda Este"
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">Código</label>
            <input
              value={form.codigo}
              disabled={!!modal?.sede}
              onChange={(e) => {
                setCodigoManual(true);
                setForm((f) => ({ ...f, codigo: e.target.value.toUpperCase().slice(0, 10) }));
              }}
              placeholder="Ej. TE"
              className={`${inputClass} disabled:bg-gray-50 disabled:text-gray-500`}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">Ciudad</label>
            <input value={form.ciudad} onChange={(e) => setForm((f) => ({ ...f, ciudad: e.target.value }))} placeholder="Ej. Lima" className={inputClass} />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1.5 block text-sm font-medium text-gray-700">Dirección</label>
            <input value={form.direccion} onChange={(e) => setForm((f) => ({ ...f, direccion: e.target.value }))} placeholder="Ej. Av. Principal 120" className={inputClass} />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1.5 block text-sm font-medium text-gray-700">Teléfono</label>
            <input value={form.telefono} onChange={(e) => setForm((f) => ({ ...f, telefono: e.target.value }))} placeholder="Ej. 987 100 200" className={inputClass} />
          </div>
          {!modal?.sede && (
            <p className="rounded-lg bg-blue-50 p-3 text-xs text-blue-700 sm:col-span-2">
              Al crear la sede se generan automáticamente sus series de comprobantes, el stock en 0 de todos
              los productos y una “Caja 1”. Luego asigna usuarios a esta sede desde el módulo Usuarios.
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
}
