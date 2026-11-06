"use client";

import {
  Banknote,
  CreditCard,
  Percent,
  ShoppingCart,
  Smartphone,
  Trash2,
  User,
  Wallet,
} from "lucide-react";
import { useEffect, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { useAuth } from "@/components/shared/AuthProvider";
import { CartProduct, type CartItem } from "./CartProduct";
import { formatCurrency } from "@/lib/utils";
import type { Caja, Cliente, TipoComprobante } from "@/lib/types";

const iconos: Record<string, typeof Banknote> = {
  Efectivo: Banknote,
  Yape: Smartphone,
  Tarjeta: CreditCard,
  Transferencia: Wallet,
};

const tipos = [
  { key: "boleta", label: "Boleta" },
  { key: "factura", label: "Factura" },
  { key: "nota_venta", label: "Nota de Venta" },
];

export function VentaForm({
  cart,
  onIncrease,
  onDecrease,
  onRemove,
  onClear,
  onConfirm,
  clientes,
  cajas,
  metodos,
  enviando,
  error,
}: {
  cart: CartItem[];
  onIncrease: (id: string) => void;
  onDecrease: (id: string) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onConfirm: (datos: {
    clienteId: string | null;
    clienteNombre: string | null;
    clienteDocumento: string | null;
    tipo: TipoComprobante;
    metodo: string;
    descuento: number;
    cajaId: string;
  }) => void;
  clientes: Cliente[];
  cajas: Caja[];
  metodos: string[];
  enviando: boolean;
  error: string | null;
}) {
  const { can } = useAuth();
  const [clienteId, setClienteId] = useState("");
  const [clienteNombre, setClienteNombre] = useState("");
  const [clienteDocumento, setClienteDocumento] = useState("");
  const [tipo, setTipo] = useState<TipoComprobante>("nota_venta");
  const [metodo, setMetodo] = useState("Efectivo");
  const [descuento, setDescuento] = useState(0);
  const [cajaElegida, setCajaElegida] = useState("");
  const cajaId = cajas.some((c) => c.id === cajaElegida) ? cajaElegida : cajas[0]?.id ?? "";

  // Cada venta nueva vuelve a empezar con Nota de Venta y Cliente Varios.
  useEffect(() => {
    if (cart.length === 0) {
      setTipo("nota_venta");
      setClienteId("");
      setClienteNombre("");
      setClienteDocumento("");
    }
  }, [cart.length]);
  const nombreComprador = clienteNombre.trim();
  const documentoComprador = clienteDocumento.trim();
  const datosParciales =
    tipo !== "nota_venta" &&
    (nombreComprador === "") !== (documentoComprador === "");
  const facturaInvalida =
    tipo === "factura" && (nombreComprador === "" || documentoComprador === "");
  const datosClienteInvalidos = datosParciales || facturaInvalida;

  const cambiarCliente = (id: string) => {
    setClienteId(id);
    const cliente = clientes.find((c) => c.id === id);
    setClienteNombre(cliente?.nombre ?? "");
    setClienteDocumento(cliente?.documento ?? "");
  };

  const total = cart.reduce(
    (acc, item) => acc + item.producto.precio * item.cantidad,
    0
  );
  const descuentoMonto = (total * descuento) / 100;
  const totalFinal = total - descuentoMonto;
  const subtotal = totalFinal / 1.18;
  const igv = totalFinal - subtotal;

  return (
    <div className="flex h-full flex-col rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-4">
        <div className="flex items-center gap-2.5">
          <div className="rounded-lg bg-green-100 p-2">
            <ShoppingCart className="h-5 w-5 text-green-600" />
          </div>
          <h2 className="text-base font-bold text-gray-900">Nueva Venta</h2>
        </div>
        {cart.length > 0 && (
          <button
            onClick={onClear}
            className="inline-flex items-center gap-1 text-xs font-semibold text-red-500 hover:text-red-600"
          >
            <Trash2 className="h-3.5 w-3.5" /> Limpiar
          </button>
        )}
      </div>

      <div className="space-y-4 border-b border-gray-100 p-4">
        <div>
          <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-gray-700">
            <Wallet className="h-4 w-4 text-gray-400" /> Caja
          </label>
          {cajas.length === 0 ? (
            <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              No hay cajas abiertas en esta sede. Abre una desde el módulo Cajas para poder vender.
            </p>
          ) : (
            <select
              value={cajaId}
              onChange={(e) => setCajaElegida(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
            >
              {cajas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre} · {c.usuario}
                </option>
              ))}
            </select>
          )}
        </div>
        <div>
          <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-gray-700">
            <User className="h-4 w-4 text-gray-400" /> Cliente
          </label>
          <select
            value={clienteId}
            onChange={(e) => cambiarCliente(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
          >
            <option value="">Cliente Varios</option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre} - {c.documento || "s/d"}
              </option>
            ))}
          </select>
          {tipo !== "nota_venta" && (
            <div className="mt-2 space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-2.5">
              <p className="text-xs font-semibold text-gray-600">
                {tipo === "factura" ? "Datos para Factura (obligatorios)" : "Datos para Boleta (opcionales)"}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={clienteDocumento}
                  onChange={(e) => {
                    setClienteId("");
                    setClienteDocumento(e.target.value);
                  }}
                  placeholder={tipo === "factura" ? "RUC *" : "DNI/RUC"}
                  className="w-full rounded-lg border border-gray-300 px-2.5 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
                <input
                  value={clienteNombre}
                  onChange={(e) => {
                    setClienteId("");
                    setClienteNombre(e.target.value);
                  }}
                  placeholder={tipo === "factura" ? "Razón social *" : "Nombre o razón social"}
                  className="w-full rounded-lg border border-gray-300 px-2.5 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
              </div>
            </div>
          )}
        </div>

        <div>
          <p className="mb-1.5 text-sm font-medium text-gray-700">
            Tipo de comprobante
          </p>
          <div className="grid grid-cols-3 gap-1.5">
            {tipos.map((t) => (
              <button
                key={t.key}
                onClick={() => setTipo(t.key as TipoComprobante)}
                className={`rounded-lg border px-2 py-2 text-xs font-semibold transition-colors ${
                  tipo === t.key
                    ? "border-blue-600 bg-blue-50 text-blue-700"
                    : "border-gray-200 text-gray-600 hover:bg-gray-50"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-sm font-medium text-gray-700">
            Método de pago
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {metodos.map((m) => {
              const Icon = iconos[m] ?? Wallet;
              return (
                <button
                  key={m}
                  onClick={() => setMetodo(m)}
                  className={`flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-semibold transition-colors ${
                    metodo === m
                      ? "border-green-600 bg-green-50 text-green-700"
                      : "border-gray-200 text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {m}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="min-h-[140px] flex-1 overflow-y-auto px-4">
        {cart.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center py-8 text-center">
            <ShoppingCart className="h-10 w-10 text-gray-200" />
            <p className="mt-2 text-sm font-medium text-gray-500">
              El carrito está vacío
            </p>
            <p className="text-xs text-gray-400">
              Agrega productos para comenzar
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {cart.map((item) => (
              <CartProduct
                key={item.producto.id}
                item={item}
                onIncrease={() => onIncrease(item.producto.id)}
                onDecrease={() => onDecrease(item.producto.id)}
                onRemove={() => onRemove(item.producto.id)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2 border-t border-gray-100 p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-1.5 text-gray-500">
            <Percent className="h-3.5 w-3.5" /> Descuento
          </span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={100}
              value={descuento}
              disabled={!can("ventas.descuentos")}
              title={can("ventas.descuentos") ? undefined : "Tu rol no puede aplicar descuentos"}
              onChange={(e) => setDescuento(Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
              className="w-16 rounded-lg border border-gray-300 px-2 py-1 text-right text-sm focus:border-blue-500 focus:outline-none disabled:bg-gray-100 disabled:text-gray-400"
            />
            <span className="text-gray-400">%</span>
          </div>
        </div>
        {tipo !== "nota_venta" && (
          <>
            <div className="flex justify-between text-sm text-gray-500">
              <span>Subtotal</span>
              <span>{formatCurrency(subtotal)}</span>
            </div>
            <div className="flex justify-between text-sm text-gray-500">
              <span>IGV (18%)</span>
              <span>{formatCurrency(igv)}</span>
            </div>
          </>
        )}
        {descuento > 0 && (
          <div className="flex justify-between text-sm text-red-500">
            <span>Descuento ({descuento}%)</span>
            <span>- {formatCurrency(descuentoMonto)}</span>
          </div>
        )}
        <div className="flex items-center justify-between border-t border-dashed border-gray-200 pt-2">
          <span className="text-sm font-bold text-gray-900">TOTAL</span>
          <span className="text-xl font-bold text-green-600">
            {formatCurrency(totalFinal)}
          </span>
        </div>
        {datosClienteInvalidos && (
          <p className="text-xs text-amber-700">
            {facturaInvalida
              ? "La factura requiere RUC y razón social del comprador."
              : "Completa DNI/RUC y nombre, o deja ambos vacíos para Cliente Varios."}
          </p>
        )}
        {error && (
          <p className="flex items-start gap-1.5 rounded-lg bg-red-50 p-2.5 text-xs text-red-700">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
          </p>
        )}
        <button
          onClick={() =>
            onConfirm({
              clienteId: clienteId || null,
              clienteNombre: tipo === "nota_venta" ? null : nombreComprador || null,
              clienteDocumento: tipo === "nota_venta" ? null : documentoComprador || null,
              tipo,
              metodo,
              descuento,
              cajaId,
            })
          }
          disabled={cart.length === 0 || !cajaId || enviando || datosClienteInvalidos}
          className="mt-1 flex w-full items-center justify-center gap-2 rounded-lg bg-green-600 py-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {enviando && <Loader2 className="h-4 w-4 animate-spin" />}
          Registrar Venta
        </button>
      </div>
    </div>
  );
}
