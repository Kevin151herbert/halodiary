import "server-only";
// Personal access tokens for other AI assistants (Claude Desktop, ChatGPT, custom agents) that use
// HaloDiary's MCP server. Only a hash is stored. A valid token becomes a normal signed-in session
// for its owner, so the agent is held to the same row level security as the app itself.

import { createHash, randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { adminClient } from "./supabase/admin";
import { supabaseKey, supabaseUrl } from "./supabase/env";
import type { Profile } from "./supabase/server";

export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export function newToken() {
  const token = `hd_${randomBytes(24).toString("base64url")}`;
  return { token, hash: hashToken(token), hint: `${token.slice(0, 6)}…${token.slice(-4)}` };
}

type Agent = { supabase: SupabaseClient; profile: Profile; label: string; tokenId: string };
// Only the signed-in client is cached; the token and profile are checked on every request,
// so revoking a token or changing the spending limit takes effect at once.
const sessions = new Map<string, { supabase: SupabaseClient; expires: number }>();

/** Resolve a bearer token to its owner's session, or null. */
export async function agentFromToken(token: string): Promise<Agent | null> {
  if (!/^hd_[A-Za-z0-9_-]{20,}$/.test(token)) return null;
  const hash = hashToken(token);
  const admin = adminClient();
  if (!admin) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  const { data: row } = await admin.from("agent_tokens").select("id, user_id, label").eq("token_hash", hash).is("revoked_at", null).maybeSingle();
  if (!row) {
    sessions.delete(hash);
    return null;
  }

  let supabase = sessions.get(hash)?.expires && sessions.get(hash)!.expires > Date.now() ? sessions.get(hash)!.supabase : null;
  if (!supabase) {
    // Sign in as the owner without a password: a one-time login link, redeemed server-side.
    const { data: u } = await admin.auth.admin.getUserById(row.user_id);
    const email = u.user?.email;
    if (!email) return null;
    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (linkErr || !link.properties?.hashed_token) throw new Error("Could not open a session for this token");
    supabase = createClient(supabaseUrl(), supabaseKey(), { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: sess, error } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
    if (error || !sess.session) throw new Error("Could not open a session for this token");
    sessions.set(hash, { supabase, expires: (sess.session.expires_at ?? 0) * 1000 - 5 * 60_000 });
  }

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", row.user_id).single();
  if (!profile) return null;
  await admin.from("agent_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", row.id);
  return { supabase, profile: profile as Profile, label: row.label, tokenId: row.id };
}
