"use client";

import { useState } from "react";
import { Navbar } from "./Navbar";
import { Sidebar, type View } from "./Sidebar";
import { ScrollToTopButton } from "./ScrollToTopButton";
import { ReservaAutomatica } from "./ReservaAutomatica";
import { BotonAsistente } from "./BotonAsistente";
import { cn } from "@/lib/utils";

const titles: Record<View, string> = {
  dashboard: "Dashboard",
  ventas: "Punto de Venta",
  productos: "Productos",
  clientes: "Clientes",
  usuarios: "Usuarios",
  caja: "Cajas",
  almacen: "Almacén",
  comprobantes: "Comprobantes",
  compras: "Egresos",
  reportes: "Reportes",
  sedes: "Sedes",
  asistente: "Asistente",
  impresion: "Impresión",
  backup: "Backup",
  auditoria: "Auditoría",
};

export function DashboardLayout({
  activeView,
  onViewChange,
  children,
}: {
  activeView: View;
  onViewChange: (view: View) => void;
  children: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-pink-50/50">
      <Navbar
        title={titles[activeView]}
        onMenuClick={() => setSidebarOpen(true)}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((value) => !value)}
      />
      <Sidebar
        activeView={activeView}
        onViewChange={onViewChange}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        collapsed={collapsed}
      />
      <main
        className={cn(
          "pt-24 transition-[padding] duration-300",
          collapsed ? "lg:pl-28" : "lg:pl-72"
        )}
      >
        <div className="mx-auto max-w-[1600px] p-4 sm:p-6">{children}</div>
      </main>
      <ScrollToTopButton />
      <ReservaAutomatica />
      <BotonAsistente oculto={activeView === "asistente"} />
    </div>
  );
}
