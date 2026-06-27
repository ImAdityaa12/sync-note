import { openDB, type DBSchema, type IDBPDatabase } from "idb";

/**
 * Client-side IndexedDB — the source of truth for document content. The editor
 * reads and writes here first so opening/editing/closing never waits on the
 * network. Server sync (op log, cursors) arrives in later phases and will add
 * `oplog` / `meta` stores via a DB_VERSION bump + upgrade step.
 */
export interface LocalDocumentRecord {
  docId: string;
  content: string;
  /** Local monotonic save counter — bumped on every persisted write. */
  version: number;
  /** Epoch ms of the last local save. */
  updatedAt: number;
}

interface SyncNoteDB extends DBSchema {
  documents: {
    key: string;
    value: LocalDocumentRecord;
  };
}

const DB_NAME = "sync-note";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<SyncNoteDB>> | null = null;

/**
 * Lazily opens (and caches) the connection. Rejects in non-browser contexts so
 * callers never accidentally touch IndexedDB during SSR.
 */
export function getLocalDB(): Promise<IDBPDatabase<SyncNoteDB>> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(
      new Error("IndexedDB is unavailable (server or unsupported browser).")
    );
  }
  if (!dbPromise) {
    dbPromise = openDB<SyncNoteDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("documents")) {
          db.createObjectStore("documents", { keyPath: "docId" });
        }
      },
    });
  }
  return dbPromise;
}
