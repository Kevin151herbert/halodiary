// The assistant's tools. Read tools run straight away; anything that changes the diary or
// money waits for a one-tap approval in the chat (see APPROVAL below). They call the same
// code as the app's buttons, under the user's own session and row level security.

import type { SupabaseClient } from "@supabase/supabase-js";
import { tool } from "ai";
import { z } from "zod";
import * as core from "../actions-core";
import { CADENCE_KEYS, cadenceLabel } from "../cadence";
import { attendanceFor } from "../attendance";
import * as chat from "../chat";
import { sendMonthlyStatement } from "../paypal-agent";
import { TERM_OPTIONS } from "../contract";
import { forecastMonth, monthKey, nowFor, spentInMonth } from "../engine";
import type { Profile } from "../supabase/server";
import { fmtMoney, fmtShort, monthLabel } from "../time";
import { blockReason, guardPayment, type AgentOrigin } from "../agent-guard";

const cadenceEnum = z.enum(CADENCE_KEYS as [string, ...string[]]);
const localTime = z
  .string()
  .describe("Wall-clock time in the user's time zone, formatted YYYY-MM-DDTHH:mm, e.g. 2026-11-05T16:30. No time zone suffix.");

export function buildTools(supabase: SupabaseClient, profile: Profile, origin: AgentOrigin = { via: "assistant" }) {
  const cur = profile.currency;
  const tz = profile.timezone;

  const readTools = {
    list_services: tool({
      description: "List every service in the HaloDiary catalogue with its id, typical price and usual cadence.",
      inputSchema: z.object({}),
      execute: async () => {
        const { data } = await supabase.from("services").select("id, name, category, default_cadence, typical_price").order("sort_order");
        return (data ?? []).map((s) => ({ ...s, usual: cadenceLabel(s.default_cadence) }));
      },
    }),

    search_providers: tool({
      description:
        "Find service providers near the user, nearest first. Use the service id from list_services (e.g. 'cleaning', 'dog-walking'). Returns up to 5 options with provider_id, price, rating and distance.",
      inputSchema: z.object({
        service: z.string().describe("Service id, e.g. 'tutoring'"),
        max_price: z.number().optional().describe(`Highest price per visit in ${cur}`),
        min_rating: z.number().min(1).max(5).optional(),
        sort: z.enum(["distance", "rating", "price"]).optional(),
        radius_km: z.number().min(1).max(50).optional(),
      }),
      execute: async ({ service, max_price, min_rating, sort, radius_km }) => {
        const { error, results } = await core.searchProviders(supabase, profile, {
          service,
          maxPrice: max_price ?? null,
          minRating: min_rating ?? null,
          radiusKm: radius_km ?? 12,
        });
        if (error) return { error };
        const sorted = [...results].sort((a, b) =>
          sort === "rating" ? Number(b.rating) - Number(a.rating) : sort === "price" ? Number(a.price) - Number(b.price) : a.distance_km - b.distance_km,
        );
        return sorted.slice(0, 5).map((r) => ({
          provider_id: r.provider_id,
          name: r.display_name,
          service_id: r.service_id,
          headline: r.headline,
          price: fmtMoney(Number(r.price), cur),
          rating: Number(r.rating),
          reviews: r.review_count,
          distance_km: r.distance_km,
          replies_within_hours: r.responds_within_hours,
        }));
      },
    }),

    get_diary: tool({
      description: "The user's upcoming visits with ids, times, status and price.",
      inputSchema: z.object({ days: z.number().min(1).max(30).optional() }),
      execute: async ({ days }) => {
        const visits = await core.upcomingVisits(supabase, profile, days ?? 14);
        return visits.map((v) => ({
          visit_id: v.id,
          when: fmtShort(v.scheduled_at, tz),
          service: v.services?.name,
          provider: v.providers?.display_name,
          price: fmtMoney(Number(v.price), cur),
          status: v.status,
          needs_client_answer: v.status === "awaiting" && !v.client_response,
        }));
      },
    }),

    get_budget: tool({
      description: "Forecast, approved cap and money used for this month or next month, with a per-service breakdown.",
      inputSchema: z.object({ month: z.enum(["this", "next"]) }),
      execute: async ({ month }) => {
        const key = monthKey(nowFor(profile), tz, month === "next" ? 1 : 0);
        const f = await forecastMonth(supabase, profile, key);
        const { data: b } = await supabase.from("budgets").select("*").eq("client_id", profile.id).eq("month", key).maybeSingle();
        const used = await spentInMonth(supabase, profile, key);
        return {
          month: monthLabel(key),
          lines: f.lines.map((l) => ({ service: l.service, provider: l.provider, visits: l.visits, each: l.price, total: l.total })),
          forecast_total: f.total,
          suggested_cap: f.cap,
          approved: b?.status === "approved",
          approved_cap: b ? Number(b.cap) : null,
          used,
          currency: cur,
        };
      },
    }),

    get_provider_attendance: tool({
      description:
        "A provider's attendance record: the share of booked visits they turned up for, offered an alternative time for, or cancelled, with cancellation reasons. Use when the user asks how reliable a provider is.",
      inputSchema: z.object({ provider_id: z.string() }),
      execute: async ({ provider_id }) => {
        const a = await attendanceFor(supabase, provider_id, nowFor(profile).toISOString());
        return {
          booked_visits: a.total,
          turned_up_pct: a.total ? Math.round((a.rendered / a.total) * 100) : null,
          alternative_pct: a.total ? Math.round((a.alternative / a.total) * 100) : null,
          cancelled_pct: a.total ? Math.round((a.cancelled / a.total) * 100) : null,
          recent_cancellations: a.items.filter((i) => i.outcome === "cancelled").slice(0, 5).map((i) => ({ when: fmtShort(i.at, tz), reason: i.note })),
        };
      },
    }),

    get_payments: tool({
      description: "Recent payment events: holds, charges, releases and provider payouts, with PayPal references.",
      inputSchema: z.object({ limit: z.number().min(1).max(50).optional() }),
      execute: async ({ limit }) => {
        const { data } = await supabase
          .from("ledger_entries")
          .select("kind, amount, paypal_ref, mode, created_at, providers(display_name), visits(services(name))")
          .eq("client_id", profile.id)
          .order("created_at", { ascending: false })
          .limit(limit ?? 15);
        return (data ?? []).map((e) => ({
          when: fmtShort(e.created_at, tz),
          kind: e.kind,
          amount: fmtMoney(Number(e.amount), cur),
          provider: (e.providers as unknown as { display_name: string })?.display_name,
          service: (e.visits as unknown as { services: { name: string } })?.services?.name,
          paypal_ref: e.paypal_ref,
          mode: e.mode,
        }));
      },
    }),
  };

  const clientActions = {
    add_recurring_service: tool({
      description:
        "Add a recurring service to the diary with a specific provider. Needs the user's approval. Weekdays use 0=Sunday..6=Saturday and apply to weekly-style cadences.",
      inputSchema: z.object({
        provider_id: z.string(),
        provider_name: z.string().describe("For the approval card: copy the name exactly, character for character, as search_providers returned it"),
        service_id: z.string(),
        service_name: z.string().describe("For the approval card"),
        cadence: cadenceEnum,
        weekdays: z.array(z.number().int().min(0).max(6)).optional(),
        time: z.string().regex(/^\d{2}:\d{2}$/).optional().describe("HH:mm local time, default 10:00"),
        price_per_visit: z.string().describe(`Price shown to the user, e.g. '${fmtMoney(35, cur)}'`),
      }),
      execute: async (i) => {
        const res = await core.createPlan(
          supabase,
          profile,
          { providerId: i.provider_id, serviceId: i.service_id, cadence: i.cadence, weekdays: i.weekdays, time: i.time },
          "assistant",
        );
        return "error" in res && res.error ? { error: res.error } : { ok: true, added: res.summary, agreement: res.agreement };
      },
    }),

    answer_visit: tool({
      description:
        "Answer a visit as the client: proceed, skip, or reschedule to a new time. Skipping or moving inside the agreement's free-change window can cost a late fee (see SERVICE AGREEMENTS in context and the visit's hours to start); if so, say the fee in the summary. Needs the user's approval.",
      inputSchema: z.object({
        visit_id: z.string(),
        summary: z.string().describe("Plain description for the approval card, e.g. 'Move Thursday cleaning to Friday 10:00'"),
        action: z.enum(["proceed", "skip", "reschedule"]),
        new_time: localTime.optional(),
      }),
      execute: async ({ visit_id, action, new_time }) =>
        core.clientRespond(supabase, profile, { visitId: visit_id, action, newTime: new_time }, "assistant"),
    }),

    change_service_status: tool({
      description: "Pause, resume or end a recurring service (plan). Needs the user's approval.",
      inputSchema: z.object({
        plan_id: z.string(),
        summary: z.string().describe("For the approval card, e.g. 'Pause pool cleaning'"),
        status: z.enum(["active", "paused", "ended"]),
      }),
      execute: async ({ plan_id, status }) => core.setPlanStatus(supabase, profile, plan_id, status, "assistant"),
    }),

    propose_agreement_change: tool({
      description:
        "Propose new terms for a service agreement. The client signs by approving; demo providers sign straight away, real providers must sign before it takes effect. Only include the terms that change. Needs the user's approval.",
      inputSchema: z.object({
        plan_id: z.string(),
        summary: z.string().describe("For the approval card, e.g. 'Cleaning agreement: free changes up to 48h, late fee 25%'"),
        cancellation_notice_hours: z.union(TERM_OPTIONS.cancellation_notice_hours.map((n) => z.literal(n)) as never).optional(),
        late_cancellation_fee_pct: z.union(TERM_OPTIONS.late_cancellation_fee_pct.map((n) => z.literal(n)) as never).optional(),
        free_reschedules_per_month: z.union(TERM_OPTIONS.free_reschedules_per_month.map((n) => z.literal(n)) as never).optional(),
        termination_notice_days: z.union(TERM_OPTIONS.termination_notice_days.map((n) => z.literal(n)) as never).optional(),
        reminder_hours: z.union(TERM_OPTIONS.reminder_hours.map((n) => z.literal(n)) as never).optional(),
        price_lock_months: z.union(TERM_OPTIONS.price_lock_months.map((n) => z.literal(n)) as never).optional(),
        note: z.string().optional(),
      }),
      execute: async ({ plan_id, note, ...rest }) => {
        const { summary, ...terms } = rest;
        void summary;
        return core.proposeAmendment(supabase, profile, { planId: plan_id, terms, note }, "assistant");
      },
    }),

    message_provider: tool({
      description:
        "Send a message to a provider in the in-app chat (questions, extra service requests, notes for the next visit). Use kind 'extra_request' when asking for extra work so the provider can quote; the client then pays with the button in the chat. Needs the user's approval.",
      inputSchema: z.object({
        provider_id: z.string(),
        provider_name: z.string().describe("Copy exactly as given"),
        message: z.string().describe("The message, written as the client, in first person"),
        kind: z.enum(["text", "extra_request"]),
        summary: z.string().describe("For the approval card, e.g. 'Ask Lucía K. to also clean the oven on Friday'"),
      }),
      execute: async ({ provider_id, message, kind }) => {
        const convId = await chat.conversationWith(supabase, profile.id, provider_id);
        const sent = await chat.clientSend(supabase, profile, convId, { body: message, kind });
        if ("error" in sent) return { error: sent.error };
        const reply = "demo" in sent && sent.demo ? await chat.demoReply(supabase, profile, convId) : null;
        return {
          ok: true,
          chat_url: `/app/messages/${convId}`,
          provider_reply: reply && "reply" in reply ? reply.reply?.body : "The provider will reply in the chat.",
          quote: reply && "request" in reply && reply.request ? { for: reply.request.body, amount: Number(reply.request.amount) } : null,
        };
      },
    }),

    send_paypal_statement: tool({
      description:
        "Email the user an official PayPal statement for a month: a PayPal invoice listing every visit, fee, extra and refund HaloDiary charged, already marked paid (nothing more to pay). Uses the PayPal Agent Toolkit. Needs the user's approval.",
      inputSchema: z.object({ month: z.enum(["this", "last"]), summary: z.string() }),
      execute: async ({ month }) => {
        try {
          const key = monthKey(nowFor(profile), tz, month === "last" ? -1 : 0);
          return await sendMonthlyStatement(supabase, profile, key);
        } catch (e) {
          return { error: e instanceof Error ? e.message : "PayPal couldn't create the statement" };
        }
      },
    }),

    sign_agreement: tool({
      description: "Sign a pending agreement version that is waiting for this user's signature (for example new terms a provider proposed). Needs the user's approval.",
      inputSchema: z.object({ contract_id: z.string(), summary: z.string() }),
      execute: async ({ contract_id }) => core.signAgreement(supabase, profile, contract_id, "assistant"),
    }),

    approve_budget: tool({
      description:
        "Approve a monthly budget cap without PayPal (simulated). Only use when the PayPal sandbox is not configured; otherwise tell the user to approve with PayPal on the Budget page, because money approvals must go through PayPal. Needs the user's approval.",
      inputSchema: z.object({ month: z.enum(["this", "next"]), cap: z.number().positive(), summary: z.string() }),
      execute: async ({ month, cap }) => {
        const key = monthKey(nowFor(profile), tz, month === "next" ? 1 : 0);
        return core.approveBudget(supabase, profile, { month: key, cap, mode: "simulated" }, "assistant");
      },
    }),

    update_assistant_settings: tool({
      description: "Turn proactive suggestions or auto-answering of routine day-before checks on or off. Needs the user's approval.",
      inputSchema: z.object({ proactive: z.boolean().optional(), auto_checks: z.boolean().optional(), summary: z.string() }),
      execute: async ({ proactive, auto_checks }) => {
        const patch: Record<string, boolean> = {};
        if (proactive != null) patch.proactive_enabled = proactive;
        if (auto_checks != null) patch.auto_checks_enabled = auto_checks;
        await supabase.from("profiles").update(patch).eq("id", profile.id);
        return { ok: true, ...patch };
      },
    }),
  };

  // Providers (and clients answering for their demo providers in the provider view).
  const providerActions = {
    answer_as_provider: tool({
      description:
        "Answer a visit as the provider: confirm it, propose a new time to the client, mark it done so payment is released, or cancel it with a reason the client will see (late changes credit the client under the agreement). Needs the user's approval.",
      inputSchema: z.object({
        visit_id: z.string(),
        summary: z.string(),
        action: z.enum(["proceed", "propose", "complete", "cancel"]),
        new_time: localTime.optional(),
        reason: z.string().optional().describe("Required to cancel"),
      }),
      execute: async ({ visit_id, action, new_time, reason }) =>
        core.providerRespond(supabase, profile, { visitId: visit_id, action, newTime: new_time, reason }, "assistant"),
    }),
  };

  // Every action that changes the diary or money is priced against the user's AI spending limit first.
  const guarded = <T extends Record<string, unknown>>(set: T): T => {
    for (const [name, t] of Object.entries(set)) {
      const orig = (t as { execute: (i: Record<string, unknown>, o: unknown) => Promise<unknown> }).execute;
      (t as { execute: unknown }).execute = async (input: Record<string, unknown>, opts: unknown) => {
        const reason = String(input.reason ?? input.summary ?? "");
        const blocked = await guardPayment(supabase, profile, origin, name, input, reason);
        if (blocked) return blocked;
        return orig(input, opts);
      };
    }
    return set;
  };
  guarded(clientActions);
  guarded(providerActions);

  /** Whether an acting tool may even be offered for approval: a call that would be refused runs straight to its refusal. */
  const precheck = async (name: string, input: Record<string, unknown>) => Boolean(await blockReason(supabase, profile, origin, name, input));

  if (profile.role === "provider") {
    // A provider's own visits are in the context snapshot; client data stays out of reach.
    return {
      tools: { list_services: readTools.list_services, ...providerActions, sign_agreement: clientActions.sign_agreement },
      approval: ["answer_as_provider", "sign_agreement"],
      precheck,
    };
  }
  return {
    tools: { ...readTools, ...clientActions, ...providerActions },
    approval: [...Object.keys(clientActions), ...Object.keys(providerActions)],
    precheck,
  };
}

export const PAYPAL_NOTE = (configured: boolean, hasToken: boolean) =>
  configured
    ? hasToken
      ? "PayPal sandbox is connected and the user has saved their PayPal account; holds and charges go through PayPal."
      : "PayPal sandbox is configured but the user hasn't approved a budget with PayPal yet; send them to the Budget page's 'Approve with PayPal' button."
    : "PayPal sandbox keys are not set on this deployment, so payments are simulated and clearly labelled as such.";

export const fmtNow = (profile: Profile) => fmtShort(nowFor(profile), profile.timezone);
