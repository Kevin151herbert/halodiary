"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import * as core from "@/lib/actions-core";
import * as chat from "@/lib/chat";
import * as problems from "@/lib/problems";
import { invoiceForRequest, sendMonthlyStatement } from "@/lib/paypal-agent";
import * as subs from "@/lib/subscriptions";
import { headers } from "next/headers";
import { log } from "@/lib/engine";
import { getSession } from "@/lib/supabase/server";

async function session() {
  const s = await getSession();
  if (!s.user || !s.profile) redirect("/login");
  return { supabase: s.supabase, profile: s.profile! };
}

function done(path = "/app") {
  revalidatePath(path, "layout");
}

function termsFrom(form: FormData) {
  const t: Record<string, number> = {};
  for (const [k, v] of form.entries()) if (k.startsWith("t_")) t[k.slice(2)] = Number(v);
  return t;
}

export async function addPlanAction(form: FormData) {
  const { supabase, profile } = await session();
  if (form.get("agree") !== "on") return { error: "Please agree to the service agreement first." };
  const weekdays = form.getAll("weekdays").map(Number);
  const res = await core.createPlan(
    supabase,
    profile,
    {
      providerId: String(form.get("provider_id")),
      serviceId: String(form.get("service_id")),
      cadence: String(form.get("cadence")),
      weekdays,
      time: String(form.get("time") || "10:00"),
      terms: termsFrom(form),
    },
    "user",
  );
  if ("error" in res && res.error) return { error: res.error };
  done();
  redirect("/app?added=1");
}

export async function respondAction(visitId: string, action: "proceed" | "skip" | "reschedule", newTime?: string, acceptsProposal = false) {
  const { supabase, profile } = await session();
  const res = await core.clientRespond(supabase, profile, { visitId, action, newTime, acceptsProposal }, "user");
  done();
  return res;
}

export async function providerAction(visitId: string, action: "proceed" | "propose" | "complete" | "cancel", newTime?: string, reason?: string) {
  const { supabase, profile } = await session();
  const res = await core.providerRespond(supabase, profile, { visitId, action, newTime, reason }, "user");
  done();
  return res;
}

export async function movePreviewAction(visitId: string) {
  const { supabase, profile } = await session();
  return core.movePreview(supabase, profile, visitId);
}

export async function signAgreementAction(contractId: string) {
  const { supabase, profile } = await session();
  const res = await core.signAgreement(supabase, profile, contractId, "user");
  done();
  return res;
}

export async function declineAgreementAction(contractId: string) {
  const { supabase, profile } = await session();
  const res = await core.declineAgreement(supabase, profile, contractId, "user");
  done();
  return res;
}

export async function proposeAmendmentAction(form: FormData) {
  const { supabase, profile } = await session();
  const res = await core.proposeAmendment(
    supabase,
    profile,
    { planId: String(form.get("plan_id")), terms: termsFrom(form), note: String(form.get("note") ?? "") },
    "user",
  );
  done();
  return res;
}

export async function planStatusAction(planId: string, status: "active" | "paused" | "ended") {
  const { supabase, profile } = await session();
  await core.setPlanStatus(supabase, profile, planId, status, "user");
  done();
}

export async function approveBudgetSimulatedAction(month: string, cap: number) {
  const { supabase, profile } = await session();
  const res = await core.approveBudget(supabase, profile, { month, cap, mode: "simulated" }, "user");
  done();
  return res;
}

export async function setClockAction(hours: number) {
  const { supabase, profile } = await session();
  const next = hours === 0 ? 0 : profile.clock_offset_hours + hours;
  await supabase.from("profiles").update({ clock_offset_hours: next }).eq("id", profile.id);
  await log(supabase, profile.id, "user", hours === 0 ? "Reset the demo clock" : `Moved the demo clock forward ${hours} hours`);
  done();
}

