import { cn } from "@/lib/utils";

type Variant =
  | "factura"
  | "boleta"
  | "nota_venta"
  | "pagado"
  | "anulado"
  | "pendiente"
  | "activo"
  | "inactivo"
  | "abierta"
  | "cerrada"
  | "recibida"
  | "anulada"
  | "vip"
  | "regular"
  | "gray"
  | "green"
  | "blue"
  | "amber"
  | "red";

const variants: Record<Variant, string> = {
  factura: "bg-blue-100 text-blue-700",
  boleta: "bg-green-100 text-green-700",
  nota_venta: "bg-amber-100 text-amber-700",
  pagado: "bg-green-100 text-green-700",
  anulado: "bg-red-100 text-red-700",
  pendiente: "bg-amber-100 text-amber-700",
  activo: "bg-green-100 text-green-700",
  inactivo: "bg-gray-100 text-gray-600",
  abierta: "bg-green-100 text-green-700",
  cerrada: "bg-gray-100 text-gray-600",
  recibida: "bg-green-100 text-green-700",
  anulada: "bg-red-100 text-red-700",
  vip: "bg-purple-100 text-purple-700",
  regular: "bg-gray-100 text-gray-600",
  gray: "bg-gray-100 text-gray-600",
  green: "bg-green-100 text-green-700",
  blue: "bg-blue-100 text-blue-700",
  amber: "bg-amber-100 text-amber-700",
  red: "bg-red-100 text-red-700",
};

const labels: Partial<Record<Variant, string>> = {
  factura: "Factura",
  boleta: "Boleta",
  nota_venta: "Nota de Venta",
  pagado: "Pagado",
  anulado: "Anulado",
  pendiente: "Pendiente",
  activo: "Activo",
  inactivo: "Inactivo",
  abierta: "Abierta",
  cerrada: "Cerrada",
  recibida: "Recibida",
  anulada: "Anulada",
  vip: "VIP",
  regular: "Regular",
};

export function Badge({
  variant = "gray",
  children,
  className,
}: {
  variant?: Variant;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
        variants[variant],
        className
      )}
    >
      {children ?? labels[variant] ?? variant}
    </span>
  );
}
