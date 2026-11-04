// Spending limit for AI agents. Every action an AI takes that would move money is priced first;
// anything above the user's per-payment limit is refused, logged and reported to the user.
import type { SupabaseClient } from "@supabase/supabase-js";
import { changeCost, getVisit } from "./actions-core";
import { CADENCES, type CadenceKey } from "./cadence";
import { forecastMonth, log, monthKey, nowFor } from "./engine";
import { monthLabel } from "./time";
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

/**
 * Why an AI may not do this, or null. Checked BEFORE the user is asked to approve, so a card is never shown
 * for something that would be refused: a payment over the per-payment limit, or a new service that would take
 * this month over the approved budget.
 */
export async function blockReason(supabase: SupabaseClient, profile: Profile, origin: AgentOrigin, tool: string, input: Record<string, unknown>) {
  const cur = profile.currency;
  const limit = limitFor(profile, origin);
  const { amount, what } = await paymentFor(supabase, profile, tool, input);
  if (limit != null && amount > limit)
    return {
      amount,
      limit,
      user: `${money(amount, cur)} for ${what} is over your AI spending limit of ${money(limit, cur)} a payment. You can add it yourself, or raise the limit in Settings.`,
      agent: `Refused by the user's spending limit: ${money(amount, cur)} is over the ${money(limit, cur)} per payment an AI may approve. Ask the user to do this in HaloDiary, or to raise the limit in Settings.`,
    };
  if (tool === "add_recurring_service" && amount > 0) {
    const cadence = CADENCES[String(input.cadence) as CadenceKey];
    const month = monthKey(nowFor(profile), profile.timezone);
    const [{ data: budget }, forecast] = await Promise.all([
      supabase.from("budgets").select("cap, status").eq("client_id", profile.id).eq("month", month).maybeSingle(),
      forecastMonth(supabase, profile, month),
    ]);
    const cap = budget?.status === "approved" ? Number(budget.cap) : profile.monthly_budget ? Number(profile.monthly_budget) : null;
    const added = amount * (cadence?.perMonth ?? 4.3);
    if (cap != null && forecast.total + added > cap)
      return {
        amount: added,
        limit: cap,
        user: `This adds about ${money(added, cur)} a month, taking ${monthLabel(month)} to ${money(forecast.total + added, cur)}, over your ${money(cap, cur)} budget. Raise the budget first, or choose a cheaper option.`,
        agent: `Refused by the user's monthly budget: adding this service costs about ${money(added, cur)} a month and would take ${monthLabel(month)} to ${money(forecast.total + added, cur)}, over the approved ${money(cap, cur)}. Ask the user to raise the budget on the Budget page, or suggest a cheaper provider or cadence.`,
      };
  }
  return null;
}

/** Returns an error for the AI when the call is not allowed (and logs it for the user); null when it may go ahead. */
export async function guardPayment(
  supabase: SupabaseClient,
  profile: Profile,
  origin: AgentOrigin,
  tool: string,
  input: Record<string, unknown>,
  reason: string,
) {
  const block = await blockReason(supabase, profile, origin, tool, input);
  if (!block) return null;
  const who = origin.via === "mcp" ? origin.agent : "HaloDiary assistant";
  await log(supabase, profile.id, "assistant", `Blocked: ${who} tried to ${tool.replace(/_/g, " ")}. ${block.user}`, { tool, input, reason, via: origin.via, agent: who, amount: block.amount, limit: block.limit });
  await supabase.from("notifications").insert({ user_id: profile.id, kind: "budget", title: "An AI action was blocked by your limits", body: block.user });
  return { error: origin.via === "mcp" ? block.agent : block.user };
}
