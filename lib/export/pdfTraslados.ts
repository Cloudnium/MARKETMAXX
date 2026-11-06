import type { MovimientoBodega } from "@/lib/types";
import { fmtFecha, fmtFechaLarga, fmtHora, fmtIsoCorta, sufijoArchivo } from "@/lib/fechas";
import { descargarBlob, fmtCantidad, fmtConSigno, limpiarPdf, textoGenerado } from "./comun";

export interface OpcionesPdfTraslados {
  /** Negocio = sede (o "Todas las sedes"). */
  negocio: string;
  ruc?: string;
  razonSocial?: string;
  direccion?: string;
  filas: MovimientoBodega[];
  desde: string;
  hasta: string;
  mostrarSede: boolean;
}

const sinTildes = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Tipo como se imprime en el PDF ("Almacen > Tienda"). */
export const tipoTrasladoPdf = (m: MovimientoBodega) => sinTildes(m.traslado);

/** Los ajustes muestran signo; los traslados solo la cantidad movida. */
export const cantidadTraslado = (m: MovimientoBodega) => {
  const esTraslado = ["a_tienda", "desde_tienda", "envio_sede", "recepcion_sede"].includes(m.operacion);
  return esTraslado ? fmtCantidad(Math.abs(m.cantidad)) : fmtConSigno(m.cantidad);
};

/** Motivo general según lo que contiene la lista. */
export function motivoGeneral(filas: MovimientoBodega[]) {
  const tienda = filas.some((f) => f.operacion === "a_tienda" || f.operacion === "desde_tienda");
  const sedes = filas.some((f) => f.operacion === "envio_sede" || f.operacion === "recepcion_sede");
  if (tienda && sedes) return "TRASLADO ENTRE TIENDA, ALMACEN Y SEDES";
  if (sedes) return "TRASLADO ENTRE SEDES";
  return "TRASLADO ENTRE TIENDA Y ALMACEN";
}

