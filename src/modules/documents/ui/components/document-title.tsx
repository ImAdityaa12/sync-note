"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";

import { RenameDocumentDialog } from "./rename-document-dialog";

export function DocumentTitle({
  documentId,
  title,
  canEdit,
}: {
  documentId: string;
  title: string;
  canEdit: boolean;
}) {
  const [renameOpen, setRenameOpen] = useState(false);

  return (
    <div className="group flex items-center gap-2">
      <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
      {canEdit && (
        <>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
            onClick={() => setRenameOpen(true)}
            aria-label="Rename document"
          >
            <Pencil className="size-4" />
          </Button>
          <RenameDocumentDialog
            documentId={documentId}
            currentTitle={title}
            open={renameOpen}
            onOpenChange={setRenameOpen}
          />
        </>
      )}
    </div>
  );
}
