import type { documentMembers, documents } from "@/db/schema";

export type DocumentRole = "owner" | "editor" | "viewer";

export type DocumentRow = typeof documents.$inferSelect;
export type DocumentMemberRow = typeof documentMembers.$inferSelect;

/** A document as it appears in a user's list, with their own role on it. */
export type DocumentSummary = {
  id: string;
  title: string;
  role: DocumentRole;
  createdAt: Date;
  updatedAt: Date;
};

export type DocumentMemberInfo = {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  role: DocumentRole;
};

export type DocumentDetail = {
  id: string;
  title: string;
  ownerId: string;
  /** The current user's role on this document. */
  role: DocumentRole;
  members: DocumentMemberInfo[];
  createdAt: Date;
  updatedAt: Date;
};

/** Discriminated result returned by every mutation (server action). */
export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };
