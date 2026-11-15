import "server-only";
import { createClient as createSbClient } from "@supabase/supabase-js";
import { assertPublicEnv, publicEnv } from "@/lib/env";

/**
 * Service-role client: bypasses RLS. Server-only. Use ONLY for writes teachers
 * must not perform themselves (e.g. storing AI extraction results), and always
 * scope queries to the verified teacher id.
 */
export function createAdminClient() {
  assertPublicEnv();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set (server-only).");
  return createSbClient(publicEnv.supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
