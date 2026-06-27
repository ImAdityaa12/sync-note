"use client";

import { Check, Loader2, WifiOff } from "lucide-react";

import type { LocalSaveStatus } from "@/modules/editor/hooks/use-document";

/**
 * Local persistence + connectivity status. This reflects IndexedDB saves, not
 * server sync — the offline/syncing/synced/conflict machine arrives with the
 * sync engine (Phase D).
 */
export function SaveIndicator({
  status,
  online,
  canEdit,
}: {
  status: LocalSaveStatus;
  online: boolean;
  canEdit: boolean;
}) {
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      {!online && (
        <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5">
          <WifiOff className="size-3.5" />
          Offline — saved on this device
        </span>
      )}
      {canEdit && (
        <span className="inline-flex items-center gap-1.5">
          {status === "saving" ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              Saving…
            </>
          ) : status === "loading" ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              Loading…
            </>
          ) : (
            <>
              <Check className="size-3.5" />
              Saved locally
            </>
          )}
        </span>
      )}
    </div>
  );
}
