import type { PostgrestError } from "@supabase/supabase-js";

/** Unwraps a Supabase result, throwing with context when the query failed or returned nothing. */
export function unwrap<T>(
  result: { data: T; error: PostgrestError | null },
  what: string,
): NonNullable<T> {
  if (result.error) {
    throw new Error(`${what}: ${result.error.message} (${result.error.code})`);
  }
  if (result.data === null || result.data === undefined) {
    throw new Error(`${what}: no data returned`);
  }
  return result.data;
}

/** For writes that return nothing: throws on error, like unwrap(). */
export function ensureOk(result: { error: PostgrestError | null }, what: string): void {
  if (result.error) {
    throw new Error(`${what}: ${result.error.message} (${result.error.code})`);
  }
}
