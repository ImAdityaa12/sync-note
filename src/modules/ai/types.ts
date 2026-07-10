import type { AiTask } from "@/modules/ai/schema";

export type AiChatRole = "user" | "assistant";

/**
 * One message in a user's private assistant chat, as it travels to the client.
 * `task` is the assistant action the message belongs to (null only for legacy
 * rows); `createdAt` is epoch milliseconds so it serializes cleanly over JSON
 * and feeds the export timestamps directly.
 */
export interface ChatMessage {
  id: string;
  role: AiChatRole;
  task: AiTask | null;
  content: string;
  createdAt: number;
}
