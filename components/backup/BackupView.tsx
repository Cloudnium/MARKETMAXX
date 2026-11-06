"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  HardDrive,
  History,
  Loader2,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import { useRef, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardHeader } from "@/components/ui/Card";
import { useAuth } from "@/components/shared/AuthProvider";
import { Modal } from "@/components/ui/Modal";
import { useAsync } from "@/lib/hooks/useAsync";
import {
  descargarBackup,
  fmtTamano,
  FRASE_LIMPIEZA,
  leerCopia,
  limpiarSistema,
  type ModoLimpieza,
  listarHistorialBackups,
  nuevoTokenRestauracion,
  restaurarBackup,
  type ResumenCopia,
} from "@/lib/data/backup";
import { formatDateTime } from "@/lib/utils";

export function BackupView() {
  const { perfil } = useAuth();
  const esAdmin = (perfil?.rolNivel ?? 0) >= 100;
  const historial = useAsync(() => listarHistorialBackups(), [], []);
  const [progreso, setProgreso] = useState<{ texto: string; pct: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [copia, setCopia] = useState<ResumenCopia | null>(null);
  const [confirmar, setConfirmar] = useState("");
  const [ocupado, setOcupado] = useState<"descarga" | "restauracion" | "limpieza" | null>(null);
  const [limpieza, setLimpieza] = useState<{ modo: ModoLimpieza; stockCero: boolean; frase: string; entiendo: boolean } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const token = useRef<string>(nuevoTokenRestauracion());

  const descargar = async () => {
    setError(null);
    setMensaje(null);
    setOcupado("descarga");
    try {
      const r = await descargarBackup((texto, pct) => setProgreso({ texto, pct }));
      setMensaje(`Copia descargada: ${r.nombre} (${fmtTamano(r.tamano)}, ${r.filas.toLocaleString("es-PE")} registros).`);
      historial.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(null);
      setProgreso(null);
    }
  };

  const elegir = async (f?: File | null) => {
    setError(null);
    setMensaje(null);
    setCopia(null);
    setArchivo(null);
    setConfirmar("");
    token.current = nuevoTokenRestauracion();
    if (!f) return;
    try {
      setCopia(await leerCopia(f));
      setArchivo(f);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const restaurar = async () => {
    if (!copia || !archivo) return;
    setError(null);
    setMensaje(null);
    setOcupado("restauracion");
    try {
      const r = await restaurarBackup(copia, archivo.name, archivo.size, (texto, pct) => setProgreso({ texto, pct }), token.current);
      setMensaje(`Restauración completa: ${r.filas.toLocaleString("es-PE")} registros en ${r.tablas} tablas. La página se recargará.`);
      setTimeout(() => window.location.reload(), 2500);
    } catch (e) {
      const inc = (e as { incierto?: boolean }).incierto;
      setError(
        inc
          ? `${(e as Error).message} Vuelve a pulsar «Restaurar Backup» con el mismo archivo: es seguro, no se aplicará dos veces.`
          : `No se restauró nada (los datos actuales siguen intactos): ${(e as Error).message}`
      );
    } finally {
      setOcupado(null);
      setProgreso(null);
    }
  };

  const limpiar = async () => {
    if (!limpieza) return;
    setError(null);
    setMensaje(null);
    setOcupado("limpieza");
    try {
      const r = await limpiarSistema(limpieza.modo, limpieza.stockCero);
      const n = Object.values(r.borrado).reduce((a, b) => a + Number(b), 0);
      setLimpieza(null);
      setMensaje(`Sistema limpiado (${r.modo === "total" ? "limpieza total" : "movimientos"}): ${n.toLocaleString("es-PE")} registros eliminados. La página se recargará.`);
      setTimeout(() => window.location.reload(), 2500);
    } catch (e) {
      setError(`No se limpió nada: ${(e as Error).message}`);
      setLimpieza(null);
    } finally {
      setOcupado(null);
    }
  };

  const barra = progreso && (
    <div>
      <div className="mb-1 flex justify-between text-xs text-gray-500">
        <span>{progreso.texto}</span>
        <span>{progreso.pct}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-gray-100">
        <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${progreso.pct}%` }} />
      </div>
    </div>
  );

  return (
    <div>
      <PageHeader title="Backup" subtitle="Respalda y restaura la información del sistema" />

      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
          <div>
            <p className="text-sm font-semibold text-blue-800">Protege tu información</p>
            <p className="text-sm text-blue-700">
              La copia incluye todas las tablas del sistema (productos, stock, ventas, cajas, egresos, usuarios y permisos).
              Guárdala fuera de este equipo. No incluye las contraseñas de acceso, que las guarda Supabase.
            </p>
          </div>
        </div>

        {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {mensaje && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{mensaje}</p>}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Descargar Backup" icon={Download} tone="green" subtitle="Genera una copia de seguridad completa" />
            <div className="space-y-4 p-5">
              <div className="flex items-center gap-4 rounded-lg bg-green-50 p-4">
                <div className="rounded-lg bg-green-100 p-3">
                  <Database className="h-6 w-6 text-green-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900">Base de datos completa</p>
                  <p className="text-xs text-gray-500">Todas las sedes: productos, ventas, clientes, compras y configuración</p>
                </div>
              </div>
              <ul className="space-y-2 text-sm text-gray-600">
                {["Incluye todos los módulos del sistema", "Archivo comprimido (.json.gz)", "Queda registrado en el historial"].map((item) => (
                  <li key={item} className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500" /> {item}
                  </li>
                ))}
              </ul>
              {ocupado === "descarga" && barra}
              <button
                onClick={descargar}
                disabled={!!ocupado}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-green-600 px-4 py-3 text-sm font-bold text-white hover:bg-green-700 disabled:opacity-60"
              >
                {ocupado === "descarga" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Descargar Backup
              </button>
            </div>
          </Card>

          <Card>
            <CardHeader title="Restaurar Backup" icon={Upload} tone="amber" subtitle="Recupera la información desde un archivo" />
            <div className="space-y-4 p-5">
              <div className="flex items-center gap-4 rounded-lg bg-amber-50 p-4">
                <div className="rounded-lg bg-amber-100 p-3">
                  <HardDrive className="h-6 w-6 text-amber-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900">Restaurar sistema</p>
                  <p className="text-xs text-gray-500">Selecciona un archivo de backup generado por este sistema</p>
                </div>
              </div>

              <input ref={input} type="file" accept=".json,.gz,application/json,application/gzip" hidden onChange={(e) => elegir(e.target.files?.[0])} />
              <div
                onClick={() => esAdmin && input.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (esAdmin) elegir(e.dataTransfer.files?.[0]);
                }}
                className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center ${esAdmin ? "cursor-pointer hover:border-amber-400" : "opacity-60"}`}
              >
                <Upload className="h-8 w-8 text-gray-300" />
                {archivo && copia ? (
                  <>
                    <p className="mt-2 text-sm font-semibold text-gray-800">{archivo.name}</p>
                    <p className="text-xs text-gray-500">
                      {fmtTamano(archivo.size)} · copia del {formatDateTime(copia.fecha)} · {copia.nTablas} tablas · {copia.filas.toLocaleString("es-PE")} registros
                    </p>
                  </>
                ) : (
                  <>
                    <p className="mt-2 text-sm font-medium text-gray-600">Arrastra tu archivo aquí</p>
                    <p className="text-xs text-gray-400">o haz clic para seleccionar</p>
                    <p className="mt-1 text-[11px] text-gray-400">Formatos permitidos: .json.gz, .json</p>
                  </>
                )}
              </div>

              <div className="flex items-start gap-2 rounded-lg bg-amber-50 p-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <p className="text-xs text-amber-700">
                  La restauración REEMPLAZA todos los datos actuales por los de la copia. Es todo o nada: si algo falla, no se cambia nada.
                  Descarga un backup actual antes de continuar.
                </p>
              </div>

              {!esAdmin && <p className="text-xs text-gray-500">Solo un Administrador puede restaurar copias.</p>}

              {copia && esAdmin && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">Escribe RESTAURAR para confirmar</label>
                  <input
                    value={confirmar}
                    onChange={(e) => setConfirmar(e.target.value)}
                    placeholder="RESTAURAR"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
                  />
                </div>
              )}
              {ocupado === "restauracion" && barra}
              <button
                onClick={restaurar}
                disabled={!esAdmin || !copia || confirmar.trim().toUpperCase() !== "RESTAURAR" || !!ocupado}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-3 text-sm font-bold text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {ocupado === "restauracion" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Restaurar Backup
              </button>
            </div>
          </Card>
        </div>

        {esAdmin && (
          <Card>
            <CardHeader title="Limpiar sistema" icon={Trash2} tone="red" subtitle="Solo Administrador · deja el sistema listo para empezar de cero" />
            <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3 rounded-lg bg-red-50 p-4 text-sm text-red-800">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
                <p>
                  Elimina ventas, cajas, egresos, compras, traslados e historiales (y, si lo eliges, también productos, clientes y proveedores).
                  Se conservan usuarios, roles, permisos, sedes y configuración. <strong>No se puede deshacer</strong>: descarga un backup antes.
                </p>
              </div>
              <button
                data-testid="btn-limpiar-sistema"
                onClick={() => setLimpieza({ modo: "movimientos", stockCero: false, frase: "", entiendo: false })}
                disabled={!!ocupado}
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-red-600 px-5 py-3 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" /> Limpiar sistema
              </button>
            </div>
          </Card>
        )}

        <Card>
          <CardHeader title="Historial de Backups" icon={History} tone="blue" subtitle="Copias descargadas y restauraciones realizadas" />
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Fecha</th>
                  <th className="px-4 py-3 font-semibold">Acción</th>
                  <th className="px-4 py-3 font-semibold">Archivo</th>
                  <th className="px-4 py-3 font-semibold">Usuario</th>
                  <th className="px-4 py-3 text-right font-semibold">Tamaño</th>
                  <th className="px-4 py-3 text-right font-semibold">Registros</th>
                  <th className="px-4 py-3 text-center font-semibold">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(historial.data ?? []).map((h) => (
                  <tr key={h.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-4 py-3 text-gray-700">{formatDateTime(h.fecha)}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${h.tipo === "descarga" ? "bg-green-100 text-green-700" : h.tipo === "limpieza" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
                        {h.tipo === "descarga" ? "Descarga" : h.tipo === "limpieza" ? "Limpieza" : "Restauración"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{h.archivo}</td>
                    <td className="px-4 py-3 text-gray-600">{h.usuario}</td>
                    <td className="px-4 py-3 text-right text-gray-600">{h.tamano ? fmtTamano(h.tamano) : "—"}</td>
                    <td className="px-4 py-3 text-right text-gray-600">{h.filas.toLocaleString("es-PE")}</td>
                    <td className="px-4 py-3 text-center">
                      <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-700">Completado</span>
                    </td>
                  </tr>
                ))}
                {(historial.data ?? []).length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Aún no hay copias registradas.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
      <Modal
        open={!!limpieza}
        onClose={() => ocupado !== "limpieza" && setLimpieza(null)}
        size="lg"
        title={<span className="flex items-center gap-2 text-red-700"><Trash2 className="h-5 w-5" /> Limpiar sistema</span>}
        footer={
          <div className="flex w-full justify-end gap-3">
            <button onClick={() => setLimpieza(null)} disabled={ocupado === "limpieza"} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              Cancelar
            </button>
            <button
              data-testid="btn-confirmar-limpieza"
              onClick={limpiar}
              disabled={!limpieza || !limpieza.entiendo || limpieza.frase.trim().toUpperCase() !== FRASE_LIMPIEZA || ocupado === "limpieza"}
              className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {ocupado === "limpieza" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Limpiar ahora
            </button>
          </div>
        }
      >
        {limpieza && (
          <div className="space-y-4 text-sm text-gray-700">
            <div className="space-y-2">
              {(
                [
                  ["movimientos", "Solo movimientos", "Borra ventas, comprobantes, cajas, egresos, compras, traslados e historiales y reinicia la numeración. Conserva productos, clientes, proveedores y el stock actual."],
                  ["total", "Limpieza total", "Además borra productos, categorías, clientes, proveedores y todo el stock. El sistema queda vacío (solo usuarios, sedes y configuración)."],
                ] as [ModoLimpieza, string, string][]
              ).map(([valor, titulo, texto]) => (
                <label key={valor} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${limpieza.modo === valor ? "border-red-400 bg-red-50" : "border-gray-200 hover:bg-gray-50"}`}>
                  <input type="radio" name="modo-limpieza" checked={limpieza.modo === valor} onChange={() => setLimpieza({ ...limpieza, modo: valor })} className="mt-1 text-red-600 focus:ring-red-500" />
                  <span>
                    <span className="block font-semibold text-gray-900">{titulo}</span>
                    <span className="text-xs text-gray-600">{texto}</span>
                  </span>
                </label>
              ))}
            </div>

            {limpieza.modo === "movimientos" && (
              <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-700">
                <input type="checkbox" checked={limpieza.stockCero} onChange={(e) => setLimpieza({ ...limpieza, stockCero: e.target.checked })} className="h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500" />
                Dejar también el stock de todos los productos en 0
              </label>
            )}

            <div className="flex items-center justify-between gap-3 rounded-lg bg-blue-50 p-3 text-xs text-blue-800">
              <span>Recomendado: descarga una copia de seguridad antes de continuar.</span>
              <button onClick={descargar} disabled={!!ocupado} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 font-semibold text-white hover:bg-green-700 disabled:opacity-50">
                {ocupado === "descarga" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Descargar backup
              </button>
            </div>
            {ocupado === "descarga" && barra}

            <label className="flex cursor-pointer items-start gap-2 text-xs text-gray-700">
              <input type="checkbox" checked={limpieza.entiendo} onChange={(e) => setLimpieza({ ...limpieza, entiendo: e.target.checked })} className="mt-0.5 h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500" />
              Entiendo que esta acción es permanente y no se puede deshacer.
            </label>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">Escribe {FRASE_LIMPIEZA} para confirmar</label>
              <input
                data-testid="frase-limpieza"
                value={limpieza.frase}
                onChange={(e) => setLimpieza({ ...limpieza, frase: e.target.value })}
                placeholder={FRASE_LIMPIEZA}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none"
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
