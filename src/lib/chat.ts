// Client and provider chat. Extra requests, extra payments and ratings live in the thread,
// so arrangements stay on the record next to the agreement instead of in WhatsApp.
// Demo providers have no login; HaloDiary's AI answers for them in character.

import { anthropic } from "@ai-sdk/anthropic";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateObject } from "ai";
import { z } from "zod";
import { COMMISSION, log, nowFor } from "./engine";
import * as paypal from "./paypal";
import type { Profile } from "./supabase/server";
import { fmtShort } from "./time";

export type Message = {
  id: string;
  conversation_id: string;
  sender: "client" | "provider" | "system";
  kind: "text" | "extra_request" | "payment_request" | "payment" | "rating_request" | "rating" | "problem" | "refund_offer";
  body: string;
  amount: number | null;
  status: "open" | "accepted" | "declined" | "paid" | "cancelled" | "done" | null;
  visit_id: string | null;
  reply_to: string | null;
  meta: Record<string, unknown>;
  created_at: string;
};

export type Conversation = {
  id: string;
  client_id: string;
  provider_id: string;
  last_message_at: string;
  last_message: string;
  client_read_at: string;
  provider_read_at: string;
  providers?: { display_name: string; avatar_hue: number; is_demo: boolean; profile_id: string | null; headline: string } | null;
};

export const CONVERSATION_SELECT = "*, providers(display_name, avatar_hue, is_demo, profile_id, headline)";

const money = (n: number, cur: string) => new Intl.NumberFormat("en-GB", { style: "currency", currency: cur }).format(n);

