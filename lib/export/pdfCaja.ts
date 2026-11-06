import type { Egreso, SesionCaja, VentaCaja } from "@/lib/types";
import { fmtFechaLarga, fmtHora } from "@/lib/fechas";
import { descargarBlob, fmtCantidad, limpiarPdf, textoGenerado } from "./comun";
import { codigoSesion, numeroCaja, resumenCaja } from "./resumenCaja";

export interface DatosCaja {
  negocio: string;
  direccion?: string;
  sesion: SesionCaja;
  ventas: VentaCaja[];
  egresos: Egreso[];
}

const soles = (n: number) => `S/ ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fechaHora = (iso: string) => `${fmtFechaLarga(iso)} ${fmtHora(iso)}`;
const nombreArchivo = (s: SesionCaja, pref: string) =>
  `${pref}_${s.caja.replace(/\s+/g, "_").toLowerCase()}_${s.dia}.pdf`.replace(/[^\w.\-]/g, "");

/* ------------------------------------------------------------------ */
/* REPORTE DE CAJA (A4 vertical)                                       */
/* ------------------------------------------------------------------ */
export async function pdfReporteCaja(d: DatosCaja) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const m = 36;
  const s = d.sesion;
  const r = resumenCaja(s, d.ventas, d.egresos);
  const cerrada = s.estado === "cerrada";

  // Encabezado
  doc.setTextColor(17, 24, 39).setFont("helvetica", "bold").setFontSize(17).text(limpiarPdf(d.negocio.toUpperCase()), W / 2, 44, { align: "center" });
  if (d.direccion) doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(107, 114, 128).text(limpiarPdf(d.direccion), W / 2, 57, { align: "center" });
  doc.setTextColor(17, 24, 39).setFont("helvetica", "bold").setFontSize(13).text(cerrada ? "Reporte de caja cerrada" : "Reporte de caja (turno abierto)", W / 2, 76, { align: "center" });
  doc.setFont("helvetica", "normal").setFontSize(9.5).setTextColor(75, 85, 99)
    .text(`N° ${limpiarPdf(s.caja)}   |   Fecha: ${fmtFechaLarga(s.fechaApertura)}   |   Sede: ${limpiarPdf(s.sede)}`, W / 2, 91, { align: "center" });
  doc.setDrawColor(209, 213, 219).setLineWidth(0.8).line(m, 100, W - m, 100);

  // Apertura / Cierre
  const bw = (W - m * 2 - 12) / 2;
  const caja = (x: number, y: number, titulo: string, color: [number, number, number], filas: [string, string][]) => {
    doc.setFillColor(249, 250, 251).setDrawColor(229, 231, 235).roundedRect(x, y, bw, 78, 5, 5, "FD");
    doc.setFillColor(...color).roundedRect(x, y, 4, 78, 2, 2, "F");
    doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(...color).text(titulo, x + 14, y + 16);
    filas.forEach(([k, v], i) => {
      doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(107, 114, 128).text(k, x + 14, y + 32 + i * 14);
      doc.setFont("helvetica", "bold").setTextColor(17, 24, 39).text(limpiarPdf(v), x + bw - 10, y + 32 + i * 14, { align: "right" });
    });
  };
  caja(m, 112, "APERTURA", [22, 163, 74], [
    ["Fecha y hora", fechaHora(s.fechaApertura)],
    ["Responsable", s.usuario],
    ["Monto de apertura", soles(s.montoApertura)],
  ]);
  caja(m + bw + 12, 112, "CIERRE", [220, 38, 38], [
    ["Fecha y hora", s.fechaCierre ? fechaHora(s.fechaCierre) : "En curso"],
    ["Responsable", s.usuario],
    ["Efectivo contado", s.montoContado === null ? "—" : `${soles(s.montoContado)}${s.diferencia ? `  (dif. ${s.diferencia > 0 ? "+" : ""}${s.diferencia.toFixed(2)})` : ""}`],
  ]);

  // Tarjetas por método
  const cards: { t: string; v: number; sub: string; c: [number, number, number] }[] = [
    ...r.metodos.map((x) => ({ t: x.metodo.toUpperCase(), v: x.total, sub: `${x.ventas} venta${x.ventas === 1 ? "" : "s"}`, c: [37, 99, 235] as [number, number, number] })),
    { t: "EGRESOS", v: r.egresos, sub: `${d.egresos.length} registro${d.egresos.length === 1 ? "" : "s"}`, c: [217, 119, 6] },
    { t: "ANULADO", v: r.anulado, sub: `${r.anuladas} venta${r.anuladas === 1 ? "" : "s"}`, c: [220, 38, 38] },
  ];
  const cols = 3;
  const cw = (W - m * 2 - 12 * (cols - 1)) / cols;
  let y = 204;
  cards.forEach((c, i) => {
    const x = m + (i % cols) * (cw + 12);
    const yy = y + Math.floor(i / cols) * 56;
    doc.setFillColor(255, 255, 255).setDrawColor(229, 231, 235).roundedRect(x, yy, cw, 48, 5, 5, "FD");
    doc.setFillColor(...c.c).rect(x, yy + 8, 3, 32, "F");
    doc.setFont("helvetica", "bold").setFontSize(8).setTextColor(107, 114, 128).text(c.t, x + 12, yy + 16);
    doc.setFont("helvetica", "bold").setFontSize(13).setTextColor(...c.c).text(soles(c.v), x + 12, yy + 32);
    doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(156, 163, 175).text(c.sub, x + 12, yy + 43);
  });
  y += Math.ceil(cards.length / cols) * 56 + 4;

  // Totales
  doc.setFillColor(17, 24, 39).roundedRect(m, y, W - m * 2, 36, 5, 5, "F");
  const tot: [string, string][] = [["TOTAL INGRESOS", soles(r.totalIngresos)], ["(-) EGRESOS", soles(r.egresos)], ["NETO", soles(r.neto)], ["EFECTIVO A ENTREGAR", soles(r.efectivoEntregar)]];
  const tw = (W - m * 2) / tot.length;
  tot.forEach(([k, v], i) => {
    const cx = m + tw * i + tw / 2;
    doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(209, 213, 219).text(k, cx, y + 14, { align: "center" });
    doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(255, 255, 255).text(v, cx, y + 28, { align: "center" });
  });
  y += 52;

  const seccion = (t: string, yy: number) => {
    doc.setFont("helvetica", "bold").setFontSize(10.5).setTextColor(17, 24, 39).text(t, m, yy);
  };

  // Detalle de ventas (una fila por producto vendido)
  seccion(`Detalle de ventas (${d.ventas.length})`, y);
  const filas: any[] = [];
  for (const v of d.ventas) {
    const anulada = v.estado === "anulado";
    const items = v.items.length ? v.items : [{ producto: "—", cantidad: 0, precio: 0 }];
    items.forEach((it, i) =>
      filas.push([
        i === 0 ? fechaHora(v.fecha) : "",
        i === 0 ? v.numero : "",
        limpiarPdf(it.producto),
        fmtCantidad(it.cantidad),
        it.precio.toFixed(2),
        (it.cantidad * it.precio).toFixed(2),
        i === 0 ? v.metodoPago : "",
        i === 0 ? (anulada ? "ANULADO" : "Pagado") : "",
        i === 0 ? v.total.toFixed(2) : "",
      ])
    );
  }
  autoTable(doc, {
    startY: y + 6,
    margin: { left: m, right: m, bottom: 40 },
    head: [["Fecha y hora", "Comprobante", "Producto", "Cant.", "Precio", "Importe", "Método", "Estado", "Total venta"]],
    body: filas.length ? filas : [[{ content: "Sin ventas en este turno.", colSpan: 9, styles: { halign: "center", textColor: [156, 163, 175] } }]],
    styles: { font: "helvetica", fontSize: 7.5, cellPadding: 3, lineColor: [229, 231, 235], lineWidth: 0.4 },
    headStyles: { fillColor: [31, 41, 55], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [249, 250, 251] },
    columnStyles: { 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" }, 8: { halign: "right", fontStyle: "bold" } },
    didParseCell: (h) => {
      if (h.section === "body" && String(h.row.raw?.[7]) === "ANULADO") h.cell.styles.textColor = [185, 28, 28];
    },
  });
  y = (doc as any).lastAutoTable.finalY + 22;

  // Detalle de egresos
  if (y > H - 120) { doc.addPage(); y = 50; }
  seccion(`Detalle de egresos (${d.egresos.length})`, y);
  autoTable(doc, {
    startY: y + 6,
    margin: { left: m, right: m, bottom: 40 },
    head: [["Fecha y hora", "Categoría", "Concepto", "Proveedor / A nombre de", "Documento", "Monto"]],
    body: d.egresos.length
      ? d.egresos.map((e) => [
          fechaHora(e.fecha), limpiarPdf(e.categoria ?? ""), limpiarPdf(e.concepto), limpiarPdf(e.proveedor ?? ""),
          limpiarPdf([e.tipoDocumento, e.numeroDocumento].filter(Boolean).join(" ")), e.monto.toFixed(2),
        ])
      : [[{ content: "Sin egresos en este turno.", colSpan: 6, styles: { halign: "center", textColor: [156, 163, 175] } }]],
    styles: { font: "helvetica", fontSize: 7.5, cellPadding: 3, lineColor: [229, 231, 235], lineWidth: 0.4 },
    headStyles: { fillColor: [180, 83, 9], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [255, 251, 235] },
    columnStyles: { 5: { halign: "right", fontStyle: "bold" } },
  });

  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(156, 163, 175);
    doc.text(textoGenerado(), m, H - 22);
    doc.text(`Página ${i} de ${n}`, W - m, H - 22, { align: "right" });
  }
  descargarBlob(doc.output("blob"), nombreArchivo(s, "reporte_caja"));
}

/* ------------------------------------------------------------------ */
/* TICKET DE CAJA (80 mm, tipografía monoespaciada)                    */
/* ------------------------------------------------------------------ */
const ANCHO = 42; // caracteres por línea

const centrar = (t: string) => {
  const x = t.slice(0, ANCHO);
  return " ".repeat(Math.max(0, Math.floor((ANCHO - x.length) / 2))) + x;
};
const par = (izq: string, der: string) => {
  const espacio = Math.max(1, ANCHO - izq.length - der.length);
  return izq.slice(0, ANCHO - der.length - 1) + " ".repeat(espacio) + der;
};
const rayas = "-".repeat(ANCHO);

export function lineasTicketCaja(d: DatosCaja): { t: string; b?: boolean }[] {
  const s = d.sesion;
  const r = resumenCaja(s, d.ventas, d.egresos);
  const L: { t: string; b?: boolean }[] = [];
  const add = (t = "", b = false) => L.push({ t: limpiarPdf(t), b });
  const lineasLargas = (t: string, sangria = "") => {
    const ancho = ANCHO - sangria.length;
    for (let i = 0; i < Math.max(1, t.length); i += ancho) add(sangria + t.slice(i, i + ancho));
  };

  add(centrar(d.negocio.toUpperCase()), true);
  if (d.direccion) add(centrar(d.direccion));
  add();
  add(centrar("RESUMEN DE CAJA"), true);
  add(rayas);
  add(par("Código:", codigoSesion(s)));
  add(par("Caja #:", numeroCaja(s)));
  add(par("Usuario:", s.usuario));
  add(par("Fecha apertura:", fmtFechaLarga(s.fechaApertura)));
  add(par("Hora apertura:", fmtHora(s.fechaApertura)));
  add(par("Hora cierre:", s.fechaCierre ? fmtHora(s.fechaCierre) : "--"));
  add(par("Estado:", s.estado === "cerrada" ? "CERRADA" : "ABIERTA"));
  add(rayas);
  add("INGRESOS POR MÉTODO DE PAGO", true);
  add(par("EFECTIVO", soles(r.efectivo)));
  add(par("TARJETA", soles(r.digital)));
  add(rayas);
  add(par("TOTAL INGRESOS", soles(r.totalIngresos)), true);
  add(par("(-) Egresos del día", soles(r.egresos)));
  add(par("NETO", soles(r.neto)), true);
  add(rayas);
  add(par("Apertura de caja", soles(s.montoApertura)));
  add(par("(+) Ventas en efectivo", soles(r.efectivo)));
  add(par("(-) Egresos", soles(r.egresos)));
  add(par("TOTAL EFECTIVO A ENTREGAR", soles(r.efectivoEntregar)), true);
  add(rayas);
  add(`DETALLE DE MOVIMIENTOS (${d.ventas.length})`, true);
  if (!d.ventas.length) add("Sin ventas.");
  for (const v of d.ventas) {
    const metodo = v.metodoPago === "Efectivo" ? "Efectivo" : "Tarjeta";
    const anulada = v.estado === "anulado" ? " (ANUL)" : "";
    add(par(`${v.numero} ${metodo}${anulada}`, soles(v.total)));
  }
  add(rayas);
  add(`DETALLE DE EGRESOS (${d.egresos.length})`, true);
  if (!d.egresos.length) add("Sin egresos.");
  for (const e of d.egresos) {
    add(par(`${fmtHora(e.fecha)} ${e.categoria ?? ""}`.slice(0, ANCHO - 12), `-${soles(e.monto)}`));
    lineasLargas(e.concepto + (e.proveedor ? ` (${e.proveedor})` : ""), "   ");
  }
  add(rayas);
  add(centrar(`Impreso: ${new Date().toLocaleString("es-PE", { timeZone: "America/Lima" })}`));
  return L;
}

export async function pdfTicketCaja(d: DatosCaja) {
  const { jsPDF } = await import("jspdf");
  const lineas = lineasTicketCaja(d);
  const ancho = 226.77; // 80 mm
  const paso = 10.2;
  const alto = Math.max(200, lineas.length * paso + 40);
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: [ancho, alto] });
  doc.setTextColor(0, 0, 0);
  doc.setFont("courier", "normal").setFontSize(7.6);
  lineas.forEach((l, i) => {
    doc.setFont("courier", l.b ? "bold" : "normal");
    doc.text(l.t, 10, 20 + i * paso);
  });
  descargarBlob(doc.output("blob"), nombreArchivo(d.sesion, "ticket_caja"));
}

/**
 * Abre la ventana de impresión del navegador con el ticket (80 mm), como el modelo:
 * desde ahí se elige imprimir o "Guardar como PDF". No descarga nada por sí solo.
 */
export function imprimirTicketCaja(d: DatosCaja) {
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const cuerpo = lineasTicketCaja(d)
    .map((l) => (l.b ? `<b>${esc(l.t)}</b>` : esc(l.t)))
    .join("\n");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Ticket ${esc(d.sesion.caja)}</title>
<style>
  @page { size: 80mm auto; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  /* Rollo térmico de 80 mm: todo dentro de una columna de 72 mm, alineada a la izquierda */
  .ticket { width: 72mm; margin: 0; padding: 4mm 4mm 6mm 4mm; box-sizing: content-box; font-family: "Courier New", Courier, monospace; font-size: 8.1pt; line-height: 1.25; color: #000; }
  .logo { display: block; margin: 0 auto 3mm; width: 62mm; height: auto; }
  pre { margin: 0; font: inherit; white-space: pre; }
</style></head><body>
<div class="ticket">
<img class="logo" src="${window.location.origin}/logo-ticket.png" onerror="this.remove()">
<pre>${cuerpo}</pre>
</div>
</body></html>`;

  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(iframe);
  const w = iframe.contentWindow!;
  w.document.open();
  w.document.write(html);
  w.document.close();
  let lanzado = false;
  const lanzar = () => {
    if (lanzado) return;
    lanzado = true;
    w.focus();
    w.print();
    setTimeout(() => iframe.remove(), 60000);
  };
  const img = w.document.querySelector("img");
  if (img && !img.complete) {
    img.addEventListener("load", lanzar, { once: true });
    img.addEventListener("error", lanzar, { once: true });
    setTimeout(lanzar, 2500);
  } else setTimeout(lanzar, 100);
}
