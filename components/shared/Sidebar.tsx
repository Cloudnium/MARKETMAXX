"use client";

import Image from "next/image";
import {
  BarChart3,
  Building2,
  Computer,
  Database,
  FileText,
  Home,
  LogOut,
  MessageSquare,
  Package,
  Package2,
  Printer,
  ShoppingCart,
  Truck,
  UserStar,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "./AuthProvider";

export type View =
  | "dashboard"
  | "ventas"
  | "productos"
  | "clientes"
  | "usuarios"
  | "caja"
  | "almacen"
  | "comprobantes"
  | "compras"
  | "reportes"
  | "sedes"
  | "asistente"
  | "impresion"
  | "backup";

interface NavItem {
  key: View;
  label: string;
  icon: React.ElementType;
  /** Permiso requerido para ver la opción (varios = basta uno). */
  permiso: string | string[];
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const sections: NavSection[] = [
  {
    title: "Principal",
    items: [
      { key: "dashboard", label: "Dashboard", icon: Home, permiso: "dashboard.ver" },
      { key: "ventas", label: "Ventas", icon: ShoppingCart, permiso: "ventas.crear" },
    ],
  },
  {
    title: "Gestión",
    items: [
      { key: "productos", label: "Productos", icon: Package, permiso: "productos.ver" },
      { key: "clientes", label: "Clientes", icon: Users, permiso: "clientes.ver" },
      { key: "usuarios", label: "Usuarios", icon: UserStar, permiso: "usuarios.ver" },
      { key: "caja", label: "Cajas", icon: Computer, permiso: "cajas.ver" },
      { key: "almacen", label: "Almacén", icon: Package2, permiso: "almacen.ver" },
    ],
  },
  {
    title: "Sedes",
    items: [{ key: "sedes", label: "Sedes", icon: Building2, permiso: "sedes.ver" }],
  },
  {
    title: "Documentos",
    items: [
      { key: "comprobantes", label: "Comprobantes", icon: FileText, permiso: "comprobantes.ver" },
      { key: "compras", label: "Egresos", icon: Truck, permiso: "compras.ver" },
      { key: "reportes", label: "Reportes", icon: BarChart3, permiso: "reportes.ver" },
    ],
  },
  {
    title: "Herramientas",
    items: [
      { key: "asistente", label: "Asistente", icon: MessageSquare, permiso: "asistente.usar" },
      { key: "impresion", label: "Impresión", icon: Printer, permiso: "impresion.usar" },
      { key: "backup", label: "Backup", icon: Database, permiso: "backup.usar" },
    ],
  },
];

/** Permiso necesario para abrir cada vista. */
export const viewPermiso: Record<View, string | string[]> = Object.fromEntries(
  sections.flatMap((section) => section.items.map((item) => [item.key, item.permiso]))
) as Record<View, string | string[]>;

interface SidebarProps {
  activeView: View;
  onViewChange: (view: View) => void;
  open: boolean;
  onClose: () => void;
  collapsed: boolean;
}

export function Sidebar({
  activeView,
  onViewChange,
  open,
  onClose,
  collapsed,
}: SidebarProps) {
  const { can, perfil, signOut } = useAuth();
  const visibles = sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) =>
        Array.isArray(item.permiso) ? item.permiso.some(can) : can(item.permiso)
      ),
    }))
    .filter((section) => section.items.length > 0);

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-gray-900/40 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}
      <aside
        className={cn(
          "fixed bottom-4 left-4 top-4 z-50 flex w-[calc(100vw-2rem)] max-w-[18rem] flex-col overflow-hidden rounded-3xl border border-white/70 bg-white/80 shadow-2xl shadow-pink-900/10 backdrop-blur-xl transition-[width,transform] duration-300 ease-out lg:translate-x-0",
          collapsed ? "lg:w-20" : "lg:w-64",
          open ? "translate-x-0" : "-translate-x-[120%]"
        )}
      >
        <div className="relative flex h-16 shrink-0 items-center justify-center overflow-hidden bg-pink-600 px-3">
          <Image
            src="/icon/maxx.png"
            alt="Market Maxx"
            width={200}
            height={48}
            className={cn(
              "relative h-11 w-auto object-contain drop-shadow",
              collapsed && "lg:hidden"
            )}
            priority
          />
          <div
            className={cn(
              "relative hidden items-center justify-center",
              collapsed && "lg:flex"
            )}
          >
            <Image
              src="/icon/maxx-m-yellow.png"
              alt="Market Maxx"
              width={92}
              height={89}
              unoptimized
              className="h-8 w-auto object-contain"
            />
          </div>
          <button
            onClick={onClose}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-xl p-1.5 text-white/80 transition-colors hover:bg-white/15 lg:hidden"
            aria-label="Cerrar menú"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav
          className={cn(
            "flex-1 space-y-6 overflow-y-auto px-3 py-4 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-300/70 [&::-webkit-scrollbar-track]:bg-transparent",
            collapsed && "lg:px-2"
          )}
        >
          {visibles.map((section) => (
            <div key={section.title}>
              <p
                className={cn(
                  "mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400",
                  collapsed && "lg:hidden"
                )}
              >
                {section.title}
              </p>
              <div
                className={cn(
                  "mx-2 mb-2 hidden h-px bg-gray-200/70",
                  collapsed && "lg:block"
                )}
              />
              <div className="space-y-1">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const active = activeView === item.key;
                  return (
                    <button
                      key={item.key}
                      onClick={() => {
                        onViewChange(item.key);
                        onClose();
                      }}
                      title={collapsed ? item.label : undefined}
                      className={cn(
                        "group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all duration-200",
                        collapsed && "lg:justify-center lg:gap-0 lg:px-0",
                        active
                          ? "bg-gradient-to-r from-pink-500 to-pink-600 font-semibold text-white shadow-lg shadow-pink-500/25"
                          : "font-medium text-gray-600 hover:bg-gray-100/80 hover:text-gray-900"
                      )}
                    >
                      <Icon
                        className={cn(
                          "h-[18px] w-[18px] shrink-0 transition-transform duration-200 group-hover:scale-110",
                          active
                            ? "text-white"
                            : "text-gray-400 group-hover:text-pink-500"
                        )}
                      />
                      <span className={cn("truncate", collapsed && "lg:hidden")}>
                        {item.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className={cn("shrink-0 space-y-2 p-3", collapsed && "lg:px-2")}>
          {perfil && (
            <div
              className={cn(
                "flex items-center gap-3 rounded-2xl bg-pink-50/70 p-2.5",
                collapsed && "lg:justify-center lg:p-1.5"
              )}
              title={`${perfil.nombre} · ${perfil.rol}`}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-pink-600 text-xs font-bold text-white">
                {perfil.nombre
                  .split(" ")
                  .slice(0, 2)
                  .map((n) => n[0])
                  .join("")
                  .toUpperCase()}
              </span>
              <span className={cn("min-w-0", collapsed && "lg:hidden")}>
                <span className="block truncate text-sm font-semibold text-gray-800">{perfil.nombre}</span>
                <span className="block truncate text-xs text-pink-600">{perfil.rol}</span>
              </span>
            </div>
          )}
          <button
            onClick={() => signOut()}
            title="Cerrar sesión"
            className={cn(
              "group flex w-full items-center gap-3 rounded-2xl bg-white/80 p-3 text-sm font-semibold text-gray-700 ring-1 ring-gray-200/70 transition-colors hover:bg-pink-50 hover:text-pink-600",
              collapsed && "lg:justify-center lg:p-2"
            )}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-pink-50 text-pink-600 transition-colors group-hover:bg-white">
              <LogOut className="h-4 w-4" />
            </span>
            <span className={cn("truncate", collapsed && "lg:hidden")}>Cerrar sesión</span>
          </button>
        </div>
      </aside>
    </>
  );
}
