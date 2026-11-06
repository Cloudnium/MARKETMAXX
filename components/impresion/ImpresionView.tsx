"use client";

import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  FileText,
  Loader2,
  Printer,
  RefreshCw,
  Settings,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardHeader } from "@/components/ui/Card";
import { Toast } from "@/components/ui/Toast";
import {
  AgenteError,
  DEFAULT_PORT,
  configurarImpresoraAgente,
  describirTarget,
  estadoAgente,
  guardarConfigAgente,
  imprimirDocumentoAgente,
  leerConfigAgente,
  limpiarConfigAgente,
  listarImpresorasAgente,
  urlPanelAgente,
  type AgenteConfig,
  type AgentePrinter,
  type PrinterTarget,
} from "@/lib/impresion/agente";

type EstadoConexion = "verificando" | "conectado" | "desconectado";

export function ImpresionView() {
  const [config, setConfig] = useState<AgenteConfig | null>(null);
  const [estado, setEstado] = useState<EstadoConexion>("verificando");
  const [versionAgente, setVersionAgente] = useState("");
  const [puerto, setPuerto] = useState(String(DEFAULT_PORT));
  const [token, setToken] = useState("");
  const [impresoras, setImpresoras] = useState<AgentePrinter[]>([]);
  const [ancho, setAncho] = useState(48);
  const [impresoraRedIp, setImpresoraRedIp] = useState("");
  const [impresoraRedPuerto, setImpresoraRedPuerto] = useState("9100");
  const [ocupado, setOcupado] = useState(false);
  const [probando, setProbando] = useState(false);
  const [notificacion, setNotificacion] = useState<{
    mensaje: string;
    tono: "success" | "error" | "info";
  } | null>(null);

  async function cargarImpresoras(conf: AgenteConfig) {
    try {
      const datos = await listarImpresorasAgente(conf);
      setImpresoras(datos.printers ?? []);
      if (datos.defaultPrinter) {
        const width = datos.defaultPrinter.width === 32 ? 32 : conf.width;
        const actualizada = { ...conf, target: datos.defaultPrinter, width };
        setAncho(width);
        guardarConfigAgente(actualizada);
        setConfig(actualizada);
      }
    } catch (error) {
      setNotificacion({
        mensaje:
          error instanceof AgenteError && error.status === 401
            ? "Token inválido. Vuelve a emparejar el agente."
            : (error as Error).message,
        tono: "error",
      });
    }
  }

  useEffect(() => {
    let activo = true;

    (async () => {
      const guardada = leerConfigAgente();
      if (guardada) {
        if (!activo) return;
        setConfig(guardada);
        setPuerto(String(guardada.port));
        setAncho(guardada.width);
        setEstado("verificando");
        try {
          const res = await estadoAgente(guardada.port);
          if (!activo) return;
          setVersionAgente(res.version ?? "");
          setEstado("conectado");
          await cargarImpresoras(guardada);
        } catch {
          if (activo) setEstado("desconectado");
        }
        return;
      }

      try {
        const res = await estadoAgente(DEFAULT_PORT);
        if (!activo) return;
        setVersionAgente(res.version ?? "");
        setEstado("conectado");
      } catch {
        if (activo) setEstado("desconectado");
      }
    })();

    return () => {
      activo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refrescar = async () => {
    const port = config?.port ?? (Number(puerto) || DEFAULT_PORT);
    setEstado("verificando");
    try {
      const res = await estadoAgente(port);
      setVersionAgente(res.version ?? "");
      setEstado("conectado");
      if (config) await cargarImpresoras({ ...config, port });
    } catch {
      setEstado("desconectado");
      setNotificacion({
        mensaje: "No se pudo conectar con el agente. Verifica que esté ejecutándose.",
        tono: "error",
      });
    }
  };

  const emparejar = async () => {
    if (!token.trim()) {
      setNotificacion({ mensaje: "Pega el token que muestra el panel del agente.", tono: "error" });
      return;
    }

    const conf: AgenteConfig = {
      port: Number(puerto) || DEFAULT_PORT,
      token: token.trim(),
      width: ancho,
      target: null,
    };

    setOcupado(true);
    try {
      const res = await estadoAgente(conf.port);
      setEstado("conectado");
      setVersionAgente(res.version ?? "");
      setPuerto(String(conf.port));
      const datos = await listarImpresorasAgente(conf);
      const width = datos.defaultPrinter?.width === 32 ? 32 : ancho;
      const final: AgenteConfig = {
        ...conf,
        width,
        target: datos.defaultPrinter ?? null,
      };
      guardarConfigAgente(final);
      setAncho(width);
      setConfig(final);
      setVersionAgente(res.version ?? "");
      setEstado("conectado");
      setImpresoras(datos.printers ?? []);
      setToken("");
      setNotificacion({
        mensaje: "Equipo vinculado. Ya puedes elegir la impresora; esta configuración sirve para todas las sedes.",
        tono: "success",
      });
    } catch (error) {
      setNotificacion({ mensaje: (error as Error).message, tono: "error" });
    } finally {
      setOcupado(false);
    }
  };

  const usarUsb = async (impresora: AgentePrinter) => {
    if (!config) return;
    setOcupado(true);
    try {
      const target: PrinterTarget = { interface: "usb", name: impresora.name, width: ancho };
      const res = await configurarImpresoraAgente(config, target);
      const actualizada = { ...config, target: res.defaultPrinter ?? target };
      guardarConfigAgente(actualizada);
      setConfig(actualizada);
      setNotificacion({
        mensaje: `Impresora "${impresora.name}" configurada como predeterminada.`,
        tono: "success",
      });
    } catch (error) {
      setNotificacion({ mensaje: (error as Error).message, tono: "error" });
    } finally {
      setOcupado(false);
    }
  };

  const usarRed = async () => {
    if (!config) return;
    if (!impresoraRedIp.trim()) {
      setNotificacion({ mensaje: "Ingresa la IP de la impresora de red.", tono: "error" });
      return;
    }
    setOcupado(true);
    try {
      const target: PrinterTarget = {
        interface: "network",
        ip: impresoraRedIp.trim(),
        port: Number(impresoraRedPuerto) || 9100,
        width: ancho,
      };
      const res = await configurarImpresoraAgente(config, target);
      const actualizada = { ...config, target: res.defaultPrinter ?? target };
      guardarConfigAgente(actualizada);
      setConfig(actualizada);
      setNotificacion({
        mensaje: "Impresora de red configurada como predeterminada.",
        tono: "success",
      });
    } catch (error) {
      setNotificacion({ mensaje: (error as Error).message, tono: "error" });
    } finally {
      setOcupado(false);
    }
  };

  const cambiarAncho = async (valor: number) => {
    const nuevo = valor === 32 ? 32 : 48;
    setAncho(nuevo);

    if (!config) return;
    const target = config.target ? { ...config.target, width: nuevo } : null;
    const actualizada = { ...config, width: nuevo, target };
    guardarConfigAgente(actualizada);
    setConfig(actualizada);

    if (target) {
      try {
        await configurarImpresoraAgente(config, target);
      } catch (error) {
        setNotificacion({ mensaje: (error as Error).message, tono: "error" });
      }
    }
  };

  const imprimirPrueba = async () => {
    if (!config) return;
    setProbando(true);
    try {
      await imprimirDocumentoAgente(config, [
        { type: "text", value: "TICKET DE PRUEBA", align: "center", bold: true, size: "double" },
        { type: "line" },
        {
          type: "text",
          value: "Agente de impresión configurado correctamente.",
          align: "center",
        },
        {
          type: "text",
          value: `Papel: ${ancho === 32 ? "58 mm" : "80 mm"}`,
          align: "center",
        },
        { type: "feed", lines: 3 },
        { type: "cut" },
      ]);
      setNotificacion({ mensaje: "Ticket de prueba enviado.", tono: "success" });
    } catch (error) {
      setNotificacion({ mensaje: (error as Error).message, tono: "error" });
    } finally {
      setProbando(false);
    }
  };

  const desvincular = () => {
    limpiarConfigAgente();
    setConfig(null);
    setImpresoras([]);
    setToken("");
    setAncho(48);
    setNotificacion({
      mensaje: "Agente desvinculado de este navegador. Puedes volver a emparejarlo cuando quieras.",
      tono: "info",
    });
  };

  const abrirPanel = () => {
    const port = config?.port ?? (Number(puerto) || DEFAULT_PORT);
    window.open(urlPanelAgente(port), "_blank", "noopener,noreferrer");
  };

  const conectado = estado === "conectado";
  const vinculado = Boolean(config);

  return (
    <div>
      <PageHeader
        title="Impresión"
        subtitle="Vincula el agente local y deja lista tu impresora térmica"
        actions={
          <button
            onClick={refrescar}
            disabled={estado === "verificando"}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {estado === "verificando" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Actualizar estado
          </button>
        }
      />

      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader
              title="Agente de impresión"
              icon={Printer}
              tone="green"
              subtitle="Conexión local de esta PC"
            />
            <div className="space-y-4 p-5">
              <div
                className={`flex items-center gap-4 rounded-lg p-4 ${
                  conectado ? "bg-green-50" : "bg-amber-50"
                }`}
              >
                <div
                  className={`rounded-lg p-3 ${
                    conectado ? "bg-green-100 text-green-600" : "bg-amber-100 text-amber-600"
                  }`}
                >
                  {conectado ? <Wifi className="h-6 w-6" /> : <WifiOff className="h-6 w-6" />}
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-900">
                    {estado === "verificando"
                      ? "Verificando conexión..."
                      : conectado
                        ? "Agente en línea"
                        : "Agente no detectado"}
                  </p>
                  <p className="text-xs text-gray-500">
                    127.0.0.1:{config?.port ?? puerto}
                    {versionAgente ? ` · v${versionAgente}` : ""}
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3 text-sm">
                  <span className="text-gray-500">Vinculación</span>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      vinculado
                        ? "bg-green-100 text-green-700"
                        : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {vinculado ? (
                      <>
                        <CheckCircle2 className="h-3 w-3" /> Vinculado
                      </>
                    ) : (
                      <>
                        <AlertCircle className="h-3 w-3" /> Sin vincular
                      </>
                    )}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3 text-sm">
                  <span className="text-gray-500">Impresora</span>
                  <span className="max-w-[60%] truncate text-right font-semibold text-gray-900">
                    {describirTarget(config?.target)}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3 text-sm">
                  <span className="text-gray-500">Papel</span>
                  <span className="font-semibold text-gray-900">
                    {ancho === 32 ? "58 mm" : "80 mm"}
                  </span>
                </div>
              </div>

              {vinculado && (
                <button
                  onClick={desvincular}
                  className="w-full rounded-lg border border-red-200 bg-white px-4 py-2.5 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50"
                >
                  Desvincular este navegador
                </button>
              )}
            </div>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader
              title={vinculado ? "Equipo vinculado" : "Vincular este equipo"}
              icon={Settings}
              tone="blue"
              subtitle="Solo se configura una vez por PC"
            />
            <div className="space-y-4 p-5">
              {vinculado && config ? (
                <>
                  <div className="flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 p-4">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
                    <div>
                      <p className="text-sm font-semibold text-green-800">
                        Este navegador ya está vinculado al agente.
                      </p>
                      <p className="mt-1 text-xs text-green-700">
                        Las ventas de cualquier sede se imprimen automáticamente en esta PC. Solo
                        cambia la impresora si instalas otra.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-gray-700">
                        Puerto del agente
                      </label>
                      <input
                        value={config.port}
                        readOnly
                        className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-600"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-gray-700">
                        Token
                      </label>
                      <input
                        value="••••••••-••••-••••-••••-••••••••••••"
                        readOnly
                        className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-500"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row">
                    <button
                      onClick={abrirPanel}
                      className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                    >
                      <ExternalLink className="h-4 w-4" /> Abrir panel del agente
                    </button>
                    <button
                      onClick={desvincular}
                      className="rounded-lg border border-red-200 bg-white px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50"
                    >
                      Vincular otro equipo
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm text-gray-600">
                    Pega el token que abrió el instalador del agente. Se guarda en este navegador y
                    no tienes que volver a hacerlo al cambiar de sede.
                  </p>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-[150px_1fr]">
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-gray-700">
                        Puerto
                      </label>
                      <input
                        value={puerto}
                        onChange={(e) => setPuerto(e.target.value)}
                        inputMode="numeric"
                        placeholder="4321"
                        className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-gray-700">
                        Token del agente
                      </label>
                      <input
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                        placeholder="768efc61-8a9c-4c59-b217-..."
                        className="w-full rounded-lg border border-gray-300 px-3 py-2.5 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row">
                    <button
                      onClick={emparejar}
                      disabled={ocupado}
                      className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {ocupado && <Loader2 className="h-4 w-4 animate-spin" />}
                      Vincular agente
                    </button>
                    <button
                      onClick={abrirPanel}
                      className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                    >
                      <ExternalLink className="h-4 w-4" /> Obtener token
                    </button>
                  </div>
                </>
              )}

              <div className="rounded-lg bg-gray-50 p-4 text-xs text-gray-600">
                <p className="font-semibold text-gray-700">Cómo vincular (solo una vez)</p>
                <ol className="mt-2 list-decimal space-y-1 pl-4">
                  <li>Instala el agente en la PC de caja con `instalar.exe`.</li>
                  <li>Abre el panel local y copia el token.</li>
                  <li>Pégalo aquí y pulsa “Vincular agente”.</li>
                  <li>Elige la impresora y envía un ticket de prueba.</li>
                </ol>
                <p className="mt-2">
                  La configuración queda guardada en este navegador y funciona para vender en
                  cualquier sede.
                </p>
              </div>
            </div>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader
              title="Impresora predeterminada"
              icon={Printer}
              tone="purple"
              subtitle="USB instalada en Windows o impresora de red"
            />
            <div className="space-y-4 p-5">
              <div className="rounded-lg bg-gray-50 px-4 py-3">
                <p className="text-xs text-gray-500">Impresora actual</p>
                <p className="mt-0.5 font-semibold text-gray-900">
                  {describirTarget(config?.target)}
                </p>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  Tamaño de papel
                </label>
                <select
                  value={ancho}
                  onChange={(e) => cambiarAncho(Number(e.target.value))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
                >
                  <option value={48}>80 mm (48 caracteres)</option>
                  <option value={32}>58 mm (32 caracteres)</option>
                </select>
              </div>

              <div>
                <p className="mb-2 text-sm font-medium text-gray-700">
                  Impresoras USB detectadas
                </p>
                {impresoras.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-gray-300 p-3 text-xs text-gray-500">
                    No se detectaron impresoras instaladas en Windows. Instala tu impresora térmica
                    y luego pulsa “Actualizar estado”.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {impresoras.map((impresora) => (
                      <div
                        key={impresora.name}
                        className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2.5"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-gray-900">
                            {impresora.name}
                          </p>
                          <p className="text-xs text-gray-500">{impresora.status || "lista"}</p>
                        </div>
                        <button
                          onClick={() => usarUsb(impresora)}
                          disabled={!config || ocupado}
                          className="shrink-0 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Usar
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-gray-200 p-3">
                <p className="mb-2 text-sm font-medium text-gray-700">Agregar impresora de red</p>
                <div className="grid grid-cols-[1fr_90px] gap-2">
                  <input
                    value={impresoraRedIp}
                    onChange={(e) => setImpresoraRedIp(e.target.value)}
                    placeholder="192.168.1.50"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                  <input
                    value={impresoraRedPuerto}
                    onChange={(e) => setImpresoraRedPuerto(e.target.value)}
                    inputMode="numeric"
                    placeholder="9100"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </div>
                <button
                  onClick={usarRed}
                  disabled={!config || ocupado}
                  className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Usar impresora de red
                </button>
              </div>

              <button
                onClick={imprimirPrueba}
                disabled={!config || probando}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {probando ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Printer className="h-4 w-4" />
                )}
                Imprimir ticket de prueba
              </button>

              {!config && (
                <p className="text-xs text-amber-700">
                  Primero vincula el agente para poder configurar la impresora.
                </p>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Recomendaciones"
              icon={FileText}
              tone="amber"
              subtitle="Para que el ticket salga sin errores"
            />
            <div className="space-y-3 p-5 text-sm text-gray-600">
              <p className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
                La impresora USB debe estar instalada como impresora de Windows antes de elegirla.
              </p>
              <p className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
                Si Chrome o Edge piden permiso para acceder a la red local, pulsa “Permitir”. Solo
                ocurre la primera vez.
              </p>
              <p className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                Brave bloquea las conexiones a 127.0.0.1. Baja el nivel de Shields para este sitio.
              </p>
              <p className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                Si el ticket sale con basura o texto cortado, revisa el driver de la impresora o
                instálala como “Generic / Text Only”.
              </p>
              <p className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                Si vendes desde otra PC, vincula el agente una vez en esa PC. La configuración es
                por navegador, no por sede.
              </p>
            </div>
          </Card>
        </div>
      </div>

      <Toast
        open={!!notificacion}
        message={notificacion?.mensaje ?? ""}
        tone={notificacion?.tono ?? "success"}
        onClose={() => setNotificacion(null)}
      />
    </div>
  );
}
