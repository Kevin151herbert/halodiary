// The scheduler. Pure code, no AI: it keeps working when the assistant is off.
// It runs lazily whenever a signed-in user loads the app, so the demo needs no cron.

import type { SupabaseClient } from "@supabase/supabase-js";
import { occurrences, visitsInMonth } from "./cadence";
import { defaultTermsFor, governingContract, planIdForVisit, providerChangeCredit, type Terms } from "./contract";
import { fingerprint } from "./contract-hash";
import * as paypal from "./paypal";
import type { Profile } from "./supabase/server";
import { fmtDay as fmtDayZ, fmtTime as fmtTimeZ, monthKey, monthRange, fmtMoney } from "./time";

export const COMMISSION = 0.1; // HaloDiary keeps 10%; the provider gets the rest
export const CHECK_WINDOW_HOURS = 24; // day-before check
export const CUTOFF_HOURS = 2; // silence by then means "proceed"

export function nowFor(profile: Pick<Profile, "clock_offset_hours">) {
  return new Date(Date.now() + (profile.clock_offset_hours ?? 0) * 3_600_000);
}

export { monthKey };

export type Plan = {
  id: string;
  client_id: string;
  provider_id: string;
  service_id: string;
  cadence: string;
  weekdays: number[];
  time_of_day: string;
  duration_minutes: number;
  price: number;
  start_date: string;
  status: string;
  notes: string;
};

export type VisitRow = {
  id: string;
  plan_id: string | null;
  client_id: string;
  provider_id: string;
  service_id: string;
  scheduled_at: string;
  duration_minutes: number;
  price: number;
  status: string;
  client_response: string | null;
  provider_response: string | null;
  check_sent_at: string | null;
  rescheduled_from: string | null;
  paypal_authorization_id: string | null;
  payment_mode: string | null;
  cancel_reason: string | null;
  provider_changed_at: string | null;
  credit_assessed: boolean;
  late_change: boolean;
  moved_by: "client" | "provider" | null;
  providers?: { display_name: string; is_demo: boolean; paypal_email: string | null; avatar_hue: number; profile_id: string | null } | null;
  services?: { name: string } | null;
  plans?: { check_hours: number; billing?: string } | null;
};

export const VISIT_SELECT = "*, providers(display_name, is_demo, paypal_email, avatar_hue, profile_id), services(name), plans(check_hours, billing)";


export async function log(
  supabase: SupabaseClient,
  userId: string,
  actor: "user" | "assistant" | "system",
  action: string,
  detail: Record<string, unknown> = {},
) {
  await supabase.from("activity_log").insert({ user_id: userId, actor, action, detail });
}

export async function notify(supabase: SupabaseClient, userId: string, kind: string, title: string, body: string, visitId?: string) {
  await supabase.from("notifications").insert({ user_id: userId, kind, title, body, visit_id: visitId ?? null });
}

/** Notify once per visit and kind, so repeated page loads don't stack the same message. */
async function notifyOnce(supabase: SupabaseClient, userId: string, kind: string, title: string, body: string, visitId: string) {
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("visit_id", visitId)
    .eq("kind", kind);
  if (!count) await notify(supabase, userId, kind, title, body, visitId);
}

/** Tell a real provider (one with a login) about a change the client made. Demo providers have no inbox. */
export async function notifyProvider(
  supabase: SupabaseClient,
  v: Pick<VisitRow, "id" | "providers">,
  kind: string,
  title: string,
  body: string,
) {
  const to = v.providers?.profile_id;
  if (!to || v.providers?.is_demo) return;
  await supabase.from("notifications").insert({ user_id: to, kind, title, body, visit_id: v.id });
}

