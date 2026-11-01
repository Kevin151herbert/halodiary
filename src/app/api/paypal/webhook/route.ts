import { payProvider, verifyWebhook } from "@/lib/paypal";
import { adminClient } from "@/lib/supabase/admin";

type Event = { id: string; event_type: string; resource: Record<string, unknown> & { id?: string } };

const CONFIRMS: Record<string, string[]> = {
  "PAYMENT.AUTHORIZATION.CREATED": ["hold"],
  "PAYMENT.AUTHORIZATION.VOIDED": ["void"],
  "PAYMENT.CAPTURE.COMPLETED": ["capture", "fee", "extra"],
  "PAYMENT.CAPTURE.REFUNDED": ["refund"],
};

/**
 * PayPal tells HaloDiary what actually happened to the money. Each event is verified with PayPal,
 * stored once (PayPal retries), and confirms or updates the matching ledger line, dispute or subscription.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  let event: Event;
  try {
    event = JSON.parse(raw);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  if (!(await verifyWebhook(req.headers, event).catch(() => false))) return new Response("Signature not verified", { status: 401 });
  const db = adminClient();
  if (!db) return new Response("SUPABASE_SERVICE_ROLE_KEY is not set", { status: 503 });

  const r = event.resource ?? {};
  const { error: dup } = await db.from("paypal_events").insert({ id: event.id, event_type: event.event_type, resource_id: r.id ?? null, resource: r });
  if (dup) return Response.json({ ok: true, duplicate: true });

  let outcome = "ignored";
  const now = new Date().toISOString();
  const confirm = async (ref: string | undefined, kinds: string[], status: string) => {
    if (!ref) return 0;
    const { data } = await db.from("ledger_entries").update({ paypal_confirmed_at: now, paypal_status: status }).eq("paypal_ref", ref).in("kind", kinds).select("id");
    return data?.length ?? 0;
  };

  if (CONFIRMS[event.event_type]) {
    const n = await confirm(r.id, CONFIRMS[event.event_type], String(r.status ?? event.event_type));
    outcome = `confirmed ${n} ledger line(s)`;
  } else if (event.event_type.startsWith("PAYMENT.PAYOUTS-ITEM.") || event.event_type.startsWith("PAYMENT.PAYOUTSBATCH.")) {
    const batch = (r.payout_batch_id as string) ?? ((r.batch_header as { payout_batch_id?: string })?.payout_batch_id);
    const n = await confirm(batch, ["payout"], event.event_type.split(".").pop() ?? "");
    outcome = `payout ${n}`;
  } else if (event.event_type === "CUSTOMER.DISPUTE.CREATED") {
    outcome = await openDispute(db, r);
  } else if (event.event_type === "CUSTOMER.DISPUTE.RESOLVED") {
    await db.from("problems").update({ status: "closed", resolved_at: now }).eq("paypal_dispute_id", String(r.dispute_id ?? r.id));
    outcome = "dispute closed";
  } else if (event.event_type === "VAULT.PAYMENT-TOKEN.DELETED") {
    const { data } = await db.from("profiles").update({ paypal_payment_token: null }).eq("paypal_payment_token", String(r.id)).select("id");
    for (const p of data ?? [])
      await db.from("notifications").insert({ user_id: p.id, kind: "budget", title: "Your PayPal account was disconnected", body: "Approve your budget with PayPal again so visits can be paid." });
    outcome = `token removed from ${data?.length ?? 0} profile(s)`;
  } else if (event.event_type.startsWith("BILLING.SUBSCRIPTION.")) {
    const status = String(r.status ?? event.event_type.split(".").pop());
    const patch: Record<string, string> = { subscription_status: status };
    if (status === "ACTIVE") patch.billing = "subscription";
    if (["CANCELLED", "EXPIRED", "SUSPENDED"].includes(status)) patch.billing = "per_visit";
    const { data } = await db.from("plans").update(patch).eq("paypal_subscription_id", String(r.id)).select("id, client_id");
    for (const p of data ?? [])
      await db.from("notifications").insert({ user_id: p.client_id, kind: "payment", title: `PayPal subscription ${status.toLowerCase()}`, body: "" });
    outcome = `subscription ${status} on ${data?.length ?? 0} plan(s)`;
  } else if (event.event_type === "INVOICING.INVOICE.PAID") {
    outcome = await invoicePaid(db, r);
  } else if (event.event_type === "PAYMENT.SALE.COMPLETED" && r.billing_agreement_id) {
    const { data: plan } = await db.from("plans").select("id, client_id, provider_id, monthly_price").eq("paypal_subscription_id", String(r.billing_agreement_id)).maybeSingle();
    if (plan) {
      const amount = Number((r.amount as { total?: string })?.total ?? plan.monthly_price ?? 0);
      await db.from("ledger_entries").insert({
        client_id: plan.client_id,
        provider_id: plan.provider_id,
        kind: "capture",
        amount,
        paypal_ref: String(r.id),
        mode: "paypal_sandbox",
        note: "Monthly PayPal subscription payment",
        paypal_confirmed_at: now,
        paypal_status: "COMPLETED",
      });
      outcome = "subscription payment recorded";
    }
  }

  await db.from("paypal_events").update({ outcome }).eq("id", event.id);
  return Response.json({ ok: true, outcome });
}

/** A buyer opened a dispute in PayPal: attach it to the visit and both parties' chat. */
async function openDispute(db: NonNullable<ReturnType<typeof adminClient>>, r: Record<string, unknown>) {
  const disputeId = String(r.dispute_id ?? r.id);
  const tx = (r.disputed_transactions as { seller_transaction_id?: string }[] | undefined)?.[0]?.seller_transaction_id;
  if (!tx) return "dispute without transaction";
  const { data: line } = await db.from("ledger_entries").select("client_id, provider_id, visit_id, amount").eq("paypal_ref", tx).limit(1).maybeSingle();
  if (!line) return "dispute for an unknown transaction";
  const { data: conv } = await db.from("conversations").select("id").eq("client_id", line.client_id).eq("provider_id", line.provider_id).maybeSingle();
  const reason = String(r.reason ?? "PayPal dispute").replace(/_/g, " ").toLowerCase();
  await db.from("problems").upsert(
    {
      visit_id: line.visit_id,
      client_id: line.client_id,
      provider_id: line.provider_id,
      conversation_id: conv?.id ?? null,
      source: "paypal_dispute",
      reason,
      details: `PayPal dispute ${disputeId} for ${line.amount}`,
      paypal_dispute_id: disputeId,
    },
    { onConflict: "paypal_dispute_id" },
  );
  if (conv)
    await db.from("messages").insert({
      conversation_id: conv.id,
      sender: "system",
      kind: "problem",
      body: `A PayPal dispute was opened for this charge (${reason}). PayPal buyer protection applies; HaloDiary will follow PayPal's decision.`,
      visit_id: line.visit_id,
      status: "open",
      meta: { dispute_id: disputeId },
    });
  await db.from("notifications").insert({ user_id: line.client_id, kind: "payment", title: "PayPal dispute opened", body: reason });
  return "dispute recorded";
}

