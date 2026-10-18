import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Card } from "@/ui/card";
import { DemoBanner } from "@/ui/demo-banner";
import { Skeleton } from "@/ui/feedback";

import { DemoButtons, PasswordForm } from "./forms";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <>
      <DemoBanner />
      <main className="flex flex-1 items-start justify-center px-4 py-12 sm:py-20">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center">
            <Link href="/" className="text-sm font-medium text-brand-700">
              Docs Assistant
            </Link>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">Sign in</h1>
          </div>

          <div>
            <h2 className="text-sm font-semibold text-zinc-900">Try the demo</h2>
            <p className="mb-3 mt-1 text-sm text-zinc-500">
              One click, no sign-up. You get a private copy of the demo company for 24 hours.
            </p>
            <DemoButtons />
          </div>

          <Card className="p-6">
            <h2 className="text-sm font-semibold text-zinc-900">Company accounts</h2>
            <Suspense fallback={<Skeleton className="mt-4 h-44" />}>
              <PasswordFormWithNext searchParams={searchParams} />
            </Suspense>
          </Card>
        </div>
      </main>
    </>
  );
}

async function PasswordFormWithNext({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const { next } = await searchParams;
  return <PasswordForm next={typeof next === "string" ? next : undefined} />;
}
