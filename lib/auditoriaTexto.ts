/** Textos legibles para los eventos de auditoría (funciones puras, sin dependencias). */

export interface EventoAuditoria {
  id: string;
  fecha: string;
  usuarioId: string | null;
  usuario: string;
  accion: string;
  tabla: string;
  registroId: string | null;
  detalle: Record<string, unknown> | null;
}

export interface Cambio {
  campo: string;
  antes: string;
  despues: string;
}

const ACCIONES: Record<string, string> = {
  INSERT: "Creó",
  UPDATE: "Modificó",
  DELETE: "Eliminó",
  DESCARGA: "Descargó reporte",
};

const TABLAS: Record<string, string> = {
  ventas: "Venta",
  compras: "Egreso / compra",
  productos: "Producto",
  clientes: "Cliente",
  proveedores: "Proveedor",
  categorias: "Categoría",
  cajas: "Caja",
  caja_sesiones: "Turno de caja",
  caja_egresos: "Gasto de caja",
  usuarios: "Usuario",
  perfiles: "Usuario",
  roles: "Rol",
  sedes: "Sede",
  auditoria: "Auditoría",
};

const IGNORAR = new Set(["updated_at", "created_at", "ref"]);

export const accionTexto = (a: string) => ACCIONES[a] ?? a.charAt(0) + a.slice(1).toLowerCase();

export const tablaTexto = (t: string) =>
  TABLAS[t] ?? t.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export function accionColor(a: string): "green" | "blue" | "red" | "amber" | "gray" {
  if (a === "INSERT") return "green";
  if (a === "UPDATE") return "blue";
  if (a === "DELETE") return "red";
  if (a === "DESCARGA") return "amber";
  return "gray";
}

const val = (v: unknown): string => {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
};

const campoTexto = (c: string) => c.replace(/_/g, " ").replace(/^\w/, (x) => x.toUpperCase());

const esObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Lista de campos que cambiaron (antes → después). */
export function cambiosDe(detalle: Record<string, unknown> | null): Cambio[] {
  if (!detalle) return [];
  const { antes, despues } = detalle;
  if (esObj(antes) && esObj(despues)) {
    const claves = Array.from(new Set([...Object.keys(antes), ...Object.keys(despues)])).filter((k) => !IGNORAR.has(k));
    return claves
      .filter((k) => JSON.stringify(antes[k]) !== JSON.stringify(despues[k]))
      .map((k) => ({ campo: campoTexto(k), antes: val(antes[k]), despues: val(despues[k]) }));
  }
  if ("campo" in detalle && ("de" in detalle || "a" in detalle)) {
    return [{ campo: campoTexto(String(detalle.campo)), antes: val(detalle.de), despues: val(detalle.a) }];
  }
  return [];
}

/** Datos del registro creado o eliminado (para mostrar en el detalle). */
export function datosDe(detalle: Record<string, unknown> | null): [string, string][] {
  if (!detalle) return [];
  const base = esObj(detalle.despues) ? detalle.despues : esObj(detalle.antes) ? detalle.antes : null;
  if (!base) return [];
  return Object.entries(base)
    .filter(([k]) => !IGNORAR.has(k))
    .map(([k, v]) => [campoTexto(k), val(v)] as [string, string]);
}

/** Referencia amigable: comprobante, nombre o, en último caso, el id corto. */
export function referenciaDe(e: Pick<EventoAuditoria, "registroId" | "detalle">): string {
  const d = e.detalle ?? {};
  const ref = d.ref ?? d.comprobante;
  if (ref) return String(ref);
  return e.registroId ? e.registroId.slice(0, 8) : "";
}

/** "Modificó Venta B001-12 (Estado: pagado → anulado)" */
export function descripcionEvento(e: EventoAuditoria): string {
  const ref = referenciaDe(e);
  let t = `${accionTexto(e.accion)} ${e.accion === "DESCARGA" ? "" : tablaTexto(e.tabla)}`.trim();
  if (ref && e.accion !== "DESCARGA") t += ` ${ref}`;
  if (e.accion === "DESCARGA") {
    const d = e.detalle ?? {};
    const f = d.formato ? ` (${String(d.formato).toUpperCase()}${d.filas != null ? `, ${d.filas} filas` : ""})` : "";
    return t + f;
  }
  const c = cambiosDe(e.detalle);
  if (e.accion === "UPDATE" && c.length) {
    const corto = c.slice(0, 3).map((x) => `${x.campo}: ${x.antes} → ${x.despues}`).join("; ");
    t += ` (${corto}${c.length > 3 ? `; +${c.length - 3} más` : ""})`;
  }
  return t;
}
