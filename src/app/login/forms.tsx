"use client";

import { useActionState, useState, useTransition } from "react";

import { Button } from "@/ui/button";
import { cn } from "@/ui/cn";
import { Alert, Spinner } from "@/ui/feedback";
import { Field, Input } from "@/ui/form";

import { signInWithPassword, startDemo } from "./actions";

const roles = [
  {
    role: "member" as const,
    label: "Try as a resident",
    detail: "Ask about rent, pets, parking, repairs… Answers cite the page.",
  },
  {
    role: "admin" as const,
    label: "Try as the property manager",
    detail: "Upload your own PDF or DOCX, answer handed-off questions, see cost per answer.",
  },
];

export function DemoButtons({ layout = "stack" }: { layout?: "stack" | "row" }) {
  const [pending, startTransition] = useTransition();
  const [active, setActive] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <div className={cn("grid gap-2", layout === "row" && "sm:grid-cols-2")}>
        {roles.map((option) => (
          <button
            key={option.role}
            type="button"
            disabled={pending}
            onClick={() => {
              setActive(option.role);
              setError(null);
              startTransition(async () => {
                const result = await startDemo(option.role);
                if (result?.error) setError(result.error);
              });
            }}
            className={cn(
              "rounded-xl bg-white p-4 text-left shadow-sm ring-1 ring-zinc-200 transition",
              "hover:bg-brand-50 hover:ring-brand-500 disabled:opacity-60",
            )}
          >
            <span className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
              {pending && active === option.role && <Spinner />}
              {option.label}
            </span>
            <span className="mt-1 block text-xs leading-relaxed text-zinc-500">
              {option.detail}
            </span>
          </button>
        ))}
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
    </div>
  );
}

export function PasswordForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(signInWithPassword, undefined);
  return (
    <form action={action} className="mt-4 space-y-3">
      {next && <input type="hidden" name="next" value={next} />}
      <Field label="E-mail" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="username" required />
      </Field>
      <Field label="Password" htmlFor="password" error={state?.error}>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>
      <Button type="submit" variant="dark" className="w-full" disabled={pending}>
        {pending && <Spinner />}
        Sign in
      </Button>
    </form>
  );
}
