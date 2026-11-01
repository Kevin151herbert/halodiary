// Service agreements: the terms both parties sign for a recurring service,
// the plain-language clauses they read, and the fee and credit rules the scheduler enforces.

import type { SupabaseClient } from "@supabase/supabase-js";

export type Terms = {
  cancellation_notice_hours: number; // client must cancel or move at least this long before a visit
  late_cancellation_fee_pct: number; // % of the visit price charged for a late skip or move
  free_reschedules_per_month: number; // late moves that are free each month
  provider_change_notice_hours: number; // provider must give this much notice to move or cancel
  provider_late_change_credit_pct: number; // % of the visit credited to the client for a late provider move
  provider_cancellation_credit_pct: number; // % credited when the provider cancels late
  price_lock_months: number; // price can't change for this many months
  termination_notice_days: number; // ending the service keeps visits inside this window
  reminder_hours: number; // both parties are asked to confirm or change this long before each visit
  dispute_window_hours: number; // time after a visit to raise a problem
};

export const DEFAULT_TERMS: Terms = {
  cancellation_notice_hours: 24,
  late_cancellation_fee_pct: 50,
  free_reschedules_per_month: 1,
  provider_change_notice_hours: 24,
  provider_late_change_credit_pct: 20,
  provider_cancellation_credit_pct: 100,
  price_lock_months: 3,
  termination_notice_days: 7,
  reminder_hours: 36,
  dispute_window_hours: 48,
};

/** Small per-service adjustments a provider would sensibly start from. */
export function defaultTermsFor(serviceId: string): Terms {
  const t = { ...DEFAULT_TERMS };
  if (serviceId === "tutoring" || serviceId === "lessons") Object.assign(t, { cancellation_notice_hours: 12, reminder_hours: 24 });
  if (serviceId === "dog-walking") Object.assign(t, { cancellation_notice_hours: 12, reminder_hours: 24, late_cancellation_fee_pct: 100, free_reschedules_per_month: 2 });
  if (serviceId === "car-servicing" || serviceId === "ac-servicing") Object.assign(t, { cancellation_notice_hours: 48, reminder_hours: 72, termination_notice_days: 0 });
  return t;
}

/** Choices a client can make when agreeing; anything outside these is rejected. */
export const TERM_OPTIONS = {
  cancellation_notice_hours: [12, 24, 48],
  late_cancellation_fee_pct: [0, 25, 50, 100],
  free_reschedules_per_month: [0, 1, 2, 4],
  termination_notice_days: [0, 7, 14, 30],
  price_lock_months: [1, 3, 6, 12],
  reminder_hours: [24, 36, 48, 72],
} as const;

/** The reminder must land before the free-change deadline, or it would only ever offer late changes. */
export function reminderFor(t: Pick<Terms, "cancellation_notice_hours" | "reminder_hours">) {
  return Math.max(t.reminder_hours, t.cancellation_notice_hours + 12);
}

export function sanitizeTerms(input: Partial<Terms> | undefined, base: Terms): Terms {
  const t = { ...base };
  if (!input) return t;
  for (const [k, allowed] of Object.entries(TERM_OPTIONS) as [keyof typeof TERM_OPTIONS, readonly number[]][]) {
    const v = Number(input[k]);
    if (allowed.includes(v)) (t[k] as number) = v;
  }
  t.reminder_hours = reminderFor(t);
  return t;
}

const money = (n: number, cur: string) => new Intl.NumberFormat("en-GB", { style: "currency", currency: cur }).format(n);

