import { describe, expect, it } from "vitest";
import { cambiosDe, descripcionEvento, type EventoAuditoria } from "@/lib/auditoriaTexto";

const ev = (o: Partial<EventoAuditoria>): EventoAuditoria => ({
  id: "1", fecha: "2026-11-01T10:00:00Z", usuarioId: null, usuario: "Ana", accion: "UPDATE",
  tabla: "ventas", registroId: "abcdef123456", detalle: null, ...o,
});

describe("auditoría: textos", () => {
  it("diff antes/después ignora updated_at y campos iguales", () => {
    const c = cambiosDe({ antes: { estado: "pagado", total: 5, updated_at: "a" }, despues: { estado: "anulado", total: 5, updated_at: "b" } });
    expect(c).toEqual([{ campo: "Estado", antes: "pagado", despues: "anulado" }]);
  });
  it("formato antiguo {campo,de,a}", () => {
    expect(cambiosDe({ campo: "metodo_pago", de: "efectivo", a: "yape" })).toEqual([{ campo: "Metodo pago", antes: "efectivo", despues: "yape" }]);
  });
  it("descripción con referencia y cambios", () => {
    const t = descripcionEvento(ev({ detalle: { ref: "B001-12", antes: { estado: "pagado" }, despues: { estado: "anulado" } } }));
    expect(t).toBe("Modificó Venta B001-12 (Estado: pagado → anulado)");
  });
  it("descarga de reporte", () => {
    expect(descripcionEvento(ev({ accion: "DESCARGA", tabla: "auditoria", detalle: { formato: "pdf", filas: 30 } }))).toBe("Descargó reporte (PDF, 30 filas)");
  });
});
