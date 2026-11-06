import { descargarBlob } from "@/lib/export/comun";
import { check, db, num, rpc, rpcMut } from "./db";
import { nuevoId } from "@/lib/net/pendientes";

export interface RegistroBackup {
  id: string;
  fecha: string;
  usuario: string;
  tipo: "descarga" | "restauracion" | "limpieza";
  archivo: string;
  tamano: number;
  filas: number;
  tablas: number;
  estado: string;
  detalle: string;
}

export async function listarHistorialBackups(): Promise<RegistroBackup[]> {
  const rows = check(
    await db().from("backup_historial").select("*").order("fecha", { ascending: false }).limit(100)
  ) as any[];
  return rows.map((r) => ({
    id: r.id,
    fecha: r.fecha,
    usuario: r.usuario_nombre ?? "—",
    tipo: r.tipo,
    archivo: r.archivo ?? "—",
    tamano: num(r.tamano_bytes),
    filas: num(r.filas),
    tablas: num(r.tablas),
    estado: r.estado,
    detalle: r.detalle ?? "",
  }));
}

export const fmtTamano = (b: number) =>
  b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : b >= 1024 ? `${(b / 1024).toFixed(0)} KB` : `${b} B`;

const LOTE = 500;
/** caja_egresos puede traer fotos: lotes pequeños. */
const loteDe = (tabla: string) => (tabla === "caja_egresos" ? 40 : LOTE);

const comprimir = async (texto: string): Promise<Blob | null> => {
  if (typeof CompressionStream === "undefined") return null;
  const cs = new CompressionStream("gzip");
  const w = cs.writable.getWriter();
  w.write(new TextEncoder().encode(texto));
  w.close();
  return new Response(cs.readable).blob();
};

const descomprimir = async (file: File): Promise<string> => {
  if (/\.gz$/i.test(file.name)) {
    if (typeof DecompressionStream === "undefined") throw new Error("Tu navegador no puede abrir archivos .gz. Usa un navegador actualizado.");
    const ds = new DecompressionStream("gzip");
    return new Response(file.stream().pipeThrough(ds)).text();
  }
  return file.text();
};

export type Progreso = (texto: string, porcentaje: number) => void;

/** Lee TODA la base (por tablas y lotes) y descarga la copia en un archivo. */
export async function descargarBackup(progreso: Progreso) {
  const lista = check(await db().rpc("backup_tablas")) as { tabla: string; filas: number }[];
  const total = lista.reduce((a, t) => a + Number(t.filas), 0) || 1;
  const tablas: Record<string, unknown[]> = {};
  let leidas = 0;
  for (const { tabla, filas } of lista) {
    const salida: unknown[] = [];
    const paso = loteDe(tabla);
    for (let desde = 0; desde < Number(filas); desde += paso) {
      const lote = await rpc<unknown[]>("backup_leer", { p_tabla: tabla, p_desde: desde, p_limite: paso });
      salida.push(...lote);
      leidas += lote.length;
      progreso(`Leyendo ${tabla}…`, Math.min(90, Math.round((leidas / total) * 90)));
    }
    if (salida.length !== Number(filas)) {
      // la tabla cambió mientras se leía (alguien vendió, etc.) o falló una página: no entregamos una copia inconsistente
      throw new Error(`La tabla ${tabla} cambió durante la copia (${salida.length} de ${filas} registros). Vuelve a intentarlo.`);
    }
    tablas[tabla] = salida;
  }
  progreso("Generando archivo…", 94);
  const ahora = new Date();
  const conteos = Object.fromEntries(Object.entries(tablas).map(([t, f]) => [t, f.length]));
  const contenido = { formato: "market-backup", version: 1, fecha: ahora.toISOString(), conteos, tablas };
  const texto = JSON.stringify(contenido);
  const gz = await comprimir(texto);
  const sello = ahora.toLocaleString("sv-SE", { timeZone: "America/Lima" }).replace(/[: ]/g, (c) => (c === " " ? "_" : "-"));
  const nombre = `backup_market_${sello}.json${gz ? ".gz" : ""}`;
  const blob = gz ?? new Blob([texto], { type: "application/json" });
  descargarBlob(blob, nombre);
  await rpcMut("backup_registrar", {
    p_tipo: "descarga",
    p_archivo: nombre,
    p_bytes: blob.size,
    p_filas: leidas,
    p_tablas: lista.length,
    p_detalle: null,
  });
  progreso("Listo", 100);
  return { nombre, tamano: blob.size, filas: leidas, tablas: lista.length };
}

