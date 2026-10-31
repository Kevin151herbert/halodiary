// The scheduler. Pure code, no AI: it keeps working when the assistant is off.
// It runs lazily whenever a signed-in user loads the app, so the demo needs no cron.

import type { SupabaseClient } from "@supabase/supabase-js";
import { occurrences, visitsInMonth } from "./cadence";
import * as paypal from "./paypal";
import type { Profile } from "./supabase/server";
import { fmtDay as fmtDayZ, fmtTime as fmtTimeZ, monthKey, monthRange } from "./time";

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
  providers?: { display_name: string; is_demo: boolean; paypal_email: string | null; avatar_hue: number } | null;
  services?: { name: string } | null;
};

export const VISIT_SELECT = "*, providers(display_name, is_demo, paypal_email, avatar_hue), services(name)";


export async function log(
  supabase: SupabaseClient,
  userId: string,
  actor: "user" | "assistant" | "system",
  action: string,
  detail: Record<string, unknown> = {},
) {
  await supabase.from("activity_log").insert({ user_id: userId, actor, action, detail });
}

async function notify(supabase: SupabaseClient, userId: string, kind: string, title: string, body: string, visitId?: string) {
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

/** Make sure every active plan has its visits on the diary for the next six weeks. */
export async function ensureVisits(supabase: SupabaseClient, profile: Profile) {
  const now = nowFor(profile);
  const until = new Date(now.getTime() + 42 * 86_400_000);
  const { data: plans } = await supabase.from("plans").select("*").eq("client_id", profile.id).eq("status", "active");
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

/** Money used this month: holds still open plus captures. */
export async function spentInMonth(supabase: SupabaseClient, profile: Profile, month: string) {
  const { start, end } = monthRange(month, profile.timezone);
  const { data } = await supabase
    .from("visits")
    .select("price, status")
    .eq("client_id", profile.id)
    .in("status", ["confirmed", "completed"])
    .gte("scheduled_at", start.toISOString())
    .lt("scheduled_at", end.toISOString());
  return (data ?? []).reduce((s, v) => s + Number(v.price), 0);
}

export async function forecastMonth(supabase: SupabaseClient, profile: Profile, month: string) {
  const { data: plans } = await supabase
    .from("plans")
    .select("*, services(name), providers(display_name)")
    .eq("client_id", profile.id)
    .eq("status", "active");
  const lines = ((plans ?? []) as (Plan & { services: { name: string }; providers: { display_name: string } })[]).map((p) => {
    const count = visitsInMonth(p, month, profile.timezone).length;
    return {
      planId: p.id,
      service: p.services?.name ?? p.service_id,
      provider: p.providers?.display_name ?? "",
      visits: count,
      price: Number(p.price),
      total: count * Number(p.price),
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
      `${v.services?.name} (${profile.currency} ${Number(v.price).toFixed(2)}) needs a budget increase before it can be confirmed.`,
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
  await log(supabase, profile.id, "system", `Held ${profile.currency} ${Number(v.price).toFixed(2)} for ${v.services?.name}`, {
    visit: v.id,
    mode,
  });
  return true;
}

/** Capture the hold and pay the provider. */
export async function completeVisit(supabase: SupabaseClient, profile: Profile, v: VisitRow, actor: "user" | "system" = "system") {
  const fmtDay = (d: Date) => fmtDayZ(d, profile.timezone);
  let captureId = `SIM-CAP-${v.id.slice(0, 8).toUpperCase()}`;
  let payoutId = `SIM-PAYOUT-${v.id.slice(0, 8).toUpperCase()}`;
  const mode = (v.payment_mode as "paypal_sandbox" | "simulated") ?? "simulated";
  const providerShare = Math.round(Number(v.price) * (1 - COMMISSION) * 100) / 100;

  if (mode === "paypal_sandbox" && v.paypal_authorization_id && paypal.paypalConfigured()) {
    try {
      captureId = await paypal.captureAuthorization(v.paypal_authorization_id);
      const receiver = v.providers?.paypal_email || process.env.PAYPAL_PAYOUT_RECEIVER;
      if (receiver) {
        payoutId = await paypal.payout({
          receiver,
          amount: providerShare,
          currency: profile.currency,
          note: `${v.services?.name}, ${fmtDay(new Date(v.scheduled_at))}`,
        });
      }
    } catch (e) {
      await log(supabase, profile.id, "system", "PayPal capture or payout failed", { visit: v.id, error: String(e) });
    }
  }

  await supabase.from("visits").update({ status: "completed" }).eq("id", v.id);
  await supabase.from("ledger_entries").insert([
    { client_id: profile.id, visit_id: v.id, provider_id: v.provider_id, kind: "capture", amount: v.price, paypal_ref: captureId, mode },
    { client_id: profile.id, visit_id: v.id, provider_id: v.provider_id, kind: "payout", amount: providerShare, paypal_ref: payoutId, mode },
  ]);
  await notify(
    supabase,
    profile.id,
    "payment",
    `${v.services?.name} done, ${profile.currency} ${Number(v.price).toFixed(2)} paid`,
    `${v.providers?.display_name} received ${profile.currency} ${providerShare.toFixed(2)} through PayPal.`,
    v.id,
  );
  await log(supabase, profile.id, actor, `Completed ${v.services?.name}; captured and paid ${v.providers?.display_name}`, {
    visit: v.id,
    mode,
  });
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
export async function advance(supabase: SupabaseClient, profile: Profile) {
  if (profile.role !== "client") return;
  const fmtDay = (d: Date) => fmtDayZ(d, profile.timezone);
  const fmtTime = (d: Date) => fmtTimeZ(d, profile.timezone);
  await ensureVisits(supabase, profile);
  const now = nowFor(profile);
  const windowEnd = new Date(now.getTime() + CHECK_WINDOW_HOURS * 3_600_000);

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
