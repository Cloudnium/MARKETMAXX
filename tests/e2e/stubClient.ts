// Sustituye a lib/supabase/client SOLO en el E2E: mismas respuestas que postgrest-js ({data,error,status}),
// pero hablando con el gateway local que ejecuta las funciones en un Postgres real.
const base = () => (window as any).__GATEWAY as string;
const uid = () => (window as any).__UID as string;

export const fetchResiliente = (...a: Parameters<typeof fetch>) => fetch(...a);

export function createClient() {
  return {
    rpc: async (fn: string, args: unknown) => {
      try {
        const r = await fetch(`${base()}/rpc/${fn}`, { method: "POST", headers: { "x-uid": uid(), "content-type": "application/json" }, body: JSON.stringify(args ?? {}) });
        const j = await r.json().catch(() => null);
        return r.ok ? { data: j, error: null, status: r.status } : { data: null, error: j, status: r.status };
      } catch (e) {
        // exactamente como postgrest-js cuando el fetch falla (corte de red / respuesta perdida)
        return { data: null, error: { message: `${(e as Error).name}: ${(e as Error).message}`, code: "" }, status: 0 };
      }
    },
    auth: { refreshSession: async () => ({ error: null }), signOut: async () => ({}) },
  };
}