export interface ResumenCopia {
  fecha: string;
  tablas: Record<string, unknown[]>;
  nTablas: number;
  filas: number;
}

/** Abre un archivo de copia y valida que tenga el formato correcto. */
export async function leerCopia(file: File): Promise<ResumenCopia> {
  let json: any;
  try {
    json = JSON.parse(await descomprimir(file));
  } catch (e) {
    throw new Error(`No se pudo leer el archivo: ${(e as Error).message}`);
  }
  if (json?.formato !== "market-backup" || typeof json.tablas !== "object") {
    throw new Error("El archivo no es una copia de seguridad válida de este sistema.");
  }
  const tablas = json.tablas as Record<string, unknown[]>;
  // un archivo cortado o editado no coincide con los conteos que guardó la descarga
  if (json.conteos && typeof json.conteos === "object") {
    for (const [t, n] of Object.entries(json.conteos as Record<string, number>)) {
      if (!Array.isArray(tablas[t]) || tablas[t].length !== n) throw new Error(`El archivo está incompleto o dañado (tabla ${t}).`);
    }
  }
  return {
    fecha: json.fecha,
    tablas,
    nTablas: Object.keys(tablas).length,
    filas: Object.values(tablas).reduce((a, t) => a + (Array.isArray(t) ? t.length : 0), 0),
  };
}

/** Sube la copia por partes y la aplica en una sola transacción (si falla, no cambia nada). */
export const nuevoTokenRestauracion = () => nuevoId();

/**
 * `token` identifica esta restauración: si se corta la conexión y se reintenta con el mismo token,
 * la subida es idempotente y el "aplicar" devuelve el resultado ya guardado en vez de repetirse.
 */
export async function restaurarBackup(copia: ResumenCopia, archivo: string, bytes: number, progreso: Progreso, token: string) {
  let aplicando = false;
  try {
    const nombres = Object.keys(copia.tablas);
    let subidas = 0;
    for (const tabla of nombres) {
      const filas = copia.tablas[tabla] as unknown[];
      const paso = loteDe(tabla);
      if (filas.length === 0) await rpc("backup_subir", { p_token: token, p_tabla: tabla, p_lote: 0, p_datos: [] });
      for (let i = 0, lote = 0; i < filas.length; i += paso, lote++) {
        await rpc("backup_subir", { p_token: token, p_tabla: tabla, p_lote: lote, p_datos: filas.slice(i, i + paso) });
        subidas += Math.min(paso, filas.length - i);
        progreso(`Subiendo ${tabla}…`, Math.min(85, Math.round((subidas / Math.max(1, copia.filas)) * 85)));
      }
    }
    progreso("Aplicando la copia (reemplazando datos)…", 92);
    aplicando = true;
    const r = await rpcMut<{ filas: number; tablas: number }>("backup_aplicar", { p_token: token, p_archivo: archivo, p_bytes: bytes }, token);
    progreso("Listo", 100);
    return r;
  } catch (e) {
    // Si "aplicar" quedó incierto NO se limpia la subida: se podrá reintentar o verificar con el mismo token.
    const incierto = (e as { incierto?: boolean }).incierto;
    if (!(aplicando && incierto)) await rpc("backup_cancelar", { p_token: token }).catch(() => {});
    throw e;
  }
}

export type ModoLimpieza = "movimientos" | "total";
export interface ResultadoLimpieza {
  modo: ModoLimpieza;
  stock_en_cero: boolean;
  borrado: Record<string, number>;
}
export const FRASE_LIMPIEZA = "LIMPIAR SISTEMA";

/**
 * Vacía los datos del sistema (solo Administrador; el servidor lo vuelve a comprobar).
 * No se reintenta sola ni se envía como operación idempotente: es una acción manual, confirmada con una frase escrita.
 */
export async function limpiarSistema(modo: ModoLimpieza, stockCero: boolean): Promise<ResultadoLimpieza> {
  const r = await rpc<ResultadoLimpieza>("limpiar_sistema", { p_confirmacion: FRASE_LIMPIEZA, p_modo: modo, p_stock_cero: stockCero });
  // este equipo ya no debe conservar reservas ni ventas guardadas de antes de la limpieza
  const { vaciarDatosLocales } = await import("@/lib/offline/motor");
  await vaciarDatosLocales().catch(() => {});
  return r;
}
