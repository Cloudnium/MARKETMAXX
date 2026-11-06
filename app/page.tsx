"use client";

import { useEffect, useState } from "react";
import { Loader2, ShieldAlert } from "lucide-react";
import { DashboardLayout } from "@/components/shared/DashboardLayout";
import { StockAlertModal } from "@/components/shared/StockAlertModal";
import { useAuth } from "@/components/shared/AuthProvider";
import { viewPermiso, type View } from "@/components/shared/Sidebar";
import { DashboardView } from "@/components/dashboard/DashboardView";
import { VentasView } from "@/components/ventas/VentasView";
import { ProductosView } from "@/components/productos/ProductosView";
import { ClientesView } from "@/components/clientes/ClientesView";
import { UsuariosView } from "@/components/usuarios/UsuariosView";
import { CajasView } from "@/components/cajas/CajasView";
import { AlmacenView } from "@/components/almacen/AlmacenView";
import { ComprobantesView } from "@/components/comprobantes/ComprobantesView";
import { EgresosView } from "@/components/egresos/EgresosView";
import { ReportesView } from "@/components/reportes/ReportesView";
import { AsistenteView } from "@/components/asistente/AsistenteView";
import { BackupView } from "@/components/backup/BackupView";
import { ImpresionView } from "@/components/impresion/ImpresionView";
import { SedesView } from "@/components/sedes/SedesView";

const views: Record<View, React.ComponentType> = {
  dashboard: DashboardView,
  ventas: VentasView,
  productos: ProductosView,
  clientes: ClientesView,
  usuarios: UsuariosView,
  caja: CajasView,
  almacen: AlmacenView,
  comprobantes: ComprobantesView,
  compras: EgresosView,
  reportes: ReportesView,
  sedes: SedesView,
  asistente: AsistenteView,
  impresion: ImpresionView,
  backup: BackupView,
};

export default function Home() {
  const { loading, perfil, can, errorRed, sinSesion, refresh } = useAuth();
  const [activeView, setActiveView] = useState<View>("dashboard");
  const [stockAlertOpen, setStockAlertOpen] = useState(true);

  const permitida = (view: View) => {
    const p = viewPermiso[view];
    return Array.isArray(p) ? p.some(can) : can(p);
  };

  // Si no tiene acceso al dashboard, abre la primera vista permitida
  useEffect(() => {
    if (loading || !perfil) return;
    if (!permitida(activeView)) {
      const primera = (Object.keys(views) as View[]).find(permitida);
      if (primera) setActiveView(primera);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, perfil]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-pink-600">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!perfil) {
    // Fallo de red: NO es "sin sesión". No se redirige ni se cierra nada; se reintenta solo al reconectar.
    if (errorRed && !sinSesion) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-pink-600" />
          <p className="text-sm font-semibold text-gray-800">No pudimos conectar con el servidor</p>
          <p className="max-w-sm text-xs text-gray-500">Tu sesión sigue activa. Reintentaremos automáticamente cuando vuelva la conexión.</p>
          <button onClick={() => refresh()} className="rounded-lg bg-pink-600 px-4 py-2 text-sm font-semibold text-white hover:bg-pink-700">
            Reintentar ahora
          </button>
        </div>
      );
    }
    // sin sesión de verdad (cerrada, vencida o usuario inactivo)
    if (typeof window !== "undefined") window.location.replace("/login");
    return null;
  }

  const ActiveView = views[activeView];

  return (
    <DashboardLayout activeView={activeView} onViewChange={setActiveView}>
      {!permitida(activeView) ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <ShieldAlert className="h-12 w-12 text-amber-500" />
          <h2 className="mt-4 text-lg font-bold text-gray-900">Sin acceso</h2>
          <p className="mt-1 max-w-sm text-sm text-gray-500">
            Tu rol ({perfil.rol}) no tiene permiso para usar este módulo. Si lo necesitas, pide a un
            administrador que lo habilite.
          </p>
        </div>
      ) : activeView === "dashboard" ? (
        <DashboardView onNavigate={setActiveView} />
      ) : (
        <ActiveView />
      )}
      {can("almacen.ver") && (
        <StockAlertModal
          open={stockAlertOpen}
          onClose={() => setStockAlertOpen(false)}
          onVerInventario={() => setActiveView("almacen")}
        />
      )}
    </DashboardLayout>
  );
}