/** A chat request the client chose to pay by PayPal invoice: settle it like a paid request. */
async function invoicePaid(db: NonNullable<ReturnType<typeof adminClient>>, r: Record<string, unknown>) {
  const inv = (r.invoice as { id?: string; amount?: { value?: string; currency_code?: string } } | undefined) ?? (r as { id?: string; amount?: { value?: string; currency_code?: string } });
  const id = inv.id;
  if (!id) return "invoice without id";
  const { data: m } = await db.from("messages").select("*, conversations!inner(client_id, provider_id, providers(display_name))").eq("meta->>invoice_id", id).maybeSingle();
  if (!m) return "invoice not from a chat request";
  if (m.status === "paid") return "already paid";
  const conv = m.conversations as unknown as { client_id: string; provider_id: string; providers: { display_name: string } };
  const amount = Number(m.amount);
  const share = Math.round(amount * 0.9 * 100) / 100;
  await db.from("messages").update({ status: "paid", meta: { ...(m.meta ?? {}), paypal_ref: id, mode: "paypal_sandbox" } }).eq("id", m.id);
  const { data: prov } = await db.from("providers").select("paypal_email").eq("id", conv.provider_id).maybeSingle();
  const po = await payProvider({ providerEmail: prov?.paypal_email, amount: share, currency: String(inv.amount && "currency_code" in inv.amount ? inv.amount.currency_code : "EUR"), note: `HaloDiary invoice ${id}`, fallbackRef: `SIM-PAYOUT-INV-${id}` });
  await db.from("ledger_entries").insert([
    { client_id: conv.client_id, provider_id: conv.provider_id, kind: "extra", amount, paypal_ref: id, mode: "paypal_sandbox", note: `Paid by PayPal invoice: ${m.body}`.slice(0, 140), paypal_confirmed_at: new Date().toISOString(), paypal_status: "PAID" },
    { client_id: conv.client_id, provider_id: conv.provider_id, kind: "payout", amount: share, paypal_ref: po.ref, mode: po.mode, note: "Provider share of an invoice paid in PayPal" },
  ]);
  await db.from("messages").insert({
    conversation_id: m.conversation_id,
    sender: "system",
    kind: "payment",
    body: `Paid by PayPal invoice: ${m.body}. ${conv.providers.display_name} receives their share.`,
    amount,
    reply_to: m.id,
    meta: { paypal_ref: id, mode: "paypal_sandbox" },
  });
  await db.from("conversations").update({ last_message: `Paid by PayPal invoice: ${m.body}`.slice(0, 140), last_message_at: new Date().toISOString() }).eq("id", m.conversation_id);
  return "chat request paid by invoice";
}
