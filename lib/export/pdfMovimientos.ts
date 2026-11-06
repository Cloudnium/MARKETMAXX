import type { MovimientoAlmacen } from "@/lib/types";
import { operacionLabel } from "@/lib/data/almacen";
import { fmtFecha, fmtHora, sufijoArchivo } from "@/lib/fechas";
import { descargarBlob, fmtCantidad, fmtConSigno, limpiarPdf, textoGenerado } from "./comun";

const tipoTexto: Record<string, string> = {
  entrada: "Entrada",
  salida: "Salida",
  traspaso: "Traspaso",
  ajuste: "Ajuste",
};

export interface OpcionesPdfMovimientos {
  /** Negocio = sede (o "Todas las sedes"). */
  negocio: string;
  filas: MovimientoAlmacen[];
  desde: string;
  hasta: string;
  /** Agrega la columna Sede (vista de todas las sedes). */
  mostrarSede: boolean;
  /** Descripción de los filtros activos (tipo, búsqueda...), si hay. */
  filtros?: string;
}

const ROSA: [number, number, number] = [236, 72, 153];
const ROSA_CLARO: [number, number, number] = [249, 168, 212];
const VERDE: [number, number, number] = [16, 185, 129];
const GRIS_TEXTO: [number, number, number] = [80, 80, 80];
const ROJO: [number, number, number] = [220, 38, 38];
const VERDE_TEXTO: [number, number, number] = [5, 150, 105];

/** Totales de unidades que entraron y salieron en la lista. */
export function totalesMovimientos(filas: { cantidad: number }[]) {
  let ingresadas = 0;
  let salidas = 0;
  for (const f of filas) {
    if (f.cantidad > 0) ingresadas += f.cantidad;
    else salidas += f.cantidad;
  }
  return { ingresadas, salidas };
}

