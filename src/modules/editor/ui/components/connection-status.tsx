"use client";

import { cn } from "@/lib/utils";
import { describeSync, type SyncStatus } from "@/lib/sync/status";

import type { LocalSaveStatus } from "@/modules/editor/hooks/use-document";

const TONE_DOT: Record<string, string> = {
  muted: "bg-muted-foreground/40",
  active: "bg-blue-500",
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
};

/**
 * The real-time connection/sync indicator (always visible in the editor header).
 * Shows the network sync state, plus a subtle local "Saving…" while edits are
 * still being written to IndexedDB.
 */
export function ConnectionStatus({
  syncStatus,
  saveStatus,
  canEdit,
}: {
  syncStatus: SyncStatus;
  saveStatus: LocalSaveStatus;
  canEdit: boolean;
}) {
  const { label, tone } = describeSync(syncStatus);

  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      {canEdit && saveStatus === "saving" && <span>Saving…</span>}
      <span className="inline-flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className={cn(
            "size-2 rounded-full",
            TONE_DOT[tone],
            tone === "active" && "animate-pulse"
          )}
        />
        {label}
      </span>
    </div>
  );
}
