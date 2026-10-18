import { z } from "zod";

/**
 * Environment variables, split by where they may be read.
 *
 * Public values are inlined into the browser bundle by Next.js, so they must never hold secrets.
 * Server values are read only by modules that import "server-only".
 *
 * The AI keys are optional so the app still starts without them: without VOYAGE_API_KEY documents cannot be
 * indexed or searched, without ANTHROPIC_API_KEY the assistant is switched off. Both say so in the UI.
 */

/** An unset variable and an empty one (`KEY=` in a .env file) both mean "not configured". */
function optional<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => (value === "" ? undefined : value), schema.optional());
}

export const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  NEXT_PUBLIC_APP_URL: optional(z.url()),
});

export const serverEnvSchema = z.object({
  // Bypasses row-level security. Used only by server code after it has authorized the request.
  SUPABASE_SECRET_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: optional(
    z.string().startsWith("sk-ant-", "an Anthropic key starts with sk-ant-"),
  ),
  ANTHROPIC_MODEL: optional(z.string().min(1)),
  ANTHROPIC_EFFORT: optional(z.enum(["low", "medium", "high"])),
  VOYAGE_API_KEY: optional(z.string().min(10)),
  // Password of the demo company's fixed accounts. Local databases fall back to a fixed one.
  DEMO_USER_PASSWORD: optional(z.string().min(8)),
  // Shared secret for the scheduled clean-up endpoint.
  CRON_SECRET: optional(z.string().min(16)),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;

/** Parses a set of variables and throws one readable error listing every problem. */
export function parseEnv<T extends z.ZodType>(
  schema: T,
  source: Record<string, string | undefined>,
  label: string,
): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid ${label} environment variables:\n${problems}`);
  }
  return result.data;
}

/** True for a Supabase stack on this machine, where fixed demo passwords are acceptable. */
export function isLocalSupabase(url: string): boolean {
  return /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(url);
}
