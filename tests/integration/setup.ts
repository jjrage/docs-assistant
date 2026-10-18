import { existsSync } from "node:fs";

// Local runs read the keys written from `supabase status`; CI provides them as environment variables.
if (existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

// Integration tests never call paid APIs, even when .env.local has keys: embeddings come from the fake
// embedder and the model from a local stand-in. Evals (`npm run eval`) are where the real APIs run.
for (const key of ["ANTHROPIC_API_KEY", "VOYAGE_API_KEY"]) {
  delete process.env[key];
}
