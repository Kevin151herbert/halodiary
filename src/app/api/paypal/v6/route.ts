import { approveBudget } from "@/lib/actions-core";
import { forecastMonth } from "@/lib/engine";
import { browserClientToken, createPaymentToken, createSetupToken, paypalConfigured } from "@/lib/paypal";
import { getSession } from "@/lib/supabase/server";
import { monthLabel } from "@/lib/time";

/**
 * Server side of the PayPal JS SDK v6 "save PayPal" button on the Budget page.
 *   GET                         -> a browser-safe client token for window.paypal.createInstance
 *   POST {step:"setup", month}  -> a vault setup token for the session's start()
 *   POST {step:"save", vaultSetupToken, month, cap} -> exchanges it for a payment token (kept server-side) and approves the budget
 */
export async function GET(req: Request) {
  const { profile } = await getSession();
  if (!profile) return new Response("Sign in first", { status: 401 });
  if (!paypalConfigured()) return Response.json({ error: "not_configured" }, { status: 503 });
  try {
    return Response.json({ accessToken: await browserClientToken(new URL(req.url).host) });
  } catch (e) {
    return Response.json({ error: String(e instanceof Error ? e.message : e) }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const { supabase, profile } = await getSession();
  if (!profile) return new Response("Sign in first", { status: 401 });
  const body = (await req.json()) as { step: "setup" | "save"; month: string; cap?: number; vaultSetupToken?: string };
  if (!/^\d{4}-\d{2}-01$/.test(body.month ?? "")) return Response.json({ error: "bad month" }, { status: 400 });
  const forecast = await forecastMonth(supabase, profile, body.month);
  const cap = Number(body.cap) > 0 ? Number(body.cap) : forecast.cap;
  const origin = new URL(req.url).origin;
  try {
    if (body.step === "setup") {
      const t = await createSetupToken({
        capText: `up to ${profile.currency} ${cap.toFixed(2)} for ${monthLabel(body.month)}`,
        returnUrl: `${origin}/app/budget`,
        cancelUrl: `${origin}/app/budget?paypal_error=cancelled`,
      });
      return Response.json({ id: t.id });
    }
    if (!body.vaultSetupToken) return Response.json({ error: "missing token" }, { status: 400 });
    const { paymentToken, email } = await createPaymentToken(body.vaultSetupToken);
    await supabase.from("profiles").update({ paypal_payment_token: paymentToken, paypal_payer_email: email }).eq("id", profile.id);
    await approveBudget(supabase, { ...profile, paypal_payment_token: paymentToken }, { month: body.month, cap, mode: "paypal_sandbox" }, "user");
    return Response.json({ ok: true, email });
  } catch (e) {
    return Response.json({ error: String(e instanceof Error ? e.message : e).slice(0, 300) }, { status: 502 });
  }
}