/** Plans made before agreements existed get a version 1 on the standard terms, signed by both. */
async function backfillAgreements(supabase: SupabaseClient, profile: Profile, plans: Plan[]) {
  if (!plans.length) return;
  const { data: existing } = await supabase.from("contracts").select("plan_id").in("plan_id", plans.map((p) => p.id));
  const have = new Set((existing ?? []).map((c) => c.plan_id));
  const at = new Date().toISOString();
  const rows = plans
    .filter((p) => !have.has(p.id))
    .map((p) => {
      const terms: Terms = defaultTermsFor(p.service_id);
      return {
        plan_id: p.id,
        client_id: p.client_id,
        provider_id: p.provider_id,
        version: 1,
        status: "active",
        terms,
        terms_hash: fingerprint({ planId: p.id, clientId: p.client_id, providerId: p.provider_id, version: 1, price: p.price, terms }),
        proposed_by: "client",
        change_note: "Standard terms applied to a service added before agreements",
        client_signed_at: at,
        provider_signed_at: at,
      };
    });
  if (rows.length) await supabase.from("contracts").upsert(rows, { onConflict: "plan_id,version", ignoreDuplicates: true });
}

/** Make sure every active plan has its visits on the diary for the next six weeks. */
export async function ensureVisits(supabase: SupabaseClient, profile: Profile) {
  const now = nowFor(profile);
  const until = new Date(now.getTime() + 42 * 86_400_000);
  const { data: plans } = await supabase.from("plans").select("*").eq("client_id", profile.id).eq("status", "active");
  await backfillAgreements(supabase, profile, (plans ?? []) as Plan[]);
  const rows: Record<string, unknown>[] = [];
  for (const p of (plans ?? []) as Plan[]) {
    for (const at of occurrences(p, now, until, profile.timezone)) {
      rows.push({
        plan_id: p.id,
        client_id: p.client_id,
        provider_id: p.provider_id,
        service_id: p.service_id,
        scheduled_at: at.toISOString(),
        duration_minutes: p.duration_minutes,
        price: p.price,
      });
    }
  }
  if (rows.length) {
    await supabase.from("visits").upsert(rows, { onConflict: "plan_id,scheduled_at", ignoreDuplicates: true });
  }
}

/** Money used this month: holds still open, captures, and late-change fees. */
export async function spentInMonth(supabase: SupabaseClient, profile: Profile, month: string) {
  const { start, end } = monthRange(month, profile.timezone);
  const { data } = await supabase
    .from("visits")
    .select("price, status, plans(billing)")
    .eq("client_id", profile.id)
    .in("status", ["confirmed", "completed"])
    .gte("scheduled_at", start.toISOString())
    .lt("scheduled_at", end.toISOString());
  // Services on a PayPal subscription count as their flat monthly price instead of visit by visit.
  const { data: subs } = await supabase.from("plans").select("monthly_price").eq("client_id", profile.id).eq("billing", "subscription").eq("status", "active");
  const subscribed = (subs ?? []).reduce((s, p) => s + Number(p.monthly_price ?? 0), 0);
  const { data: fees } = await supabase
    .from("ledger_entries")
    .select("amount, visits!inner(scheduled_at)")
    .eq("client_id", profile.id)
    .eq("kind", "fee")
    .gte("visits.scheduled_at", start.toISOString())
    .lt("visits.scheduled_at", end.toISOString());
  // Extras paid in chat count against the month too, so the budget shows everything that left the client's account.
  const { data: extras } = await supabase
    .from("ledger_entries")
    .select("amount")
    .eq("client_id", profile.id)
    .eq("kind", "extra")
    .gte("created_at", start.toISOString())
    .lt("created_at", end.toISOString());
  const perVisit = (data ?? []).filter((v) => (v.plans as unknown as { billing?: string } | null)?.billing !== "subscription");
  return (
    perVisit.reduce((s, v) => s + Number(v.price), 0) +
    (fees ?? []).reduce((s, f) => s + Number(f.amount), 0) +
    (extras ?? []).reduce((s, e) => s + Number(e.amount), 0) +
    subscribed
  );
}

export async function forecastMonth(supabase: SupabaseClient, profile: Profile, month: string) {
  const { data: plans } = await supabase
    .from("plans")
    .select("*, services(name), providers(display_name)")
    .eq("client_id", profile.id)
    .eq("status", "active");
  type P = Plan & { services: { name: string }; providers: { display_name: string }; billing?: string; monthly_price?: number | null };
  const lines = ((plans ?? []) as P[]).map((p) => {
    const count = visitsInMonth(p, month, profile.timezone).length;
    const subscribed = p.billing === "subscription" && p.monthly_price;
    return {
      planId: p.id,
      service: p.services?.name ?? p.service_id,
      provider: p.providers?.display_name ?? "",
      visits: count,
      price: Number(p.price),
      total: subscribed ? Number(p.monthly_price) : count * Number(p.price),
      subscription: Boolean(subscribed),
    };
  });
  const total = lines.reduce((s, l) => s + l.total, 0);
  // A 10% buffer covers an extra visit or a price change, rounded up to the next 10.
  const cap = Math.ceil((total * 1.1) / 10) * 10;
  return { lines, total, cap };
}

