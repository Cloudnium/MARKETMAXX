import { descripcionEvento, accionTexto, tablaTexto, cambiosDe, referenciaDe, type EventoAuditoria } from "@/lib/auditoriaTexto";
import { fmtFecha, fmtHora, sufijoArchivo } from "@/lib/fechas";
import { descargarBlob, fechaHoraLima, limpiarPdf, textoGenerado } from "./comun";

export interface OpcionesReporteAuditoria {
  negocio: string;
  eventos: EventoAuditoria[];
  desde: string;
  hasta: string;
  filtros: string;
  total: number;
  truncado: boolean;
}

const cambiosTexto = (e: EventoAuditoria) =>
  cambiosDe(e.detalle).map((c) => `${c.campo}: ${c.antes} → ${c.despues}`).join(" | ");

export async function excelAuditoria(o: OpcionesReporteAuditoria) {
  const ExcelJS = (await import("exceljs")).default;
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet("Auditoría");
  const cab = ["Fecha", "Hora", "Usuario", "Acción", "Módulo", "Registro", "Descripción", "Cambios"];
  const n = cab.length;
  const fill = (argb: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } });

  const banda = (fila: number, texto: string, color: string, txt: string, size: number) => {
    hoja.mergeCells(fila, 1, fila, n);
    const c = hoja.getCell(fila, 1);
    c.value = texto;
    c.font = { bold: true, size, color: { argb: txt } };
    c.fill = fill(color);
    c.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    hoja.getRow(fila).height = 24;
  };
  banda(1, o.negocio.toUpperCase(), "FFEC4899", "FFFFFFFF", 13);
  banda(2, "AUDITORÍA DEL SISTEMA", "FFF9A8D4", "FF000000", 11);
  const pares: [string, string | number][] = [
    ["Rango de fechas", `${o.desde} al ${o.hasta}`],
    ["Total de eventos", o.truncado ? `${o.eventos.length} de ${o.total} (reporte limitado)` : o.eventos.length],
    ["Filtros", o.filtros || "Ninguno"],
    ["Generado", new Date().toLocaleString("es-PE", { timeZone: "America/Lima" })],
  ];
  pares.forEach(([k, v], i) => {
    const r = 4 + i;
    hoja.mergeCells(r, 2, r, n);
    hoja.getCell(r, 1).value = k;
    hoja.getCell(r, 1).font = { bold: true, color: { argb: "FF505050" } };
    hoja.getCell(r, 2).value = v;
  });

  const filaCab = 4 + pares.length + 1;
  const h = hoja.getRow(filaCab);
  cab.forEach((t, i) => {
    const c = h.getCell(i + 1);
    c.value = t;
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = fill("FF10B981");
  });
  o.eventos.forEach((e, i) => {
    const r = hoja.getRow(filaCab + 1 + i);
    r.getCell(1).value = fechaHoraLima(e.fecha);
    r.getCell(1).numFmt = "dd/mm/yyyy";
    r.getCell(2).value = fechaHoraLima(e.fecha);
    r.getCell(2).numFmt = "hh:mm:ss";
    r.getCell(3).value = e.usuario;
    r.getCell(4).value = accionTexto(e.accion);
    r.getCell(5).value = tablaTexto(e.tabla);
    r.getCell(6).value = referenciaDe(e);
    r.getCell(7).value = descripcionEvento(e);
    r.getCell(8).value = cambiosTexto(e);
    if (i % 2) for (let c = 1; c <= n; c++) r.getCell(c).fill = fill("FFF5F5F5");
  });
  [12, 10, 22, 16, 20, 16, 60, 60].forEach((w, i) => (hoja.getColumn(i + 1).width = w));
  hoja.views = [{ state: "frozen", ySplit: filaCab }];
  hoja.autoFilter = { from: { row: filaCab, column: 1 }, to: { row: filaCab + o.eventos.length, column: n } };

  const buf = await libro.xlsx.writeBuffer();
  descargarBlob(
    new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `auditoria_${sufijoArchivo(o.desde, o.hasta)}.xlsx`
  );
}

export async function pdfAuditoria(o: OpcionesReporteAuditoria) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const mx = 28.35;
  const ancho = W - mx * 2;
  const ROSA: [number, number, number] = [236, 72, 153];
  const ROSA_CLARO: [number, number, number] = [249, 168, 212];
  const VERDE: [number, number, number] = [16, 185, 129];
  const GRIS: [number, number, number] = [55, 65, 81];

  doc.setFillColor(...ROSA).rect(mx, 34, ancho, 31.2, "F");
  doc.setTextColor(255, 255, 255).setFont("helvetica", "bold").setFontSize(13);
  doc.text(limpiarPdf(o.negocio.toUpperCase()), mx + 14.7, 54);
  doc.setFontSize(10).text(fmtFecha(new Date().toISOString()), W - mx - 14.5, 54, { align: "right" });
  doc.setFillColor(...ROSA_CLARO).rect(mx, 73.7, ancho, 25.5, "F");
  doc.setTextColor(0, 0, 0).setFontSize(11);
  doc.text("AUDITORIA DEL SISTEMA", W / 2, 90, { align: "center" });

  doc.setTextColor(...GRIS).setFontSize(9);
  doc.setFont("helvetica", "bold").text("Rango:", mx, 116);
  doc.setFont("helvetica", "normal").text(`${o.desde} al ${o.hasta}`, mx + 40, 116);
  doc.setFont("helvetica", "bold").text("Eventos:", mx + 220, 116);
  doc.setFont("helvetica", "normal").text(o.truncado ? `${o.eventos.length} de ${o.total} (limitado)` : String(o.eventos.length), mx + 265, 116);
  doc.setFont("helvetica", "bold").text("Filtros:", mx + 420, 116);
  doc.setFont("helvetica", "normal").text(limpiarPdf(o.filtros || "Ninguno").slice(0, 90), mx + 455, 116);

  autoTable(doc, {
    startY: 130,
    head: [["Fecha", "Hora", "Usuario", "Acción", "Módulo", "Descripción"]],
    body: o.eventos.map((e) => [
      fmtFecha(e.fecha),
      fmtHora(e.fecha),
      limpiarPdf(e.usuario),
      accionTexto(e.accion),
      limpiarPdf(tablaTexto(e.tabla)),
      limpiarPdf(descripcionEvento(e)),
    ]),
    margin: { left: mx, right: mx, top: 40, bottom: 40 },
    theme: "plain",
    styles: { font: "helvetica", fontSize: 7.5, textColor: GRIS, cellPadding: 4.5, overflow: "linebreak" },
    headStyles: { fillColor: VERDE, textColor: 255, fontStyle: "bold", fontSize: 8 },
    alternateRowStyles: { fillColor: [245, 245, 245] },
    columnStyles: {
      0: { cellWidth: 55 }, 1: { cellWidth: 45 }, 2: { cellWidth: 90 }, 3: { cellWidth: 70 }, 4: { cellWidth: 85 },
    },
  });

  const total = doc.getNumberOfPages();
  const generado = limpiarPdf(textoGenerado());
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "bold").setFontSize(7.5).setTextColor(150, 150, 150);
    doc.text(generado, W / 2, H - 22, { align: "center" });
    doc.text(`Pág. ${p}/${total}`, W - mx - 5, H - 22, { align: "right" });
  }
  descargarBlob(doc.output("blob"), `auditoria_${sufijoArchivo(o.desde, o.hasta)}.pdf`);
}
