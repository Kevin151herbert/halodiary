import "server-only";
// Flat monthly plans as PayPal Subscriptions: the product comes from the PayPal Agent Toolkit,
// the billing plan and subscription from the PayPal Server SDK. Visits on a subscribed plan are
// covered by the monthly payment; HaloDiary pays the provider per visit from it.

import type { SupabaseClient } from "@supabase/supabase-js";
import { CADENCES, type CadenceKey } from "./cadence";
import { log } from "./engine";
import * as paypal from "./paypal";
import { runPayPalTool } from "./paypal-agent";
import type { Profile } from "./supabase/server";

/** A flat monthly price: the average month of visits, 5% off for committing. */
export function monthlyPriceFor(plan: { price: number; cadence: string }) {
  const perMonth = CADENCES[plan.cadence as CadenceKey]?.perMonth ?? 1;
  return Math.max(1, Math.round(Number(plan.price) * perMonth * 0.95));
}

export async function startSubscription(supabase: SupabaseClient, profile: Profile, planId: string, origin: string) {
  if (!paypal.paypalConfigured()) return { error: "PayPal sandbox keys aren't set on this deployment." };
  const { data: plan } = await supabase.from("plans").select("*, services(name), providers(display_name)").eq("id", planId).eq("client_id", profile.id).maybeSingle();
  if (!plan) return { error: "Service not found" };
  if (plan.billing === "subscription" && plan.subscription_status === "ACTIVE") return { error: "This service already has an active PayPal subscription." };
  const service = plan.services?.name ?? "Service";
  const provider = plan.providers?.display_name ?? "";
  const amount = monthlyPriceFor(plan);

  const product = await runPayPalTool<{ id?: string }>("create_product", {
    name: `HaloDiary ${service}`.slice(0, 127),
    type: "SERVICE",
    description: `${service} with ${provider}, booked and managed through HaloDiary`.slice(0, 256),
    category: "SERVICES",
  });
  if (!product.id) throw new Error("PayPal did not return a product");
  const billingPlanId = await paypal.createMonthlyPlan({ productId: product.id, name: `${service} with ${provider}, monthly`, amount, currency: profile.currency });
  const sub = await paypal.createSubscription({
    planId: billingPlanId,
    customId: plan.id,
    returnUrl: `${origin}/api/paypal/subscription?plan=${plan.id}`,
    cancelUrl: `${origin}/app?subscription=cancelled`,
  });
  await supabase.from("plans").update({ paypal_subscription_id: sub.id, subscription_status: "APPROVAL_PENDING", monthly_price: amount }).eq("id", plan.id);
  await log(supabase, profile.id, "user", `Started a ${profile.currency} ${amount} monthly PayPal subscription for ${service}`, { plan: plan.id, subscription: sub.id });
  return { approveUrl: sub.approveUrl, amount };
}

/** After PayPal sends the payer back (the webhook confirms the same thing a moment later). */
export async function confirmSubscription(supabase: SupabaseClient, profile: Profile, planId: string) {
  const { data: plan } = await supabase.from("plans").select("id, paypal_subscription_id, services(name)").eq("id", planId).eq("client_id", profile.id).maybeSingle();
  if (!plan?.paypal_subscription_id) return { error: "No subscription to confirm" };
  const status = await paypal.getSubscriptionStatus(plan.paypal_subscription_id);
  const active = ["ACTIVE", "APPROVED"].includes(status);
  await supabase.from("plans").update({ subscription_status: status, billing: active ? "subscription" : "per_visit" }).eq("id", plan.id);
  if (active) await log(supabase, profile.id, "user", `PayPal subscription is ${status.toLowerCase()} for ${(plan.services as unknown as { name: string })?.name}`);
  return { ok: active, status };
}

export async function stopSubscription(supabase: SupabaseClient, profile: Profile, planId: string) {
  const { data: plan } = await supabase.from("plans").select("id, paypal_subscription_id, services(name)").eq("id", planId).eq("client_id", profile.id).maybeSingle();
  if (!plan?.paypal_subscription_id) return { error: "No subscription on this service" };
  try {
    await paypal.cancelSubscription(plan.paypal_subscription_id, "Switched back to paying per visit in HaloDiary");
  } catch (e) {
    if (!String(e).includes("SUBSCRIPTION_STATUS_INVALID")) throw e;
  }
  await supabase.from("plans").update({ billing: "per_visit", subscription_status: "CANCELLED" }).eq("id", plan.id);
  await log(supabase, profile.id, "user", `Cancelled the PayPal subscription for ${(plan.services as unknown as { name: string })?.name}; back to paying per visit`);
  return { ok: true };
}
