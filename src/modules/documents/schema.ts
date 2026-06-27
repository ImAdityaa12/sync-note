import { z } from "zod";

/**
 * Input validation for every documents mutation. Sharing/role changes are
 * restricted to editor|viewer — "owner" is never grantable through the UI, so
 * a document always has exactly one owner (its creator).
 */

const documentId = z.string().min(1, "Missing document id");
const grantableRole = z.enum(["editor", "viewer"]);

export const createDocumentSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
});

export const renameDocumentSchema = z.object({
  documentId,
  title: z.string().trim().min(1, "Title can't be empty").max(200, "Title is too long"),
});

export const documentIdSchema = z.object({ documentId });

export const shareDocumentSchema = z.object({
  documentId,
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  role: grantableRole,
});

export const changeRoleSchema = z.object({
  documentId,
  userId: z.string().min(1),
  role: grantableRole,
});

export const removeMemberSchema = z.object({
  documentId,
  userId: z.string().min(1),
});

export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;
export type RenameDocumentInput = z.infer<typeof renameDocumentSchema>;
export type ShareDocumentInput = z.infer<typeof shareDocumentSchema>;
export type ChangeRoleInput = z.infer<typeof changeRoleSchema>;
export type RemoveMemberInput = z.infer<typeof removeMemberSchema>;