/** Hold the money for a visit both sides have confirmed. Returns false if the budget blocks it. */
async function holdPayment(supabase: SupabaseClient, profile: Profile, v: VisitRow) {
  const tz = profile.timezone;
  const fmtDay = (d: Date) => fmtDayZ(d, tz);
  const month = monthKey(new Date(v.scheduled_at), tz);

  const contract = await governingContract(supabase, await planIdForVisit(supabase, v));
  if (v.plans?.billing === "subscription" && contract?.status !== "pending") {
    await supabase.from("visits").update({ status: "confirmed", payment_mode: paypal.paypalConfigured() ? "paypal_sandbox" : "simulated" }).eq("id", v.id);
    await log(supabase, profile.id, "system", `Confirmed ${v.services?.name}; covered by the monthly PayPal subscription`, { visit: v.id });
    return true;
  }
  if (contract && contract.status === "pending") {
    await notifyOnce(
      supabase,
      profile.id,
      "agreement",
      `Waiting for ${v.providers?.display_name} to sign the agreement`,
      `${v.services?.name} on ${fmtDay(new Date(v.scheduled_at))} will confirm once both of you have signed.`,
      v.id,
    );
    return false;
  }
  const { data: budget } = await supabase.from("budgets").select("*").eq("client_id", profile.id).eq("month", month).maybeSingle();

  if (!budget || budget.status !== "approved") {
    await notifyOnce(
      supabase,
      profile.id,
      "budget",
      "Approve this month's budget",
      `${v.services?.name} on ${fmtDay(new Date(v.scheduled_at))} is ready to confirm once the monthly budget is approved.`,
      v.id,
    );
    return false;
  }
  const spent = await spentInMonth(supabase, profile, month);
  if (spent + Number(v.price) > Number(budget.cap)) {
    await notifyOnce(
      supabase,
      profile.id,
      "budget_cap",
      "This visit would go over your monthly cap",
      `${v.services?.name} (${fmtMoney(Number(v.price), profile.currency)}) needs a budget increase before it can be confirmed.`,
      v.id,
    );
    return false;
  }

  let mode: "paypal_sandbox" | "simulated" = "simulated";
  let orderId: string | null = null;
  let authId = `SIM-AUTH-${v.id.slice(0, 8).toUpperCase()}`;
  if (paypal.paypalConfigured() && profile.paypal_payment_token) {
    try {
      const r = await paypal.authorizeWithVault({
        paymentToken: profile.paypal_payment_token,
        amount: Number(v.price),
        currency: profile.currency,
        description: `${v.services?.name} with ${v.providers?.display_name}, ${fmtDay(new Date(v.scheduled_at))}`,
        visitId: v.id,
      });
      mode = "paypal_sandbox";
      orderId = r.orderId;
      authId = r.authorizationId;
    } catch (e) {
      await log(supabase, profile.id, "system", "PayPal hold failed, using simulated hold", { visit: v.id, error: String(e) });
    }
  }

  await supabase
    .from("visits")
    .update({ status: "confirmed", paypal_order_id: orderId, paypal_authorization_id: authId, payment_mode: mode })
    .eq("id", v.id);
  await supabase.from("ledger_entries").insert({
    client_id: profile.id,
    visit_id: v.id,
    provider_id: v.provider_id,
    kind: "hold",
    amount: v.price,
    paypal_ref: authId,
    mode,
  });
  await log(supabase, profile.id, "system", `Held ${fmtMoney(Number(v.price), profile.currency)} for ${v.services?.name}`, {
    visit: v.id,
    mode,
  });
  return true;
}

