"use client";

import { AlertTriangle, CheckCircle2, Loader2, MapPin, PackageX, WifiOff, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { Toast } from "@/components/ui/Toast";
import { ProductGrid } from "./ProductGrid";
import { VentaForm } from "./VentaForm";
import type { CartItem } from "./CartProduct";
import type { Producto } from "@/lib/types";
import { useAuth } from "@/components/shared/AuthProvider";
import { useSede } from "@/components/shared/SedeProvider";
import { useAsync } from "@/lib/hooks/useAsync";
import { useBarcodeScanner } from "@/lib/hooks/useBarcodeScanner";
import { listarCategorias, listarProductos } from "@/lib/data/productos";
import { listarClientes } from "@/lib/data/clientes";
import { listarCajas } from "@/lib/data/cajas";
import { listarMetodosPago } from "@/lib/data/ventas";
import { aplicarStockVivo } from "@/lib/data/stockVivo";
import { useStockVivo } from "@/lib/hooks/useStockVivo";
import { imprimirTicket, type TicketData } from "@/lib/impresion/agente";
import { formatCurrency } from "@/lib/utils";
import { useConexion } from "@/lib/net/useConexion";
import { useOffline } from "@/lib/offline/useOffline";
import { guardarSnapshot, leaseVigente, leerSnapshot, prepararDispositivo, registrarVentaSegura, restante, ticketDe } from "@/lib/offline/motor";
import type { Snapshot } from "@/lib/offline/tipos";

/** Compara códigos ignorando ceros iniciales (algunos lectores los omiten). */
function mismoCodigo(a: string, b: string) {
  const codigoA = a.trim().toLowerCase();
  const codigoB = b.trim().toLowerCase();
  if (codigoA === codigoB) return true;
  if (!/^\d+$/.test(codigoA) || !/^\d+$/.test(codigoB)) return false;
  const largo = Math.max(codigoA.length, codigoB.length);
  return codigoA.padStart(largo, "0") === codigoB.padStart(largo, "0");
}

export function VentasView() {
  const { perfil } = useAuth();
  const { sedeOperativa, sede } = useSede();
  const sedeUuid = sedeOperativa?.id ?? null;
  const [cart, setCart] = useState<CartItem[]>([]);
  const [success, setSuccess] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notificacion, setNotificacion] = useState<{
    mensaje: string;
    tono: "success" | "error" | "info";
  } | null>(null);
  const [avisoEscaneo, setAvisoEscaneo] = useState<{
    titulo: string;
    mensaje: string;
    codigo: string;
  } | null>(null);

  const productos = useAsync(() => (sedeUuid ? listarProductos(sedeUuid) : Promise.resolve([])), [sedeUuid], []);
  const categorias = useAsync(listarCategorias, [], []);
  const clientes = useAsync(listarClientes, [], []);
  const metodos = useAsync(listarMetodosPago, [], ["Efectivo"]);
  const cajas = useAsync(
    async () => (sedeUuid ? (await listarCajas(sedeUuid)).filter((c) => c.estado === "abierta") : []),
    [sedeUuid],
    []
  );

  // ---- Modo sin conexión: catálogo local + reserva de stock de esta caja ----
  const conexion = useConexion();
  const offline = conexion !== "online";
  const of = useOffline();
  const [snap, setSnap] = useState<Snapshot | null>(null);
  useEffect(() => {
    if (sedeUuid) void leerSnapshot(sedeUuid).then((s) => setSnap(s ?? null));
    void prepararDispositivo();
  }, [sedeUuid]);
  useEffect(() => {
    // con internet, se guarda una copia local del catálogo, precios y cajas abiertas para poder seguir vendiendo
    if (!sedeUuid || offline || !(productos.data ?? []).length || !(cajas.data ?? []).length) return;
    const dato = {
      sedeId: sedeUuid,
      productos: productos.data ?? [],
      cajas: cajas.data ?? [],
      metodos: metodos.data ?? ["Efectivo"],
      sede: { nombre: sede.nombre, direccion: sede.direccion, telefono: sede.telefono, ciudad: sede.ciudad },
      vendedor: perfil?.nombre,
    };
    void guardarSnapshot(dato).then(() => setSnap({ ...dato, guardado: Date.now() }));
  }, [sedeUuid, offline, productos.data, cajas.data, metodos.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const leaseSede = of.leases.find((l) => l.sedeId === sedeUuid && leaseVigente(l)) ?? null;
  const productosBase = (productos.data ?? []).length ? productos.data ?? [] : snap?.productos ?? [];
  // sin conexión solo se puede vender lo RESERVADO para esta caja (el stock real lo decide el servidor)
  // en línea: stock EN VIVO de la sede (lo que vende cualquier cajero ya se refleja aquí en pocos segundos)
  const stockVivo = useStockVivo(sedeUuid);
  const productosUso = offline
    ? productosBase.map((p) => ({ ...p, stock: leaseSede ? restante(leaseSede, p.id) : 0 }))
    : aplicarStockVivo(productosBase, stockVivo.vivo, (id) => (leaseSede ? restante(leaseSede, id) : 0));
  const cajasBase = (cajas.data ?? []).length ? cajas.data ?? [] : snap?.cajas ?? [];
  const cajasUso = offline && leaseSede ? cajasBase.filter((c) => c.id === leaseSede.cajaId) : cajasBase;
  const metodosUso = offline && snap ? snap.metodos : metodos.data ?? ["Efectivo"];

  // Al cambiar de sede el carrito deja de ser válido
  const [sedeCarrito, setSedeCarrito] = useState(sedeUuid);
  if (sedeCarrito !== sedeUuid) {
    setSedeCarrito(sedeUuid);
    setCart([]);
  }

  const enCarrito = useMemo(
    () => Object.fromEntries(cart.map((i) => [i.producto.id, i.cantidad])),
    [cart]
  );

  // el carrito se muestra con el stock EN VIVO (si otro cajero vendió, el "+" se bloquea y se avisa)
  const stockDe = useMemo(() => new Map(productosUso.map((p) => [p.id, p.stock])), [productosUso]);
  const cartVivo = useMemo(() => cart.map((i) => ({ ...i, producto: { ...i.producto, stock: stockDe.get(i.producto.id) ?? i.producto.stock } })), [cart, stockDe]);
  const faltantes = cartVivo.filter((i) => i.producto.stock !== undefined && i.cantidad > i.producto.stock);

  const addProduct = (producto: Producto) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.producto.id === producto.id);
      if (existing) {
        if (existing.cantidad >= producto.stock) return prev;
        return prev.map((item) =>
          item.producto.id === producto.id ? { ...item, cantidad: item.cantidad + 1 } : item
        );
      }
      return [
        ...prev,
        {
          producto: { id: producto.id, nombre: producto.nombre, precio: producto.precio, stock: producto.stock },
          cantidad: 1,
        },
      ];
    });
  };

  const escanear = (valor: string) => {
    const codigo = valor.trim();
    if (!codigo) return;

    if (productos.loading && (productos.data ?? []).length === 0) {
      setAvisoEscaneo({
        titulo: "Catálogo cargando",
        mensaje: "Espera un momento a que terminen de cargar los productos e intenta de nuevo.",
        codigo,
      });
      return;
    }

    const producto = productosUso.find((p) => mismoCodigo(p.codigo, codigo));

    if (!producto) {
      setAvisoEscaneo({
        titulo: "El producto no existe",
        mensaje: `No se encontró ningún producto con el código "${codigo}". Verifica que esté registrado en el módulo Productos.`,
        codigo,
      });
      return;
    }

    if (!producto.activo) {
      setAvisoEscaneo({
        titulo: "Producto inactivo",
        mensaje: `El producto "${producto.nombre}" está inactivo y no puede venderse.`,
        codigo,
      });
      return;
    }

    const enCarritoCantidad = cart.find((i) => i.producto.id === producto.id)?.cantidad ?? 0;
    if (enCarritoCantidad >= producto.stock) {
      setAvisoEscaneo({
        titulo: producto.stock <= 0 ? "Producto sin stock" : "Stock insuficiente",
        mensaje:
          producto.stock <= 0
            ? `El producto "${producto.nombre}" no tiene stock disponible en esta sede.`
            : `El producto "${producto.nombre}" solo tiene ${producto.stock} ${producto.unidad}(s) disponibles y ya están en el carrito.`,
        codigo,
      });
      return;
    }

    addProduct(producto);
  };

  useBarcodeScanner(escanear);

  const increase = (id: string) =>
    setCart((prev) =>
      prev.map((item) =>
        item.producto.id === id && item.cantidad < (item.producto.stock ?? Infinity)
          ? { ...item, cantidad: item.cantidad + 1 }
          : item
      )
    );

  const decrease = (id: string) =>
    setCart((prev) =>
      prev
        .map((item) => (item.producto.id === id ? { ...item, cantidad: item.cantidad - 1 } : item))
        .filter((item) => item.cantidad > 0)
    );

  const remove = (id: string) => setCart((prev) => prev.filter((item) => item.producto.id !== id));

  type DatosVenta = Parameters<React.ComponentProps<typeof VentaForm>["onConfirm"]>[0];

  const confirm = async (datos: DatosVenta) => {
    if (!sedeUuid) return;
    setEnviando(true);
    setError(null);
    try {
      // Una sola vía para vender con o sin internet: si la red se corta a mitad del envío la venta queda guardada en el
      // equipo con el MISMO identificador y se confirma sola al volver (el servidor no la duplica ni descuenta dos veces).
      const r = await registrarVentaSegura({
        sedeId: sedeUuid,
        cajaId: datos.cajaId,
        tipo: datos.tipo,
        metodo: datos.metodo,
        descuento: datos.descuento,
        clienteId: datos.clienteId,
        clienteNombre: datos.clienteNombre,
        clienteDocumento: datos.clienteDocumento,
        items: cart.map((i) => ({ productoId: i.producto.id, cantidad: i.cantidad })),
      });

      if (r.modo === "guardada") {
        const v = r.venta;
        setCart([]);
        setSuccess(
          r.motivo === "sin_conexion"
            ? `Venta ${v.provisional} guardada SIN CONEXIÓN por ${formatCurrency(v.total)}. Se enviará sola al reconectar.`
            : `Venta ${v.provisional} por ${formatCurrency(v.total)}: la conexión falló al enviarla. Quedó guardada y se confirmará sola (no se duplicará).`
        );
        setTimeout(() => setSuccess(null), 8000);
        void imprimirTicket(ticketDe(v)).then((res) =>
          setNotificacion({ mensaje: res.ok ? "Ticket provisional impreso." : "Venta guardada; ticket provisional no impreso.", tono: "info" })
        );
        return;
      }

      const ticket: TicketData = {
        numero: r.numero,
        tipo: datos.tipo,
        fecha: new Date(),
        cliente: datos.clienteNombre || "Cliente Varios",
        documento: datos.clienteDocumento || "-",
        caja: (cajas.data ?? []).find((c) => c.id === datos.cajaId)?.nombre ?? "—",
        vendedor: perfil?.nombre,
        metodoPago: datos.metodo,
        descuentoPct: datos.descuento,
        total: Number(r.total),
        sede: {
          nombre: sede.nombre,
          direccion: sede.direccion,
          telefono: sede.telefono,
          ciudad: sede.ciudad,
        },
        items: cart.map((item) => ({
          nombre: item.producto.nombre,
          cantidad: item.cantidad,
          precio: item.producto.precio,
        })),
      };

      setCart([]);
      setSuccess(`Venta ${r.numero} registrada por ${formatCurrency(Number(r.total))}.`);
      setTimeout(() => setSuccess(null), 6000);
      productos.reload(); // refresca el catálogo
      void stockVivo.refrescar(); // y el stock en vivo, al instante
      cajas.reload();

      void imprimirTicket(ticket).then((resultado) => {
        setNotificacion({
          mensaje: resultado.ok ? "Venta exitosa, comprobante impreso." : "Venta exitosa, comprobante guardado.",
          tono: "success",
        });
      });
    } catch (e) {
      setError((e as Error).message);
      productos.reload();
      void stockVivo.refrescar();
    } finally {
      setEnviando(false);
    }
  };

  if (!sedeUuid) {
    return (
      <div>
        <PageHeader title="Punto de Venta" subtitle="Selecciona los productos y registra la venta" />
        <div className="flex flex-col items-center rounded-xl border border-dashed border-gray-300 bg-white py-16 text-center">
          <MapPin className="h-10 w-10 text-pink-400" />
          <p className="mt-3 font-semibold text-gray-900">Elige una sede para vender</p>
          <p className="mt-1 max-w-sm text-sm text-gray-500">
            Estás viendo “{sede.nombre}”. Las ventas se registran siempre en una sede concreta: cámbiala desde
            el selector de la barra superior.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Punto de Venta"
        subtitle={`Selecciona los productos y registra la venta · ${sede.nombre}`}
      />

      {offline ? (
        leaseSede ? (
          <div role="status" className="mb-4 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900" data-testid="aviso-offline">
            <WifiOff className="h-5 w-5 shrink-0" />
            Modo offline con stock reservado: solo puedes vender lo reservado para esta caja. Las ventas se envían solas al volver internet.
          </div>
        ) : (
          <div role="alert" className="mb-4 flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800" data-testid="aviso-sin-reserva">
            <WifiOff className="h-5 w-5 shrink-0" />
            Sin conexión y sin stock reservado: no se puede vender hasta que vuelva internet.
          </div>
        )
      ) : null}

      {faltantes.length > 0 && !offline && (
        <div role="alert" className="mb-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900" data-testid="aviso-stock-cambio">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <span>
            El stock cambió mientras armabas la venta:{" "}
            {faltantes.map((i) => `${i.producto.nombre} (quedan ${i.producto.stock}, tienes ${i.cantidad})`).join("; ")}. Ajusta las cantidades antes de registrar.
          </span>
        </div>
      )}

      {success && (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-green-200 bg-green-50 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-green-700">
            <CheckCircle2 className="h-5 w-5" />
            {success}
          </div>
          <button onClick={() => setSuccess(null)} className="text-green-600 hover:text-green-700">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          {productos.loading && productosUso.length === 0 ? (
            <div className="flex justify-center rounded-xl border border-gray-200 bg-white py-20 text-gray-400">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : (
            <ProductGrid
              productos={productosUso}
              categorias={(categorias.data ?? []).map((c) => c.nombre)}
              enCarrito={enCarrito}
              onAdd={addProduct}
              enVivo={!offline && stockVivo.activo && stockVivo.vivo !== null}
            />
          )}
        </div>
        <div className="xl:col-span-1">
          <div className="xl:sticky xl:top-20">
            <VentaForm
              cart={cartVivo}
              onIncrease={increase}
              onDecrease={decrease}
              onRemove={remove}
              onClear={() => setCart([])}
              onConfirm={confirm}
              clientes={clientes.data ?? []}
              cajas={cajasUso}
              metodos={metodosUso}
              enviando={enviando}
              error={error}
            />
          </div>
        </div>
      </div>

      <Modal
        open={!!avisoEscaneo}
        onClose={() => setAvisoEscaneo(null)}
        title={avisoEscaneo?.titulo}
        size="sm"
        footer={
          <button
            onClick={() => setAvisoEscaneo(null)}
            className="rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gray-800"
          >
            Cerrar
          </button>
        }
      >
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-red-100 p-2">
            <PackageX className="h-5 w-5 text-red-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">{avisoEscaneo?.mensaje}</p>
            {avisoEscaneo?.codigo && (
              <p className="mt-2 text-xs text-gray-500">
                Código leído: <span className="font-mono">{avisoEscaneo.codigo}</span>
              </p>
            )}
          </div>
        </div>
      </Modal>
      <Toast
        open={!!notificacion}
        message={notificacion?.mensaje ?? ""}
        tone={notificacion?.tono ?? "success"}
        onClose={() => setNotificacion(null)}
      />
    </div>
  );
}
