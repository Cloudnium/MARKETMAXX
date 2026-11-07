/**
 * IndexedDB en memoria con la misma semántica que lib/offline/idb.ts:
 *  - lo que se lee/escribe se CLONA (como el clon estructurado de IndexedDB: mutar un objeto leído no cambia lo guardado);
 *  - una transacción de escritura es atómica: si la función lanza, se deshace todo.
 */
const CLAVES = { meta: "key", snapshot: "sedeId", leases: "leaseId", outbox: "requestId", ventas: "localId", conflictos: "localId" } as const;
type Nombre = keyof typeof CLAVES;

export function crearIdb() {
  let datos = {} as Record<Nombre, Map<string, any>>;
  const reset = () => {
    datos = Object.fromEntries(Object.keys(CLAVES).map((k) => [k, new Map()])) as Record<Nombre, Map<string, any>>;
  };
  reset();
  const clon = <T,>(v: T): T => structuredClone(v);

  async function transaccion<R>(stores: Nombre[], modo: "readonly" | "readwrite", fn: (a: any) => Promise<R>): Promise<R> {
    const respaldo = modo === "readwrite" ? Object.fromEntries(stores.map((s) => [s, new Map([...datos[s]].map(([k, v]) => [k, clon(v)]))])) : null;
    const a = {
      get: async (s: Nombre, k: string) => (datos[s].has(k) ? clon(datos[s].get(k)) : undefined),
      put: async (s: Nombre, v: any) => void datos[s].set(v[CLAVES[s]], clon(v)),
      del: async (s: Nombre, k: string) => void datos[s].delete(k),
      all: async (s: Nombre) => [...datos[s].values()].map(clon),
    };
    try {
      return await fn(a);
    } catch (e) {
      if (respaldo) for (const s of stores) datos[s] = respaldo[s] as Map<string, any>;
      throw e;
    }
  }
  return {
    reset,
    STORES: CLAVES,
    abrir: async () => ({}),
    transaccion,
    leer: <T,>(s: Nombre, k: string) => transaccion([s], "readonly", (a) => a.get(s, k)) as Promise<T | undefined>,
    listar: <T,>(s: Nombre) => transaccion([s], "readonly", (a) => a.all(s)) as Promise<T[]>,
    guardar: <T,>(s: Nombre, v: T) => transaccion([s], "readwrite", (a) => a.put(s, v)),
  };
}
