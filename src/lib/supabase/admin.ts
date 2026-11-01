import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseUrl } from "./env";

/** Server-only client for jobs with no signed-in user: the scheduler cron and PayPal webhooks. */
export function adminClient(): SupabaseClient | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!key) return null;
  return createClient(supabaseUrl(), key, { auth: { persistSession: false, autoRefreshToken: false } });
}
