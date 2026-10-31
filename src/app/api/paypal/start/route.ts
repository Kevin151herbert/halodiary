import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { forecastMonth } from "@/lib/engine";
import { createSetupToken, paypalConfigured } from "@/lib/paypal";
import { getSession } from "@/lib/supabase/server";
import { monthLabel } from "@/lib/time";

// Starts the one-time PayPal approval for the monthly budget, then sends the payer to PayPal.
export async function POST(req: Request) {
  const { supabase, profile } = await getSession();
  if (!profile) return NextResponse.redirect(new URL("/login", req.url), 303);
  const form = await req.formData();
  const month = String(form.get("month"));
  const forecast = await forecastMonth(supabase, profile, month);
  const cap = Number(form.get("cap") || forecast.cap);

  if (!paypalConfigured()) return NextResponse.redirect(new URL("/app/budget?paypal_error=not_configured", req.url), 303);

  const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin;
  try {
    const capText = `up to ${profile.currency} ${cap.toFixed(2)} for ${monthLabel(month)}`;
    const { id, approveUrl } = await createSetupToken({
      capText,
      returnUrl: `${origin}/api/paypal/return`,
      cancelUrl: `${origin}/app/budget?paypal_error=cancelled`,
    });
    (await cookies()).set("hd_setup", JSON.stringify({ id, month, cap }), {
      httpOnly: true,
      secure: origin.startsWith("https"),
      sameSite: "lax",
      maxAge: 1800,
      path: "/",
    });
    return NextResponse.redirect(approveUrl, 303);
  } catch (e) {
    return NextResponse.redirect(new URL(`/app/budget?paypal_error=${encodeURIComponent(String(e).slice(0, 200))}`, req.url), 303);
  }
}
