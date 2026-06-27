"use client";

import { useDeferredValue } from "react";

import { cn } from "@/lib/utils";
import { useDocument } from "@/modules/editor/hooks/use-document";
import { useOnlineStatus } from "@/modules/editor/hooks/use-online-status";

import { MarkdownPreview } from "./markdown-preview";
import { SaveIndicator } from "./save-indicator";

export function MarkdownEditor({
  docId,
  canEdit,
}: {
  docId: string;
  canEdit: boolean;
}) {
  const { content, setContent, status } = useDocument(docId);
  const online = useOnlineStatus();
  // The preview lags behind during rapid typing so re-parsing markdown never
  // blocks keystrokes; the textarea always reflects the latest value.
  const deferredContent = useDeferredValue(content);

  const loading = status === "loading";

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">
          {canEdit ? "Editor" : "Read-only"}
        </h2>
        <SaveIndicator status={status} online={online} canEdit={canEdit} />
      </div>

      {loading ? (
        <div className="h-[460px] animate-pulse rounded-xl border bg-muted/40" />
      ) : canEdit ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="Start writing in markdown…"
            spellCheck
            aria-label="Markdown editor"
            className="min-h-[460px] w-full resize-none rounded-xl border bg-transparent p-4 font-mono text-sm leading-relaxed outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
          />
          <div className="min-h-[460px] overflow-auto rounded-xl border p-4">
            <MarkdownPreview source={deferredContent} />
          </div>
        </div>
      ) : (
        <div
          className={cn(
            "min-h-[460px] overflow-auto rounded-xl border p-4"
          )}
        >
          <MarkdownPreview source={deferredContent} />
        </div>
      )}
    </section>
  );
}