export async function saveSettingsAction(form: FormData) {
  const { supabase, profile } = await session();
  const patch = {
    full_name: String(form.get("full_name") ?? profile.full_name),
    assistant_enabled: form.get("assistant_enabled") === "on",
    proactive_enabled: form.get("proactive_enabled") === "on",
    auto_checks_enabled: form.get("auto_checks_enabled") === "on",
    agent_max_per_payment: (() => {
      const v = String(form.get("agent_max_per_payment") ?? "").trim();
      const n = Number(v);
      return v && !Number.isNaN(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
    })(),
  };
  await supabase.from("profiles").update(patch).eq("id", profile.id);
  await log(supabase, profile.id, "user", "Updated settings", patch);
  done();
  redirect("/app/settings?saved=1");
}

export async function toggleAssistantAction(enabled: boolean) {
  const { supabase, profile } = await session();
  await supabase.from("profiles").update({ assistant_enabled: enabled }).eq("id", profile.id);
  await log(supabase, profile.id, "user", enabled ? "Turned the assistant on" : "Turned the assistant off");
  done();
}

export async function markNotificationReadAction(id: string) {
  const { supabase, profile } = await session();
  await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", profile.id).eq("id", id);
  done();
}

export async function markNotificationsReadAction() {
  const { supabase, profile } = await session();
  await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", profile.id).is("read_at", null);
  done();
}

export async function saveLocationAction(lat: number, lng: number, city: string) {
  const { supabase, profile } = await session();
  await supabase.from("profiles").update({ lat, lng, city }).eq("id", profile.id);
  await log(supabase, profile.id, "user", `Set location to ${city}`);
  done();
}

export async function signOutAction() {
  const { supabase } = await session();
  await supabase.auth.signOut();
  redirect("/");
}

// ---------- Chat ----------

function chatDone(id?: string) {
  revalidatePath("/app/messages");
  if (id) revalidatePath(`/app/messages/${id}`);
}

export async function openChatAction(providerId: string) {
  const { supabase, profile } = await session();
  const id = await chat.conversationWith(supabase, profile.id, providerId);
  redirect(`/app/messages/${id}`);
}

export async function sendChatAction(conversationId: string, body: string, kind: "text" | "extra_request" = "text", visitId?: string | null) {
  const { supabase, profile } = await session();
  const res =
    profile.role === "provider"
      ? await chat.providerSend(supabase, profile, conversationId, { body })
      : await chat.clientSend(supabase, profile, conversationId, { body, kind, visitId });
  chatDone(conversationId);
  return res;
}

export async function demoReplyAction(conversationId: string) {
  const { supabase, profile } = await session();
  const res = await chat.demoReply(supabase, profile, conversationId);
  chatDone(conversationId);
  return res;
}

export async function requestPaymentAction(conversationId: string, body: string, amount: number, replyTo?: string | null) {
  const { supabase, profile } = await session();
  if (profile.role !== "provider") return { error: "Only providers send payment requests." };
  const res = await chat.providerSend(supabase, profile, conversationId, { body, amount, replyTo });
  chatDone(conversationId);
  return res;
}

export async function payRequestAction(messageId: string) {
  const { supabase, profile } = await session();
  const res = await chat.payRequest(supabase, profile, messageId);
  done();
  return res;
}

export async function sendPaymentAction(conversationId: string, amount: number, note: string) {
  const { supabase, profile } = await session();
  const res = await chat.sendPayment(supabase, profile, conversationId, amount, note);
  done();
  return res;
}

export async function rateVisitAction(messageId: string, rating: number, comment: string) {
  const { supabase, profile } = await session();
  const res = await chat.rateVisit(supabase, profile, messageId, rating, comment);
  chatDone();
  return res;
}

export async function markChatReadAction(conversationId: string) {
  const { supabase, profile } = await session();
  await chat.markRead(supabase, conversationId, profile.role === "provider" ? "provider" : "client");
  done();
}

// ---------- Problems and refunds ----------

export async function reportProblemAction(conversationId: string, visitId: string, reason: string, details: string) {
  const { supabase, profile } = await session();
  const res = await problems.reportProblem(supabase, profile, { conversationId, visitId, reason: reason as problems.Reason, details });
  chatDone(conversationId);
  return res;
}

export async function demoProblemAction(problemId: string) {
  const { supabase, profile } = await session();
  const res = await problems.demoRespondToProblem(supabase, profile, problemId);
  chatDone();
  return res;
}

export async function offerRefundAction(conversationId: string, amount: number, note: string) {
  const { supabase, profile } = await session();
  if (profile.role !== "provider") return { error: "Only providers offer refunds." };
  const res = await problems.offerRefund(supabase, conversationId, amount, note);
  chatDone(conversationId);
  return res;
}

export async function acceptRefundAction(messageId: string) {
  const { supabase, profile } = await session();
  const res = await problems.acceptRefund(supabase, profile, messageId);
  done();
  return res;
}

export async function sendStatementAction(month: string) {
  const { supabase, profile } = await session();
  try {
    const res = await sendMonthlyStatement(supabase, profile, month);
    done();
    return res;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "PayPal couldn't create the statement." };
  }
}

// ---------- PayPal Subscriptions ----------

export async function startSubscriptionAction(planId: string) {
  const { supabase, profile } = await session();
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  try {
    return await subs.startSubscription(supabase, profile, planId, origin);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "PayPal couldn't start the subscription." };
  }
}

export async function stopSubscriptionAction(planId: string) {
  const { supabase, profile } = await session();
  try {
    const r = await subs.stopSubscription(supabase, profile, planId);
    done();
    return r;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "PayPal couldn't cancel the subscription." };
  }
}

export async function invoiceRequestAction(messageId: string) {
  const { supabase, profile } = await session();
  try {
    return await invoiceForRequest(supabase, profile, messageId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "PayPal couldn't create the invoice." };
  }
}

export async function createAgentTokenAction(label: string) {
  const { supabase, profile } = await session();
  const { newToken } = await import("@/lib/agent-tokens");
  const t = newToken();
  const name = label.trim().slice(0, 60) || "AI assistant";
  const { error } = await supabase.from("agent_tokens").insert({ user_id: profile.id, label: name, token_hash: t.hash, token_hint: t.hint });
  if (error) return { error: "Could not create the token." };
  await log(supabase, profile.id, "user", `Connected an outside AI: ${name}`);
  done();
  return { ok: true, token: t.token };
}

export async function revokeAgentTokenAction(id: string) {
  const { supabase, profile } = await session();
  const { data } = await supabase.from("agent_tokens").update({ revoked_at: new Date().toISOString() }).eq("id", id).select("label").maybeSingle();
  if (data) await log(supabase, profile.id, "user", `Disconnected ${data.label}`);
  done();
  return { ok: true };
}
