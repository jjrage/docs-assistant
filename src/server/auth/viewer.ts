import "server-only";

import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";

import { userDb } from "../db/user-client";

/**
 * Who is signed in, in which company and with which role. Read once per request from the session cookie
 * (the proxy keeps it fresh); every page and action calls requireViewer() or requireAdmin(), and the
 * database's row-level security applies to everything they read.
 */

export type Viewer = {
  userId: string;
  email: string;
  displayName: string;
  role: "admin" | "member";
  company: {
    id: string;
    slug: string;
    name: string;
    kind: "standard" | "template" | "sandbox";
    /** The template a sandbox reads its sample documents from. */
    libraryId: string | null;
    expiresAt: string | null;
  };
};

export const getViewer = cache(async (): Promise<Viewer | null> => {
  // Signed-in pages render per request: the session check compares token expiry with the current time,
  // which a prerendered (or prefetched) shell must not do.
  await connection();
  const db = await userDb();
  const { data } = await db.auth.getClaims();
  const userId = data?.claims.sub;
  if (!userId) return null;

  const { data: membership } = await db
    .from("memberships")
    .select(
      "role, display_name, company:companies!inner(id, slug, name, kind, library_company_id, expires_at)",
    )
    .eq("user_id", userId)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!membership) return null;

  const { company } = membership;
  return {
    userId,
    email: String(data.claims.email ?? ""),
    displayName: membership.display_name,
    role: membership.role,
    company: {
      id: company.id,
      slug: company.slug,
      name: company.name,
      kind: company.kind,
      libraryId: company.library_company_id,
      expiresAt: company.expires_at,
    },
  };
});

/** The companies whose documents this viewer searches: their own and, for a sandbox, its template. */
export function searchableCompanyIds(viewer: Viewer): string[] {
  return viewer.company.libraryId
    ? [viewer.company.id, viewer.company.libraryId]
    : [viewer.company.id];
}

export async function requireViewer(next = "/chat"): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect(`/login?next=${encodeURIComponent(next)}`);
  return viewer;
}

export async function requireAdmin(next = "/documents"): Promise<Viewer> {
  const viewer = await requireViewer(next);
  if (viewer.role !== "admin") redirect("/chat");
  return viewer;
}
