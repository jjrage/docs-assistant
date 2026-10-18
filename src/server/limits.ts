/**
 * Limits that keep the public demo cheap and safe. Real companies get roomier document limits; the question
 * limits apply to everyone (the API key also has a spending limit).
 */
export const limits = {
  file: {
    maxBytes: 10 * 1024 * 1024,
    /** Pages per PDF in a sandbox; more pages mean more embedding tokens and slower indexing. */
    maxPagesSandbox: 40,
    maxPages: 300,
  },
  documents: {
    /** A visitor's own uploads in a sandbox, on top of the sample documents. */
    perSandbox: 5,
    perCompany: 200,
  },
  sandbox: {
    lifetimeHours: 24,
    perVisitorPerDay: 3,
  },
  questions: {
    maxChars: 1000,
    perUserPerDay: 40,
    /** A ceiling for the whole deployment per day. */
    perDay: 400,
    turnsPerConversation: 12,
  },
} as const;