/** Capture the hold and pay the provider, less any credit the client is owed under the agreement. */
export async function completeVisit(supabase: SupabaseClient, profile: Profile, v: VisitRow, actor: "user" | "system" = "system") {
  const fmtDay = (d: Date) => fmtDayZ(d, profile.timezone);
  const cur = profile.currency;
  const price = Number(v.price);

  // Covered by the PayPal subscription: nothing to capture, just pay the provider their share.
  if (v.plans?.billing === "subscription") {
    const share = Math.round(price * (1 - COMMISSION) * 100) / 100;
    const mode = (v.payment_mode as "paypal_sandbox" | "simulated") ?? "simulated";
    let payoutId = `SIM-PAYOUT-${v.id.slice(0, 8).toUpperCase()}`;
    let payoutMode: "paypal_sandbox" | "simulated" = "simulated";
    if (mode === "paypal_sandbox") {
      const po = await paypal.payProvider({ providerEmail: v.providers?.paypal_email, amount: share, currency: cur, note: `${v.services?.name}, ${fmtDay(new Date(v.scheduled_at))}`, fallbackRef: payoutId });
      payoutId = po.ref;
      payoutMode = po.mode;
      if (po.error) await log(supabase, profile.id, "system", "PayPal payout failed, recorded as simulated", { visit: v.id, error: po.error });
    }
    await supabase.from("visits").update({ status: "completed" }).eq("id", v.id);
    await supabase.from("ledger_entries").insert({ client_id: profile.id, visit_id: v.id, provider_id: v.provider_id, kind: "payout", amount: share, paypal_ref: payoutId, mode: payoutMode, note: "Covered by monthly PayPal subscription" });
    await log(supabase, profile.id, actor, `Completed ${v.services?.name}; paid ${v.providers?.display_name} from the subscription`, { visit: v.id });
    if (nowFor(profile).getTime() - new Date(v.scheduled_at).getTime() < 3 * 86_400_000) {
      const { requestRating } = await import("./chat");
      await requestRating(supabase, v, profile.timezone);
    }
    return;
  }

  // Credits from late provider changes come off this provider's next payment.
  const { data: credits } = await supabase
    .from("ledger_entries")
    .select("id, amount")
    .eq("client_id", profile.id)
    .eq("provider_id", v.provider_id)
    .eq("kind", "credit")
    .is("settled_at", null)
    .order("created_at");
  let creditUsed = 0;
  const settled: string[] = [];
  for (const c of credits ?? []) {
    if (creditUsed + Number(c.amount) > price + 0.001) break;
    creditUsed += Number(c.amount);
    settled.push(c.id);
  }
  creditUsed = Math.round(creditUsed * 100) / 100;
  const charge = Math.round((price - creditUsed) * 100) / 100;
  const providerShare = Math.round(charge * (1 - COMMISSION) * 100) / 100;

  let captureId = `SIM-CAP-${v.id.slice(0, 8).toUpperCase()}`;
  let payoutId = `SIM-PAYOUT-${v.id.slice(0, 8).toUpperCase()}`;
  const mode = (v.payment_mode as "paypal_sandbox" | "simulated") ?? "simulated";
  let payoutMode: "paypal_sandbox" | "simulated" = "simulated";

  if (mode === "paypal_sandbox" && v.paypal_authorization_id && paypal.paypalConfigured()) {
    try {
      if (charge <= 0) {
        await paypal.voidAuthorization(v.paypal_authorization_id);
        captureId = v.paypal_authorization_id;
      } else {
        // A partial final capture releases the rest of the hold.
        captureId = await paypal.captureAuthorization(v.paypal_authorization_id, charge < price ? { amount: charge, currency: cur } : undefined);
        const po = await paypal.payProvider({ providerEmail: v.providers?.paypal_email, amount: providerShare, currency: cur, note: `${v.services?.name}, ${fmtDay(new Date(v.scheduled_at))}`, fallbackRef: payoutId });
        payoutId = po.ref;
        payoutMode = po.mode;
        if (po.error) await log(supabase, profile.id, "system", "PayPal payout failed, recorded as simulated", { visit: v.id, error: po.error });
      }
    } catch (e) {
      await log(supabase, profile.id, "system", "PayPal capture or payout failed", { visit: v.id, error: String(e) });
    }
  }

  await supabase.from("visits").update({ status: "completed" }).eq("id", v.id);
  const note = creditUsed ? `${fmtMoney(creditUsed, cur)} agreement credit applied` : "";
  await supabase.from("ledger_entries").insert([
    { client_id: profile.id, visit_id: v.id, provider_id: v.provider_id, kind: "capture", amount: charge, paypal_ref: captureId, mode, note },
    { client_id: profile.id, visit_id: v.id, provider_id: v.provider_id, kind: "payout", amount: providerShare, paypal_ref: payoutId, mode: payoutMode, note },
  ]);
  if (settled.length) await supabase.from("ledger_entries").update({ settled_at: new Date().toISOString() }).in("id", settled);
  await notify(
    supabase,
    profile.id,
    "payment",
    `${v.services?.name} done, ${fmtMoney(charge, cur)} paid`,
    `${v.providers?.display_name} received ${fmtMoney(providerShare, cur)} through PayPal.${creditUsed ? ` Your ${fmtMoney(creditUsed, cur)} credit was taken off.` : ""}`,
    v.id,
  );
  await log(supabase, profile.id, actor, `Completed ${v.services?.name}; captured and paid ${v.providers?.display_name}`, {
    visit: v.id,
    mode,
    credit: creditUsed,
  });
  // Ask for a rating in the chat with this provider. Only for visits that just finished,
  // so a long demo-clock jump doesn't flood the thread with old requests.
  if (nowFor(profile).getTime() - new Date(v.scheduled_at).getTime() < 3 * 86_400_000) {
    const { requestRating } = await import("./chat");
    await requestRating(supabase, v, profile.timezone);
  }
}

