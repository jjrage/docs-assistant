import "server-only";

import { serverEnv } from "@/config/server-env";

import { voyageEmbedder, type Embedder } from "./voyage";

/** The app's embedder, or null when VOYAGE_API_KEY is not configured (indexing and search are off). */
export function appEmbedder(): Embedder | null {
  return serverEnv.VOYAGE_API_KEY ? voyageEmbedder(serverEnv.VOYAGE_API_KEY) : null;
}