/** Historial de traslados del ALMACÉN en PDF (A4 vertical, como el modelo). */
export async function pdfTrasladosAlmacen(o: OpcionesPdfTraslados) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const x0 = 39.7;
  const x1 = W - 39.7;
  const cx = W / 2;
  const negocio = limpiarPdf(sinTildes(o.negocio.toUpperCase()));
  const sedesEnvolucradas = o.filas.some((f) => f.operacion === "envio_sede" || f.operacion === "recepcion_sede");

  const linea = (y: number, grosor: number) => {
    doc.setDrawColor(0, 0, 0).setLineWidth(grosor).line(x0, y, x1, y);
  };
  const etiqueta = (txt: string, x: number, y: number) => {
    doc.setFont("helvetica", "bold").setFontSize(8).setTextColor(0, 0, 0).text(txt, x, y);
  };
  const valor = (txt: string, x: number, y: number, size = 8) => {
    doc.setFont("helvetica", "normal").setFontSize(size).setTextColor(0, 0, 0).text(limpiarPdf(sinTildes(txt)), x, y);
  };
  const titulo = (txt: string, y: number) => {
    doc.setFont("helvetica", "bold").setFontSize(8.5).setTextColor(0, 0, 0).text(txt, cx, y, { align: "center" });
  };

  // ---- Encabezado ---------------------------------------------------------
  doc.setFont("helvetica", "bold").setFontSize(13).setTextColor(0, 0, 0).text(negocio, x0, 37);
  if (o.ruc) valor(`RUC ${o.ruc}`, x0, 49, 8.5);

  doc.setDrawColor(0, 0, 0).setLineWidth(1.7).rect(362.8, 25.5, x1 - 362.8, 45.4);
  doc.setFont("helvetica", "bold").setFontSize(10).text("TRASLADO INTERNO", (362.8 + x1) / 2, 43, { align: "center" });
  const ultimo = o.filas.reduce((m, f) => Math.max(m, f.numero), 0);
  doc.setFontSize(9).text(`N°${String(ultimo).padStart(8, "0")}`, (362.8 + x1) / 2, 59, { align: "center" });

  // ---- Datos del traslado --------------------------------------------------
  linea(82.2, 1.42);
  titulo("DATOS DEL TRASLADO", 97);
  linea(106.3, 0.85);
  etiqueta("FECHA EMISION:", x0, 118);
  valor(fmtFecha(new Date().toISOString()), 136, 118);
  etiqueta("MOTIVO DEL TRASLADO:", 306, 118);
  valor(motivoGeneral(o.filas), 420, 118, 7.5);
  linea(131.8, 0.85);

  titulo("DATOS DEL DESTINATARIO:", 147);
  linea(155.9, 0.85);
  etiqueta("SENOR (ES):", x0, 168);
  valor(o.razonSocial?.trim() || o.negocio, 136, 168);
  etiqueta("IDENTIFICACION:", x0, 182);
  valor(o.ruc ?? "-", 136, 182);
  linea(195.6, 0.85);

  titulo("DATOS DEL PUNTO DE PARTIDA Y PUNTO DE LLEGADA", 210);
  linea(219.7, 0.85);
  etiqueta("DIRECCION DE PARTIDA:", x0, 231);
  etiqueta("SUCURSAL ORIGEN:", x0, 244);
  valor("ALMACEN / TIENDA", 159, 244);
  etiqueta("DIRECCION DE LLEGADA:", x0, 257);
  valor(o.direccion?.trim() || "-", 159, 257);
  etiqueta("SUCURSAL DESTINO:", x0, 270);
  valor(sedesEnvolucradas ? "TIENDA / ALMACEN / OTRAS SEDES" : "TIENDA / ALMACEN", 159, 270);
  linea(283.5, 1.42);

  // ---- Historial ---------------------------------------------------------------
  doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(0, 0, 0).text("HISTORIAL DE TRASLADOS", cx, 300, { align: "center" });
  const periodo = o.desde === o.hasta ? `Fecha: ${fmtIsoCorta(o.desde)}` : `Del ${fmtIsoCorta(o.desde)} al ${fmtIsoCorta(o.hasta)}`;
  doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(100, 100, 100)
    .text(`${periodo}  -  Total de movimientos: ${o.filas.length}`, cx, 311.5, { align: "center" });

  const base = o.mostrarSede
    ? [48, 125, 62, 78, 64, 82, 56.9]
    : [56.7, 150, 80, 100, 68, 61.2];
  const total = base.reduce((a, b) => a + b, 0);
  const k = (x1 - x0) / total;
  const cab = ["CANTIDAD", "DESCRIPCION", "CATEGORIA", ...(o.mostrarSede ? ["SEDE"] : []), "TIPO", "FECHA", "HORA"];
  const cuerpo = o.filas.map((m) => [
    cantidadTraslado(m),
    limpiarPdf(sinTildes(m.producto)),
    limpiarPdf(sinTildes(m.categoria)),
    ...(o.mostrarSede ? [limpiarPdf(sinTildes(m.sedeNombre ?? ""))] : []),
    limpiarPdf(tipoTrasladoPdf(m)),
    fmtFechaLarga(m.fecha),
    fmtHora(m.fecha),
  ]);
  const colEstilos: Record<number, object> = {};
  base.forEach((w, i) => (colEstilos[i] = { cellWidth: w * k, halign: "center" }));

  autoTable(doc, {
    startY: 326,
    head: [cab],
    body: cuerpo,
    margin: { left: x0, right: W - x1, top: 40, bottom: 48 },
    theme: "grid",
    styles: { font: "helvetica", fontSize: 7.5, textColor: 0, lineColor: [150, 150, 150], lineWidth: 0.57, cellPadding: { top: 9, bottom: 9, left: 4, right: 4 }, valign: "middle", halign: "center", overflow: "linebreak" },
    headStyles: { fillColor: 255, textColor: 0, fontStyle: "bold", fontSize: 7.5, lineColor: [0, 0, 0], lineWidth: 0.85, cellPadding: { top: 6, bottom: 6, left: 4, right: 4 } },
    columnStyles: colEstilos,
    didParseCell: (d) => {
      if (d.section === "body" && d.column.index === 0) d.cell.styles.fontStyle = "bold";
    },
  });

  // ---- Pie -----------------------------------------------------------------------
  const paginas = doc.getNumberOfPages();
  const generado = limpiarPdf(textoGenerado());
  for (let p = 1; p <= paginas; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal").setFontSize(6.5).setTextColor(130, 130, 130);
    doc.text(generado, x0, H - 38);
    doc.text(negocio, cx, H - 38, { align: "center" });
    doc.text(`Pag. ${p}/${paginas}`, x1, H - 38, { align: "right" });
  }
  doc.setPage(paginas);
  doc.setFont("helvetica", "bold").setFontSize(7.5).setTextColor(0, 0, 0).text("GRACIAS POR SU VISITA", cx, H - 22, { align: "center" });
  doc.setFont("helvetica", "normal").setFontSize(6).setTextColor(130, 130, 130).text("Sistema de gestion Market Maxx", cx, H - 12, { align: "center" });

  descargarBlob(doc.output("blob"), `historial_traslados_${sufijoArchivo(o.desde, o.hasta)}.pdf`);
}