/** The agreement as both parties read it. */
export function clauses(t: Terms, ctx: { client: string; provider: string; service: string; price: number; currency: string; schedule: string }) {
  const fee = (t.late_cancellation_fee_pct / 100) * ctx.price;
  const credit = (t.provider_late_change_credit_pct / 100) * ctx.price;
  const cancelCredit = (t.provider_cancellation_credit_pct / 100) * ctx.price;
  return [
    {
      title: "The service",
      body: `${ctx.provider} provides ${ctx.service.toLowerCase()} for ${ctx.client}, ${ctx.schedule}, at ${money(ctx.price, ctx.currency)} a visit. Each visit is paid through PayPal inside ${ctx.client.split(" ")[0]}'s approved monthly budget: held when confirmed the day before, charged after it is done.`,
    },
    {
      title: "Cancelling or moving a visit (client)",
      body:
        t.late_cancellation_fee_pct === 0
          ? `${ctx.client.split(" ")[0]} can skip or move any visit at no charge. Please give at least ${t.cancellation_notice_hours} hours' notice.`
          : `Skipping or moving a visit with at least ${t.cancellation_notice_hours} hours' notice is free. Inside that window a late fee of ${t.late_cancellation_fee_pct}% (${money(fee, ctx.currency)}) is charged and paid to ${ctx.provider.replace(/\.$/, "")}. ${t.free_reschedules_per_month > 0 ? (t.free_reschedules_per_month === 1 ? "The first late move each month is free." : `The first ${t.free_reschedules_per_month} late moves each month are free.`) : "Late moves are charged like late skips."}`,
    },
    {
      title: "Changes by the provider",
      body: `${ctx.provider} gives at least ${t.provider_change_notice_hours} hours' notice to move a visit. A later move credits ${t.provider_late_change_credit_pct}% (${money(credit, ctx.currency)}) to ${ctx.client.split(" ")[0]}, taken off the next payment. A late cancellation or no-show credits ${t.provider_cancellation_credit_pct}% (${money(cancelCredit, ctx.currency)}).`,
    },
    {
      title: "Notifications",
      body: `HaloDiary asks both of you to confirm or change each visit ${reminderFor(t)} hours before it starts, ahead of the free-change deadline. Every change, by either party, notifies the other straight away and is recorded in the activity log. Changes count under this agreement only when made through HaloDiary. No reply by 2 hours before the visit means it goes ahead.`,
    },
    {
      title: "Price",
      body: `The price is fixed for ${t.price_lock_months} ${t.price_lock_months === 1 ? "month" : "months"} from signing. After that, a new price needs a new version of this agreement signed by both parties.`,
    },
    {
      title: "Problems with a visit",
      body: `Problems with a visit should be raised within ${t.dispute_window_hours} hours. Both parties can see the full visit and payment history, and PayPal buyer protection applies to every charge.`,
    },
    {
      title: "Ending the service",
      body:
        t.termination_notice_days === 0
          ? "Either party can end the service at any time. Visits not yet confirmed are cancelled at no charge."
          : `Either party can end the service with ${t.termination_notice_days} days' notice. Visits inside that notice period still go ahead and are paid as normal.`,
    },
    {
      title: "Changes to this agreement",
      body: "Any change to these terms creates a new version. It takes effect only when both parties have signed it; until then the current version applies.",
    },
  ];
}

export type Contract = {
  id: string;
  plan_id: string;
  client_id: string;
  provider_id: string;
  version: number;
  status: "pending" | "active" | "superseded" | "declined" | "terminated";
  terms: Terms;
  terms_hash: string;
  proposed_by: "client" | "provider";
  change_note: string;
  client_signed_at: string | null;
  provider_signed_at: string | null;
  created_at: string;
};

/** The agreement that currently governs a plan (the active one, else the newest pending). */
export async function governingContract(supabase: SupabaseClient, planId: string | null) {
  if (!planId) return null;
  const { data } = await supabase
    .from("contracts")
    .select("*")
    .eq("plan_id", planId)
    .in("status", ["active", "pending"])
    .order("version", { ascending: false });
  const rows = (data ?? []) as Contract[];
  return rows.find((c) => c.status === "active") ?? rows[0] ?? null;
}

/** A visit that was moved is a one-off; find the plan it came from by its provider and service. */
export async function planIdForVisit(
  supabase: SupabaseClient,
  v: { plan_id: string | null; client_id: string; provider_id: string; service_id: string },
) {
  if (v.plan_id) return v.plan_id;
  const { data } = await supabase
    .from("plans")
    .select("id")
    .eq("client_id", v.client_id)
    .eq("provider_id", v.provider_id)
    .eq("service_id", v.service_id)
    .order("created_at", { ascending: false })
    .limit(1);
  return data?.[0]?.id ?? null;
}

/** What a client change would cost right now under the agreement. */
export function clientChangeCost(t: Terms, opts: { price: number; hoursUntil: number; kind: "skip" | "reschedule"; lateMovesThisMonth: number }) {
  if (opts.hoursUntil >= t.cancellation_notice_hours) return { late: false, fee: 0, reason: "" };
  if (opts.kind === "reschedule" && opts.lateMovesThisMonth < t.free_reschedules_per_month)
    return { late: true, fee: 0, reason: `free late move (${opts.lateMovesThisMonth + 1} of ${t.free_reschedules_per_month} this month)` };
  const fee = Math.round(opts.price * t.late_cancellation_fee_pct) / 100;
  return { late: true, fee, reason: `less than ${t.cancellation_notice_hours}h notice, ${t.late_cancellation_fee_pct}% late fee` };
}

/** What a provider change would credit the client under the agreement. */
export function providerChangeCredit(t: Terms, opts: { price: number; hoursUntil: number; kind: "move" | "cancel" }) {
  if (opts.hoursUntil >= t.provider_change_notice_hours) return { late: false, credit: 0, reason: "" };
  const pct = opts.kind === "cancel" ? t.provider_cancellation_credit_pct : t.provider_late_change_credit_pct;
  return { late: true, credit: Math.round(opts.price * pct) / 100, reason: `less than ${t.provider_change_notice_hours}h notice, ${pct}% credit` };
}
