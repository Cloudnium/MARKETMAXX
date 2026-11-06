import { describe, expect, it } from "vitest";
import { CATEGORIAS } from "@/components/asistente/preguntas";
import { itemsAReservar, RESERVA_MAXIMO } from "@/lib/offline/auto";

describe("Asistente Markit", () => {
  it("todas las preguntas tienen id único y una respuesta con contenido", () => {
    const ids = CATEGORIAS.flatMap((c) => c.preguntas.map((p) => p.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of CATEGORIAS) for (const p of c.preguntas) {
      expect(p.texto.trim().length).toBeGreaterThan(5);
      const r = p.respuesta;
      expect(Boolean(r.intro) || (r.pasos?.length ?? 0) > 0).toBe(true);
    }
  });
  it("cubre los temas básicos (vender, abrir caja, cerrar caja, sin internet)", () => {
    const ids = CATEGORIAS.flatMap((c) => c.preguntas.map((p) => p.id));
    for (const k of ["vender", "abrir-caja", "cerrar-caja", "sin-internet", "anular", "egreso"]) expect(ids).toContain(k);
  });
});

describe("Reserva automática: cuánto se reserva", () => {
  const p = (id: string, stock: number, activo = true) => ({ id, stock, activo });
  it("25% del stock, con tope, sin reservar productos escasos ni inactivos", () => {
    const r = itemsAReservar([p("a", 20), p("b", 3), p("c", 1000), p("d", 40, false)], null);
    expect(r).toEqual([{ productoId: "a", cantidad: 5 }, { productoId: "c", cantidad: RESERVA_MAXIMO }]);
  });
});
