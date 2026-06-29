"use client";

import { useCallback, useState, useTransition } from "react";
import {
  ArrowLeft,
  History,
  Loader2,
  RotateCcw,
  Save,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatRelativeTime } from "@/lib/format";
import { MarkdownPreview } from "@/modules/editor/ui/components/markdown-preview";
import {
  getVersionContent,
  listVersions,
  saveVersion,
} from "@/modules/versions/server/actions";
import type { VersionSummary } from "@/modules/versions/types";

/**
 * Version history + time travel.
 *
 * Lists saved snapshots, lets an editor save the current document as a named
 * version, and restores a past version. Restore is intentionally *not* a
 * destructive overwrite: `onRestore` replays the version as forward CRDT ops
 * (see `restoreToText`), so collaborators editing concurrently converge cleanly.
 *
 * Viewers may browse and preview history read-only; saving and restoring are
 * gated to editors here and re-enforced on the server.
 */
export function VersionHistory({
  docId,
  canEdit,
  captureVersion,
  onRestore,
}: {
  docId: string;
  canEdit: boolean;
  /** Snapshot the live document (content + the cursor it reflects) at save time. */
  captureVersion: () => Promise<{ content: string; baseSeq: number }>;
  onRestore: (text: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);

  const [versions, setVersions] = useState<VersionSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const [label, setLabel] = useState("");
  const [saving, startSave] = useTransition();
  const [saveError, setSaveError] = useState<string | null>(null);

  // Preview / restore of a single selected version.
  const [selected, setSelected] = useState<VersionSummary | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [restoring, startRestore] = useTransition();

  const loadVersions = useCallback(async () => {
    setListError(null);
    const result = await listVersions({ documentId: docId });
    if (result.ok) setVersions(result.data);
    else setListError(result.error);
  }, [docId]);

  // Drive the timeline from the open/close transition itself (not an effect):
  // load on open, reset every sub-view on close so reopening starts clean.
  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      void loadVersions();
    } else {
      setSelected(null);
      setPreview(null);
      setPreviewError(null);
      setConfirming(false);
      setSaveError(null);
    }
  }

  function onSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaveError(null);
    startSave(async () => {
      const { content, baseSeq } = await captureVersion();
      const result = await saveVersion({
        documentId: docId,
        label: label.trim() || undefined,
        content,
        baseSeq,
      });
      if (result.ok) {
        setLabel("");
        await loadVersions();
      } else {
        setSaveError(result.error);
      }
    });
  }

  const openPreview = useCallback(
    async (version: VersionSummary) => {
      setSelected(version);
      setPreview(null);
      setPreviewError(null);
      setConfirming(false);
      const result = await getVersionContent({
        documentId: docId,
        versionId: version.id,
      });
      if (result.ok) setPreview(result.data.content);
      else setPreviewError(result.error);
    },
    [docId]
  );

  function onConfirmRestore() {
    if (preview === null) return;
    const text = preview;
    startRestore(async () => {
      await onRestore(text);
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <History className="size-4" />
          History
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-2xl">
        {selected ? (
          <PreviewPane
            version={selected}
            content={preview}
            error={previewError}
            canEdit={canEdit}
            confirming={confirming}
            restoring={restoring}
            onBack={() => setSelected(null)}
            onStartConfirm={() => setConfirming(true)}
            onCancelConfirm={() => setConfirming(false)}
            onConfirmRestore={onConfirmRestore}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Version history</DialogTitle>
              <DialogDescription>
                Snapshots of this document over time. Restoring brings a version
                back as new edits, so collaborators stay in sync.
              </DialogDescription>
            </DialogHeader>

            {canEdit && (
              <form
                onSubmit={onSave}
                className="space-y-2 rounded-lg border bg-muted/30 p-3"
              >
                <Label htmlFor="version-label">Save current version</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="version-label"
                    value={label}
                    onChange={(event) => setLabel(event.target.value)}
                    placeholder="Optional name (e.g. First draft)"
                    maxLength={100}
                    disabled={saving}
                  />
                  <Button type="submit" disabled={saving}>
                    {saving ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Save className="size-4" />
                    )}
                    Save
                  </Button>
                </div>
                {saveError && (
                  <p className="text-sm text-destructive">{saveError}</p>
                )}
              </form>
            )}

            <VersionList
              versions={versions}
              error={listError}
              onSelect={openPreview}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function VersionList({
  versions,
  error,
  onSelect,
}: {
  versions: VersionSummary[] | null;
  error: string | null;
  onSelect: (version: VersionSummary) => void;
}) {
  if (error) {
    return <p className="py-6 text-center text-sm text-destructive">{error}</p>;
  }
  if (versions === null) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading history…
      </div>
    );
  }
  if (versions.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No saved versions yet.
      </p>
    );
  }

  return (
    <ul className="max-h-80 space-y-1 overflow-y-auto">
      {versions.map((version) => (
        <li key={version.id}>
          <button
            type="button"
            onClick={() => onSelect(version)}
            className="flex w-full items-center justify-between gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors hover:border-border hover:bg-muted/50"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">
                {version.label || "Untitled version"}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {version.authorName} · {formatRelativeTime(version.createdAt)}
              </span>
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              Preview
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function PreviewPane({
  version,
  content,
  error,
  canEdit,
  confirming,
  restoring,
  onBack,
  onStartConfirm,
  onCancelConfirm,
  onConfirmRestore,
}: {
  version: VersionSummary;
  content: string | null;
  error: string | null;
  canEdit: boolean;
  confirming: boolean;
  restoring: boolean;
  onBack: () => void;
  onStartConfirm: () => void;
  onCancelConfirm: () => void;
  onConfirmRestore: () => void;
}) {
  const loading = content === null && error === null;

  return (
    <>
      <DialogHeader>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to history
        </button>
        <DialogTitle className="pt-1">
          {version.label || "Untitled version"}
        </DialogTitle>
        <DialogDescription>
          Saved by {version.authorName} {formatRelativeTime(version.createdAt)}.
        </DialogDescription>
      </DialogHeader>

      <div className="max-h-80 min-h-40 overflow-y-auto rounded-lg border p-4">
        {loading && (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading version…
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {content !== null && <MarkdownPreview source={content} />}
      </div>

      {canEdit && content !== null && (
        <div className="space-y-2">
          {confirming ? (
            <div className="flex flex-col gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
              <p className="text-sm">
                Restore this version? It replaces the current document for
                everyone, applied as new collaborative edits.
              </p>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onCancelConfirm}
                  disabled={restoring}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={onConfirmRestore}
                  disabled={restoring}
                >
                  {restoring && <Loader2 className="size-4 animate-spin" />}
                  Restore version
                </Button>
              </div>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={onStartConfirm}
            >
              <RotateCcw className="size-4" />
              Restore this version
            </Button>
          )}
        </div>
      )}
    </>
  );
}
