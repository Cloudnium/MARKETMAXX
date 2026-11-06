import type { TipoComprobante } from "@/lib/types";

export type TicketElement =
  | {
      type: "text";
      value: string;
      align?: "left" | "center" | "right";
      bold?: boolean;
      underline?: boolean;
      size?: "normal" | "double" | "quad";
    }
  | { type: "line" }
  | { type: "feed"; lines?: number }
  | { type: "cut" }
  | { type: "qr"; value: string; size?: number }
  | { type: "barcode"; value: string; width?: number; height?: number }
  | { type: "image"; base64: string }
  | { type: "cashdraw" };

export interface TicketItem {
  nombre: string;
  cantidad: number;
  precio: number;
}

export interface TicketSede {
  nombre: string;
  direccion?: string;
  telefono?: string;
  ciudad?: string;
}

export interface TicketData {
  numero: string;
  tipo: TipoComprobante;
  fecha: string | Date;
  cliente: string;
  documento: string;
  caja: string;
  vendedor?: string;
  metodoPago: string;
  descuentoPct?: number;
  total: number;
  sede: TicketSede;
  items: TicketItem[];
  /** Venta hecha sin conexión: el número es provisional y se canjea por el real al sincronizar. */
  provisional?: boolean;
}

const tipoLabel: Record<TipoComprobante, string> = {
  factura: "FACTURA",
  boleta: "BOLETA DE VENTA",
  nota_venta: "NOTA DE VENTA",
};

const numero = new Intl.NumberFormat("es-PE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function money(value: number) {
  return `S/ ${numero.format(Number(value) || 0)}`;
}

function fechaTicket(value: string | Date) {
  const fecha = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(fecha.getTime())) return "-";
  const dd = String(fecha.getDate()).padStart(2, "0");
  const mm = String(fecha.getMonth() + 1).padStart(2, "0");
  const yyyy = fecha.getFullYear();
  const hh = String(fecha.getHours()).padStart(2, "0");
  const min = String(fecha.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

function wrapText(value: string, width: number) {
  const texto = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!texto) return [""];

  const lineas: string[] = [];
  let actual = "";

  for (const palabra of texto.split(" ")) {
    const candidato = actual ? `${actual} ${palabra}` : palabra;
    if (candidato.length <= width) {
      actual = candidato;
      continue;
    }
    if (actual) lineas.push(actual);
    if (palabra.length > width) {
      let resto = palabra;
      while (resto.length > width) {
        lineas.push(resto.slice(0, width));
        resto = resto.slice(width);
      }
      actual = resto;
    } else {
      actual = palabra;
    }
  }

  if (actual || lineas.length === 0) lineas.push(actual);
  return lineas;
}

function texto(
  value: string,
  opciones: Omit<Extract<TicketElement, { type: "text" }>, "type" | "value"> = {}
): TicketElement[] {
  return [{ type: "text", value, ...opciones }];
}

function textoEnvuelto(
  value: string,
  width: number,
  opciones: Omit<Extract<TicketElement, { type: "text" }>, "type" | "value"> = {}
): TicketElement[] {
  return wrapText(value, width).map((linea) => ({ type: "text", value: linea, ...opciones }));
}

function fila(etiqueta: string, valor: string, width: number, bold = false) {
  const izquierda = etiqueta.slice(0, Math.max(1, width - valor.length - 1));
  const espacios = Math.max(1, width - izquierda.length - valor.length);
  return `${izquierda}${" ".repeat(espacios)}${valor}`;
}

