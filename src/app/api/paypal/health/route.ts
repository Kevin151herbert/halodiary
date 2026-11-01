import { createSetupToken, paypalConfigured } from "@/lib/paypal";
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
  out.webhook = process.env.PAYPAL_WEBHOOK_ID ? "configured" : "PAYPAL_WEBHOOK_ID missing";
  out.service_role = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY ? "configured" : "missing";
  out.cron_secret = process.env.CRON_SECRET ? "configured" : "missing";
  return Response.json({ configured: true, ...out });
}