/** Charge a late-change fee under the agreement and pay it on to the provider. */
export async function chargeFee(supabase: SupabaseClient, profile: Profile, v: VisitRow, amount: number, reason: string) {
  const cur = profile.currency;
  const providerShare = Math.round(amount * (1 - COMMISSION) * 100) / 100;
  let mode: "paypal_sandbox" | "simulated" = "simulated";
  let feeRef = `SIM-FEE-${v.id.slice(0, 8).toUpperCase()}`;
  let payoutRef = `SIM-PAYOUT-FEE-${v.id.slice(0, 8).toUpperCase()}`;
  let payoutMode: "paypal_sandbox" | "simulated" = "simulated";
  if (paypal.paypalConfigured() && profile.paypal_payment_token) {
    try {
      const auth = await paypal.authorizeWithVault({
        paymentToken: profile.paypal_payment_token,
        amount,
        currency: cur,
        description: `Late change fee: ${v.services?.name} with ${v.providers?.display_name}`,
        visitId: `${v.id}-fee`,
      });
      feeRef = await paypal.captureAuthorization(auth.authorizationId);
      mode = "paypal_sandbox";
      const po = await paypal.payProvider({ providerEmail: v.providers?.paypal_email, amount: providerShare, currency: cur, note: `Late change fee, ${v.services?.name}`, fallbackRef: payoutRef });
      payoutRef = po.ref;
      payoutMode = po.mode;
      if (po.error) await log(supabase, profile.id, "system", "PayPal payout failed, recorded as simulated", { visit: v.id, error: po.error });
    } catch (e) {
      await log(supabase, profile.id, "system", "PayPal fee charge failed, recorded as simulated", { visit: v.id, error: String(e) });
    }
  }
  await supabase.from("ledger_entries").insert([
    { client_id: profile.id, visit_id: v.id, provider_id: v.provider_id, kind: "fee", amount, paypal_ref: feeRef, mode, note: reason },
    { client_id: profile.id, visit_id: v.id, provider_id: v.provider_id, kind: "payout", amount: providerShare, paypal_ref: payoutRef, mode: payoutMode, note: "Late change fee" },
  ]);
  await log(supabase, profile.id, "system", `Charged a ${fmtMoney(amount, cur)} late change fee for ${v.services?.name}`, { visit: v.id, reason, mode });
}

/** Release a hold (skipped or cancelled visit). */
export async function releaseHold(supabase: SupabaseClient, profile: Profile, v: VisitRow) {
  if (!v.paypal_authorization_id) return;
  const mode = (v.payment_mode as "paypal_sandbox" | "simulated") ?? "simulated";
  if (mode === "paypal_sandbox" && paypal.paypalConfigured()) {
    try {
      await paypal.voidAuthorization(v.paypal_authorization_id);
    } catch (e) {
      await log(supabase, profile.id, "system", "PayPal void failed", { visit: v.id, error: String(e) });
    }
  }
  await supabase.from("ledger_entries").insert({
    client_id: profile.id,
    visit_id: v.id,
    provider_id: v.provider_id,
    kind: "void",
    amount: v.price,
    paypal_ref: v.paypal_authorization_id,
    mode,
  });
}

