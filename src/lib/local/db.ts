import { openDB, type DBSchema, type IDBPDatabase } from "idb";

import type { Op } from "@/lib/crdt/codec";
import type { RGASnapshot } from "@/lib/crdt/rga";

/**
 * Client-side IndexedDB — the source of truth for document content.
 *
 * - `documents`: the materialized CRDT state per doc (restored on open).
 * - `oplog`: locally-produced ops not yet confirmed by the server. The sync
 *   engine (Phase D) drains these; survives reload so offline work is durable.
 * - `meta`: per-doc client metadata — most importantly a stable `siteId` so this
 *   replica's op ids stay consistent across reloads.
 */
export interface LocalDocumentRecord {
  docId: string;
  crdtState?: RGASnapshot;
  /** Legacy Phase-B plain-text content; seeded into the CRDT on first open. */
  content?: string;
  version: number;
  updatedAt: number;
}

export interface OplogRecord {
  /** Auto-assigned key; also the local order of the op. */
  localSeq?: number;
  docId: string;
  op: Op;
  createdAt: number;
}

export interface MetaRecord {
  docId: string;
  siteId: string;
}

interface SyncNoteDB extends DBSchema {
  documents: { key: string; value: LocalDocumentRecord };
  oplog: { key: number; value: OplogRecord; indexes: { "by-doc": string } };
  meta: { key: string; value: MetaRecord };
}

const DB_NAME = "sync-note";
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase<SyncNoteDB>> | null = null;

export function getLocalDB(): Promise<IDBPDatabase<SyncNoteDB>> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(
      new Error("IndexedDB is unavailable (server or unsupported browser).")
    );
  }
  if (!dbPromise) {
    dbPromise = openDB<SyncNoteDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // v1 → v2 keeps the existing `documents` store and adds oplog + meta.
        if (!db.objectStoreNames.contains("documents")) {
          db.createObjectStore("documents", { keyPath: "docId" });
        }
        if (!db.objectStoreNames.contains("oplog")) {
          const oplog = db.createObjectStore("oplog", {
            keyPath: "localSeq",
            autoIncrement: true,
          });
          oplog.createIndex("by-doc", "docId");
        }
        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta", { keyPath: "docId" });
        }
      },
    });
  }
  return dbPromise;
}
