/**
 * Preguntas y respuestas predeterminadas del Asistente Markit. Redactadas según los módulos, botones y reglas
 * reales del sistema (nombres exactos de menús y botones). El usuario NO escribe: elige una pregunta.
 */
export interface Respuesta {
  intro?: string;
  pasos?: string[];
  nota?: string;
}
export interface Pregunta {
  id: string;
  texto: string;
  respuesta: Respuesta;
}
export interface Categoria {
  id: string;
  nombre: string;
  preguntas: Pregunta[];
}

export const CATEGORIAS: Categoria[] = [
  {
    id: "caja",
    nombre: "Cajas",
    preguntas: [
      {
        id: "abrir-caja",
        texto: "¿Cómo abro mi caja?",
        respuesta: {
          pasos: [
            "Elige tu sede en la barra superior (no puede estar en «Todas las sedes»).",
            "Entra a Cajas en el menú lateral.",
            "Pulsa el botón verde «Abrir mi caja».",
            "El sistema te asigna solo el siguiente número de caja de la sede.",
            "Escribe el monto de apertura (S/) con el que empiezas y confirma.",
          ],
          nota: "Solo puedes tener una caja abierta a la vez. Sin caja abierta no se pueden registrar ventas.",
        },
      },
      {
        id: "cerrar-caja",
        texto: "¿Cómo cierro mi caja?",
        respuesta: {
          pasos: [
            "Entra a Cajas y busca la tarjeta de tu turno abierto.",
            "Pulsa el botón rojo «Cerrar caja».",
            "Revisa el resumen: Apertura, Ingresos por ventas, Egresos y Monto final.",
            "Si quieres ver la diferencia, escribe el efectivo contado (opcional) y añade observaciones.",
            "Confirma el cierre. Después puedes sacar el Ticket o Descargar el reporte del turno.",
          ],
        },
      },
      {
        id: "egreso-caja",
        texto: "¿Cómo registro un egreso desde mi caja?",
        respuesta: {
          pasos: [
            "En Cajas, en la tarjeta de tu turno abierto, pulsa «Ver detalle».",
            "En la sección Egresos pulsa «Registrar egreso».",
            "Escribe el Concepto (por ejemplo «Pago de movilidad») y el Monto (S/).",
            "Guarda. El egreso se resta del neto de la caja y sale en su reporte y ticket.",
          ],
          nota: "También puedes registrarlo en el módulo Egresos con la opción «Descontar de mi caja abierta».",
        },
      },
      {
        id: "ver-caja",
        texto: "¿Dónde veo lo que se vendió en mi turno?",
        respuesta: {
          pasos: [
            "Entra a Cajas y elige la fecha.",
            "En la tarjeta de la caja pulsa «Ver detalle» para ver ventas y egresos del turno.",
            "Abajo, la tabla «Movimientos» lista apertura, ventas y egresos con su método de pago.",
          ],
        },
      },
    ],
  },
  {
    id: "ventas",
    nombre: "Ventas",
    preguntas: [
      {
        id: "vender",
        texto: "¿Cómo registro una venta?",
        respuesta: {
          pasos: [
            "Abre tu caja (si aún no la tienes abierta) y entra a Ventas.",
            "Busca el producto por nombre o código, o escanéalo con el lector. Un clic lo agrega al carrito.",
            "En «Nueva Venta» revisa la Caja y el Cliente (por defecto «Cliente Varios»).",
            "Elige el Tipo de comprobante: Boleta, Factura o Nota de Venta.",
            "Elige el Método de pago (Efectivo, Yape, Tarjeta, Transferencia…).",
            "Pulsa «Registrar Venta». Se genera el comprobante y puedes imprimir el ticket.",
          ],
          nota: "El precio y el stock los valida el servidor al registrar: si otro cajero vendió la última unidad antes que tú, el sistema te avisa con «Stock insuficiente».",
        },
      },
      {
        id: "escanear",
        texto: "¿Cómo uso el lector de código de barras?",
        respuesta: {
          intro: "Con la pantalla de Ventas abierta, solo escanea el producto: se agrega solo al carrito. Cada escaneo repetido suma una unidad.",
          nota: "Si el código no existe, está inactivo o no tiene stock, el sistema te muestra un aviso con el código leído.",
        },
      },
      {
        id: "factura",
        texto: "¿Cómo emito una factura?",
        respuesta: {
          pasos: [
            "En Ventas, agrega los productos al carrito.",
            "En «Tipo de comprobante» elige Factura.",
            "Completa el RUC y la Razón social (son obligatorios), o elige un cliente ya registrado.",
            "Pulsa «Registrar Venta».",
          ],
        },
      },
      {
        id: "descuento",
        texto: "¿Cómo aplico un descuento?",
        respuesta: {
          intro: "En el panel «Nueva Venta» está el campo de descuento (%). Se aplica sobre el total antes de registrar.",
          nota: "Solo funciona si tu rol tiene permiso de descuentos; si está deshabilitado, pide a un administrador que lo active en Usuarios → Roles y permisos.",
        },
      },
      {
        id: "no-vende",
        texto: "No me deja vender, ¿qué reviso?",
        respuesta: {
          pasos: [
            "Que tengas una caja abierta en esta sede (módulo Cajas → «Abrir mi caja»).",
            "Que la sede de la barra superior sea una sede concreta, no «Todas las sedes».",
            "Que el producto esté activo y tenga stock disponible.",
            "Si es Factura, que hayas escrito RUC y Razón social.",
            "Que tu rol tenga el permiso de ventas (si no, pídelo al administrador).",
          ],
        },
      },
      {
        id: "sin-internet",
        texto: "¿Qué pasa si se cae el internet mientras vendo?",
        respuesta: {
          intro: "No tienes que hacer nada: el sistema se encarga solo.",
          pasos: [
            "Con internet, el sistema deja reservada en segundo plano una parte del stock para tu caja.",
            "Si se corta la conexión, arriba aparece «Sin conexión» y puedes seguir vendiendo lo reservado para tu caja.",
            "Cada venta se guarda en el equipo con un ticket provisional (OFF-…).",
            "Al volver el internet, las ventas se envían solas, una sola vez cada una, y reciben su número real.",
            "Lo que no se vendió de la reserva regresa automáticamente al stock.",
          ],
          nota: "Los demás módulos (productos, compras, etc.) solo permiten guardar cambios con internet.",
        },
      },
      {
        id: "indicador",
        texto: "¿Qué significa el indicador de la barra superior?",
        respuesta: {
          pasos: [
            "En línea (verde): todo conectado y sincronizado.",
            "Sin conexión (gris): puedes seguir vendiendo lo reservado; las ventas esperan para enviarse.",
            "Sincronizando (azul): se están enviando las ventas guardadas.",
            "Conflictos (rojo): una venta guardada no pudo registrarse (por ejemplo cambió el precio o ya no hay stock).",
          ],
          nota: "Pulsa el indicador para ver el detalle: reservas, ventas pendientes y tickets con su número real para reimprimir.",
        },
      },
      {
        id: "conflicto",
        texto: "Una venta quedó en «Conflictos», ¿qué hago?",
        respuesta: {
          intro: "La venta nunca se borra. Pulsa el indicador de la barra superior, busca la venta y elige:",
          pasos: [
            "Reintentar: la vuelve a enviar tal cual (útil si ya hay stock o la caja volvió a abrirse).",
            "Ajustar: cambia cantidades, acepta el precio actual o cambia de caja y la reenvía.",
            "Anular: la deja anulada en el dispositivo sin borrarla del historial.",
          ],
        },
      },
    ],
  },
  {
    id: "comprobantes",
    nombre: "Comprobantes",
    preguntas: [
      {
        id: "buscar-comprobante",
        texto: "¿Cómo busco un comprobante?",
        respuesta: {
          pasos: [
            "Entra a Comprobantes.",
            "Escribe el número, cliente o documento en el buscador.",
            "Filtra por tipo (Boleta, Factura, Nota de Venta) o por estado (completado, anulado, pendiente).",
            "Abre el comprobante para ver su vista previa.",
          ],
        },
      },
      {
        id: "anular",
        texto: "¿Cómo anulo una venta?",
        respuesta: {
          pasos: [
            "Entra a Comprobantes y abre la venta.",
            "Pulsa «Anular venta».",
            "Escribe el motivo (es obligatorio) y confirma.",
          ],
          nota: "Al anular, el stock vuelve al inventario y queda registrado quién anuló y por qué.",
        },
      },
      {
        id: "cambiar-pago",
        texto: "¿Cómo cambio el tipo de pago de una venta?",
        respuesta: {
          pasos: [
            "Entra a Comprobantes y abre la venta.",
            "Elige «Cambiar tipo de pago».",
            "Selecciona el nuevo método (por ejemplo de Efectivo a Yape) y confirma.",
          ],
          nota: "Los reportes y el cuadre de caja se actualizan con el nuevo método.",
        },
      },
      {
        id: "reimprimir",
        texto: "¿Cómo reimprimo un ticket?",
        respuesta: {
          pasos: [
            "Entra a Comprobantes, abre la venta y pulsa «Imprimir».",
            "Si la venta se hizo sin internet, también puedes reimprimirla desde el indicador de la barra superior, ya con su número real.",
          ],
          nota: "Necesitas tener vinculado el agente de impresión (módulo Impresión).",
        },
      },
    ],
  },
  {
    id: "inventario",
    nombre: "Productos y almacén",
    preguntas: [
      {
        id: "nuevo-producto",
        texto: "¿Cómo agrego un producto nuevo?",
        respuesta: {
          pasos: [
            "Elige una sede concreta en la barra superior.",
            "Entra a Productos y pulsa «Nuevo Producto».",
            "Completa nombre, código, categoría, precio y el stock inicial.",
            "Guarda. El producto queda disponible en esa sede.",
          ],
          nota: "Cada sede maneja su propio catálogo y stock.",
        },
      },
      {
        id: "stock",
        texto: "¿Cómo sumo o resto stock de un producto?",
        respuesta: {
          pasos: [
            "En Productos, edita el producto.",
            "En «Agregar / restar stock» escribe la cantidad (positiva para sumar, negativa para restar).",
            "Al restar, el motivo es obligatorio (merma, conteo, vencido…).",
            "Guarda: el cambio queda en el historial con tu nombre, fecha y stock antes/después.",
          ],
        },
      },
      {
        id: "traslado",
        texto: "¿Cómo paso productos del almacén a la tienda?",
        respuesta: {
          pasos: [
            "Entra a Almacén.",
            "Pulsa «Tienda ⇄ Almacén».",
            "Elige el sentido del traslado, los productos y las cantidades.",
            "Agrega un motivo (opcional) y confirma.",
          ],
          nota: "Cada traslado queda en «Historial de traslados».",
        },
      },
      {
        id: "otra-sede",
        texto: "¿Cómo envío mercadería a otra sede?",
        respuesta: {
          pasos: [
            "En Almacén pulsa «Enviar a otra sede».",
            "Elige la Sede destino, los productos y las cantidades.",
            "Confirma. El stock sale de esta sede y entra en la de destino.",
          ],
        },
      },
      {
        id: "ajuste-almacen",
        texto: "¿Cómo corrijo el stock del almacén?",
        respuesta: {
          pasos: [
            "En Almacén ubica el producto y pulsa «Ajustar».",
            "Escribe el nuevo stock y el motivo (obligatorio).",
            "Confirma: el ajuste se guarda en el historial.",
          ],
        },
      },
      {
        id: "desactivar",
        texto: "¿Cómo desactivo un producto?",
        respuesta: {
          intro: "En Productos usa la acción de activar/desactivar del producto. Un producto inactivo no aparece en Ventas, pero conserva su historial.",
        },
      },
    ],
  },
  {
    id: "egresos",
    nombre: "Egresos y compras",
    preguntas: [
      {
        id: "egreso",
        texto: "¿Cómo registro un egreso (gasto)?",
        respuesta: {
          pasos: [
            "Entra a Egresos (con una sede concreta elegida).",
            "Pulsa «Registrar Egreso».",
            "Completa el comprobante de pago (o «Sin documento»), el proveedor, el importe y una descripción.",
            "Opcional: sube la foto del comprobante.",
            "Deja marcada «Descontar de mi caja abierta» si el dinero salió de tu caja.",
          ],
        },
      },
      {
        id: "editar-egreso",
        texto: "¿Cómo edito un egreso?",
        respuesta: {
          pasos: [
            "En Egresos busca el egreso.",
            "Pulsa el lápiz «Editar egreso» de su fila.",
            "Cambia lo necesario y pulsa «Guardar cambios».",
          ],
          nota: "Los egresos que vienen de una compra se editan desde la compra.",
        },
      },
      {
        id: "compra",
        texto: "¿Cómo registro una compra de insumos?",
        respuesta: {
          pasos: [
            "En Egresos abre la pestaña «Compras de insumos».",
            "Pulsa «Registrar Compra».",
            "Completa el proveedor, el comprobante y los productos comprados con sus cantidades.",
            "Guarda. Las compras pueden estar Recibidas, Pendientes o Anuladas.",
          ],
        },
      },
    ],
  },
  {
    id: "gestion",
    nombre: "Clientes, usuarios y sedes",
    preguntas: [
      {
        id: "cliente",
        texto: "¿Cómo registro un cliente?",
        respuesta: {
          pasos: ["Entra a Clientes.", "Pulsa «Nuevo Cliente».", "Completa nombre, documento y datos de contacto, y guarda."],
          nota: "Luego lo eliges en «Cliente» al vender. Para ventas sin datos se usa «Cliente Varios».",
        },
      },
      {
        id: "usuario",
        texto: "¿Cómo creo un usuario?",
        respuesta: {
          pasos: [
            "Entra a Usuarios y pulsa «Nuevo Usuario».",
            "Completa nombre, correo, rol y las sedes a las que podrá acceder.",
            "Guarda. El usuario ya puede iniciar sesión.",
          ],
        },
      },
      {
        id: "roles",
        texto: "¿Cómo cambio lo que puede hacer un rol?",
        respuesta: {
          pasos: [
            "En Usuarios abre «Roles y permisos».",
            "Elige el rol y marca o desmarca sus permisos (ventas, descuentos, caja, almacén…).",
            "Guarda. El sistema hace respetar estas reglas en el servidor.",
          ],
        },
      },
      {
        id: "cambiar-sede",
        texto: "¿Cómo cambio de sede?",
        respuesta: {
          intro: "Usa el selector de sede de la barra superior (junto al ícono de ubicación). Ventas, caja, productos y stock se muestran según la sede elegida.",
          nota: "Para operar (vender, abrir caja, registrar egresos) debes estar en una sede concreta; «Todas las sedes» solo sirve para consultar.",
        },
      },
      {
        id: "nueva-sede",
        texto: "¿Cómo creo una sede nueva?",
        respuesta: { pasos: ["Entra a Sedes.", "Crea la sede con nombre, código, dirección, teléfono y ciudad.", "Guarda y asigna usuarios a esa sede desde Usuarios."] },
      },
    ],
  },
  {
    id: "herramientas",
    nombre: "Reportes, backup e impresión",
    preguntas: [
      {
        id: "reporte",
        texto: "¿Cómo saco un reporte?",
        respuesta: {
          pasos: [
            "Entra a Reportes.",
            "En «Filtros del reporte» elige el Tipo de reporte (Ventas o Egresos), las fechas y, si quieres, sede, categoría o comprobante.",
            "Revisa las tarjetas y el detalle.",
            "Exporta con los botones Excel o PDF.",
          ],
        },
      },
      {
        id: "backup",
        texto: "¿Cómo hago una copia de seguridad?",
        respuesta: {
          pasos: ["Entra a Backup.", "En «Descargar Backup» pulsa el botón para generar la copia completa.", "Guarda el archivo (.json.gz) en un lugar seguro."],
          nota: "Restaurar solo lo puede hacer un Administrador y exige escribir RESTAURAR para confirmar.",
        },
      },
      {
        id: "impresora",
        texto: "¿Cómo configuro la impresora de tickets?",
        respuesta: {
          pasos: [
            "Instala el agente de impresión en la PC de caja con instalar.exe.",
            "Abre el panel local del agente y copia el token.",
            "En Impresión pega el token y pulsa «Vincular agente» (solo una vez por PC).",
            "Elige la impresora predeterminada y envía un ticket de prueba.",
          ],
        },
      },
      {
        id: "dashboard",
        texto: "¿Qué veo en el Dashboard?",
        respuesta: {
          intro: "Un resumen del negocio de la sede activa: métricas del día, gráficos de ventas, «Ventas Recientes» (con «Ver detalle») y «Alertas de Stock» con los productos por debajo del mínimo.",
        },
      },
      {
        id: "salir",
        texto: "¿Cómo cierro sesión?",
        respuesta: { intro: "Pulsa «Salir» en la esquina superior derecha. Antes, cierra tu caja si terminaste tu turno." },
      },
    ],
  },
];
