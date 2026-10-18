"use client";

import { useTransition } from "react";

import { Spinner } from "@/ui/feedback";

import { removeDocument } from "./actions";

export function DeleteButton({ documentId, title }: { documentId: string; title: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!window.confirm(`Delete "${title}"? The assistant will stop using it.`)) return;
        startTransition(async () => {
          await removeDocument(documentId);
        });
      }}
      className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-red-700 disabled:opacity-50"
    >
      {pending && <Spinner className="size-3" />}
      Delete
    </button>
  );
}
