import { fmtFecha, fmtHora, ZONA } from "@/lib/fechas";

/** Descarga un archivo generado en el navegador. */
export function descargarBlob(blob: Blob, nombre: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Las fuentes estándar de PDF no tienen todos los símbolos: se cambian por equivalentes. */
export const limpiarPdf = (t: string) =>
  String(t ?? "")
    .replace(/[→⟶]/g, ">")
    .replace(/[–—]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/…/g, "...")
    // quita lo que no se pueda dibujar (fuera de Latin-1)
    .replace(/[^\u0000-ÿ]/g, "");

/** 1.234 / 12 / 0,5 : hasta 3 decimales, sin ceros sobrantes */
export const fmtCantidad = (n: number) =>
  new Intl.NumberFormat("es-PE", { maximumFractionDigits: 3 }).format(n);

/** +5 / -3 */
export const fmtConSigno = (n: number) => `${n > 0 ? "+" : n < 0 ? "-" : ""}${fmtCantidad(Math.abs(n))}`;

/** "Generado: 1/11/2026, 6:31:53 p. m." */
export const textoGenerado = () =>
  `Generado: ${new Date().toLocaleString("es-PE", { timeZone: ZONA })}`;

/** Fecha y hora de Lima como componentes (para celdas de Excel sin desfase de zona). */
export function fechaHoraLima(iso: string) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const g = (t: string) => Number(f.find((p) => p.type === t)?.value ?? 0);
  return new Date(Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")));
}

export { fmtFecha, fmtHora };
