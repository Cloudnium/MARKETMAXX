/** Mini envoltorio de IndexedDB (sin dependencias). Guarda snapshot, reservas, outbox, ventas y conflictos. */
export const STORES = {
  meta: "key",
  snapshot: "sedeId",
  leases: "leaseId",
  outbox: "requestId",
  ventas: "localId",
  conflictos: "localId",
} as const;
export type StoreName = keyof typeof STORES;

const NOMBRE = "market-offline";
let abierta: Promise<IDBDatabase> | null = null;

export function abrir(): Promise<IDBDatabase> {
  if (!abierta) {
    abierta = new Promise((ok, mal) => {
      const req = indexedDB.open(NOMBRE, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const [s, k] of Object.entries(STORES)) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: k });
      };
      req.onsuccess = () => ok(req.result);
      req.onerror = () => {
        abierta = null;
        mal(req.error);
      };
    });
  }
  return abierta;
}

const pedir = <T,>(r: IDBRequest<T>) => new Promise<T>((ok, mal) => ((r.onsuccess = () => ok(r.result)), (r.onerror = () => mal(r.error))));

export interface Almacen {
  get<T>(s: StoreName, k: string): Promise<T | undefined>;
  put<T>(s: StoreName, v: T): Promise<void>;
  del(s: StoreName, k: string): Promise<void>;
  all<T>(s: StoreName): Promise<T[]>;
}

/** Ejecuta varias lecturas/escrituras en UNA transacción atómica (todo o nada). */
export async function transaccion<R>(stores: StoreName[], modo: IDBTransactionMode, fn: (a: Almacen) => Promise<R>): Promise<R> {
  const db = await abrir();
  const tx = db.transaction(stores, modo);
  const fin = new Promise<void>((ok, mal) => {
    tx.oncomplete = () => ok();
    tx.onerror = () => mal(tx.error);
    tx.onabort = () => mal(tx.error ?? new Error("Transacción cancelada"));
  });
  fin.catch(() => {}); // si fn falla y abortamos, evita un 'unhandled rejection' (el error real se relanza abajo)
  const a: Almacen = {
    get: (s, k) => pedir(tx.objectStore(s).get(k)) as Promise<any>,
    put: async (s, v) => void (await pedir(tx.objectStore(s).put(v))),
    del: async (s, k) => void (await pedir(tx.objectStore(s).delete(k))),
    all: (s) => pedir(tx.objectStore(s).getAll()) as Promise<any>,
  };
  try {
    const r = await fn(a);
    await fin;
    return r;
  } catch (e) {
    try {
      tx.abort();
    } catch {
      /* ya cerrada */
    }
    throw e;
  }
}

export const leer = <T,>(s: StoreName, k: string) => transaccion([s], "readonly", (a) => a.get<T>(s, k));
export const listar = <T,>(s: StoreName) => transaccion([s], "readonly", (a) => a.all<T>(s));
export const guardar = <T,>(s: StoreName, v: T) => transaccion([s], "readwrite", (a) => a.put(s, v));
