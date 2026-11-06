/** Utilidades de fechas para historiales y exportaciones (hora de Perú). */

export const ZONA = "America/Lima";
/** Perú no usa horario de verano: UTC-5 todo el año. */
const OFFSET = "-05:00";

const partes = (d: Date) => {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  return f; // YYYY-MM-DD
};

/** Fecha de hoy en Lima como YYYY-MM-DD. */
export const hoyLima = () => partes(new Date());

/** Suma días a una fecha YYYY-MM-DD. */
export function sumarDias(iso: string, dias: number) {
  const d = new Date(`${iso}T12:00:00${OFFSET}`);
  d.setUTCDate(d.getUTCDate() + dias);
  return partes(d);
}

export const primerDiaDelMes = (iso: string) => `${iso.slice(0, 8)}01`;

/** Límites (timestamptz) del rango de fechas, ambos extremos incluidos. */
export function limitesRango(desde: string, hasta: string) {
  return {
    desde: `${desde}T00:00:00.000${OFFSET}`,
    hasta: `${hasta}T23:59:59.999${OFFSET}`,
  };
}

/** 1/11/2026 */
export const fmtFecha = (iso: string) =>
  new Date(iso).toLocaleDateString("es-PE", { timeZone: ZONA });

/** 06:23 p. m. */
export const fmtHora = (iso: string) =>
  new Date(iso).toLocaleTimeString("es-PE", {
    timeZone: ZONA,
    hour: "2-digit",
    minute: "2-digit",
  });

/** 30/10/2026 (con ceros, para tablas del almacén) */
export const fmtFechaLarga = (iso: string) =>
  new Date(iso).toLocaleDateString("es-PE", {
    timeZone: ZONA,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

/** Fecha de un YYYY-MM-DD como 30/10/2026 */
export const fmtIsoCorta = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

export type PresetFecha = "hoy" | "ayer" | "7d" | "30d" | "mes";

export const presetsFecha: { value: PresetFecha; label: string }[] = [
  { value: "hoy", label: "Hoy" },
  { value: "ayer", label: "Ayer" },
  { value: "7d", label: "Últimos 7 días" },
  { value: "30d", label: "Últimos 30 días" },
  { value: "mes", label: "Este mes" },
];

export function rangoPreset(p: PresetFecha): { desde: string; hasta: string } {
  const hoy = hoyLima();
  switch (p) {
    case "hoy":
      return { desde: hoy, hasta: hoy };
    case "ayer": {
      const a = sumarDias(hoy, -1);
      return { desde: a, hasta: a };
    }
    case "7d":
      return { desde: sumarDias(hoy, -6), hasta: hoy };
    case "30d":
      return { desde: sumarDias(hoy, -29), hasta: hoy };
    case "mes":
      return { desde: primerDiaDelMes(hoy), hasta: hoy };
  }
}

/** Sufijo para el nombre de archivo: un día o un rango. */
export const sufijoArchivo = (desde: string, hasta: string) =>
  desde === hasta ? desde : `${desde}_a_${hasta}`;
