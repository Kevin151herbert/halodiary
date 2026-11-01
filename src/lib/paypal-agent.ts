import "server-only";
// PayPal Agent Toolkit: PayPal's official tools for AI agents. HaloDiary never hands the raw
// merchant tools to the model (they would see every customer's data); it runs them server-side,
// scoped to the signed-in user, behind the assistant's one-tap approval.

import { ALL_TOOLS_ENABLED, PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { log } from "./engine";
import { paypalConfigured } from "./paypal";
import type { Profile } from "./supabase/server";
import { monthLabel, monthRange } from "./time";

let toolkit: PayPalAgentToolkit | null = null;
function tools() {
  if (!paypalConfigured()) throw new Error("PayPal sandbox keys are not set");
  toolkit ??= new PayPalAgentToolkit({
    clientId: process.env.PAYPAL_CLIENT_ID!,
    clientSecret: process.env.PAYPAL_CLIENT_SECRET!,
    configuration: { actions: ALL_TOOLS_ENABLED, context: { sandbox: process.env.PAYPAL_ENV !== "live" } },
  });
  return toolkit.getTools();
}

/** Run one Agent Toolkit tool and parse its JSON result. */
export async function runPayPalTool<T = Record<string, unknown>>(name: string, args: Record<string, unknown>): Promise<T> {
  const t = tools()[name] as unknown as { execute: (a: unknown, o: unknown) => Promise<unknown> };
  if (!t) throw new Error(`Unknown PayPal tool ${name}`);
  const out = await t.execute(args, { toolCallId: crypto.randomUUID(), messages: [] });
  const value = typeof out === "string" ? safe(out) : out;
  if (value && typeof value === "object" && "error" in (value as object)) throw new Error(String((value as { error: unknown }).error));
  return value as T;
}
const safe = (s: string) => {
  try {
    return JSON.parse(s);
  } catch {
    return { text: s };
  }
};

/**
 * A monthly statement as a PayPal invoice marked paid: the client gets an official PayPal record of every
 * visit HaloDiary charged, without being asked to pay again.
 */
export async function sendMonthlyStatement(supabase: SupabaseClient, profile: Profile, month: string) {
  if (!profile.paypal_payer_email) return { error: "Approve a budget with PayPal first, so the statement can go to your PayPal email." };
  const { start, end } = monthRange(month, profile.timezone);
  const { data: lines } = await supabase
    .from("ledger_entries")
    .select("kind, amount, paypal_ref, mode, note, created_at, providers(display_name), visits(scheduled_at, services(name))")
    .eq("client_id", profile.id)
    .in("kind", ["capture", "fee", "extra", "refund"])
    .gte("created_at", start.toISOString())
    .lt("created_at", end.toISOString())
    .order("created_at");
  const charged = (lines ?? []).filter((l) => Number(l.amount) > 0);
  if (!charged.length) return { error: `Nothing was charged in ${monthLabel(month)} yet.` };

  const cur = profile.currency;
  const items = charged.map((l) => {
    const service = (l.visits as unknown as { services?: { name: string } } | null)?.services?.name;
    const provider = (l.providers as unknown as { display_name: string } | null)?.display_name ?? "";
    const label = l.kind === "refund" ? "Refund" : l.kind === "fee" ? "Late change fee" : l.kind === "extra" ? "Extra in chat" : (service ?? "Visit");
    return {
      name: `${label}${provider ? `, ${provider}` : ""}`.slice(0, 200),
      description: `${new Date(l.created_at).toISOString().slice(0, 10)} · ${l.mode === "paypal_sandbox" ? "PayPal" : "simulated"} ${l.paypal_ref ?? ""}`.slice(0, 1000),
      quantity: "1",
      unit_amount: { currency_code: cur, value: (l.kind === "refund" ? -Number(l.amount) : Number(l.amount)).toFixed(2) },
    };
  });
  const total = items.reduce((s, i) => s + Number(i.unit_amount.value), 0);
  if (total <= 0) return { error: "Nothing left to report after refunds this month." };

  const today = new Date().toISOString().slice(0, 10);
  const invoice = await runPayPalTool<{ id?: string; href?: string; links?: { href: string; rel: string }[] }>("create_invoice", {
    currency_code: cur,
    invoice_date: today,
    note: `Your HaloDiary statement for ${monthLabel(month)}. Every line was already paid through PayPal; nothing more is due.`,
    reference: `HaloDiary ${month.slice(0, 7)}`,
    invoicer_business_name: "HaloDiary",
    primary_recipients: [
      {
        billing_info: {
          name: { given_name: profile.full_name.split(" ")[0] || "Client", surname: profile.full_name.split(" ").slice(1).join(" ") || "HaloDiary" },
          email_address: profile.paypal_payer_email,
        },
      },
    ],
    items,
  });
  const id = invoice.id ?? invoice.href?.split("/").pop() ?? invoice.links?.find((l) => l.rel === "self")?.href.split("/").pop();
  if (!id) throw new Error("PayPal did not return an invoice id");
  await runPayPalTool("send_invoice", { invoice_id: id, send_to_recipient: true, note: "Your HaloDiary monthly statement" });
  await runPayPalTool("record_payment_for_invoice", {
    invoice_id: id,
    method: "PAYPAL",
    payment_date: today,
    amount: { currency_code: cur, value: total.toFixed(2) },
    note: "Paid visit by visit through HaloDiary",
  });
  await log(supabase, profile.id, "user", `Sent a PayPal statement for ${monthLabel(month)}`, { invoice: id, total });
  return { ok: true, invoiceId: id, total, lines: items.length };
}
