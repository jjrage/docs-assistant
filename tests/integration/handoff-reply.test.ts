import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { replyToHandoff } from "@/server/admin/data";
import type { Viewer } from "@/server/auth/viewer";

import { createAdminClient, createTestCompany } from "./admin-client";

/** Replying to a hand-off is a server write: it must stay inside the admin's own company, once. */

const admin = createAdminClient();
let companyA: Awaited<ReturnType<typeof createTestCompany>>;
let companyB: Awaited<ReturnType<typeof createTestCompany>>;
let userId: string;
let handoffId: string;

const viewerOf = (companyId: string): Viewer => ({
  userId,
  email: "admin@test.example",
  displayName: "Admin",
  role: "admin",
  company: {
    id: companyId,
    slug: "x",
    name: "X",
    kind: "standard",
    libraryId: null,
    expiresAt: null,
  },
});

beforeAll(async () => {
  companyA = await createTestCompany(admin, "Hand-off A");
  companyB = await createTestCompany(admin, "Hand-off B");
  const { data: user } = await admin.auth.admin.createUser({
    email: `handoff-${randomUUID().slice(0, 8)}@test.example`,
    email_confirm: true,
  });
  userId = user.user!.id;
  const { data: conversation } = await admin
    .from("conversations")
    .insert({ company_id: companyA.companyId, user_id: userId, title: "EV charging" })
    .select("id")
    .single();
  const { data: handoff } = await admin
    .from("handoffs")
    .insert({
      company_id: companyA.companyId,
      conversation_id: conversation!.id,
      asked_by: userId,
      question: "Is there EV charging?",
      reason: "Not in the documents.",
    })
    .select("id")
    .single();
  handoffId = handoff!.id;
});

afterAll(async () => {
  await companyA.cleanup();
  await companyB.cleanup();
  await admin.auth.admin.deleteUser(userId);
});

describe("replying to a hand-off", () => {
  it("does nothing for an admin of another company", async () => {
    expect(await replyToHandoff(viewerOf(companyB.companyId), handoffId, "Yes")).toEqual({
      error: "This question was already answered.",
    });
    const { data } = await admin.from("handoffs").select("status").eq("id", handoffId).single();
    expect(data!.status).toBe("open");
  });

  it("answers once for the company's admin", async () => {
    expect(
      await replyToHandoff(viewerOf(companyA.companyId), handoffId, "Two chargers in lot B."),
    ).toEqual({});
    const { data } = await admin
      .from("handoffs")
      .select("status, answer, answered_by")
      .eq("id", handoffId)
      .single();
    expect(data).toEqual({
      status: "answered",
      answer: "Two chargers in lot B.",
      answered_by: userId,
    });
    expect(await replyToHandoff(viewerOf(companyA.companyId), handoffId, "Again")).toEqual({
      error: "This question was already answered.",
    });
  });
});
