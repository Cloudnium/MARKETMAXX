import { construirTicket, type TicketElement } from "./ticket";
import type { TicketData } from "./ticket";
import { cargarLogoBase64 } from "./logo";

export type { TicketData } from "./ticket";

export type PrinterTarget =
  | { interface: "usb"; name: string; width?: number }
  | { interface: "network"; ip: string; port?: number; width?: number };

export interface AgenteConfig {
  port: number;
  token: string;
  width: number;
  target: PrinterTarget | null;
}

export interface AgentePrinter {
  name: string;
  status?: string;
}

export type ResultadoImpresion =
  | { ok: true }
  | {
      ok: false;
      motivo: "sin-agente" | "token" | "sin-impresora" | "sin-respuesta" | "error";
      error: string;
    };

const STORAGE_KEY = "market.printAgent.config.v1";
export const DEFAULT_PORT = 4321;
const HEALTH_TIMEOUT = 3000;
const REQUEST_TIMEOUT = 8000;
const PRINT_TIMEOUT = 20000;

export class AgenteError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "AgenteError";
    this.status = status;
  }
}

export function leerConfigAgente(): AgenteConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<AgenteConfig>;
    if (!data.token) return null;
    const port = Number(data.port) || DEFAULT_PORT;
    const width = data.width === 32 ? 32 : 48;
    return {
      port,
      token: String(data.token),
      width,
      target: data.target ?? null,
    };
  } catch {
    return null;
  }
}

export function guardarConfigAgente(config: AgenteConfig) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function limpiarConfigAgente() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}

export function urlAgente(port: number) {
  return `http://127.0.0.1:${port}`;
}

export function urlPanelAgente(port: number) {
  return `${urlAgente(port)}/config.html`;
}

export function describirTarget(target: PrinterTarget | null | undefined) {
  if (!target) return "Sin impresora configurada";
  if (target.interface === "network") return `Red ${target.ip}:${target.port ?? 9100}`;
  return target.name;
}

async function consultar<T>(
  url: string,
  opciones: RequestInit = {},
  timeout = REQUEST_TIMEOUT
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...opciones, signal: controller.signal, cache: "no-store" });
    const data = (await res.json().catch(() => null)) as
      | (T & { ok?: boolean; error?: string })
      | null;
    if (!res.ok) {
      throw new AgenteError(data?.error || `El agente respondió con error ${res.status}`, res.status);
    }
    return data as T;
  } catch (error) {
    if (error instanceof AgenteError) throw error;
    if ((error as Error).name === "AbortError") {
      throw new AgenteError("El agente no respondió a tiempo");
    }
    throw new AgenteError("No se pudo conectar con el agente de impresión");
  } finally {
    clearTimeout(timer);
  }
}

export async function estadoAgente(port: number) {
  return consultar<{ ok: boolean; version: string }>(
    `${urlAgente(port)}/health`,
    { method: "GET" },
    HEALTH_TIMEOUT
  );
}

export async function listarImpresorasAgente(config: AgenteConfig) {
  return consultar<{
    ok: boolean;
    printers: AgentePrinter[];
    defaultPrinter: PrinterTarget | null;
  }>(`${urlAgente(config.port)}/printers`, {
    method: "GET",
    headers: { "x-agent-token": config.token },
  });
}

export async function configurarImpresoraAgente(config: AgenteConfig, target: PrinterTarget) {
  return consultar<{ ok: boolean; defaultPrinter: PrinterTarget }>(
    `${urlAgente(config.port)}/printers/default`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-agent-token": config.token,
      },
      body: JSON.stringify({ target }),
    }
  );
}

export async function imprimirPruebaAgente(config: AgenteConfig) {
  return consultar<{ ok: boolean }>(
    `${urlAgente(config.port)}/print/test`,
    {
      method: "POST",
      headers: { "x-agent-token": config.token },
    },
    PRINT_TIMEOUT
  );
}

export async function imprimirDocumentoAgente(config: AgenteConfig, elements: TicketElement[]) {
  const target = config.target ? { ...config.target, width: config.width } : undefined;
  return consultar<{ ok: boolean }>(
    `${urlAgente(config.port)}/print`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-agent-token": config.token,
      },
      body: JSON.stringify({ target, elements }),
    },
    PRINT_TIMEOUT
  );
}

export async function imprimirTicket(data: TicketData): Promise<ResultadoImpresion> {
  const config = leerConfigAgente();
  if (!config) {
    return { ok: false, motivo: "sin-agente", error: "Agente de impresión no vinculado" };
  }

  try {
    const logoBase64 = await cargarLogoBase64();
    await imprimirDocumentoAgente(
      config,
      construirTicket(data, config.width, { logoBase64: logoBase64 ?? undefined })
    );
    return { ok: true };
  } catch (error) {
    const err = error as AgenteError;
    if (err.status === 401) return { ok: false, motivo: "token", error: err.message };
    if (err.status === 400) return { ok: false, motivo: "sin-impresora", error: err.message };
    if (err.message.includes("No se pudo conectar")) {
      return { ok: false, motivo: "sin-agente", error: err.message };
    }
    if (err.message.includes("no respondió")) {
      return { ok: false, motivo: "sin-respuesta", error: err.message };
    }
    return { ok: false, motivo: "error", error: err.message };
  }
}
