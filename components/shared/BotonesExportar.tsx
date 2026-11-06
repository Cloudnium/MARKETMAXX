"use client";

import { FileDown, FileSpreadsheet, Loader2, X } from "lucide-react";

/**
 * Pie de los historiales: [Cerrar] [Excel] [PDF].
 * Diseño: Cerrar blanco con borde, Excel verde, PDF rojo (mismo tamaño y redondeo).
 */
export function BotonesExportar({
  onClose,
  onExcel,
  onPdf,
  exportando,
  deshabilitado,
}: {
  onClose: () => void;
  onExcel: () => void;
  onPdf: () => void;
  exportando?: "excel" | "pdf" | null;
  deshabilitado?: boolean;
}) {
  const base =
    "inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60";
  return (
    <>
      <button
        type="button"
        onClick={onClose}
        className={`${base} border border-gray-200 bg-white text-gray-800 hover:bg-gray-50`}
      >
        <X className="h-4 w-4" /> Cerrar
      </button>
      <button
        type="button"
        onClick={onExcel}
        disabled={deshabilitado || !!exportando}
        className={`${base} bg-emerald-600 text-white hover:bg-emerald-700`}
      >
        {exportando === "excel" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
        Excel
      </button>
      <button
        type="button"
        onClick={onPdf}
        disabled={deshabilitado || !!exportando}
        className={`${base} bg-red-600 text-white hover:bg-red-700`}
      >
        {exportando === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
        PDF
      </button>
    </>
  );
}
