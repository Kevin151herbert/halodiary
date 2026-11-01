// Spending limit for AI agents. Every action an AI takes that would move money is priced first;
// anything above the user's per-payment limit is refused, logged and reported to the user.
import type { SupabaseClient } from "@supabase/supabase-js";
import { changeCost, getVisit } from "./actions-core";
import { log } from "./engine";
import type { Profile } from "./supabase/server";

/** Outside agents (MCP) get this limit until the user sets their own. */
export const DEFAULT_AGENT_LIMIT = 50;

export type AgentOrigin = { via: "assistant" } | { via: "mcp"; agent: string };

export function limitFor(profile: Profile, origin: AgentOrigin) {
  const set = profile.agent_max_per_payment == null ? null : Number(profile.agent_max_per_payment);
  if (set != null && !Number.isNaN(set)) return set;
  return origin.via === "mcp" ? DEFAULT_AGENT_LIMIT : null;
}

/** The single largest payment this tool call would cause, or 0 when it moves no money. */
export async function paymentFor(supabase: SupabaseClient, profile: Profile, tool: string, input: Record<string, unknown>) {
  if (tool === "add_recurring_service") {
    const { data } = await supabase
      .from("provider_services")
      .select("price")
      .eq("provider_id", String(input.provider_id))
      .eq("service_id", String(input.service_id))
      .maybeSingle();
    return { amount: Number(data?.price ?? 0), what: "each visit of this service" };
  }
  if (tool === "answer_visit") {
    const v = await getVisit(supabase, String(input.visit_id));
    if (!v) return { amount: 0, what: "" };
    if (input.action === "proceed") return { amount: Number(v.price), what: "this visit" };
    const c = await changeCost(supabase, profile, v, input.action === "skip" ? "skip" : "reschedule");
    return { amount: c.fee, what: "the late change fee" };
  }
  return { amount: 0, what: "" };
}

const money = (n: number, cur: string) => new Intl.NumberFormat("en-GB", { style: "currency", currency: cur }).format(n);

/** Returns an error for the agent when the call is over the limit; null when it may go ahead. */
export async function guardPayment(
  supabase: SupabaseClient,
  profile: Profile,
  origin: AgentOrigin,
  tool: string,
  input: Record<string, unknown>,
  reason: string,
) {
  const limit = limitFor(profile, origin);
  const who = origin.via === "mcp" ? origin.agent : "HaloDiary assistant";
  const { amount, what } = await paymentFor(supabase, profile, tool, input);
  if (limit == null || amount <= limit) return null;
  const msg = `${who} tried to approve ${money(amount, profile.currency)} for ${what}, over your AI limit of ${money(limit, profile.currency)} per payment.`;
  await log(supabase, profile.id, "assistant", `Blocked: ${msg}`, { tool, input, reason, via: origin.via, agent: who, amount, limit });
  await supabase.from("notifications").insert({ user_id: profile.id, kind: "budget", title: "An AI action was blocked by your spending limit", body: msg });
  return {
    error: `Refused by the user's spending limit: ${money(amount, profile.currency)} is over the ${money(limit, profile.currency)} per payment an AI may approve. Ask the user to do this in HaloDiary, or to raise the limit in Settings.`,
  };
}