/** Historial de movimientos de PRODUCTOS en PDF (A4 horizontal, como el modelo). */
export async function pdfMovimientosProductos(o: OpcionesPdfMovimientos) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const mx = 28.35;
  const ancho = W - mx * 2;
  const hoy = new Date().toISOString();

  // ---- Cabecera ------------------------------------------------------
  doc.setFillColor(...ROSA).rect(mx, 34, ancho, 31.2, "F");
  doc.setTextColor(255, 255, 255).setFont("helvetica", "bold").setFontSize(13);
  doc.text(limpiarPdf(o.negocio.toUpperCase()), mx + 14.7, 54);
  doc.setFontSize(10).text(fmtFecha(hoy), W - mx - 14.5, 54, { align: "right" });

  doc.setFillColor(...ROSA_CLARO).rect(mx, 73.7, ancho, 25.5, "F");
  doc.setTextColor(0, 0, 0).setFontSize(11);
  doc.text("HISTORIAL DE MOVIMIENTOS DE PRODUCTOS", W / 2, 90, { align: "center" });

  // ---- Resumen (cuadro de 2 columnas) --------------------------------
  const { ingresadas, salidas } = totalesMovimientos(o.filas);
  const filasResumen: [string, string, string, string][] = [
    ["Rango de fechas", `${o.desde} al ${o.hasta}`, "Total Movimientos", String(o.filas.length)],
    ["Unidades Ingresadas", `+${fmtCantidad(ingresadas)}`, "Unidades Salidas", `-${fmtCantidad(Math.abs(salidas))}`],
  ];
  const cw = [127.6, 255.1, 127.6, 141.7];
  const alto = 27.3;
  let y = 110.6;
  doc.setDrawColor(199, 199, 199).setLineWidth(0.28);
  for (const fila of filasResumen) {
    let x = mx;
    fila.forEach((txt, i) => {
      doc.setFillColor(255, 255, 255).rect(x, y, cw[i], alto, "FD");
      doc.setTextColor(...GRIS_TEXTO).setFont("helvetica", i % 2 === 0 ? "bold" : "normal").setFontSize(9);
      doc.text(limpiarPdf(txt), x + 8.5, y + alto / 2 + 3);
      x += cw[i];
    });
    y += alto;
  }
  if (o.filtros) {
    doc.setFillColor(255, 255, 255).rect(mx, y, cw.reduce((a, b) => a + b, 0), alto, "FD");
    doc.setTextColor(...GRIS_TEXTO).setFont("helvetica", "bold").setFontSize(9).text("Filtros", mx + 8.5, y + alto / 2 + 3);
    doc.setFont("helvetica", "normal").text(limpiarPdf(o.filtros), mx + cw[0] + 8.5, y + alto / 2 + 3);
    y += alto;
  }

  // ---- Banda "DETALLE" -------------------------------------------------
  y += 28.3;
  doc.setFillColor(...VERDE).rect(mx, y, ancho, 25.5, "F");
  doc.setTextColor(255, 255, 255).setFont("helvetica", "bold").setFontSize(11);
  doc.text(`DETALLE DE MOVIMIENTOS (${o.filas.length} registros)`, W / 2, y + 16.5, { align: "center" });
  y += 34;

  // ---- Tabla -------------------------------------------------------------
  const base = o.mostrarSede
    ? { fecha: 68.1, hora: 51, producto: 145, categoria: 85, sede: 70, tipo: 52, motivo: 95, cant: 51, stock: 90.7, usuario: 68.1 }
    : { fecha: 68.1, hora: 51, producto: 175.7, categoria: 90.8, tipo: 56.7, motivo: 119, cant: 51, stock: 90.7, usuario: 68.1 };
  const suma = Object.values(base).reduce((a, b) => a + b, 0);
  const k = ancho / suma;
  const col = (n: keyof typeof base) => ({ cellWidth: (base as Record<string, number>)[n] * k });

  const cabecera = ["Fecha", "Hora", "Producto", "Categoría", ...(o.mostrarSede ? ["Sede"] : []), "Tipo", "Motivo", "Cant.", "Stock", "Usuario"];
  const cuerpo = o.filas.map((m) => [
    fmtFecha(m.fecha),
    fmtHora(m.fecha),
    limpiarPdf(m.producto),
    limpiarPdf(m.categoria ?? ""),
    ...(o.mostrarSede ? [limpiarPdf(m.sedeNombre ?? "")] : []),
    tipoTexto[m.tipo] ?? m.tipo,
    limpiarPdf(motivoTexto(m)),
    fmtConSigno(m.cantidad),
    `${fmtCantidad(m.stockAntes)} > ${fmtCantidad(m.stockDespues)}`,
    limpiarPdf(m.usuario),
  ]);
  const idxCant = cabecera.indexOf("Cant.");
  const idxStock = cabecera.indexOf("Stock");

  const estilosCol: Record<number, object> = {};
  const nombres = Object.keys(base) as (keyof typeof base)[];
  nombres.forEach((n, i) => (estilosCol[i] = col(n)));
  estilosCol[idxCant] = { ...estilosCol[idxCant], halign: "right" };
  estilosCol[idxStock] = { ...estilosCol[idxStock], halign: "center" };

  autoTable(doc, {
    startY: y,
    head: [cabecera],
    body: cuerpo,
    margin: { left: mx, right: mx, top: 40, bottom: 40 },
    theme: "plain",
    styles: { font: "helvetica", fontSize: 7.5, textColor: GRIS_TEXTO, cellPadding: { top: 5.3, bottom: 5.3, left: 4.7, right: 4.7 }, overflow: "linebreak" },
    headStyles: { fillColor: VERDE, textColor: 255, fontStyle: "bold", fontSize: 8, halign: "left", cellPadding: { top: 5.7, bottom: 5.7, left: 4.7, right: 4.7 } },
    alternateRowStyles: { fillColor: [245, 245, 245] },
    columnStyles: estilosCol,
    didParseCell: (d) => {
      if (d.section === "body" && d.column.index === idxCant) {
        const txt = String(d.cell.raw);
        d.cell.styles.fontStyle = "bold";
        d.cell.styles.textColor = txt.startsWith("-") ? ROJO : VERDE_TEXTO;
      }
      if (d.section === "head" && d.column.index === idxStock) d.cell.styles.halign = "left";
    },
  });

  // ---- Pie ---------------------------------------------------------------
  const total = doc.getNumberOfPages();
  const generado = textoGenerado();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "bold").setFontSize(7.5).setTextColor(150, 150, 150);
    doc.text(limpiarPdf(generado), W / 2, H - 22, { align: "center" });
    doc.text(`Pág. ${p}/${total}`, W - mx - 5, H - 22, { align: "right" });
  }

  descargarBlob(doc.output("blob"), `movimientos_stock_${sufijoArchivo(o.desde, o.hasta)}.pdf`);
}

/** Texto de la columna "Motivo": la operación y, si la hay, la nota. */
export function motivoTexto(m: MovimientoAlmacen) {
  const op = operacionLabel[m.operacion] ?? m.operacion;
  return m.nota && !["venta", "compra"].includes(m.operacion) ? `${op}: ${m.nota}` : op;
}