/** Move every visit forward through its life cycle based on the (demo) clock. */
// When the app last ran the scheduler for each user (per server instance), keyed with the demo clock so a
// clock jump always runs it. Every action that changes visits calls advance() itself, and the Render cron
// covers everyone in the background, so page loads only need it when it is a little stale.
const lastAdvance = new Map<string, { at: number; run: Promise<void> }>();
const ADVANCE_EVERY_MS = 60_000;

/**
 * advance(), skipped when it already ran for this user and demo clock in the last minute. The layout and the
 * page render at the same time, so a run in progress is shared: whoever asks second waits for the same run
 * instead of reading the diary before it has moved.
 */
export async function advanceIfStale(supabase: SupabaseClient, profile: Profile) {
  if (profile.role !== "client") return;
  const key = `${profile.id}:${profile.clock_offset_hours}`;
  const last = lastAdvance.get(key);
  if (last && Date.now() - last.at < ADVANCE_EVERY_MS) return last.run;
  const run = advance(supabase, profile).catch((e) => {
    lastAdvance.delete(key);
    throw e;
  });
  lastAdvance.set(key, { at: Date.now(), run });
  return run;
}

export async function advance(supabase: SupabaseClient, profile: Profile) {
  if (profile.role !== "client") return;
  const fmtDay = (d: Date) => fmtDayZ(d, profile.timezone);
  const fmtTime = (d: Date) => fmtTimeZ(d, profile.timezone);
  await ensureVisits(supabase, profile);
  const now = nowFor(profile);
  // Agreements set the reminder between 24 and 72 hours ahead; fetch the widest window and filter per visit.
  const windowEnd = new Date(now.getTime() + 72 * 3_600_000);

  // 1. Day-before checks go out. When the demo clock jumps several days, visits inside the
  //    jump get their check too (with no answer), so they go ahead exactly as they would have.
  const { data: due } = await supabase
    .from("visits")
    .select(VISIT_SELECT)
    .eq("client_id", profile.id)
    .eq("status", "scheduled")
    .lte("scheduled_at", windowEnd.toISOString())
    .order("scheduled_at");
  for (const v of (due ?? []) as VisitRow[]) {
    const at = new Date(v.scheduled_at);
    const hours = v.plans?.check_hours ?? CHECK_WINDOW_HOURS;
    if (at.getTime() > now.getTime() + hours * 3_600_000) continue;
    const auto = profile.auto_checks_enabled && profile.assistant_enabled;
    await supabase
      .from("visits")
      .update({
        status: "awaiting",
        check_sent_at: now.toISOString(),
        // Demo providers have no login; they say yes, unless a judge answers for them in the provider view.
        provider_response: v.providers?.is_demo ? "proceed" : v.provider_response,
        client_response: auto ? "proceed" : v.client_response,
      })
      .eq("id", v.id);
    if (at > now) await notify(
      supabase,
      profile.id,
      "day_before_check",
      `${v.services?.name} with ${v.providers?.display_name}, ${fmtDay(at)} at ${fmtTime(at)}`,
      auto ? "Your assistant confirmed this for you." : "Proceed as planned, move it, or skip it.",
      v.id,
    );
    if (auto) await log(supabase, profile.id, "assistant", `Confirmed tomorrow's ${v.services?.name}`, { visit: v.id });
  }

  // 1b. Provider moves and cancellations: settle them under the agreement.
  const { data: changed } = await supabase
    .from("visits")
    .select(VISIT_SELECT)
    .eq("client_id", profile.id)
    .in("provider_response", ["reschedule", "cancel"])
    .eq("credit_assessed", false);
  for (const v of (changed ?? []) as VisitRow[]) {
    const kind = v.provider_response === "cancel" ? "cancel" : "move";
    const changedAt = v.provider_changed_at ? new Date(v.provider_changed_at) : now;
    const hoursUntil = (new Date(v.scheduled_at).getTime() - changedAt.getTime()) / 3_600_000;
    const contract = await governingContract(supabase, await planIdForVisit(supabase, v));
    const c = contract?.status === "active" ? providerChangeCredit(contract.terms, { price: Number(v.price), hoursUntil, kind }) : null;
    if (kind === "cancel" && v.status !== "cancelled") {
      if (v.status === "confirmed") await releaseHold(supabase, profile, v);
      await supabase.from("visits").update({ status: "cancelled" }).eq("id", v.id);
      await notify(
        supabase,
        profile.id,
        "provider_cancelled",
        `${v.providers?.display_name} cancelled ${v.services?.name}, ${fmtDay(new Date(v.scheduled_at))}`,
        `Reason: ${v.cancel_reason || "not given"}. Nothing is charged for this visit.${c?.credit ? ` Under your agreement you get a ${fmtMoney(c.credit, profile.currency)} credit on the next payment.` : ""}`,
        v.id,
      );
      await log(supabase, profile.id, "system", `${v.providers?.display_name} cancelled ${v.services?.name}`, { visit: v.id, reason: v.cancel_reason });
    }
    if (c?.credit) {
      await supabase.from("ledger_entries").insert({
        client_id: profile.id,
        visit_id: v.id,
        provider_id: v.provider_id,
        kind: "credit",
        amount: c.credit,
        paypal_ref: `CREDIT-${v.id.slice(0, 8).toUpperCase()}`,
        mode: "simulated",
        note: c.reason,
      });
      await log(supabase, profile.id, "system", `Agreement credit of ${fmtMoney(c.credit, profile.currency)} from ${v.providers?.display_name}`, {
        visit: v.id,
        reason: c.reason,
      });
    }
    await supabase.from("visits").update({ credit_assessed: true }).eq("id", v.id);
  }

  // 2. Confirm visits where both sides said go, or where the client stayed silent past the cut-off.
  const cutoff = new Date(now.getTime() + CUTOFF_HOURS * 3_600_000);
  const { data: awaiting } = await supabase
    .from("visits")
    .select(VISIT_SELECT)
    .eq("client_id", profile.id)
    .eq("status", "awaiting")
    .order("scheduled_at");
  for (const v of (awaiting ?? []) as VisitRow[]) {
    const at = new Date(v.scheduled_at);
    const silentPastCutoff = !v.client_response && at <= cutoff;
    const providerOk = v.provider_response === "proceed" || v.providers?.is_demo;
    if ((v.client_response === "proceed" || silentPastCutoff) && providerOk) {
      if (silentPastCutoff) {
        await supabase.from("visits").update({ client_response: "proceed" }).eq("id", v.id);
        await log(supabase, profile.id, "system", `No reply by the cut-off, so ${v.services?.name} goes ahead`, { visit: v.id });
      }
      await holdPayment(supabase, profile, v);
    }
  }

  // 3. Visits that are over get completed: demo providers 1 hour after the end, real ones after 24 hours.
  const { data: confirmed } = await supabase
    .from("visits")
    .select(VISIT_SELECT)
    .eq("client_id", profile.id)
    .eq("status", "confirmed")
    .lt("scheduled_at", now.toISOString());
  for (const v of (confirmed ?? []) as VisitRow[]) {
    const end = new Date(v.scheduled_at).getTime() + v.duration_minutes * 60_000;
    const grace = v.providers?.is_demo ? 3_600_000 : 86_400_000;
    // A real provider marking the visit done settles it straight away.
    if (v.provider_response === "done" || now.getTime() >= end + grace) await completeVisit(supabase, profile, v);
  }

  // 4. Visits that could not be confirmed in time (no approved budget, or a real provider who
  //    never confirmed) are skipped at no charge once their time has passed.
  await supabase
    .from("visits")
    .update({ status: "skipped" })
    .eq("client_id", profile.id)
    .in("status", ["scheduled", "awaiting"])
    .lt("scheduled_at", new Date(now.getTime() - 3_600_000).toISOString());
}

/** Minutes an average booking takes by hand: search, message, agree, remind, pay. Shown as "time saved". */
export const MINUTES_SAVED_PER_VISIT = 12;
