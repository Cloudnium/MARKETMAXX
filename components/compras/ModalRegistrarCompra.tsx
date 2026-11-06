"use client";

import { Loader2, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useAsync } from "@/lib/hooks/useAsync";
import { listarProductos } from "@/lib/data/productos";
import { listarProveedores, registrarCompraCompleta } from "@/lib/data/compras";
import { rpc } from "@/lib/data/db";
import { formatCurrency } from "@/lib/utils";

const inputClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100";

interface ItemCompra {
  /** Nombre escrito o elegido; si no coincide con un producto de la sede, se crea uno nuevo. */
  nombre: string;
  cantidad: number;
  precio: number;
}

const norm = (t: string) => t.trim().toLowerCase();

export function ModalRegistrarCompra({
  open,
  sedeId,
  onClose,
  onDone,
}: {
  open: boolean;
  sedeId: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const prods = useAsync(() => (open && sedeId ? listarProductos(sedeId) : Promise.resolve([])), [open, sedeId], []);
  const provs = useAsync(() => (open ? listarProveedores() : Promise.resolve([])), [open], []);
  const productos = (prods.data ?? []).filter((p) => p.activo);
  const [items, setItems] = useState<ItemCompra[]>([]);
  const [proveedor, setProveedor] = useState("");
  const [comprobante, setComprobante] = useState("");
  const [fecha, setFecha] = useState("");
  const [recibida, setRecibida] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setItems([{ nombre: "", cantidad: 1, precio: 0 }]);
      setProveedor("");
      setComprobante("");
      setFecha(new Date().toISOString().slice(0, 10));
      setRecibida(true);
      setError(null);
    }
  }, [open]);

  const buscar = (nombre: string) => productos.find((p) => norm(p.nombre) === norm(nombre));

  const addItem = () => setItems((prev) => [...prev, { nombre: "", cantidad: 1, precio: 0 }]);

  const updateItem = (index: number, field: keyof ItemCompra, value: string | number) =>
    setItems((prev) =>
      prev.map((item, i) => {
        if (i !== index) return item;
        if (field === "nombre") {
          const p = buscar(String(value));
          return { ...item, nombre: String(value), precio: p ? p.precioCompra : item.precio };
        }
        return { ...item, [field]: value };
      })
    );

  const removeItem = (index: number) =>
    setItems((prev) => prev.filter((_, i) => i !== index));

  const guardar = async () => {
    if (!sedeId) return;
    setError(null);
    const lineas = items.filter((i) => i.nombre.trim());
    if (lineas.length === 0) return setError("Agrega al menos un producto.");
    if (lineas.some((i) => !(i.cantidad > 0))) return setError("Las cantidades deben ser mayores a cero.");
    if (proveedor.trim().length < 2) return setError("Elige o escribe el proveedor.");
    setGuardando(true);
    try {
      // TODO o NADA en una sola transacción: proveedor (nuevo o existente) + productos nuevos + compra + stock
      const prov = (provs.data ?? []).find((p) => norm(p.nombre) === norm(proveedor));
      await registrarCompraCompleta({
        sedeId,
        proveedorId: prov?.id ?? null,
        proveedorNombre: proveedor,
        comprobante,
        fecha,
        recibida,
        items: lineas.map((it) => ({ productoId: buscar(it.nombre)?.id ?? null, nombre: it.nombre, cantidad: it.cantidad, precio: it.precio })),
      });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  };

  const total = items.reduce(
    (acc, item) => acc + item.cantidad * item.precio,
    0
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Registrar Compra"
      subtitle="Registra la compra de productos al proveedor"
      size="xl"
      footer={
        <>
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            Cancelar
          </button>
          <button
            onClick={guardar}
            disabled={guardando || !sedeId}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {guardando && <Loader2 className="h-4 w-4 animate-spin" />} Registrar compra
          </button>
        </>
      }
    >
      <div className="space-y-5">
        {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Proveedor
            </label>
            <input
              list="lista-proveedores"
              value={proveedor}
              onChange={(e) => setProveedor(e.target.value)}
              placeholder="Escribe uno nuevo o elige uno registrado"
              className={inputClass}
            />
            <datalist id="lista-proveedores">
              {(provs.data ?? []).map((p) => <option key={p.id} value={p.nombre} />)}
            </datalist>
            {proveedor.trim().length >= 2 && !(provs.data ?? []).some((p) => norm(p.nombre) === norm(proveedor)) && (
              <p className="mt-1 text-xs text-amber-600">Proveedor nuevo: se registrará al guardar.</p>
            )}
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              N° de comprobante
            </label>
            <input value={comprobante} onChange={(e) => setComprobante(e.target.value)} placeholder="Ej. F001-000245 (del proveedor)" className={inputClass} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Fecha
            </label>
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={inputClass} />
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-700">
              Productos de la compra
            </p>
            <button
              onClick={addItem}
              className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700"
            >
              <Plus className="h-3.5 w-3.5" /> Agregar producto
            </button>
          </div>
          <datalist id="lista-productos">
            {productos.map((p) => <option key={p.id} value={p.nombre} />)}
          </datalist>
          <div className="overflow-hidden rounded-lg border border-gray-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2.5 font-semibold">Producto</th>
                  <th className="w-24 px-3 py-2.5 font-semibold">Cantidad</th>
                  <th className="w-28 px-3 py-2.5 font-semibold">P. compra</th>
                  <th className="w-28 px-3 py-2.5 text-right font-semibold">
                    Subtotal
                  </th>
                  <th className="w-12 px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((item, index) => (
                  <tr key={index}>
                    <td className="px-3 py-2">
                      <input
                        list="lista-productos"
                        value={item.nombre}
                        onChange={(e) => updateItem(index, "nombre", e.target.value)}
                        placeholder="Elige o escribe un producto"
                        className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                      />
                      {item.nombre.trim() && !buscar(item.nombre) && (
                        <p className="mt-0.5 text-[11px] text-amber-600">Producto nuevo: se creará en PRODUCTOS (ajusta su precio de venta allí).</p>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={1}
                        value={item.cantidad}
                        onChange={(e) =>
                          updateItem(index, "cantidad", Number(e.target.value))
                        }
                        className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        value={item.precio}
                        onChange={(e) =>
                          updateItem(index, "precio", Number(e.target.value))
                        }
                        className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                      />
                    </td>
                    <td className="px-3 py-2 text-right font-semibold text-gray-900">
                      {formatCurrency(item.cantidad * item.precio)}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => removeItem(index)}
                        className="rounded-lg p-1.5 text-red-500 hover:bg-red-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-gray-200 p-3 text-sm">
          <input type="checkbox" checked={recibida} onChange={(e) => setRecibida(e.target.checked)} className="mt-0.5 h-4 w-4 accent-blue-600" />
          <span>
            <span className="font-semibold text-gray-900">Mercadería recibida</span>
            <span className="block text-xs text-gray-500">
              Si está marcada, el stock ingresa de inmediato a la sede y se registra en el historial de almacén.
              Si no, la compra queda pendiente hasta recibirla.
            </span>
          </span>
        </label>

        <div className="ml-auto flex w-full items-center justify-between rounded-lg bg-gray-50 p-4 sm:w-72">
          <span className="font-bold text-gray-900">Total</span>
          <span className="text-lg font-bold text-green-600">{formatCurrency(total)}</span>
        </div>
      </div>
    </Modal>
  );
}