/** The one thread between this client and a provider, created on first use. */
export async function conversationWith(supabase: SupabaseClient, clientId: string, providerId: string) {
  const { data: found } = await supabase.from("conversations").select("id").eq("client_id", clientId).eq("provider_id", providerId).maybeSingle();
  if (found) return found.id as string;
  const { data, error } = await supabase
    .from("conversations")
    .upsert({ client_id: clientId, provider_id: providerId }, { onConflict: "client_id,provider_id" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function getConversation(supabase: SupabaseClient, id: string) {
  const { data } = await supabase.from("conversations").select(CONVERSATION_SELECT).eq("id", id).maybeSingle();
  return data as Conversation | null;
}

export async function listMessages(supabase: SupabaseClient, conversationId: string) {
  const { data } = await supabase.from("messages").select("*").eq("conversation_id", conversationId).order("created_at").limit(300);
  return (data ?? []) as Message[];
}

/** Insert a message and keep the thread's preview and the sender's read marker current. */
export async function post(
  supabase: SupabaseClient,
  conversationId: string,
  m: Partial<Message> & Pick<Message, "sender" | "kind">,
  preview?: string,
) {
  const { data, error } = await supabase
    .from("messages")
    .insert({ conversation_id: conversationId, ...m })
    .select("*")
    .single();
  if (error) return { error: error.message };
  const at = new Date().toISOString();
  const patch: Record<string, string> = { last_message_at: at, last_message: (preview ?? m.body ?? "").slice(0, 140) };
  if (m.sender === "client" || m.kind === "payment") patch.client_read_at = at;
  if (m.sender === "provider") patch.provider_read_at = at;
  await supabase.from("conversations").update(patch).eq("id", conversationId);
  return { message: data as Message };
}

export async function markRead(supabase: SupabaseClient, conversationId: string, as: "client" | "provider") {
  await supabase
    .from("conversations")
    .update(as === "client" ? { client_read_at: new Date().toISOString() } : { provider_read_at: new Date().toISOString() })
    .eq("id", conversationId);
}

export async function unreadCount(supabase: SupabaseClient, profile: Profile) {
  if (profile.role === "client") {
    const { data } = await supabase.from("conversations").select("last_message_at, client_read_at").eq("client_id", profile.id);
    return (data ?? []).filter((c) => c.last_message_at > c.client_read_at).length;
  }
  const { data: me } = await supabase.from("providers").select("id").eq("profile_id", profile.id).maybeSingle();
  if (!me) return 0;
  const { data } = await supabase.from("conversations").select("last_message_at, provider_read_at").eq("provider_id", me.id);
  return (data ?? []).filter((c) => c.last_message_at > c.provider_read_at).length;
}

/** Let a real provider know there is something waiting in the thread. */
async function pingProvider(supabase: SupabaseClient, conv: Conversation, title: string) {
  const to = conv.providers?.is_demo ? null : conv.providers?.profile_id;
  if (!to) return;
  await supabase.from("notifications").insert({ user_id: to, kind: "chat", title, body: "" });
}

// ---------- Client side ----------

export async function clientSend(
  supabase: SupabaseClient,
  profile: Profile,
  conversationId: string,
  input: { body: string; kind: "text" | "extra_request"; visitId?: string | null },
) {
  const body = input.body.trim().slice(0, 2000);
  if (!body) return { error: "Write a message first." };
  const conv = await getConversation(supabase, conversationId);
  if (!conv || conv.client_id !== profile.id) return { error: "Conversation not found" };
  const res = await post(
    supabase,
    conversationId,
    { sender: "client", kind: input.kind, body, visit_id: input.visitId ?? null, status: input.kind === "extra_request" ? "open" : null },
    input.kind === "extra_request" ? `Extra request: ${body}` : body,
  );
  if ("error" in res) return res;
  await pingProvider(supabase, conv, input.kind === "extra_request" ? `${profile.full_name || "A client"} asked for something extra` : `New message from ${profile.full_name || "a client"}`);
  if (input.kind === "extra_request") await log(supabase, profile.id, "user", `Asked ${conv.providers?.display_name} for an extra: ${body.slice(0, 80)}`, { conversation: conversationId });
  return { message: res.message, demo: Boolean(conv.providers?.is_demo) };
}

/** Charge an extra through PayPal (or a labelled simulation) and pay the provider their share. */
async function chargeExtra(supabase: SupabaseClient, profile: Profile, conv: Conversation, amount: number, description: string, visitId: string | null) {
  const cur = profile.currency;
  const share = Math.round(amount * (1 - COMMISSION) * 100) / 100;
  let mode: "paypal_sandbox" | "simulated" = "simulated";
  let ref = `SIM-EXTRA-${Date.now().toString(36).toUpperCase()}`;
  let payoutRef = `SIM-PAYOUT-${ref.slice(10)}`;
  if (paypal.paypalConfigured() && profile.paypal_payment_token) {
    try {
      const auth = await paypal.authorizeWithVault({
        paymentToken: profile.paypal_payment_token,
        amount,
        currency: cur,
        description: `Extra: ${description} (${conv.providers?.display_name})`,
        visitId: `extra-${Date.now()}`,
      });
      ref = await paypal.captureAuthorization(auth.authorizationId);
      mode = "paypal_sandbox";
      const { data: prov } = await supabase.from("providers").select("paypal_email").eq("id", conv.provider_id).maybeSingle();
      const receiver = prov?.paypal_email || process.env.PAYPAL_PAYOUT_RECEIVER;
      if (receiver) payoutRef = await paypal.payout({ receiver, amount: share, currency: cur, note: `HaloDiary extra: ${description}`.slice(0, 120) });
    } catch (e) {
      await log(supabase, profile.id, "system", "PayPal extra payment failed, recorded as simulated", { error: String(e) });
    }
  }
  await supabase.from("ledger_entries").insert([
    { client_id: profile.id, visit_id: visitId, provider_id: conv.provider_id, kind: "extra", amount, paypal_ref: ref, mode, note: description.slice(0, 140) },
    { client_id: profile.id, visit_id: visitId, provider_id: conv.provider_id, kind: "payout", amount: share, paypal_ref: payoutRef, mode, note: "Extra paid in chat" },
  ]);
  return { ref, mode, share };
}

/** Pay a payment request the provider sent in the chat. */
export async function payRequest(supabase: SupabaseClient, profile: Profile, messageId: string) {
  const { data: m } = await supabase.from("messages").select("*").eq("id", messageId).maybeSingle();
  const req = m as Message | null;
  if (!req || req.kind !== "payment_request" || !req.amount) return { error: "Payment request not found" };
  if (req.status !== "open") return { error: "This request is no longer open." };
  const conv = await getConversation(supabase, req.conversation_id);
  if (!conv || conv.client_id !== profile.id) return { error: "Conversation not found" };
  // Claim the request first so a double tap can't charge twice.
  const { data: claimed } = await supabase.from("messages").update({ status: "paid" }).eq("id", req.id).eq("status", "open").select("id");
  if (!claimed?.length) return { error: "This request was already paid." };
  const amount = Number(req.amount);
  const r = await chargeExtra(supabase, profile, conv, amount, req.body, req.visit_id);
  await supabase.from("messages").update({ meta: { ...req.meta, paypal_ref: r.ref, mode: r.mode } }).eq("id", req.id);
  const receipt = `Paid ${money(amount, profile.currency)} for "${req.body}" ${r.mode === "paypal_sandbox" ? "with PayPal" : "(simulated PayPal)"}. ${conv.providers?.display_name} receives ${money(r.share, profile.currency)}.`;
  await post(supabase, conv.id, { sender: "system", kind: "payment", body: receipt, amount, reply_to: req.id, visit_id: req.visit_id, meta: { paypal_ref: r.ref, mode: r.mode } });
  await pingProvider(supabase, conv, `${profile.full_name || "Your client"} paid ${money(amount, profile.currency)}`);
  await log(supabase, profile.id, "user", `Paid ${conv.providers?.display_name} ${money(amount, profile.currency)} in chat for ${req.body}`, { message: req.id, mode: r.mode });
  return { ok: true, ref: r.ref };
}

/** The client sends money without a request: a tip or an extra agreed in conversation. */
export async function sendPayment(supabase: SupabaseClient, profile: Profile, conversationId: string, amount: number, note: string) {
  if (!(amount > 0 && amount <= 500)) return { error: "Enter an amount between 1 and 500." };
  const conv = await getConversation(supabase, conversationId);
  if (!conv || conv.client_id !== profile.id) return { error: "Conversation not found" };
  const what = note.trim().slice(0, 140) || "Extra payment";
  const r = await chargeExtra(supabase, profile, conv, Math.round(amount * 100) / 100, what, null);
  const receipt = `Paid ${money(amount, profile.currency)} for "${what}" ${r.mode === "paypal_sandbox" ? "with PayPal" : "(simulated PayPal)"}. ${conv.providers?.display_name} receives ${money(r.share, profile.currency)}.`;
  await post(supabase, conv.id, { sender: "system", kind: "payment", body: receipt, amount, meta: { paypal_ref: r.ref, mode: r.mode } });
  await pingProvider(supabase, conv, `${profile.full_name || "Your client"} sent you ${money(amount, profile.currency)}`);
  await log(supabase, profile.id, "user", `Sent ${conv.providers?.display_name} ${money(amount, profile.currency)} in chat`, { mode: r.mode });
  return { ok: true, ref: r.ref };
}

/** Ask for a rating in the thread once a visit is done. Called by the scheduler. */
export async function requestRating(supabase: SupabaseClient, v: { id: string; client_id: string; provider_id: string; scheduled_at: string; services?: { name: string } | null }, tz: string) {
  const convId = await conversationWith(supabase, v.client_id, v.provider_id);
  const { count } = await supabase.from("messages").select("id", { count: "exact", head: true }).eq("visit_id", v.id).eq("kind", "rating_request");
  if (count) return;
  // Only the latest visit waits for a rating; older unanswered requests are retired.
  await supabase.from("messages").update({ status: "cancelled" }).eq("conversation_id", convId).eq("kind", "rating_request").eq("status", "open");
  await post(supabase, convId, {
    sender: "system",
    kind: "rating_request",
    body: `How was ${v.services?.name?.toLowerCase() ?? "the visit"} on ${fmtShort(v.scheduled_at, tz)}?`,
    visit_id: v.id,
    status: "open",
  });
}

export async function rateVisit(supabase: SupabaseClient, profile: Profile, messageId: string, rating: number, comment: string) {
  const { data: m } = await supabase.from("messages").select("*").eq("id", messageId).maybeSingle();
  const req = m as Message | null;
  if (!req || req.kind !== "rating_request" || !req.visit_id) return { error: "Rating request not found" };
  if (req.status !== "open") return { error: "This visit is already rated." };
  const { error } = await supabase.rpc("rate_visit", { p_visit: req.visit_id, p_rating: Math.round(rating), p_body: comment });
  if (error) return { error: error.message };
  await supabase.from("messages").update({ status: "done", meta: { rating: Math.round(rating) } }).eq("id", req.id);
  await post(
    supabase,
    req.conversation_id,
    { sender: "client", kind: "rating", body: comment.trim().slice(0, 600), amount: null, reply_to: req.id, visit_id: req.visit_id, meta: { rating: Math.round(rating) } },
    `Rated ${Math.round(rating)} stars`,
  );
  await log(supabase, profile.id, "user", `Rated a visit ${Math.round(rating)} stars`, { visit: req.visit_id });
  return { ok: true };
}

// ---------- Provider side ----------

export async function providerSend(
  supabase: SupabaseClient,
  profile: Profile,
  conversationId: string,
  input: { body: string; amount?: number | null; replyTo?: string | null },
) {
  const conv = await getConversation(supabase, conversationId);
  if (!conv) return { error: "Conversation not found" };
  const body = input.body.trim().slice(0, 2000);
  if (!body) return { error: "Write a message first." };
  if (input.amount != null && !(input.amount > 0 && input.amount <= 5000)) return { error: "Enter a valid amount." };
  const isRequest = input.amount != null;
  const res = await post(
    supabase,
    conversationId,
    { sender: "provider", kind: isRequest ? "payment_request" : "text", body, amount: input.amount ?? null, status: isRequest ? "open" : null, reply_to: input.replyTo ?? null },
    isRequest ? `Payment request: ${body}` : body,
  );
  if ("error" in res) return res;
  if (input.replyTo) await supabase.from("messages").update({ status: "accepted" }).eq("id", input.replyTo).eq("kind", "extra_request");
  await supabase.from("notifications").insert({
    user_id: conv.client_id,
    kind: "chat",
    title: isRequest ? `${conv.providers?.display_name} sent a payment request` : `New message from ${conv.providers?.display_name}`,
    body: body.slice(0, 120),
  });
  return { message: res.message };
}

// ---------- Demo providers answer through the AI ----------

const replySchema = z.object({
  reply: z.string().describe("The provider's chat reply, 1 to 3 short sentences"),
  quote: z
    .object({
      description: z.string().describe("Short name of the extra work, e.g. 'Oven deep clean'"),
      amount: z.number().positive().describe("Price for the extra in the client's currency"),
    })
    .nullable()
    .describe("Only when the client asked for extra work beyond the booked service, or asked what something extra costs"),
});

export async function demoReply(supabase: SupabaseClient, profile: Profile, conversationId: string) {
  const conv = await getConversation(supabase, conversationId);
  if (!conv || conv.client_id !== profile.id || !conv.providers?.is_demo) return { error: "Not a demo conversation" };
  const history = await listMessages(supabase, conversationId);
  const last = history.at(-1);
  if (!last || last.sender !== "client" || !["text", "extra_request"].includes(last.kind)) return { ok: true };

  const name = conv.providers.display_name;
  const first = name.split(" ")[0];
  const cur = profile.currency;
  const [{ data: offers }, { data: visits }] = await Promise.all([
    supabase.from("provider_services").select("price, services(name)").eq("provider_id", conv.provider_id),
    supabase
      .from("visits")
      .select("id, scheduled_at, status, services(name)")
      .eq("client_id", profile.id)
      .eq("provider_id", conv.provider_id)
      .gte("scheduled_at", nowFor(profile).toISOString())
      .not("status", "in", "(cancelled,skipped)")
      .order("scheduled_at")
      .limit(4),
  ]);
  const basePrice = Number(offers?.[0]?.price ?? 30);
  const nextVisit = visits?.[0];

  let reply: z.infer<typeof replySchema>;
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const { object } = await generateObject({
        model: anthropic(process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5"),
        schema: replySchema,
        instructions: `You are ${name}, a home-services provider on HaloDiary (${conv.providers.headline}). You are chatting with your client ${profile.full_name || "your client"} inside the HaloDiary app.
Your services and prices: ${(offers ?? []).map((o) => `${(o.services as unknown as { name: string })?.name} ${money(Number(o.price), cur)} a visit`).join("; ")}.
Their upcoming visits with you: ${(visits ?? []).map((v) => `${(v.services as unknown as { name: string })?.name} on ${fmtShort(v.scheduled_at, profile.timezone)} (${v.status})`).join("; ") || "none"}.
Rules:
- Warm, professional and brief, like a trusted local provider texting. Never use em dashes.
- If they ask for extra work beyond the booked service (an oven clean, extra hour, ironing, a bath for the dog, extra revision session...), agree when it is reasonable and give a fair quote as "quote": typically 20% to 80% of a visit price, rounded to a whole ${cur}. Say they can pay with the button in this chat.
- If they ask to move, skip or cancel a visit, tell them to use Move or Skip on the visit in their Diary so the agreement terms apply. Do not invent policies.
- Never suggest WhatsApp, phone or paying outside HaloDiary. Everything stays in this chat.
- Do not claim to have done anything you can't do; you only reply.`,
        messages: dropLeadingAssistant(history.slice(-14).map((m) => ({
          role: m.sender === "client" ? ("user" as const) : ("assistant" as const),
          content:
            m.kind === "extra_request"
              ? `[Extra request${m.visit_id ? " for a visit" : ""}] ${m.body}`
              : m.kind === "payment_request"
                ? `[I sent a payment request: ${m.body}, ${money(Number(m.amount), cur)}, status ${m.status}]`
                : m.kind === "payment"
                  ? `[Receipt] ${m.body}`
                  : m.kind === "rating"
                    ? `[They rated a visit ${String(m.meta?.rating)} stars] ${m.body}`
                    : m.kind === "rating_request"
                      ? `[HaloDiary asked them to rate a visit]`
                      : m.body,
        }))),
      });
      reply = object;
    } catch {
      reply = fallback();
    }
  } else {
    reply = fallback();
  }

  function fallback(): z.infer<typeof replySchema> {
    if (last!.kind === "extra_request")
      return {
        reply: `Happy to do that${nextVisit ? " on the next visit" : ""}. Here is the price; you can pay with the button below.`,
        quote: { description: last!.body.slice(0, 80), amount: Math.max(5, Math.round(basePrice * 0.4)) },
      };
    return { reply: `Thanks, noted. See you at the next visit. If you need anything extra, just ask here.`, quote: null };
  }

  const sent = await post(supabase, conversationId, { sender: "provider", kind: "text", body: reply.reply.replace(/—/g, ",") });
  let request: Message | null = null;
  if (reply.quote && reply.quote.amount > 0 && reply.quote.amount <= 5000) {
    const visitId = last.kind === "extra_request" ? last.visit_id : (nextVisit?.id ?? null);
    const r = await post(
      supabase,
      conversationId,
      {
        sender: "provider",
        kind: "payment_request",
        body: reply.quote.description.slice(0, 140),
        amount: Math.round(reply.quote.amount * 100) / 100,
        status: "open",
        reply_to: last.kind === "extra_request" ? last.id : null,
        visit_id: visitId,
      },
      `Payment request: ${reply.quote.description}`,
    );
    if ("message" in r) request = r.message!;
    if (last.kind === "extra_request") await supabase.from("messages").update({ status: "accepted" }).eq("id", last.id);
  }
  await log(supabase, profile.id, "system", `${first} replied in chat${request ? ` with a ${money(Number(request.amount), cur)} quote` : ""}`, { conversation: conversationId });
  return { ok: true, reply: "message" in sent ? sent.message : null, request };
}

/** The model's conversation must open with the client speaking. */
function dropLeadingAssistant<T extends { role: "user" | "assistant" }>(list: T[]) {
  const i = list.findIndex((m) => m.role === "user");
  return i < 0 ? list : list.slice(i);
}
