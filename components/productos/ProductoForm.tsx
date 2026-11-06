"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Loader2, Minus, Plus } from "lucide-react";
import { useAuth } from "@/components/shared/AuthProvider";
import { useSede } from "@/components/shared/SedeProvider";
import { actualizarProducto, ajustarStockProducto, crearProducto } from "@/lib/data/productos";
import type { Categoria, Producto } from "@/lib/types";

const empty: Producto = {
  id: "",
  codigo: "",
  nombre: "",
  descripcion: "",
  categoria: "",
  precio: 0,
  precioCompra: 0,
  stock: 0,
  stockMinimo: 0,
  unidad: "Unidad",
  activo: true,
};

export function ProductoForm({
  open,
  producto,
  categorias,
  onClose,
  onSaved,
  onStockChanged,
}: {
  open: boolean;
  producto: Producto | null;
  categorias: Categoria[];
  onClose: () => void;
  onSaved: () => void;
  /** Se avisa cuando se agrega/resta stock (el modal sigue abierto). */
  onStockChanged?: () => void;
}) {
  const { can, perfil } = useAuth();
  const { sedeOperativa, sede } = useSede();
  const [form, setForm] = useState<Producto>(empty);
  const [motivo, setMotivo] = useState("");
  // Agregar / restar stock (solo al editar)
  const [cantidad, setCantidad] = useState("");
  const [ubicacion, setUbicacion] = useState<"tienda" | "almacen">("tienda");
  const [motivoAjuste, setMotivoAjuste] = useState("");
  const [ajustando, setAjustando] = useState(false);
  const [stockTienda, setStockTienda] = useState(0);
  const [stockAlmacen, setStockAlmacen] = useState(0);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(producto ?? { ...empty, categoriaId: categorias[0]?.id ?? null });
      setMotivo("");
      setCantidad("");
      setUbicacion("tienda");
      setMotivoAjuste("");
      setStockTienda(producto?.stock ?? 0);
      setStockAlmacen(producto?.stockAlmacen ?? 0);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, producto]);

  const stockCambio = false; // al editar, el stock se cambia con "Agregar / restar stock"
  // El stock siempre pertenece a UNA sede: en "todas las sedes" no se puede tocar
  const sedeProducto = producto?.sedeId ?? sedeOperativa?.id ?? null;
  const stockBloqueado = !can("almacen.ajustar") || !sedeProducto;
  // Restar stock: solo Administrador y Supervisor. Los demás solo pueden agregar.
  const puedeRestar = (perfil?.rolNivel ?? 0) >= 60;

  const ajustar = async (signo: 1 | -1) => {
    if (!producto || !sedeProducto) return;
    setError(null);
    const n = Number(cantidad);
    if (!(n > 0)) return setError("Escribe una cantidad mayor a cero.");
    if (signo < 0 && !puedeRestar) return setError("Solo administradores y supervisores pueden restar stock.");
    if (signo < 0 && motivoAjuste.trim().length < 3) return setError("Indica el motivo para restar stock.");
    const actual = ubicacion === "tienda" ? stockTienda : stockAlmacen;
    if (signo < 0 && n > actual) return setError(`Solo hay ${actual} en ${ubicacion === "tienda" ? "tienda" : "almacén"}.`);
    setAjustando(true);
    try {
      await ajustarStockProducto(sedeProducto, producto.id, ubicacion, signo * n, motivoAjuste.trim() || null);
      if (ubicacion === "tienda") setStockTienda((v) => v + signo * n);
      else setStockAlmacen((v) => v + signo * n);
      setCantidad("");
      setMotivoAjuste("");
      onStockChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAjustando(false);
    }
  };
  const preciosBloqueados = !!producto && !can("productos.editar_precio");

  const guardar = async () => {
    setError(null);
    if (!form.codigo.trim() || !form.nombre.trim()) return setError("Código y nombre son obligatorios.");
    if (stockCambio && motivo.trim().length < 3) return setError("Indica el motivo del cambio de stock.");
    if (!producto && !sedeOperativa) return setError("Elige una sede concreta para crear el producto.");
    setGuardando(true);
    try {
      if (producto) {
        await actualizarProducto(
          form,
          stockCambio ? sedeProducto : null,
          stockCambio ? form.stock : null,
          stockCambio ? motivo : null
        );
      } else {
        await crearProducto(form, sedeOperativa!.id, form.stock);
      }
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  };

  const update = (field: keyof Producto, value: string | number | boolean) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const inputClass =
    "w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={producto ? "Editar Producto" : "Nuevo Producto"}
      subtitle={
        producto
          ? "Actualiza la información del producto"
          : "Registra un nuevo producto en el inventario"
      }
      size="lg"
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
            disabled={guardando}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
            {producto ? "Guardar cambios" : "Registrar producto"}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 sm:col-span-2">{error}</p>}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">
            Código
          </label>
          <input
            value={form.codigo}
            onChange={(e) => update("codigo", e.target.value)}
            placeholder="Ej. 779013"
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">
            Categoría
          </label>
          <select
            value={form.categoriaId ?? ""}
            onChange={(e) => setForm((prev) => ({ ...prev, categoriaId: e.target.value || null }))}
            className={inputClass}
          >
            <option value="">Sin categoría</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1.5 block text-sm font-medium text-gray-700">
            Nombre del producto
          </label>
          <input
            value={form.nombre}
            onChange={(e) => update("nombre", e.target.value)}
            placeholder="Ej. Arroz Extra 5kg"
            className={inputClass}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1.5 block text-sm font-medium text-gray-700">
            Descripción
          </label>
          <textarea
            value={form.descripcion}
            onChange={(e) => update("descripcion", e.target.value)}
            rows={2}
            placeholder="Descripción breve del producto"
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">
            Precio de venta (S/)
          </label>
          <input
            type="number"
            value={form.precio}
            min={0}
            step="0.01"
            disabled={preciosBloqueados}
            onChange={(e) => update("precio", Number(e.target.value))}
            className={`${inputClass} disabled:bg-gray-50 disabled:text-gray-400`}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">
            Precio de compra (S/)
          </label>
          <input
            type="number"
            value={form.precioCompra}
            min={0}
            step="0.01"
            disabled={preciosBloqueados}
            onChange={(e) => update("precioCompra", Number(e.target.value))}
            className={`${inputClass} disabled:bg-gray-50 disabled:text-gray-400`}
          />
        </div>
        {producto ? (
          <div className="space-y-4 sm:col-span-2">
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Agregar / restar stock</p>
              <div className="flex flex-wrap items-center gap-3">
                <input
                  type="number"
                  min={0}
                  value={cantidad}
                  disabled={!can("productos.editar") || !sedeProducto}
                  onChange={(e) => setCantidad(e.target.value)}
                  placeholder="Cantidad"
                  className={`${inputClass} min-w-[8rem] flex-1`}
                />
                <div className="space-y-1 text-sm text-gray-700">
                  {([["tienda", "🏪 Tienda"], ["almacen", "🏭 Almacén"]] as const).map(([v, t]) => (
                    <label key={v} className="flex cursor-pointer items-center gap-2">
                      <input type="radio" name="ubic" checked={ubicacion === v} onChange={() => setUbicacion(v)} className="accent-blue-600" />
                      {t}
                    </label>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => ajustar(1)}
                  disabled={ajustando || !sedeProducto}
                  title="Agregar stock"
                  className="flex h-11 w-11 items-center justify-center rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {ajustando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-5 w-5" />}
                </button>
                <button
                  type="button"
                  onClick={() => ajustar(-1)}
                  disabled={ajustando || !sedeProducto || !puedeRestar}
                  title={puedeRestar ? "Restar stock" : "Solo administradores y supervisores pueden restar"}
                  className="flex h-11 w-11 items-center justify-center rounded-lg bg-red-500 text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Minus className="h-5 w-5" />
                </button>
              </div>
              {puedeRestar && (
                <input
                  value={motivoAjuste}
                  onChange={(e) => setMotivoAjuste(e.target.value)}
                  placeholder="Motivo (obligatorio al restar: merma, conteo, vencido...)"
                  className="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              )}
              {!puedeRestar && <p className="mt-2 text-xs text-gray-500">Tu rol solo permite agregar stock.</p>}
            </div>

            <div>
              <p className="mb-2 text-sm font-semibold text-gray-900">Stock</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-blue-600">🏪 Tienda (Exhibición)</label>
                  <input readOnly value={stockTienda} className={`${inputClass} bg-gray-50`} />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-orange-600">🏭 Almacén (Bodega)</label>
                  <input readOnly value={stockAlmacen} className={`${inputClass} bg-gray-50`} />
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-gray-100 px-4 py-2.5 text-sm text-gray-600">
                Stock Total (Tienda + Almacén): <span className="font-bold text-gray-900">{stockTienda + stockAlmacen} unidades</span>
              </div>
            </div>
          </div>
        ) : (
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              {`Stock inicial${sedeOperativa ? ` en ${sedeOperativa.nombre}` : ""}`}
            </label>
            <input
              type="number"
              min={0}
              value={form.stock}
              disabled={stockBloqueado}
              onChange={(e) => update("stock", Number(e.target.value))}
              className={`${inputClass} disabled:bg-gray-50 disabled:text-gray-400`}
            />
            {!sedeOperativa && (
              <p className="mt-1 text-xs text-gray-500">Elige una sede concreta para modificar el stock.</p>
            )}
          </div>
        )}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">
            Stock mínimo
          </label>
          <input
            type="number"
            value={form.stockMinimo}
            min={0}
            onChange={(e) => update("stockMinimo", Number(e.target.value))}
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">
            Unidad
          </label>
          <select
            value={form.unidad}
            onChange={(e) => update("unidad", e.target.value)}
            className={inputClass}
          >
            {["Unidad", "Bolsa", "Botella", "Caja", "Paquete", "Kilogramo"].map(
              (u) => (
                <option key={u}>{u}</option>
              )
            )}
          </select>
        </div>
        {stockCambio && (
          <div className="sm:col-span-2">
            <label className="mb-1.5 block text-sm font-medium text-amber-700">
              Motivo del cambio de stock (obligatorio · queda en el historial de almacén)
            </label>
            <input
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej. Conteo físico, producto vencido..."
              className="w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-100"
            />
          </div>
        )}
        <div className="flex items-end">
          <label className="flex cursor-pointer items-center gap-2 pb-2.5 text-sm font-medium text-gray-700">
            <input
              type="checkbox"
              checked={form.activo}
              disabled={!!producto && !can("productos.eliminar")}
              onChange={(e) => update("activo", e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            Producto activo
          </label>
        </div>
      </div>
    </Modal>
  );
}
