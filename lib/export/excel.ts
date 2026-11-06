import type { MovimientoAlmacen, MovimientoBodega } from "@/lib/types";
import { fmtHora, sufijoArchivo } from "@/lib/fechas";
import { descargarBlob, fechaHoraLima } from "./comun";
import { motivoTexto, totalesMovimientos } from "./pdfMovimientos";
import { motivoGeneral } from "./pdfTraslados";

type Color = string; // ARGB

const ROSA: Color = "FFEC4899";
const ROSA_CLARO: Color = "FFF9A8D4";
const VERDE: Color = "FF10B981";
const GRIS: Color = "FFF5F5F5";
const NEGRO: Color = "FF111827";
const ROJO: Color = "FFDC2626";
const VERDE_TXT: Color = "FF059669";

const tipoTexto: Record<string, string> = { entrada: "Entrada", salida: "Salida", traspaso: "Traspaso", ajuste: "Ajuste" };

const borde = { style: "thin" as const, color: { argb: "FFD1D5DB" } };
const bordes = { top: borde, left: borde, bottom: borde, right: borde };

async function nuevoLibro() {
  const ExcelJS = (await import("exceljs")).default;
  return new ExcelJS.Workbook();
}

type Hoja = import("exceljs").Worksheet;

function banda(hoja: Hoja, fila: number, texto: string, color: Color, ncols: number, txt = "FFFFFFFF", size = 13) {
  hoja.mergeCells(fila, 1, fila, ncols);
  const c = hoja.getCell(fila, 1);
  c.value = texto;
  c.font = { bold: true, size, color: { argb: txt } };
  c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
  c.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  hoja.getRow(fila).height = 24;
}

function resumen(hoja: Hoja, fila: number, pares: [string, string | number][], ncols: number) {
  pares.forEach(([k, v], i) => {
    const r = fila + i;
    hoja.mergeCells(r, 2, r, ncols);
    const a = hoja.getCell(r, 1);
    const b = hoja.getCell(r, 2);
    a.value = k;
    a.font = { bold: true, color: { argb: "FF505050" } };
    b.value = v;
    b.alignment = { horizontal: "left" };
    a.border = bordes;
    b.border = bordes;
  });
}

async function guardar(libro: import("exceljs").Workbook, nombre: string) {
  const buf = await libro.xlsx.writeBuffer();
  descargarBlob(
    new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    nombre
  );
}

/** Historial de movimientos de PRODUCTOS en Excel. */
export async function excelMovimientosProductos(o: {
  negocio: string;
  filas: MovimientoAlmacen[];
  desde: string;
  hasta: string;
  mostrarSede: boolean;
  filtros?: string;
}) {
  const libro = await nuevoLibro();
  const hoja = libro.addWorksheet("Movimientos", { views: [{ state: "frozen", ySplit: 0 }] });
  const cab = ["Fecha", "Hora", "Producto", "Código", "Categoría", ...(o.mostrarSede ? ["Sede"] : []), "Tipo", "Motivo", "Cantidad", "Stock antes", "Stock después", "Referencia", "Usuario"];
  const n = cab.length;
  const { ingresadas, salidas } = totalesMovimientos(o.filas);

  banda(hoja, 1, o.negocio.toUpperCase(), ROSA, n);
  banda(hoja, 2, "HISTORIAL DE MOVIMIENTOS DE PRODUCTOS", ROSA_CLARO, n, "FF000000", 11);
  const pares: [string, string | number][] = [
    ["Rango de fechas", `${o.desde} al ${o.hasta}`],
    ["Total Movimientos", o.filas.length],
    ["Unidades Ingresadas", ingresadas],
    ["Unidades Salidas", salidas],
  ];
  if (o.filtros) pares.push(["Filtros", o.filtros]);
  resumen(hoja, 4, pares, n);

  const filaCab = 4 + pares.length + 1;
  banda(hoja, filaCab, `DETALLE DE MOVIMIENTOS (${o.filas.length} registros)`, VERDE, n, "FFFFFFFF", 11);
  const h = hoja.getRow(filaCab + 1);
  cab.forEach((t, i) => {
    const c = h.getCell(i + 1);
    c.value = t;
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: VERDE } };
    c.alignment = { horizontal: "left", vertical: "middle" };
  });
  h.height = 20;

  const idx = (name: string) => cab.indexOf(name) + 1;
  o.filas.forEach((m, i) => {
    const r = hoja.getRow(filaCab + 2 + i);
    const vals: (string | number | Date)[] = [
      fechaHoraLima(m.fecha),
      fmtHora(m.fecha),
      m.producto,
      m.codigo ?? "",
      m.categoria ?? "",
      ...(o.mostrarSede ? [m.sedeNombre ?? ""] : []),
      tipoTexto[m.tipo] ?? m.tipo,
      motivoTexto(m),
      m.cantidad,
      m.stockAntes,
      m.stockDespues,
      m.referencia,
      m.usuario,
    ];
    vals.forEach((v, j) => {
      const c = r.getCell(j + 1);
      c.value = v;
      c.border = bordes;
      if (i % 2 === 0) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRIS } };
    });
    r.getCell(1).numFmt = "dd/mm/yyyy";
    const cant = r.getCell(idx("Cantidad"));
    cant.numFmt = "+#,##0.###;-#,##0.###;0";
    cant.font = { bold: true, color: { argb: m.cantidad < 0 ? ROJO : VERDE_TXT } };
  });

  const anchos = [12, 12, 36, 14, 18, ...(o.mostrarSede ? [18] : []), 11, 34, 10, 11, 13, 16, 16];
  anchos.forEach((w, i) => (hoja.getColumn(i + 1).width = w));
  hoja.autoFilter = { from: { row: filaCab + 1, column: 1 }, to: { row: filaCab + 1 + o.filas.length, column: n } };
  hoja.views = [{ state: "frozen", ySplit: filaCab + 1 }];

  await guardar(libro, `movimientos_stock_${sufijoArchivo(o.desde, o.hasta)}.xlsx`);
}

