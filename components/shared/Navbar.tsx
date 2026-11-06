"use client";

import { ChevronsLeft, ChevronsRight, LogOut, Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { SedeSelector } from "./SedeSelector";
import { useAuth } from "./AuthProvider";
import { PanelOffline } from "./PanelOffline";

interface NavbarProps {
  onMenuClick: () => void;
  title: string;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function Navbar({
  onMenuClick,
  title,
  collapsed,
  onToggleCollapse,
}: NavbarProps) {
  const { signOut } = useAuth();
  return (
    <header
      className={cn(
        "fixed left-4 right-4 top-4 z-30 flex h-16 items-center justify-between rounded-2xl border border-white/20 px-3 shadow-lg shadow-pink-900/10 backdrop-blur-md transition-[left] duration-300 sm:px-5",
        collapsed ? "lg:left-28" : "lg:left-72"
      )}
      style={{
        background:
          "linear-gradient(135deg, #c4167a 0%, #E91E8C 50%, #c4167a 100%)",
      }}
    >
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <button
          onClick={onMenuClick}
          className="rounded-xl p-2 text-white/90 transition-colors hover:bg-white/10 lg:hidden"
          aria-label="Abrir menú"
        >
          <Menu className="h-5 w-5" />
        </button>
        <button
          onClick={onToggleCollapse}
          className="hidden rounded-xl p-2 text-white/90 transition-colors hover:bg-white/10 lg:inline-flex"
          aria-label={collapsed ? "Expandir menú" : "Contraer menú"}
          title={collapsed ? "Expandir menú" : "Contraer menú"}
        >
          {collapsed ? (
            <ChevronsRight className="h-5 w-5" />
          ) : (
            <ChevronsLeft className="h-5 w-5" />
          )}
        </button>
        <h1 className="truncate text-base font-bold text-white sm:text-lg">
          {title}
        </h1>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <SedeSelector />
        <PanelOffline />
        <button
          onClick={() => signOut()}
          className="flex items-center gap-2 rounded-xl bg-white/15 px-3 py-2 text-sm font-semibold text-white ring-1 ring-white/10 transition-colors hover:bg-white/25"
        >
          <LogOut className="h-4 w-4" />
          <span className="hidden sm:inline">Salir</span>
        </button>
      </div>
    </header>
  );
}
