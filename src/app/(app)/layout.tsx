import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { requireViewer, type Viewer } from "@/server/auth/viewer";
import { userDb } from "@/server/db/user-client";
import { DemoBanner } from "@/ui/demo-banner";
import { Skeleton } from "@/ui/feedback";

import { signOut } from "../login/actions";
import { Nav, NavFallback, RoleSwitch } from "./nav";

export const metadata: Metadata = { robots: { index: false } };

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <DemoBanner />
      <div className="flex flex-1">
        <aside className="hidden w-64 shrink-0 flex-col border-r border-zinc-200 bg-white lg:flex">
          <div className="px-5 py-5">
            <Link href="/" className="text-xs font-semibold uppercase tracking-wide text-brand-700">
              Docs Assistant
            </Link>
          </div>
          <Suspense fallback={<NavFallback />}>
            <NavForViewer />
          </Suspense>
          <div className="mt-auto border-t border-zinc-100 px-5 py-4">
            <Suspense fallback={<Skeleton className="h-24" />}>
              <Account />
            </Suspense>
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="space-y-3 border-b border-zinc-200 bg-white px-4 py-3 lg:hidden">
            <Suspense fallback={<NavFallback compact />}>
              <NavForViewer compact />
            </Suspense>
          </div>
          <main className="flex w-full flex-1 flex-col">{children}</main>
        </div>
      </div>
    </div>
  );
}

async function openHandoffs(viewer: Viewer): Promise<number> {
  if (viewer.role !== "admin") return 0;
  const db = await userDb();
  const { count } = await db
    .from("handoffs")
    .select("id", { count: "exact", head: true })
    .eq("company_id", viewer.company.id)
    .eq("status", "open");
  return count ?? 0;
}

async function NavForViewer({ compact = false }: { compact?: boolean }) {
  const viewer = await requireViewer();
  return (
    <Nav
      admin={viewer.role === "admin"}
      openHandoffs={await openHandoffs(viewer)}
      compact={compact}
    />
  );
}

function hoursLeft(expiresAt: string): number {
  return Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 3600_000));
}

async function Account() {
  const viewer = await requireViewer();
  const sandbox = viewer.company.kind === "sandbox";
  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold leading-tight text-zinc-900">{viewer.company.name}</p>
        <p className="mt-0.5 text-xs text-zinc-500">
          {sandbox && viewer.company.expiresAt
            ? `Your private demo copy · ${hoursLeft(viewer.company.expiresAt)} h left`
            : `${viewer.displayName} · ${viewer.role === "admin" ? "Admin" : "Member"}`}
        </p>
      </div>
      {sandbox && <RoleSwitch role={viewer.role} />}
      <form action={signOut}>
        <button type="submit" className="text-xs text-zinc-500 underline hover:text-zinc-800">
          {sandbox ? "Leave the demo" : "Sign out"}
        </button>
      </form>
    </div>
  );
}
