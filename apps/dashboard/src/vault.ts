/**
 * The only thing Snappy writes to the browser's database: one sealed (encrypted) blob.
 * Every access is wrapped, because IndexedDB can be missing or throw in private windows,
 * sandboxed frames and file:// pages in some browsers.
 */

export interface VaultStore {
  /** Whether saving is possible at all in this browser. */
  supported(): boolean;
  read(): Promise<Uint8Array | null>;
  write(bytes: Uint8Array): Promise<void>;
  /** Removes the whole database. */
  clear(): Promise<void>;
}

/** Fixed message only: a storage error must not carry anything from the stored data. */
export class VaultError extends Error {
  constructor(message = "Browser storage is not available.") {
    super(message);
    this.name = "VaultError";
  }
}

const DB_NAME = "snappy";
const STORE_NAME = "vault";
const KEY = "sealed-v1";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new VaultError());
      request.onblocked = () => reject(new VaultError());
    } catch {
      reject(new VaultError());
    }
  });
}

/** Run one request inside a short transaction and always close the connection afterwards. */
async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      try {
        const tx = db.transaction(STORE_NAME, mode);
        const request = run(tx.objectStore(STORE_NAME));
        tx.oncomplete = () => resolve(request.result);
        tx.onerror = () => reject(new VaultError());
        tx.onabort = () => reject(new VaultError());
      } catch {
        reject(new VaultError());
      }
    });
  } finally {
    db.close();
  }
}

export const browserVault: VaultStore = {
  supported(): boolean {
    try {
      return typeof indexedDB !== "undefined" && indexedDB !== null;
    } catch {
      return false;
    }
  },

  async read() {
    const value = await withStore<unknown>("readonly", (store) => store.get(KEY));
    return value instanceof Uint8Array ? value : null;
  },

  async write(bytes) {
    await withStore("readwrite", (store) => store.put(bytes, KEY));
  },

  clear() {
    return new Promise<void>((resolve, reject) => {
      try {
        const request = indexedDB.deleteDatabase(DB_NAME);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(new VaultError());
        // Our own connections are always closed, so a block is another tab of this page: it
        // finishes the deletion as soon as that tab lets go, and the request then succeeds.
      } catch {
        reject(new VaultError());
      }
    });
  },
};

/** Theme preference: the only thing kept in localStorage, and never anything about friends. */
const THEME_KEY = "snappy-theme";

export function readThemePreference(): string | null {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch {
    return null;
  }
}

export function writeThemePreference(value: string): void {
  try {
    localStorage.setItem(THEME_KEY, value);
  } catch {
    // Remembering the theme is a convenience; the page works without it.
  }
}
