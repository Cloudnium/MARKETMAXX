"use client";

import { ImageIcon, Loader2, Receipt, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useAsync } from "@/lib/hooks/useAsync";
import { listarProveedores } from "@/lib/data/compras";
import { CATEGORIAS_EGRESO_FORM, TIPOS_DOCUMENTO, actualizarEgreso, obtenerFotoEgreso, registrarEgresoGeneral } from "@/lib/data/egresos";
import type { Egreso } from "@/lib/types";
import { hoyLima } from "@/lib/fechas";

const inputClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100";
const label = "mb-1.5 block text-xs font-medium text-gray-700";
const seccion = "mb-3 text-[11px] font-semibold uppercase tracking-wide text-gray-500";
const req = <span className="text-red-500"> *</span>;

/** Reduce la foto (máx. 1280 px, JPEG) para guardarla ligera junto al egreso. */
async function comprimirFoto(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, mal) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => mal(new Error("No se pudo leer la imagen."));
      i.src = url;
    });
    const k = Math.min(1, 1280 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * k);
    c.height = Math.round(img.height * k);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.72);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Registrar Egreso: comprobante, proveedor, monto y foto (sin IGV ni base imponible). */
export function ModalRegistrarEgreso({
  open,
  sedeId,
  onClose,
  onDone,
  egreso,
}: {
  egreso?: Egreso | null;
  open: boolean;
  sedeId: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [categoria, setCategoria] = useState<string>(CATEGORIAS_EGRESO_FORM[0]);
  const [tipoDoc, setTipoDoc] = useState("Factura");
  const [serie, setSerie] = useState("");
  const [numero, setNumero] = useState("");
  const [fecha, setFecha] = useState(hoyLima());
  const [ruc, setRuc] = useState("");
  const [razon, setRazon] = useState("");
  const [monto, setMonto] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [foto, setFoto] = useState<string | null>(null);
  const [descontar, setDescontar] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const archivo = useRef<HTMLInputElement>(null);
  const provs = useAsync(() => (open ? listarProveedores() : Promise.resolve([])), [open], []);

  const [fotoCambio, setFotoCambio] = useState(false);
  const editando = !!egreso;

  useEffect(() => {
    if (!open) return;
    setError(null);
    setFotoCambio(false);
    if (egreso) {
      const doc = egreso.numeroDocumento ?? "";
      const i = doc.indexOf("-");
      setCategoria(egreso.categoria);
      setTipoDoc(egreso.tipoDocumento || "Sin documento");
      setSerie(i >= 0 ? doc.slice(0, i) : doc);
      setNumero(i >= 0 ? doc.slice(i + 1) : "");
      setFecha(egreso.fechaEgreso ?? hoyLima());
      setRuc(egreso.proveedorDocumento ?? "");
      setRazon(egreso.proveedor ?? "");
      setMonto(String(egreso.monto));
      setDescripcion(egreso.concepto);
      setFoto(null);
      if (egreso.tieneFoto) obtenerFotoEgreso(egreso.id).then(setFoto).catch(() => {});
    } else {
      setCategoria(CATEGORIAS_EGRESO_FORM[0]);
      setTipoDoc("Factura");
      setSerie("");
      setNumero("");
      setFecha(hoyLima());
      setRuc("");
      setRazon("");
      setMonto("");
      setDescripcion("");
      setFoto(null);
      setDescontar(true);
    }
  }, [open, egreso]);

  const sinDoc = tipoDoc === "Sin documento";

  const elegirFoto = async (f?: File | null) => {
    if (!f) return;
    try {
      setFoto(await comprimirFoto(f));
      setFotoCambio(true);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const guardar = async () => {
    if (!sedeId) return;
    setError(null);
    if (!sinDoc && (!serie.trim() || !numero.trim())) return setError("Escribe la serie y el N° de comprobante.");
    if (!sinDoc && ruc.trim().length < 8) return setError("Escribe el RUC o DNI del proveedor.");
    if (razon.trim().length < 2) return setError("Escribe la razón social o el nombre.");
    if (!(Number(monto) > 0)) return setError("El importe total debe ser mayor a cero.");
    setGuardando(true);
    try {
      if (egreso) {
        await actualizarEgreso({
          id: egreso.id,
          fecha,
          categoria,
          concepto: descripcion,
          proveedor: razon,
          monto: Number(monto),
          tipoDocumento: sinDoc ? "" : tipoDoc,
          numeroDocumento: sinDoc ? "" : `${serie.trim()}-${numero.trim()}`,
          proveedorDocumento: ruc,
          foto: fotoCambio ? foto : null,
          quitarFoto: fotoCambio && !foto,
        });
        onDone();
        return;
      }
      await registrarEgresoGeneral({
        sedeId,
        fecha,
        categoria,
        concepto: descripcion,
        proveedor: razon,
        proveedorDocumento: ruc,
        monto: Number(monto),
        tipoDocumento: sinDoc ? "" : tipoDoc,
        numeroDocumento: sinDoc ? "" : `${serie.trim()}-${numero.trim()}`,
        observaciones: "",
        descontarCaja: descontar,
        foto,
      });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <Receipt className="h-5 w-5 text-blue-600" /> {editando ? "Editar Egreso" : "Registrar Egreso"}
        </span>
      }
      subtitle="Los campos marcados con * son obligatorios"
      size="lg"
      footer={
        <>
          <button onClick={onClose} className="rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50">
            Cancelar
          </button>
          <button
            onClick={guardar}
            disabled={guardando || !sedeId}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {guardando && <Loader2 className="h-4 w-4 animate-spin" />} {editando ? "Guardar cambios" : "Registrar egreso"}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        <div>
          <label className={label}>Categoría{req}</label>
          <select value={categoria} onChange={(e) => setCategoria(e.target.value)} className={inputClass}>
            {CATEGORIAS_EGRESO_FORM.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>

        <div className="border-t border-gray-100 pt-4">
          <p className={seccion}>Comprobante de pago</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className={label}>Tipo{req}</label>
              <select value={tipoDoc} onChange={(e) => setTipoDoc(e.target.value)} className={inputClass}>
                {TIPOS_DOCUMENTO.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className={label}>Serie{!sinDoc && req}</label>
              <input value={serie} disabled={sinDoc} onChange={(e) => setSerie(e.target.value.toUpperCase())} placeholder="F001" className={`${inputClass} disabled:bg-gray-50`} />
            </div>
            <div>
              <label className={label}>N° Comprobante{!sinDoc && req}</label>
              <input value={numero} disabled={sinDoc} onChange={(e) => setNumero(e.target.value)} placeholder="00001234" className={`${inputClass} disabled:bg-gray-50`} />
            </div>
          </div>
          <div className="mt-3">
            <label className={label}>Fecha de emisión{req}</label>
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={inputClass} />
          </div>
        </div>

        <div className="border-t border-gray-100 pt-4">
          <p className={seccion}>Información del proveedor</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={label}>RUC / DNI{!sinDoc && req}</label>
              <input value={ruc} onChange={(e) => setRuc(e.target.value.replace(/\D/g, ""))} maxLength={11} placeholder="20123456789" className={inputClass} />
            </div>
            <div>
              <label className={label}>Razón social{req}</label>
              <input list="egreso-proveedores" value={razon} onChange={(e) => setRazon(e.target.value)} placeholder="EMPRESA S.A.C." className={inputClass} />
              <datalist id="egreso-proveedores">
                {(provs.data ?? []).map((p) => <option key={p.id} value={p.nombre} />)}
              </datalist>
            </div>
          </div>
        </div>

        <div className="border-t border-gray-100 pt-4">
          <p className={seccion}>Montos</p>
          <div className="max-w-xs">
            <label className={label}>Importe total{req}</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">S/</span>
              <input type="number" min={0} step="0.01" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="0.00" className={`${inputClass} pl-9`} />
            </div>
          </div>
        </div>

        <div className="border-t border-gray-100 pt-4">
          <label className={label}>Descripción <span className="font-normal text-gray-400">(opcional)</span></label>
          <textarea rows={2} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Ej: Pago de luz de octubre, adelanto de sueldo..." className={inputClass} />
        </div>

        <div className="border-t border-gray-100 pt-4">
          <label className={label}>Foto del comprobante <span className="font-normal text-gray-400">(opcional)</span></label>
          <div className="flex h-36 items-center justify-center overflow-hidden rounded-lg border-2 border-dashed border-gray-300 bg-gray-50">
            {foto ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={foto} alt="Comprobante" className="h-full w-full object-contain" />
            ) : (
              <div className="text-center text-xs text-gray-400">
                <ImageIcon className="mx-auto mb-1 h-7 w-7" /> Sin foto
              </div>
            )}
          </div>
          <input ref={archivo} type="file" accept="image/*" capture="environment" hidden onChange={(e) => elegirFoto(e.target.files?.[0])} />
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => archivo.current?.click()} className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-gray-300 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50">
              <Upload className="h-4 w-4" /> Tomar / subir foto
            </button>
            {foto && (
              <button type="button" onClick={() => { setFoto(null); setFotoCambio(true); }} className="rounded-lg border border-gray-300 px-3 text-gray-500 hover:bg-gray-50" title="Quitar foto">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {!editando && <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-gray-200 p-3 text-sm">
          <input type="checkbox" checked={descontar} onChange={(e) => setDescontar(e.target.checked)} className="mt-0.5 h-4 w-4 accent-blue-600" />
          <span>
            <span className="font-semibold text-gray-900">Descontar de mi caja abierta</span>
            <span className="block text-xs text-gray-500">Si tienes una caja abierta en esta sede, el egreso se resta de su neto y sale en su reporte y ticket.</span>
          </span>
        </label>}
      </div>
    </Modal>
  );
}
