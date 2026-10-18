import { describe, expect, it } from "vitest";

import { isLocalSupabase, parseEnv, publicEnvSchema, serverEnvSchema } from "./env-schema";

describe("environment", () => {
  it("treats empty optional values as not configured", () => {
    const env = parseEnv(
      serverEnvSchema,
      { SUPABASE_SECRET_KEY: "sb_secret_x", ANTHROPIC_API_KEY: "", VOYAGE_API_KEY: "" },
      "server",
    );
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.VOYAGE_API_KEY).toBeUndefined();
  });

  it("lists every problem in one error", () => {
    expect(() =>
      parseEnv(publicEnvSchema, { NEXT_PUBLIC_SUPABASE_URL: "not a url" }, "public"),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_URL[\s\S]*NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  });

  it("rejects a key that is not an Anthropic key", () => {
    expect(() =>
      parseEnv(
        serverEnvSchema,
        { SUPABASE_SECRET_KEY: "sb_secret_x", ANTHROPIC_API_KEY: "pa-voyage" },
        "server",
      ),
    ).toThrow(/sk-ant-/);
  });

  it("recognizes a local Supabase stack", () => {
    expect(isLocalSupabase("http://127.0.0.1:44621")).toBe(true);
    expect(isLocalSupabase("https://abc.supabase.co")).toBe(false);
  });
});
