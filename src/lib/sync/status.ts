/** Connection/sync state surfaced in the editor header. */
export type SyncStatus =
  | "offline"
  | "connecting"
  | "syncing"
  | "synced"
  | "error";

export function describeSync(status: SyncStatus): {
  label: string;
  tone: "muted" | "active" | "ok" | "warn";
} {
  switch (status) {
    case "offline":
      return { label: "Offline", tone: "warn" };
    case "connecting":
      return { label: "Connecting…", tone: "muted" };
    case "syncing":
      return { label: "Syncing…", tone: "active" };
    case "synced":
      return { label: "Synced", tone: "ok" };
    case "error":
      return { label: "Sync error", tone: "warn" };
  }
}
