import { rpc } from "./db";
import { limitesRango } from "@/lib/fechas";
import type { EventoAuditoria } from "@/lib/auditoriaTexto";

export interface FiltrosAuditoria {
  desde: string; // YYYY-MM-DD
  hasta: string;
  usuario: string;
  tabla: string;
  accion: string;
  busqueda: string;
}

export interface ResumenAuditoria {
  total: number;
  usuarios: number;
  porAccion: Record<string, number>;
  porTabla: Record<string, number>;
}

export interface OpcionesAuditoria {
  usuarios: string[];
  tablas: string[];
  acciones: string[];
}

interface Fila {
  id: string;
  fecha: string;
  usuario_id: string | null;
  usuario_nombre: string | null;
  accion: string;
  tabla: string;
  registro_id: string | null;
  detalle: Record<string, unknown> | null;
  total: number | string;
}

const args = (f: FiltrosAuditoria) => {
  const l = limitesRango(f.desde, f.hasta);
  return {
    p_desde: l.desde,
    p_hasta: l.hasta,
    p_usuario: f.usuario || null,
    p_tabla: f.tabla || null,
    p_accion: f.accion || null,
    p_busqueda: f.busqueda.trim() || null,
  };
};

const mapear = (r: Fila): EventoAuditoria => ({
  id: r.id,
  fecha: r.fecha,
  usuarioId: r.usuario_id,
  usuario: r.usuario_nombre ?? "Sistema",
  accion: r.accion,
  tabla: r.tabla,
  registroId: r.registro_id,
  detalle: r.detalle,
});

export async function buscarAuditoria(f: FiltrosAuditoria, pagina: number, porPagina: number) {
  const filas =
    (await rpc<Fila[]>("auditoria_buscar", {
      ...args(f),
      p_limit: porPagina,
      p_offset: (pagina - 1) * porPagina,
    })) ?? [];
  return { eventos: filas.map(mapear), total: filas.length ? Number(filas[0].total) : 0 };
}

export async function resumenAuditoria(f: FiltrosAuditoria): Promise<ResumenAuditoria> {
  const r = await rpc<{ total: number; usuarios: number; por_accion: Record<string, number>; por_tabla: Record<string, number> }>(
    "auditoria_resumen",
    args(f)
  );
  return { total: Number(r?.total ?? 0), usuarios: Number(r?.usuarios ?? 0), porAccion: r?.por_accion ?? {}, porTabla: r?.por_tabla ?? {} };
}

export async function opcionesAuditoria(): Promise<OpcionesAuditoria> {
  const r = await rpc<OpcionesAuditoria>("auditoria_opciones");
  return { usuarios: r?.usuarios ?? [], tablas: r?.tablas ?? [], acciones: r?.acciones ?? [] };
}

export const MAX_DESCARGA = 20000;

/** Trae todos los eventos del filtro (en bloques de 1000) para el reporte. */
export async function todosAuditoria(f: FiltrosAuditoria, alProgresar?: (n: number, total: number) => void) {
  const out: EventoAuditoria[] = [];
  let total = 0;
  for (let pagina = 1; out.length < MAX_DESCARGA; pagina++) {
    const r = await buscarAuditoria(f, pagina, 1000);
    total = r.total;
    out.push(...r.eventos);
    alProgresar?.(out.length, Math.min(total, MAX_DESCARGA));
    if (r.eventos.length < 1000 || out.length >= total) break;
  }
  return { eventos: out.slice(0, MAX_DESCARGA), total, truncado: total > MAX_DESCARGA };
}

/** Deja constancia en la auditoría de quién bajó el reporte. */
export async function registrarDescarga(formato: "excel" | "pdf", f: FiltrosAuditoria, filas: number) {
  try {
    await rpc("auditoria_registrar_descarga", { p_formato: formato, p_filtros: f, p_filas: filas });
  } catch {
    /* la descarga no debe fallar por no poder anotarla */
  }
}
