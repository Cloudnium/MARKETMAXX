import { descargarBlob, fmtCantidad, limpiarPdf, textoGenerado } from "./comun";
import { hoyLima, fmtIsoCorta } from "@/lib/fechas";

export interface FilaStock {
  producto: string;
  codigo: string;
  categoria: string;
  sede: string;
  almacen: number;
  tienda: number;
  total: number;
  minimo: number;
  estado: string;
  unidad: string;
  valorVenta: number;
}

export interface DatosStock {
  negocio: string;
  filas: FilaStock[];
  mostrarSede: boolean;
}

const soles = (n: number) => `S/ ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const nombre = (ext: string) => `stock_almacen_${hoyLima()}.${ext}`;

/** Stock del almacén (con tienda y total) en PDF A4 horizontal. */
export async function pdfStockAlmacen(d: DatosStock) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  doc.setFont("helvetica", "bold").setFontSize(16).setTextColor(17, 24, 39).text("STOCK DE ALMACEN", 36, 42);
  doc.setFont("helvetica", "normal").setFontSize(9.5).setTextColor(107, 114, 128)
    .text(`${limpiarPdf(d.negocio)}  |  Fecha: ${fmtIsoCorta(hoyLima())}  |  ${d.filas.length} productos`, 36, 58);

  const totA = d.filas.reduce((a, f) => a + f.almacen, 0);
  const totT = d.filas.reduce((a, f) => a + f.tienda, 0);
  const totV = d.filas.reduce((a, f) => a + f.valorVenta, 0);
  const cab = ["Producto", "Codigo", "Categoria", ...(d.mostrarSede ? ["Sede"] : []), "En almacen", "En tienda", "Total", "Minimo", "Estado", "Valor (venta)"];
  autoTable(doc, {
    startY: 72,
    margin: { left: 36, right: 36, bottom: 40 },
    head: [cab],
    body: d.filas.map((f) => [
      limpiarPdf(f.producto), f.codigo, limpiarPdf(f.categoria), ...(d.mostrarSede ? [limpiarPdf(f.sede)] : []),
      fmtCantidad(f.almacen), fmtCantidad(f.tienda), fmtCantidad(f.total), fmtCantidad(f.minimo), f.estado, soles(f.valorVenta),
    ]),
    foot: [[{ content: "TOTAL", colSpan: d.mostrarSede ? 4 : 3 }, fmtCantidad(totA), fmtCantidad(totT), fmtCantidad(totA + totT), "", "", soles(totV)]],
    styles: { font: "helvetica", fontSize: 8, cellPadding: 3.5, lineColor: [229, 231, 235], lineWidth: 0.4 },
    headStyles: { fillColor: [31, 41, 55], textColor: 255, fontStyle: "bold" },
    footStyles: { fillColor: [243, 244, 246], textColor: [17, 24, 39], fontStyle: "bold" },
    alternateRowStyles: { fillColor: [249, 250, 251] },
    columnStyles: Object.fromEntries(
      [d.mostrarSede ? 4 : 3, d.mostrarSede ? 5 : 4, d.mostrarSede ? 6 : 5, d.mostrarSede ? 7 : 6, d.mostrarSede ? 9 : 8].map((i) => [i, { halign: "right" as const }])
    ),
    didParseCell: (h) => {
      if (h.section === "body" && h.column.index === (d.mostrarSede ? 8 : 7)) {
        const t = String(h.cell.raw);
        if (t === "Sin stock") h.cell.styles.textColor = [185, 28, 28];
        else if (t === "Stock bajo") h.cell.styles.textColor = [180, 83, 9];
      }
    },
  });
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(156, 163, 175);
    doc.text(textoGenerado(), 36, H - 20);
    doc.text(`Pagina ${i} de ${n}`, W - 36, H - 20, { align: "right" });
  }
  descargarBlob(doc.output("blob"), nombre("pdf"));
}

/** Stock del almacén en Excel. */
export async function excelStockAlmacen(d: DatosStock) {
  const ExcelJS = (await import("exceljs")).default;
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet("Stock almacén");
  const cab = ["Producto", "Código", "Categoría", ...(d.mostrarSede ? ["Sede"] : []), "En almacén", "En tienda", "Total", "Stock mínimo", "Estado", "Valor (venta)"];
  hoja.mergeCells(1, 1, 1, cab.length);
  const t = hoja.getCell(1, 1);
  t.value = `STOCK DE ALMACÉN · ${d.negocio} · ${fmtIsoCorta(hoyLima())}`;
  t.font = { bold: true, size: 14 };
  hoja.addRow([]);
  const h = hoja.addRow(cab);
  h.eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
    c.alignment = { horizontal: "center" };
  });
  for (const f of d.filas) {
    hoja.addRow([f.producto, f.codigo, f.categoria, ...(d.mostrarSede ? [f.sede] : []), f.almacen, f.tienda, f.total, f.minimo, f.estado, f.valorVenta]);
  }
  const ini = 4;
  const fin = 3 + d.filas.length;
  const ca = d.mostrarSede ? 5 : 4;
  const col = (i: number) => String.fromCharCode(64 + i);
  const tot = hoja.addRow([
    "TOTAL", ...Array(ca - 2).fill(""),
    { formula: `SUM(${col(ca)}${ini}:${col(ca)}${fin})` },
    { formula: `SUM(${col(ca + 1)}${ini}:${col(ca + 1)}${fin})` },
    { formula: `SUM(${col(ca + 2)}${ini}:${col(ca + 2)}${fin})` },
    "", "",
    { formula: `SUM(${col(ca + 5)}${ini}:${col(ca + 5)}${fin})` },
  ]);
  tot.font = { bold: true };
  hoja.getColumn(ca + 5).numFmt = '"S/" #,##0.00';
  hoja.columns.forEach((c, i) => (c.width = i === 0 ? 34 : 15));
  hoja.views = [{ state: "frozen", ySplit: 3 }];
  const buf = await libro.xlsx.writeBuffer();
  descargarBlob(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), nombre("xlsx"));
}
