"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { createDocument } from "@/modules/documents/server/actions";

export function NewDocumentButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onCreate() {
    setError(null);
    startTransition(async () => {
      const result = await createDocument({});
      if (result.ok) {
        router.push(`/documents/${result.data.id}`);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button onClick={onCreate} disabled={pending} size="sm">
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Plus className="size-4" />
        )}
        New document
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