export function construirTicket(
  data: TicketData,
  width = 48,
  opciones: { logoBase64?: string } = {}
): TicketElement[] {
  const ancho = width === 32 ? 32 : 48;
  const anchoDoble = Math.floor(ancho / 2);
  const elementos: TicketElement[] = [];

  if (opciones.logoBase64) {
    elementos.push({ type: "image", base64: opciones.logoBase64 });
  } else {
    elementos.push(
      ...textoEnvuelto(data.sede.nombre.toUpperCase(), anchoDoble, {
        align: "center",
        bold: true,
        size: "double",
      })
    );
  }
  if (data.sede.direccion) {
    elementos.push(...textoEnvuelto(data.sede.direccion, ancho, { align: "center" }));
  }
  if (data.sede.ciudad) {
    elementos.push(...textoEnvuelto(data.sede.ciudad, ancho, { align: "center" }));
  }
  if (data.sede.telefono) {
    elementos.push(...texto(`Tel: ${data.sede.telefono}`, { align: "center" }));
  }

  elementos.push({ type: "line" });
  elementos.push(
    ...texto(tipoLabel[data.tipo] ?? "COMPROBANTE", {
      align: "center",
      bold: true,
      underline: true,
    })
  );
  elementos.push(...textoEnvuelto(data.numero, anchoDoble, { align: "center", bold: true, size: "double" }));
  if (data.provisional) {
    elementos.push(...textoEnvuelto("TICKET PROVISIONAL (venta sin conexion)", ancho, { align: "center", bold: true }));
    elementos.push(...textoEnvuelto("Pide tu comprobante con numero oficial", ancho, { align: "center" }));
  }
  elementos.push({ type: "feed", lines: 1 });

  elementos.push(...texto(`Fecha: ${fechaTicket(data.fecha)}`));
  elementos.push(...textoEnvuelto(`Cliente: ${data.cliente || "Cliente Varios"}`, ancho));
  elementos.push(...textoEnvuelto(`Documento: ${data.documento || "-"}`, ancho));
  elementos.push(...textoEnvuelto(`Caja: ${data.caja || "-"}`, ancho));
  if (data.vendedor) {
    elementos.push(...textoEnvuelto(`Vendedor: ${data.vendedor}`, ancho));
  }

  elementos.push({ type: "line" });

  const anchoImporte = 10;
  const anchoCantidad = 3;
  const anchoNombre = Math.max(8, ancho - anchoCantidad - 1 - anchoImporte);

  elementos.push(
    ...texto(
      `${"CANT".padEnd(anchoCantidad + 1)}${"PRODUCTO".padEnd(anchoNombre)}${"IMPORTE".padStart(
        anchoImporte
      )}`,
      { bold: true }
    )
  );

  for (const item of data.items) {
    const nombreLineas = wrapText(item.nombre, anchoNombre);
    const importe = money(item.cantidad * item.precio);
    nombreLineas.forEach((linea, index) => {
      const prefijo =
        index === 0
          ? `${String(item.cantidad).slice(0, anchoCantidad).padEnd(anchoCantidad)} ${linea.padEnd(
              anchoNombre
            )}`
          : `${" ".repeat(anchoCantidad + 1)}${linea.padEnd(anchoNombre)}`;
      const valor = index === 0 ? `${prefijo}${importe.padStart(anchoImporte)}` : prefijo;
      elementos.push({ type: "text", value: valor });
    });
    if (item.cantidad > 1) {
      elementos.push({
        type: "text",
        value: `${" ".repeat(anchoCantidad + 1)}@ ${money(item.precio)} c/u`,
      });
    }
  }

  const bruto = data.items.reduce((total, item) => total + item.precio * item.cantidad, 0);
  const descuentoPct = Math.min(100, Math.max(0, data.descuentoPct ?? 0));
  const descuento = (bruto * descuentoPct) / 100;
  const total = Number(data.total) || 0;
  const subtotal = total / 1.18;
  const igv = total - subtotal;

  elementos.push({ type: "line" });
  if (data.tipo !== "nota_venta") {
    elementos.push(...texto(fila("Subtotal", money(subtotal), ancho)));
    elementos.push(...texto(fila("IGV (18%)", money(igv), ancho)));
  }
  if (descuentoPct > 0) {
    elementos.push(
      ...texto(fila(`Descuento (${descuentoPct}%)`, `- ${money(descuento)}`, ancho))
    );
  }
  elementos.push(...texto(fila("TOTAL", money(total), ancho), { bold: true }));
  elementos.push({ type: "feed", lines: 1 });
  elementos.push(...texto(`Pago: ${data.metodoPago || "-"}`));

  elementos.push({ type: "line" });
  elementos.push(...texto("Gracias por su compra", { align: "center", bold: true }));
  elementos.push({ type: "feed", lines: 3 });
  elementos.push({ type: "cut" });

  return elementos.map((elemento) =>
    elemento.type === "text" ? { ...elemento, bold: true } : elemento
  );
}
