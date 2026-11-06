"use client";

import {
  AlertTriangle,
  BarChart3,
  CreditCard,
  Crown,
  DollarSign,
  Package,
  PieChart as PieIcon,
  Receipt,
  ShoppingBag,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardHeader } from "@/components/ui/Card";
import { useReporte } from "./ReporteContext";
import { formatCurrency } from "@/lib/utils";

const colors = ["#22c55e", "#3b82f6", "#a855f7", "#f59e0b", "#ef4444", "#14b8a6"];

function Variation({ value }: { value: number }) {
  const positive = value >= 0;
  return (
    <span
      className={`flex items-center gap-0.5 text-xs font-semibold ${
        positive ? "text-green-600" : "text-red-600"
      }`}
    >
      {positive ? (
        <TrendingUp className="h-3.5 w-3.5" />
      ) : (
        <TrendingDown className="h-3.5 w-3.5" />
      )}
      {positive ? "+" : ""}
      {value}%
    </span>
  );
}

export function ResumenPeriodoCard() {
  const { alertasStock, metodosPago, resumenPeriodo, topCategorias, topClientes, topProductos, ventasPorCaja, ventasPorComprobante, ventasSemanales, inventarioCategorias } = useReporte();
  const rows = [
    {
      label: "Ventas totales",
      value: formatCurrency(resumenPeriodo.ventasTotales),
      variation: resumenPeriodo.variacionVentas,
      icon: DollarSign,
    },
    {
      label: "Comprobantes",
      value: resumenPeriodo.comprobantes.toString(),
      variation: resumenPeriodo.variacionComprobantes,
      icon: Receipt,
    },
    {
      label: "Ticket promedio",
      value: formatCurrency(resumenPeriodo.ticketPromedio),
      variation: resumenPeriodo.variacionTicket,
      icon: ShoppingBag,
    },
    {
      label: "Utilidad estimada",
      value: formatCurrency(resumenPeriodo.utilidad),
      variation: resumenPeriodo.variacionUtilidad,
      icon: TrendingUp,
    },
  ];

  return (
    <Card>
      <CardHeader
        title="Resumen del Periodo"
        icon={BarChart3}
        tone="green"
        subtitle="Comparado con el periodo anterior"
      />
      <div className="divide-y divide-gray-100">
        {rows.map((row) => {
          const Icon = row.icon;
          return (
            <div
              key={row.label}
              className="flex items-center justify-between px-4 py-3.5"
            >
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-gray-100 p-2">
                  <Icon className="h-4 w-4 text-gray-500" />
                </div>
                <span className="text-sm text-gray-600">{row.label}</span>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-gray-900">{row.value}</p>
                <Variation value={row.variation} />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export function MetodosPagoCard() {
  const { alertasStock, metodosPago, resumenPeriodo, topCategorias, topClientes, topProductos, ventasPorCaja, ventasPorComprobante, ventasSemanales, inventarioCategorias } = useReporte();
  return (
    <Card>
      <CardHeader
        title="Métodos de Pago"
        icon={CreditCard}
        tone="blue"
        subtitle="Distribución de ingresos"
      />
      <div className="space-y-4 p-4">
        {metodosPago.map((metodo) => (
          <div key={metodo.nombre}>
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="font-medium text-gray-700">{metodo.nombre}</span>
              <span className="font-semibold text-gray-900">
                {formatCurrency(metodo.total)}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${metodo.porcentaje}%`,
                  backgroundColor: metodo.color,
                }}
              />
            </div>
            <p className="mt-1 text-right text-xs text-gray-400">
              {metodo.porcentaje}%
            </p>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function VentasSemanalesCard() {
  const { alertasStock, metodosPago, resumenPeriodo, topCategorias, topClientes, topProductos, ventasPorCaja, ventasPorComprobante, ventasSemanales, inventarioCategorias } = useReporte();
  return (
    <Card className="xl:col-span-2">
      <CardHeader
        title="Ventas de la Semana"
        icon={TrendingUp}
        tone="green"
        subtitle="Evolución diaria de ventas"
      />
      <div className="h-72 p-4">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={ventasSemanales}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="dia" tick={{ fontSize: 12 }} stroke="#9ca3af" />
            <YAxis tick={{ fontSize: 12 }} stroke="#9ca3af" />
            <Tooltip
              formatter={(value: number) => [`S/ ${Number(value).toFixed(2)}`, "Ventas"]}
              contentStyle={{ borderRadius: 8, borderColor: "#e5e7eb" }}
            />
            <Line
              type="monotone"
              dataKey="ventas"
              stroke="#22c55e"
              strokeWidth={2.5}
              dot={{ r: 4, fill: "#22c55e" }}
            />
            <Line
              type="monotone"
              dataKey="comprobantes"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={{ r: 3, fill: "#3b82f6" }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

export function TopProductosCard() {
  const { alertasStock, metodosPago, resumenPeriodo, topCategorias, topClientes, topProductos, ventasPorCaja, ventasPorComprobante, ventasSemanales, inventarioCategorias } = useReporte();
  return (
    <Card>
      <CardHeader
        title="Top Productos"
        icon={Package}
        tone="orange"
        subtitle="Más vendidos del periodo"
      />
      <div className="divide-y divide-gray-100">
        {topProductos.map((producto, index) => (
          <div
            key={producto.nombre}
            className="flex items-center gap-3 px-4 py-3"
          >
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                index === 0
                  ? "bg-amber-100 text-amber-700"
                  : index === 1
                  ? "bg-gray-200 text-gray-700"
                  : index === 2
                  ? "bg-orange-100 text-orange-700"
                  : "bg-gray-100 text-gray-500"
              }`}
            >
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-gray-900">
                {producto.nombre}
              </p>
              <p className="text-xs text-gray-500">
                {producto.cantidad} unidades
              </p>
            </div>
            <span className="text-sm font-bold text-gray-900">
              {formatCurrency(producto.total)}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function TopCategoriasCard() {
  const { alertasStock, metodosPago, resumenPeriodo, topCategorias, topClientes, topProductos, ventasPorCaja, ventasPorComprobante, ventasSemanales, inventarioCategorias } = useReporte();
  return (
    <Card>
      <CardHeader
        title="Top Categorías"
        icon={PieIcon}
        tone="purple"
        subtitle="Ventas por categoría"
      />
      <div className="h-64 p-4">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={topCategorias}
              dataKey="total"
              nameKey="nombre"
              cx="50%"
              cy="50%"
              innerRadius={45}
              outerRadius={80}
              paddingAngle={2}
            >
              {topCategorias.map((_, index) => (
                <Cell key={index} fill={colors[index % colors.length]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: number) => [`S/ ${Number(value).toFixed(2)}`, "Total"]}
              contentStyle={{ borderRadius: 8, borderColor: "#e5e7eb" }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="grid grid-cols-2 gap-2 px-4 pb-4">
        {topCategorias.map((c, index) => (
          <div key={c.nombre} className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: colors[index % colors.length] }}
            />
            <span className="truncate text-xs text-gray-600">{c.nombre}</span>
            <span className="ml-auto text-xs font-semibold text-gray-900">
              {c.porcentaje}%
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function TopClientesCard() {
  const { alertasStock, metodosPago, resumenPeriodo, topCategorias, topClientes, topProductos, ventasPorCaja, ventasPorComprobante, ventasSemanales, inventarioCategorias } = useReporte();
  return (
    <Card>
      <CardHeader
        title="Top Clientes"
        icon={Crown}
        tone="amber"
        subtitle="Mayores compradores"
      />
      <div className="divide-y divide-gray-100">
        {topClientes.map((cliente, index) => (
          <div
            key={cliente.nombre}
            className="flex items-center gap-3 px-4 py-3"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-pink-100 text-xs font-bold text-pink-600">
              {cliente.nombre
                .split(" ")
                .slice(0, 2)
                .map((n) => n[0])
                .join("")}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-gray-900">
                {cliente.nombre}
              </p>
              <p className="text-xs text-gray-500">
                {cliente.compras} compras
              </p>
            </div>
            <span className="text-sm font-bold text-green-600">
              {formatCurrency(cliente.total)}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function VentasPorCajaCard() {
  const { alertasStock, metodosPago, resumenPeriodo, topCategorias, topClientes, topProductos, ventasPorCaja, ventasPorComprobante, ventasSemanales, inventarioCategorias } = useReporte();
  return (
    <Card>
      <CardHeader
        title="Ventas por Caja"
        icon={Wallet}
        tone="indigo"
        subtitle="Rendimiento por caja"
      />
      <div className="h-64 p-4">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={ventasPorCaja} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis type="number" tick={{ fontSize: 11 }} stroke="#9ca3af" />
            <YAxis
              type="category"
              dataKey="caja"
              tick={{ fontSize: 11 }}
              stroke="#9ca3af"
              width={55}
            />
            <Tooltip
              formatter={(value: number) => [`S/ ${Number(value).toFixed(2)}`, "Ventas"]}
              contentStyle={{ borderRadius: 8, borderColor: "#e5e7eb" }}
            />
            <Bar dataKey="total" fill="#6366f1" radius={[0, 6, 6, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

export function VentasPorComprobanteCard() {
  const { alertasStock, metodosPago, resumenPeriodo, topCategorias, topClientes, topProductos, ventasPorCaja, ventasPorComprobante, ventasSemanales, inventarioCategorias } = useReporte();
  const total = ventasPorComprobante.reduce((acc, v) => acc + v.total, 0);
  return (
    <Card>
      <CardHeader
        title="Por Comprobante"
        icon={Receipt}
        tone="teal"
        subtitle="Distribución por tipo"
      />
      <div className="space-y-4 p-4">
        {ventasPorComprobante.map((v, index) => {
          const porcentaje = total ? Math.round((v.total / total) * 100) : 0;
          return (
            <div key={v.tipo}>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="font-medium text-gray-700">{v.tipo}</span>
                <span className="font-semibold text-gray-900">
                  {formatCurrency(v.total)}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${porcentaje}%`,
                    backgroundColor: colors[index % colors.length],
                  }}
                />
              </div>
              <div className="mt-1 flex justify-between text-xs text-gray-400">
                <span>{v.cantidad} comprobantes</span>
                <span>{porcentaje}%</span>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export function AlertasStockCard() {
  const { alertasStock, metodosPago, resumenPeriodo, topCategorias, topClientes, topProductos, ventasPorCaja, ventasPorComprobante, ventasSemanales, inventarioCategorias } = useReporte();
  return (
    <Card>
      <CardHeader
        title="Alertas de Stock"
        icon={AlertTriangle}
        tone="red"
        subtitle="Productos que requieren reposición"
      />
      <div className="divide-y divide-gray-100">
        {alertasStock.map((item) => (
          <div
            key={item.id}
            className="flex items-center justify-between px-4 py-3"
          >
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-red-50 p-2">
                <Package className="h-4 w-4 text-red-500" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">
                  {item.producto}
                </p>
                <p className="text-xs text-gray-500">
                  {item.tienda} · Mínimo: {item.stockMinimo} {item.unidad}
                </p>
              </div>
            </div>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                item.stock === 0
                  ? "bg-red-100 text-red-700"
                  : "bg-amber-100 text-amber-700"
              }`}
            >
              {item.stock === 0 ? "Agotado" : `${item.stock} ${item.unidad}`}
            </span>
          </div>
        ))}
        {alertasStock.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-gray-500">
            Sin alertas de stock.
          </p>
        )}
      </div>
    </Card>
  );
}

export function InventarioResumenCard() {
  const { alertasStock, metodosPago, resumenPeriodo, topCategorias, topClientes, topProductos, ventasPorCaja, ventasPorComprobante, ventasSemanales, inventarioCategorias } = useReporte();
  return (
    <Card>
      <CardHeader
        title="Inventario por Categoría"
        icon={Users}
        tone="gray"
        subtitle="Unidades disponibles"
      />
      <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3">
        {inventarioCategorias.map((c, index) => (
          <div key={c.nombre} className="rounded-lg bg-gray-50 p-3">
            <p className="truncate text-xs text-gray-500">{c.nombre}</p>
            <p className="text-lg font-bold text-gray-900">{c.porcentaje}%</p>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-200">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${c.porcentaje}%`,
                  backgroundColor: colors[index % colors.length],
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
