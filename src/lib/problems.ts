// Problems with a visit: reported in chat inside the agreement's window, summarised by AI,
// answered with a refund offer, and refunded through PayPal when the client accepts.

import { anthropic } from "@ai-sdk/anthropic";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateObject, generateText } from "ai";
import { z } from "zod";
import { getConversation, post, type Message } from "./chat";
import { governingContract, planIdForVisit } from "./contract";
import { log, nowFor } from "./engine";
import * as paypal from "./paypal";
import type { Profile } from "./supabase/server";
import { fmtShort } from "./time";

export const REASONS = {
  no_show: "Provider didn't show up",
  incomplete: "Job not finished",
  quality: "Poor quality",
  damage: "Something was damaged",
  late: "Very late",
  other: "Something else",
} as const;
export type Reason = keyof typeof REASONS;
const DEFAULT_PCT: Record<Reason, number> = { no_show: 100, incomplete: 50, quality: 30, damage: 50, late: 20, other: 20 };

const model = () => anthropic(process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5");
const money = (n: number, cur: string) => new Intl.NumberFormat("en-GB", { style: "currency", currency: cur }).format(n);

/** Completed visits with this provider that are still inside the agreement's problem window. */
export async function reportableVisits(supabase: SupabaseClient, profile: Profile, providerId: string) {
  const now = nowFor(profile);
  const { data } = await supabase
    .from("visits")
    .select("id, scheduled_at, price, plan_id, client_id, provider_id, service_id, services(name)")
    .eq("client_id", profile.id)
    .eq("provider_id", providerId)
    .eq("status", "completed")
    .gte("scheduled_at", new Date(now.getTime() - 7 * 86_400_000).toISOString())
    .order("scheduled_at", { ascending: false })
    .limit(6);
  const out: { id: string; label: string; price: number }[] = [];
  for (const v of data ?? []) {
    const c = await governingContract(supabase, await planIdForVisit(supabase, v));
    const windowH = Number(c?.terms?.dispute_window_hours ?? 48);
    if (now.getTime() - new Date(v.scheduled_at).getTime() <= windowH * 3_600_000)
      out.push({ id: v.id, label: `${(v.services as unknown as { name: string })?.name}, ${fmtShort(v.scheduled_at, profile.timezone)}`, price: Number(v.price) });
  }
  return out;
}

export async function reportProblem(
  supabase: SupabaseClient,
  profile: Profile,
  input: { conversationId: string; visitId: string; reason: Reason; details: string },
) {
  const conv = await getConversation(supabase, input.conversationId);
  if (!conv || conv.client_id !== profile.id) return { error: "Conversation not found" };
  if (!(input.reason in REASONS)) return { error: "Choose what went wrong." };
  const allowed = await reportableVisits(supabase, profile, conv.provider_id);
  const visit = allowed.find((v) => v.id === input.visitId);
  if (!visit) return { error: "That visit is outside the agreement's window for problems." };
  const { data: open } = await supabase.from("problems").select("id").eq("visit_id", visit.id).in("status", ["open", "offered"]).maybeSingle();
  if (open) return { error: "There's already an open problem for this visit." };

  const details = input.details.trim().slice(0, 1200);
  let summary = `${REASONS[input.reason]} on ${visit.label}. ${details}`.trim();
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const { text } = await generateText({
        abortSignal: AbortSignal.timeout(20_000),
        model: model(),
        instructions:
          "Summarise a client's complaint about a home-service visit for the provider, in two neutral, factual sentences. Say what went wrong and what the client wants, without blame or emotion. Never use em dashes.",
        prompt: `Visit: ${visit.label}, ${money(visit.price, profile.currency)}. Reason: ${REASONS[input.reason]}. Client's words: ${details || "(none)"}`,
      });
      summary = text.replace(/—/g, ",").trim();
    } catch {
      /* keep the plain summary */
    }
  }

  const { data: problem, error } = await supabase
    .from("problems")
    .insert({ visit_id: visit.id, client_id: profile.id, provider_id: conv.provider_id, conversation_id: conv.id, reason: input.reason, details, ai_summary: summary })
    .select("id")
    .single();
  if (error) return { error: error.message };
  const msg = await post(
    supabase,
    conv.id,
    { sender: "client", kind: "problem", body: summary, visit_id: visit.id, status: "open", meta: { problem_id: problem.id, reason: input.reason, details, price: visit.price } },
    `Problem reported: ${REASONS[input.reason]}`,
  );
  if (!conv.providers?.is_demo && conv.providers?.profile_id)
    await supabase.from("notifications").insert({ user_id: conv.providers.profile_id, kind: "chat", title: "A client reported a problem", body: summary.slice(0, 140) });
  await log(supabase, profile.id, "user", `Reported a problem with ${visit.label}: ${REASONS[input.reason]}`, { problem: problem.id });
  return { ok: true, problemId: problem.id, message: "message" in msg ? msg.message : null, demo: Boolean(conv.providers?.is_demo) };
}

