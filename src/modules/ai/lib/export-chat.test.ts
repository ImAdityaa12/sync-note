import { describe, expect, it } from "vitest";

import type { ChatMessage } from "@/modules/ai/types";

import { exportChat } from "./export-chat";

const MESSAGES: ChatMessage[] = [
  {
    id: "m1",
    role: "user",
    task: "ask",
    content: "What is this about?",
    createdAt: Date.parse("2026-07-10T12:00:00.000Z"),
  },
  {
    id: "m2",
    role: "assistant",
    task: "ask",
    content: "  It's about testing.  ",
    createdAt: Date.parse("2026-07-10T12:00:05.000Z"),
  },
  {
    id: "m3",
    role: "user",
    task: "summary",
    content: "Summarize this document",
    createdAt: Date.parse("2026-07-10T12:01:00.000Z"),
  },
  {
    id: "m4",
    role: "assistant",
    task: "summary",
    content: "A short summary.",
    createdAt: Date.parse("2026-07-10T12:01:05.000Z"),
  },
];

const META = {
  documentId: "doc-123",
  exportedAt: Date.parse("2026-07-10T12:15:00.000Z"),
};

describe("exportChat", () => {
  it("names the file and sets the mime type per format", () => {
    expect(exportChat(MESSAGES, "markdown", META)).toMatchObject({
      filename: "ai-chat-doc-123.md",
      mimeType: "text/markdown",
    });
    expect(exportChat(MESSAGES, "text", META)).toMatchObject({
      filename: "ai-chat-doc-123.txt",
      mimeType: "text/plain",
    });
    expect(exportChat(MESSAGES, "json", META)).toMatchObject({
      filename: "ai-chat-doc-123.json",
      mimeType: "application/json",
    });
  });

  it("slugifies unsafe document ids in the filename", () => {
    const file = exportChat(MESSAGES, "markdown", {
      ...META,
      documentId: "a/b:c 1",
    });
    expect(file.filename).toBe("ai-chat-a-b-c-1.md");
  });

  it("renders markdown with role headings and trimmed content", () => {
    const { content } = exportChat(MESSAGES, "markdown", META);
    expect(content).toContain("# AI assistant chat");
    expect(content).toContain("### You");
    expect(content).toContain("### Assistant");
    expect(content).toContain("What is this about?");
    expect(content).toContain("It's about testing.");
    expect(content).not.toContain("  It's about testing.  ");
    expect(content.endsWith("\n")).toBe(true);
  });

  it("renders plain text with role labels and no markdown syntax", () => {
    const { content } = exportChat(MESSAGES, "text", META);
    expect(content).toContain("You:");
    expect(content).toContain("Assistant:");
    expect(content).not.toContain("#");
    expect(content).not.toContain("**");
  });

  it("renders JSON with ISO timestamps and verbatim content", () => {
    const { content } = exportChat(MESSAGES, "json", META);
    const parsed = JSON.parse(content);
    expect(parsed.document).toBe("doc-123");
    expect(parsed.exportedAt).toBe("2026-07-10T12:15:00.000Z");
    expect(parsed.messages).toHaveLength(4);
    expect(parsed.messages[0]).toMatchObject({
      role: "user",
      task: "ask",
      content: "What is this about?",
      createdAt: "2026-07-10T12:00:00.000Z",
    });
    // JSON keeps the raw content verbatim (untrimmed).
    expect(parsed.messages[1].content).toBe("  It's about testing.  ");
  });
});
