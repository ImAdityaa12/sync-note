import type { ChatMessage } from "@/modules/ai/types";

export type ExportFormat = "markdown" | "text" | "json";

export interface ExportMeta {
  documentId: string;
  exportedAt: number; // epoch ms
}

export interface ExportedFile {
  filename: string;
  mimeType: string;
  content: string;
}

const ROLE_LABEL = { user: "You", assistant: "Assistant" } as const;

const EXTENSION: Record<ExportFormat, string> = {
  markdown: "md",
  text: "txt",
  json: "json",
};

const MIME_TYPE: Record<ExportFormat, string> = {
  markdown: "text/markdown",
  text: "text/plain",
  json: "application/json",
};

/** Keep a document id usable as a filename segment across platforms. */
function slugifyDocId(documentId: string): string {
  const slug = documentId.replace(/[^a-zA-Z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "document";
}

function toMarkdown(messages: ChatMessage[], meta: ExportMeta): string {
  const lines: string[] = [
    "# AI assistant chat",
    "",
    `_Document ${meta.documentId} · exported ${new Date(meta.exportedAt).toISOString()}_`,
    "",
  ];

  for (const message of messages) {
    lines.push(`### ${ROLE_LABEL[message.role]}`, "", message.content.trim(), "");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function toText(messages: ChatMessage[], meta: ExportMeta): string {
  const lines: string[] = [
    "AI assistant chat",
    `Document ${meta.documentId} — exported ${new Date(meta.exportedAt).toISOString()}`,
    "",
  ];

  for (const message of messages) {
    lines.push(`${ROLE_LABEL[message.role]}:`, message.content.trim(), "");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function toJson(messages: ChatMessage[], meta: ExportMeta): string {
  const payload = {
    document: meta.documentId,
    exportedAt: new Date(meta.exportedAt).toISOString(),
    messages: messages.map((message) => ({
      id: message.id,
      role: message.role,
      task: message.task,
      content: message.content,
      createdAt: new Date(message.createdAt).toISOString(),
    })),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

/**
 * Serialize an assistant chat transcript into a downloadable file in the
 * requested format. Pure — the caller handles the actual download. Message text
 * is trimmed per line but otherwise preserved verbatim.
 */
export function exportChat(
  messages: ChatMessage[],
  format: ExportFormat,
  meta: ExportMeta
): ExportedFile {
  const content =
    format === "markdown"
      ? toMarkdown(messages, meta)
      : format === "text"
        ? toText(messages, meta)
        : toJson(messages, meta);

  return {
    filename: `ai-chat-${slugifyDocId(meta.documentId)}.${EXTENSION[format]}`,
    mimeType: MIME_TYPE[format],
    content,
  };
}
