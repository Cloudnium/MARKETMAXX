"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardHeader } from "@/components/ui/Card";
import { BarChart3, PieChart as PieIcon, TrendingUp } from "lucide-react";

const colors = ["#22c55e", "#3b82f6", "#a855f7", "#f59e0b", "#ef4444", "#14b8a6"];

interface ChartsProps {
  semana?: { dia: string; ventas: number; comprobantes: number }[];
  meses?: { mes: string; ventas: number }[];
  categorias?: { nombre: string; total: number }[];
}

export function DashboardCharts({ semana = [], meses = [], categorias = [] }: ChartsProps) {
  const ventasSemanales = semana;
  const ventasMensuales = meses;
  const topCategorias = categorias;
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <Card className="xl:col-span-2">
        <CardHeader
          title="Ventas de la Semana"
          icon={TrendingUp}
          tone="green"
          subtitle="Ingresos diarios de los últimos 7 días"
        />
        <div className="h-72 p-4">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={ventasSemanales}>
              <defs>
                <linearGradient id="ventasGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="dia" tick={{ fontSize: 12 }} stroke="#9ca3af" />
              <YAxis tick={{ fontSize: 12 }} stroke="#9ca3af" />
              <Tooltip
                formatter={(value: number) => [`S/ ${value}`, "Ventas"]}
                contentStyle={{ borderRadius: 8, borderColor: "#e5e7eb" }}
              />
              <Area
                type="monotone"
                dataKey="ventas"
                stroke="#22c55e"
                strokeWidth={2}
                fill="url(#ventasGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Ventas por Categoría"
          icon={PieIcon}
          tone="purple"
          subtitle="Distribución del periodo"
        />
        <div className="h-72 p-4">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={topCategorias}
                dataKey="total"
                nameKey="nombre"
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={85}
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
              <Legend
                wrapperStyle={{ fontSize: 11 }}
                iconType="circle"
                iconSize={8}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card className="xl:col-span-3">
        <CardHeader
          title="Evolución Mensual"
          icon={BarChart3}
          tone="blue"
          subtitle="Ventas de los últimos 6 meses"
        />
        <div className="h-64 p-4">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={ventasMensuales}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="mes" tick={{ fontSize: 12 }} stroke="#9ca3af" />
              <YAxis tick={{ fontSize: 12 }} stroke="#9ca3af" />
              <Tooltip
                formatter={(value: number) => [`S/ ${value}`, "Ventas"]}
                contentStyle={{ borderRadius: 8, borderColor: "#e5e7eb" }}
              />
              <Bar dataKey="ventas" fill="#3b82f6" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}
