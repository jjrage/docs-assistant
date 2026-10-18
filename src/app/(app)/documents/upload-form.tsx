"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Button } from "@/ui/button";
import { Alert, Spinner } from "@/ui/feedback";
import { Field, Input, Select } from "@/ui/form";
import { browserDb } from "@/ui/supabase-browser";

import { finishUpload, startUpload } from "./actions";

type Replaceable = { id: string; title: string };

/**
 * Upload: the server issues a one-time signed URL, the browser sends the file straight to storage, then the
 * server indexes it in the background while the list shows its progress.
 */
export function UploadForm({ replaceable }: { replaceable: Replaceable[] }) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;
    const data = new FormData(event.currentTarget);
    const text = (name: string) => {
      const value = String(data.get(name) ?? "").trim();
      return value === "" ? null : value;
    };
    setError(null);
    setBusy("Preparing…");
    try {
      const ticket = await startUpload({
        fileName: file.name,
        sizeBytes: file.size,
        title: title.trim() || file.name.replace(/\.(pdf|docx)$/i, ""),
        effectiveDate: text("effectiveDate"),
        versionLabel: text("versionLabel"),
        supersedesId: text("supersedesId"),
      });
      if (!ticket.ok) {
        setError(ticket.error);
        return;
      }
      setBusy("Uploading…");
      const sent = await browserDb()
        .storage.from("documents")
        .uploadToSignedUrl(ticket.path, ticket.token, file, {
          contentType: file.type || undefined,
        });
      if (sent.error) {
        setError("The upload did not go through. Try again.");
        return;
      }
      setBusy("Indexing…");
      const done = await finishUpload(ticket.documentId);
      if (done.error) {
        setError(done.error);
        return;
      }
      form.current?.reset();
      setFile(null);
      setTitle("");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <form ref={form} onSubmit={submit} className="space-y-4">
      <Field
        label="File"
        htmlFor="file"
        hint="PDF or Word (.docx), up to 10 MB. Text PDFs only, no scans."
      >
        <Input
          id="file"
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="py-1.5"
          onChange={(e) => {
            const chosen = e.target.files?.[0] ?? null;
            setFile(chosen);
            if (chosen && !title) setTitle(chosen.name.replace(/\.(pdf|docx)$/i, ""));
          }}
          required
        />
      </Field>
      <Field label="Title" htmlFor="title">
        <Input
          id="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Effective date" htmlFor="effectiveDate" hint="Optional">
          <Input id="effectiveDate" name="effectiveDate" type="date" />
        </Field>
        <Field label="Version" htmlFor="versionLabel" hint="Optional, e.g. 2026">
          <Input id="versionLabel" name="versionLabel" maxLength={40} />
        </Field>
      </div>
      {replaceable.length > 0 && (
        <Field
          label="Replaces"
          htmlFor="supersedesId"
          hint="When documents disagree, the assistant follows the newer version."
        >
          <Select id="supersedesId" name="supersedesId" defaultValue="">
            <option value="">Nothing</option>
            {replaceable.map((doc) => (
              <option key={doc.id} value={doc.id}>
                {doc.title}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
      <Button type="submit" disabled={!file || busy !== null} className="w-full">
        {busy && <Spinner />}
        {busy ?? "Upload and index"}
      </Button>
    </form>
  );
}