/** Historial de traslados del ALMACÉN en Excel. */
export async function excelTrasladosAlmacen(o: {
  negocio: string;
  filas: MovimientoBodega[];
  desde: string;
  hasta: string;
  mostrarSede: boolean;
}) {
  const libro = await nuevoLibro();
  const hoja = libro.addWorksheet("Traslados");
  const cab = ["Cantidad", "Descripción", "Código", "Categoría", ...(o.mostrarSede ? ["Sede"] : []), "Tipo", "Fecha", "Hora", "Referencia", "Usuario", "Observación"];
  const n = cab.length;

  banda(hoja, 1, o.negocio.toUpperCase(), NEGRO, n);
  banda(hoja, 2, "HISTORIAL DE TRASLADOS", "FFE5E7EB", n, "FF000000", 11);
  resumen(
    hoja,
    4,
    [
      ["Rango de fechas", `${o.desde} al ${o.hasta}`],
      ["Total de movimientos", o.filas.length],
      ["Motivo del traslado", motivoGeneral(o.filas)],
    ],
    n
  );

  const filaCab = 8;
  const h = hoja.getRow(filaCab);
  cab.forEach((t, i) => {
    const c = h.getCell(i + 1);
    c.value = t;
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NEGRO } };
    c.alignment = { horizontal: "center", vertical: "middle" };
  });
  h.height = 20;

  o.filas.forEach((m, i) => {
    const r = hoja.getRow(filaCab + 1 + i);
    const esTraslado = ["a_tienda", "desde_tienda", "envio_sede", "recepcion_sede"].includes(m.operacion);
    const vals: (string | number | Date)[] = [
      esTraslado ? Math.abs(m.cantidad) : m.cantidad,
      m.producto,
      m.codigo,
      m.categoria,
      ...(o.mostrarSede ? [m.sedeNombre ?? ""] : []),
      m.traslado,
      fechaHoraLima(m.fecha),
      fmtHora(m.fecha),
      m.referencia,
      m.usuario,
      m.nota ?? "",
    ];
    vals.forEach((v, j) => {
      const c = r.getCell(j + 1);
      c.value = v;
      c.border = bordes;
      c.alignment = { horizontal: j === 1 || j === cab.length - 1 ? "left" : "center", vertical: "middle" };
      if (i % 2 === 1) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRIS } };
    });
    const q = r.getCell(1);
    q.font = { bold: true };
    q.numFmt = esTraslado ? "#,##0.###" : "+#,##0.###;-#,##0.###;0";
    r.getCell(cab.indexOf("Fecha") + 1).numFmt = "dd/mm/yyyy";
  });

  const anchos = [11, 38, 14, 18, ...(o.mostrarSede ? [18] : []), 24, 12, 12, 16, 16, 30];
  anchos.forEach((w, i) => (hoja.getColumn(i + 1).width = w));
  hoja.autoFilter = { from: { row: filaCab, column: 1 }, to: { row: filaCab + o.filas.length, column: n } };
  hoja.views = [{ state: "frozen", ySplit: filaCab }];

  await guardar(libro, `historial_traslados_${sufijoArchivo(o.desde, o.hasta)}.xlsx`);
}
