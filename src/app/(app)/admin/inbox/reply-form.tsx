"use client";

import { useActionState } from "react";

import { Button } from "@/ui/button";
import { Alert, Spinner } from "@/ui/feedback";
import { Textarea } from "@/ui/form";

import { sendReply } from "../actions";

export function ReplyForm({ handoffId }: { handoffId: string }) {
  const [state, action, pending] = useActionState(sendReply, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="handoffId" value={handoffId} />
      <Textarea
        name="answer"
        rows={3}
        maxLength={4000}
        placeholder="Your reply appears in the resident's chat."
        aria-label="Reply"
        required
      />
      {state?.error && <Alert tone="danger">{state.error}</Alert>}
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={pending}>
          {pending && <Spinner />}
          Send reply
        </Button>
      </div>
    </form>
  );
}
