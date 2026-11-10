"use client";

import { useEffect, useState } from "react";
import { Download, FileSpreadsheet, FileText, Search, ShieldAlert } from "lucide-react";
import { useAuth } from "@/components/shared/AuthProvider";
import { FiltroFechas, type RangoFechas } from "@/components/shared/FiltroFechas";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { PageHeader } from "@/components/ui/PageHeader";
import { useAsync } from "@/lib/hooks/useAsync";
import { rangoPreset } from "@/lib/fechas";
import {
  buscarAuditoria,
  opcionesAuditoria,
  registrarDescarga,
  resumenAuditoria,
  todosAuditoria,
  type FiltrosAuditoria,
} from "@/lib/data/auditoria";
import {
  accionColor,
  accionTexto,
  cambiosDe,
  datosDe,
  descripcionEvento,
  referenciaDe,
  tablaTexto,
  type EventoAuditoria,
} from "@/lib/auditoriaTexto";
import { formatDateTime } from "@/lib/utils";

const POR_PAGINA = 20;
const campo =
  "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100";

export function AuditoriaView() {
  const { perfil } = useAuth();
  const esAdmin = (perfil?.rolNivel ?? 0) >= 100;

  const [rango, setRango] = useState<RangoFechas>(() => rangoPreset("7d"));
  const [usuario, setUsuario] = useState("");
  const [tabla, setTabla] = useState("");
  const [accion, setAccion] = useState("");
  const [texto, setTexto] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [pagina, setPagina] = useState(1);
  const [detalle, setDetalle] = useState<EventoAuditoria | null>(null);
  const [descargando, setDescargando] = useState<"excel" | "pdf" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  // La búsqueda de texto se aplica al dejar de escribir
  useEffect(() => {
    const t = setTimeout(() => {
      setBusqueda(texto);
      setPagina(1);
    }, 350);
    return () => clearTimeout(t);
  }, [texto]);

  const filtros: FiltrosAuditoria = { ...rango, usuario, tabla, accion, busqueda };
  const clave = JSON.stringify(filtros);

  const opciones = useAsync(() => opcionesAuditoria(), [esAdmin]);
  const resumen = useAsync(() => resumenAuditoria(filtros), [clave]);
  const lista = useAsync(() => buscarAuditoria(filtros, pagina, POR_PAGINA), [clave, pagina]);

  if (!esAdmin) {
    return (
      <Card className="mx-auto mt-10 max-w-md p-8 text-center">
        <ShieldAlert className="mx-auto h-10 w-10 text-red-500" />
        <h2 className="mt-3 text-lg font-bold text-gray-900">Acceso restringido</h2>
        <p className="mt-1 text-sm text-gray-500">Solo los administradores pueden ver la auditoría del sistema.</p>
      </Card>
    );
  }

  const cambiar = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPagina(1);
  };

  const descripcionFiltros = [
    usuario && `Usuario: ${usuario}`,
    tabla && `Módulo: ${tablaTexto(tabla)}`,
    accion && `Acción: ${accionTexto(accion)}`,
    busqueda.trim() && `Búsqueda: "${busqueda.trim()}"`,
  ]
    .filter(Boolean)
    .join(" · ");

  const descargar = async (formato: "excel" | "pdf") => {
    setError(null);
    setAviso(null);
    setDescargando(formato);
    try {
      const r = await todosAuditoria(filtros);
      if (!r.eventos.length) {
        setError("No hay eventos para descargar con estos filtros.");
        return;
      }
      const o = {
        negocio: "Sistema Market",
        eventos: r.eventos,
        desde: rango.desde,
        hasta: rango.hasta,
        filtros: descripcionFiltros,
        total: r.total,
        truncado: r.truncado,
      };
      if (formato === "excel") await (await import("@/lib/export/auditoria")).excelAuditoria(o);
      else await (await import("@/lib/export/auditoria")).pdfAuditoria(o);
      await registrarDescarga(formato, filtros, r.eventos.length);
      if (r.truncado) setAviso(`El reporte se limitó a ${r.eventos.length} de ${r.total} eventos. Acota las fechas para ver el resto.`);
      lista.reload();
      resumen.reload();
    } catch (e) {
      setError((e as Error).message || "No se pudo generar el reporte.");
    } finally {
      setDescargando(null);
    }
  };

  const total = lista.data?.total ?? 0;
  const eventos = lista.data?.eventos ?? [];
  const r = resumen.data;

  return (
    <div>
      <PageHeader
        title="Auditoría"
        subtitle="Registro de todo lo que ocurre en el sistema. Visible solo para administradores."
        actions={
          <>
            <button
              onClick={() => descargar("excel")}
              disabled={!!descargando}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <FileSpreadsheet className="h-4 w-4 text-green-600" />
              {descargando === "excel" ? "Generando..." : "Excel"}
            </button>
            <button
              onClick={() => descargar("pdf")}
              disabled={!!descargando}
              className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              {descargando === "pdf" ? "Generando..." : "Reporte PDF"}
            </button>
          </>
        }
      />

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {aviso && <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{aviso}</div>}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Resumen titulo="Eventos" valor={r?.total ?? 0} />
        <Resumen titulo="Usuarios" valor={r?.usuarios ?? 0} />
        <Resumen titulo="Anulaciones y eliminaciones" valor={(r?.porAccion.DELETE ?? 0)} />
        <Resumen titulo="Modificaciones" valor={r?.porAccion.UPDATE ?? 0} />
      </div>

      <Card className="mb-4 space-y-3 p-4">
        <FiltroFechas valor={rango} onChange={cambiar(setRango)} />
        <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            <input
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Buscar (comprobante, producto, texto...)"
              className={`${campo} w-full pl-9`}
            />
          </div>
          <select value={usuario} onChange={(e) => cambiar(setUsuario)(e.target.value)} className={campo}>
            <option value="">Todos los usuarios</option>
            {(opciones.data?.usuarios ?? []).map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
          <select value={tabla} onChange={(e) => cambiar(setTabla)(e.target.value)} className={campo}>
            <option value="">Todos los módulos</option>
            {(opciones.data?.tablas ?? []).map((t) => (
              <option key={t} value={t}>{tablaTexto(t)}</option>
            ))}
          </select>
          <select value={accion} onChange={(e) => cambiar(setAccion)(e.target.value)} className={campo}>
            <option value="">Todas las acciones</option>
            {(opciones.data?.acciones ?? []).map((a) => (
              <option key={a} value={a}>{accionTexto(a)}</option>
            ))}
          </select>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3">Fecha</th>
                <th className="px-4 py-3">Usuario</th>
                <th className="px-4 py-3">Acción</th>
                <th className="px-4 py-3">Módulo</th>
                <th className="px-4 py-3">Descripción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lista.loading && !eventos.length && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-400">Cargando...</td></tr>
              )}
              {!lista.loading && !eventos.length && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-400">
                  {lista.error ?? "No hay eventos con estos filtros."}
                </td></tr>
              )}
              {eventos.map((e) => (
                <tr key={e.id} onClick={() => setDetalle(e)} className="cursor-pointer hover:bg-gray-50">
                  <td className="whitespace-nowrap px-4 py-3 text-gray-600">{formatDateTime(e.fecha)}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{e.usuario}</td>
                  <td className="px-4 py-3"><Badge variant={accionColor(e.accion)}>{accionTexto(e.accion)}</Badge></td>
                  <td className="px-4 py-3 text-gray-600">{tablaTexto(e.tabla)}</td>
                  <td className="max-w-md px-4 py-3 text-gray-700">
                    <span className="line-clamp-2">{descripcionEvento(e)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination
          currentPage={pagina}
          totalPages={Math.max(1, Math.ceil(total / POR_PAGINA))}
          onPageChange={setPagina}
          totalItems={total}
          itemsPerPage={POR_PAGINA}
        />
      </Card>

      <Modal
        open={!!detalle}
        onClose={() => setDetalle(null)}
        size="lg"
        title={detalle ? descripcionEvento(detalle).split(" (")[0] : ""}
        subtitle={detalle ? `${formatDateTime(detalle.fecha)} · ${detalle.usuario}` : undefined}
      >
        {detalle && <Detalle e={detalle} />}
      </Modal>
    </div>
  );
}

function Resumen({ titulo, valor }: { titulo: string; valor: number }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-gray-500">{titulo}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900">{valor.toLocaleString("es-PE")}</p>
    </Card>
  );
}

function Detalle({ e }: { e: EventoAuditoria }) {
  const cambios = cambiosDe(e.detalle);
  const datos = cambios.length ? [] : datosDe(e.detalle);
  return (
    <div className="space-y-4 text-sm">
      <div className="grid grid-cols-2 gap-3">
        <Dato k="Acción" v={accionTexto(e.accion)} />
        <Dato k="Módulo" v={tablaTexto(e.tabla)} />
        <Dato k="Referencia" v={referenciaDe(e) || "—"} />
        <Dato k="ID del registro" v={e.registroId ?? "—"} />
      </div>
      {cambios.length > 0 && (
        <div>
          <h3 className="mb-2 font-semibold text-gray-900">Cambios</h3>
          <div className="overflow-hidden rounded-lg border border-gray-200">
            <table className="w-full">
              <thead className="bg-gray-50 text-left text-xs text-gray-500">
                <tr><th className="px-3 py-2">Campo</th><th className="px-3 py-2">Antes</th><th className="px-3 py-2">Después</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {cambios.map((c) => (
                  <tr key={c.campo}>
                    <td className="px-3 py-2 font-medium text-gray-700">{c.campo}</td>
                    <td className="break-all px-3 py-2 text-red-600">{c.antes}</td>
                    <td className="break-all px-3 py-2 text-green-700">{c.despues}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {datos.length > 0 && (
        <div>
          <h3 className="mb-2 font-semibold text-gray-900">Datos del registro</h3>
          <div className="grid grid-cols-2 gap-3">
            {datos.map(([k, v]) => <Dato key={k} k={k} v={v} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function Dato({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <p className="text-xs text-gray-500">{k}</p>
      <p className="break-all font-medium text-gray-900">{v}</p>
    </div>
  );
}
