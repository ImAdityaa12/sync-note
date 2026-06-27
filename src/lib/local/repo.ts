import { getLocalDB, type LocalDocumentRecord } from "./db";

export type { LocalDocumentRecord };

/** Local content for a document, or undefined if it's never been opened here. */
export async function getLocalDocument(
  docId: string
): Promise<LocalDocumentRecord | undefined> {
  const db = await getLocalDB();
  return db.get("documents", docId);
}

/** Upserts local content, bumping the local version and updatedAt. */
export async function saveLocalDocument(
  docId: string,
  content: string
): Promise<LocalDocumentRecord> {
  const db = await getLocalDB();
  const existing = await db.get("documents", docId);
  const record: LocalDocumentRecord = {
    docId,
    content,
    version: (existing?.version ?? 0) + 1,
    updatedAt: Date.now(),
  };
  await db.put("documents", record);
  return record;
}

export async function deleteLocalDocument(docId: string): Promise<void> {
  const db = await getLocalDB();
  await db.delete("documents", docId);
}