/** Demo providers have no login: the AI answers for them and proposes a fair refund. */
export async function demoRespondToProblem(supabase: SupabaseClient, profile: Profile, problemId: string) {
  const { data: p } = await supabase.from("problems").select("*").eq("id", problemId).eq("client_id", profile.id).maybeSingle();
  if (!p || p.status !== "open" || !p.conversation_id) return { ok: true };
  const conv = await getConversation(supabase, p.conversation_id);
  if (!conv?.providers?.is_demo) return { ok: true };
  const { data: v } = await supabase.from("visits").select("price").eq("id", p.visit_id).single();
  const price = Number(v?.price ?? 0);
  let reply = `I'm sorry about that. I've offered a refund below; you can accept it straight to your PayPal.`;
  let pct = DEFAULT_PCT[p.reason as Reason] ?? 20;
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const { object } = await generateObject({
        abortSignal: AbortSignal.timeout(20_000),
        model: model(),
        schema: z.object({ reply: z.string(), refund_pct: z.number().min(0).max(100) }),
        instructions: `You are ${conv.providers.display_name}, a professional home-service provider replying in the HaloDiary chat to a complaint. Apologise briefly and concretely, say what you'll do differently, and propose a fair refund percentage of the visit price (no-show 100, unfinished 40 to 60, quality 20 to 40, minor lateness 10 to 20). Two sentences. Never use em dashes. Never suggest moving off HaloDiary.`,
        prompt: `Complaint: ${p.ai_summary}\nVisit price: ${money(price, profile.currency)}`,
      });
      reply = object.reply.replace(/—/g, ",");
      pct = Math.round(object.refund_pct);
    } catch {
      /* defaults */
    }
  }
  const amount = Math.max(1, Math.round(price * pct) / 100);
  const r1 = await post(supabase, conv.id, { sender: "provider", kind: "text", body: reply });
  const r2 = await post(
    supabase,
    conv.id,
    { sender: "provider", kind: "refund_offer", body: `${pct}% refund for ${REASONS[p.reason as Reason]?.toLowerCase() ?? "the problem"}`, amount, status: "open", visit_id: p.visit_id, meta: { problem_id: p.id, pct } },
    `Refund offered: ${money(amount, profile.currency)}`,
  );
  await supabase.from("problems").update({ status: "offered", refund_amount: amount }).eq("id", p.id);
  return { ok: true, messages: [r1, r2].map((r) => ("message" in r ? r.message : null)).filter(Boolean) as Message[] };
}

/** A real provider offers a refund from their own chat. */
export async function offerRefund(supabase: SupabaseClient, conversationId: string, amount: number, note: string) {
  const { data: p } = await supabase.from("problems").select("*").eq("conversation_id", conversationId).eq("status", "open").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!p) return { error: "There's no open problem in this conversation." };
  if (!(amount > 0 && amount <= 5000)) return { error: "Enter a valid amount." };
  const r = await post(
    supabase,
    conversationId,
    { sender: "provider", kind: "refund_offer", body: note.trim().slice(0, 140) || "Refund for the reported problem", amount: Math.round(amount * 100) / 100, status: "open", visit_id: p.visit_id, meta: { problem_id: p.id } },
    `Refund offered`,
  );
  if ("error" in r) return r;
  await supabase.from("problems").update({ status: "offered", refund_amount: amount }).eq("id", p.id);
  await supabase.from("notifications").insert({ user_id: p.client_id, kind: "payment", title: "Your provider offered a refund", body: "" });
  return { message: r.message };
}

/** The client accepts: refund the visit's PayPal charge (or record a labelled simulation). */
export async function acceptRefund(supabase: SupabaseClient, profile: Profile, messageId: string) {
  const { data: m } = await supabase.from("messages").select("*").eq("id", messageId).maybeSingle();
  const offer = m as Message | null;
  if (!offer || offer.kind !== "refund_offer" || !offer.amount) return { error: "Refund offer not found" };
  const conv = await getConversation(supabase, offer.conversation_id);
  if (!conv || conv.client_id !== profile.id) return { error: "Conversation not found" };
  const { data: claimed } = await supabase.from("messages").update({ status: "paid" }).eq("id", offer.id).eq("status", "open").select("id");
  if (!claimed?.length) return { error: "This offer was already accepted." };

  const amount = Number(offer.amount);
  const { data: capture } = await supabase
    .from("ledger_entries")
    .select("paypal_ref, mode, amount")
    .eq("visit_id", offer.visit_id)
    .eq("kind", "capture")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  let ref = `SIM-REFUND-${offer.id.slice(0, 8).toUpperCase()}`;
  let mode: "paypal_sandbox" | "simulated" = "simulated";
  if (capture?.mode === "paypal_sandbox" && capture.paypal_ref && paypal.paypalConfigured()) {
    try {
      ref = await paypal.refundCapture(capture.paypal_ref, Math.min(amount, Number(capture.amount)), profile.currency, `HaloDiary refund: ${offer.body}`);
      mode = "paypal_sandbox";
    } catch (e) {
      await log(supabase, profile.id, "system", "PayPal refund failed, recorded as simulated", { error: String(e) });
    }
  }
  await supabase.from("ledger_entries").insert({
    client_id: profile.id,
    visit_id: offer.visit_id,
    provider_id: conv.provider_id,
    kind: "refund",
    amount,
    paypal_ref: ref,
    mode,
    note: offer.body.slice(0, 140),
  });
  const problemId = (offer.meta as { problem_id?: string })?.problem_id;
  if (problemId) await supabase.from("problems").update({ status: "refunded", refund_ref: ref, resolved_at: new Date().toISOString() }).eq("id", problemId);
  await supabase.from("messages").update({ status: "done" }).eq("conversation_id", conv.id).eq("kind", "problem").eq("status", "open");
  await post(supabase, conv.id, {
    sender: "system",
    kind: "payment",
    body: `Refunded ${money(amount, profile.currency)} ${mode === "paypal_sandbox" ? "to your PayPal" : "(simulated PayPal)"}. The problem is resolved.`,
    amount,
    reply_to: offer.id,
    visit_id: offer.visit_id,
    meta: { paypal_ref: ref, mode },
  });
  await log(supabase, profile.id, "user", `Accepted a ${money(amount, profile.currency)} refund from ${conv.providers?.display_name}`, { mode });
  return { ok: true, ref };
}
