import { FileText } from "lucide-react";

import type { DocumentSummary } from "@/modules/documents/types";
import { DocumentCard } from "@/modules/documents/ui/components/document-card";
import { NewDocumentButton } from "@/modules/documents/ui/components/new-document-button";

export function DocumentsView({
  documents,
}: {
  documents: DocumentSummary[];
}) {
  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Local-first — open and edit instantly, syncs in the background.
          </p>
        </div>
        <NewDocumentButton />
      </div>

      {documents.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed px-6 py-16 text-center">
          <span className="inline-flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <FileText className="size-5" strokeWidth={1.75} />
          </span>
          <h2 className="mt-4 text-lg font-medium">No documents yet</h2>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            Create your first document to start writing. It lives on your device
            first and syncs when you&apos;re online.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {documents.map((document) => (
            <DocumentCard key={document.id} document={document} />
          ))}
        </div>
      )}
    </div>
  );
}
