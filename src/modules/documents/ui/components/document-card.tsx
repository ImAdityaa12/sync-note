"use client";

import { useState } from "react";
import Link from "next/link";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatRelativeTime } from "@/lib/format";
import type { DocumentSummary } from "@/modules/documents/types";

import { DeleteDocumentDialog } from "./delete-document-dialog";
import { RenameDocumentDialog } from "./rename-document-dialog";
import { RoleBadge } from "./role-badge";

export function DocumentCard({ document }: { document: DocumentSummary }) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const canEdit = document.role === "owner" || document.role === "editor";
  const canDelete = document.role === "owner";

  return (
    <div className="group relative flex flex-col rounded-xl border p-4 transition-colors hover:bg-muted/40">
      <div className="flex items-start justify-between gap-2">
        <Link href={`/documents/${document.id}`} className="min-w-0 flex-1">
          <h3 className="truncate font-medium tracking-tight">
            {document.title}
          </h3>
          <p
            className="mt-1 text-xs text-muted-foreground"
            suppressHydrationWarning
          >
            Edited {formatRelativeTime(document.updatedAt)}
          </p>
        </Link>

        {canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 data-[state=open]:opacity-100"
                aria-label="Document actions"
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setRenameOpen(true)}>
                <Pencil className="size-4" />
                Rename
              </DropdownMenuItem>
              {canDelete && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => setDeleteOpen(true)}
                  >
                    <Trash2 className="size-4" />
                    Delete
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <div className="mt-4">
        <RoleBadge role={document.role} />
      </div>

      <RenameDocumentDialog
        documentId={document.id}
        currentTitle={document.title}
        open={renameOpen}
        onOpenChange={setRenameOpen}
      />
      <DeleteDocumentDialog
        documentId={document.id}
        title={document.title}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
    </div>
  );
}
