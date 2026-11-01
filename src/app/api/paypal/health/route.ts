import { accessToken, createSetupToken, paypalConfigured } from "@/lib/paypal";
import { adminClient } from "@/lib/supabase/admin";
import { runPayPalTool } from "@/lib/paypal-agent";
import { getSession } from "@/lib/supabase/server";

/** Signed-in check that the PayPal Server SDK and Agent Toolkit both reach the sandbox. No money moves. */
export async function GET() {
  const { user } = await getSession();
  if (!user) return new Response("Sign in first", { status: 401 });
  if (!paypalConfigured()) return Response.json({ configured: false });
  const out: Record<string, string> = {};
  try {
    const t = await createSetupToken({ capText: "health check", returnUrl: "https://halodiary.vercel.app/app", cancelUrl: "https://halodiary.vercel.app/app" });
    out.server_sdk = t.id ? "ok" : "no id";
  } catch (e) {
    out.server_sdk = String(e instanceof Error ? e.message : e).slice(0, 200);
  }
  try {
    const r = await runPayPalTool<{ total_items?: number; items?: unknown[] }>("list_invoices", { page: 1, page_size: 1 });
    out.agent_toolkit = `ok (${r.total_items ?? r.items?.length ?? 0} invoices)`;
  } catch (e) {
    out.agent_toolkit = String(e instanceof Error ? e.message : e).slice(0, 200);
  }
  // Ask PayPal which webhooks this app has, and check ours points at this site with the right events.
  try {
    const base = process.env.PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
    const res = await fetch(`${base}/v1/notifications/webhooks`, { headers: { Authorization: `Bearer ${await accessToken()}` }, cache: "no-store" });
    const json = (await res.json()) as { webhooks?: { id: string; url: string; event_types: { name: string }[] }[] };
    const mine = json.webhooks?.find((w) => w.id === process.env.PAYPAL_WEBHOOK_ID);
    out.webhook = !process.env.PAYPAL_WEBHOOK_ID
      ? "PAYPAL_WEBHOOK_ID missing"
      : !mine
        ? `PAYPAL_WEBHOOK_ID not found among this app's ${json.webhooks?.length ?? 0} webhook(s)`
        : `ok: ${mine.url} (${mine.event_types.some((e) => e.name === "*") ? "all events" : `${mine.event_types.length} events`})`;
  } catch (e) {
    out.webhook = `could not list webhooks: ${String(e).slice(0, 120)}`;
  }
  out.service_role = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY ? "configured" : "missing";
  out.cron_secret = process.env.CRON_SECRET ? "configured" : "missing";
  const db = adminClient();
  if (db) {
    const { data: run } = await db.from("job_runs").select("ran_at, result").eq("job", "scheduler").order("ran_at", { ascending: false }).limit(1).maybeSingle();
    out.last_scheduler_run = run ? `${run.ran_at} ${JSON.stringify(run.result).slice(0, 160)}` : "never";
    const { count } = await db.from("paypal_events").select("id", { count: "exact", head: true });
    out.webhook_events_received = String(count ?? 0);
  }
  return Response.json({ configured: true, ...out });
}
