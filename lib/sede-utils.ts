import type { Sede } from "./types";

export const TODAS_LAS_SEDES = "todas";

export const sedeGlobal: Sede = {
  id: TODAS_LAS_SEDES,
  nombre: "Todas las sedes",
  codigo: "ALL",
  direccion: "",
  telefono: "",
  activa: true,
};

/** UUID de la sede o null cuando se trabaja con "todas" (para filtrar en la BD). */
export function sedeFiltro(sedeId: string): string | null {
  return sedeId === TODAS_LAS_SEDES ? null : sedeId;
}
