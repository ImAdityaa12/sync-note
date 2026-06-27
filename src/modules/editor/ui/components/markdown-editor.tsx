"use client";

import { useDeferredValue, useLayoutEffect, useRef } from "react";

import { useDocument } from "@/modules/editor/hooks/use-document";

import { ConnectionStatus } from "./connection-status";
import { MarkdownPreview } from "./markdown-preview";

export function MarkdownEditor({
  docId,
  canEdit,
}: {
  docId: string;
  canEdit: boolean;
}) {
  const { content, onChange, status, syncStatus } = useDocument(docId, canEdit);
  // The preview lags behind during rapid typing so re-parsing never blocks keys.
  const deferredContent = useDeferredValue(content);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const caretRef = useRef(0);

  // Keep the caret stable across re-renders — both the local echo and merged
  // remote ops re-set `content`, which would otherwise jump the cursor.
  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (ta && document.activeElement === ta) {
      const pos = Math.min(caretRef.current, content.length);
      ta.setSelectionRange(pos, pos);
    }
  }, [content]);

  const loading = status === "loading";

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">
          {canEdit ? "Editor" : "Read-only"}
        </h2>
        <ConnectionStatus
          syncStatus={syncStatus}
          saveStatus={status}
          canEdit={canEdit}
        />
      </div>

      {loading ? (
        <div className="h-[460px] animate-pulse rounded-xl border bg-muted/40" />
      ) : canEdit ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(event) => {
              caretRef.current = event.target.selectionStart;
              onChange(event.target.value);
            }}
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
        <div className="min-h-[460px] overflow-auto rounded-xl border p-4">
          <MarkdownPreview source={deferredContent} />
        </div>
      )}
    </section>
  );
}
