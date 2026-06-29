"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { deleteDocument } from "@/modules/documents/server/actions";

export function DeleteDocumentDialog({
  documentId,
  title,
  open,
  onOpenChange,
  onDeleted,
}: {
  documentId: string;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional override — defaults to a router.refresh() (stay on the list). */
  onDeleted?: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onConfirm() {
    setError(null);
    startTransition(async () => {
      const result = await deleteDocument({ documentId });
      if (result.ok) {
        onOpenChange(false);
        if (onDeleted) onDeleted();
        else router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete document</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{title}</span> and all
            of its history will be permanently deleted for every collaborator.
            This can&apos;t be undone.
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
            disabled={pending}
          >
            {pending && <Loader2 className="size-4 animate-spin" />}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
