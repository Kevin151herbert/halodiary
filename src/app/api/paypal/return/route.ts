import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { approveBudget } from "@/lib/actions-core";
import { createPaymentToken } from "@/lib/paypal";
import { getSession } from "@/lib/supabase/server";

// PayPal sends the payer back here after they approve. We save the PayPal account
// as a payment token and approve the month's budget with it.
export async function GET(req: Request) {
  const { supabase, profile } = await getSession();
  if (!profile) return NextResponse.redirect(new URL("/login", req.url));
  const jar = await cookies();
  const raw = jar.get("hd_setup")?.value;
  if (!raw) return NextResponse.redirect(new URL("/app/budget?paypal_error=expired", req.url));
  jar.delete("hd_setup");

  try {
    const { id, month, cap } = JSON.parse(raw) as { id: string; month: string; cap: number };
    const { paymentToken, email } = await createPaymentToken(id);
    await supabase.from("profiles").update({ paypal_payment_token: paymentToken, paypal_payer_email: email }).eq("id", profile.id);
    await approveBudget(supabase, { ...profile, paypal_payment_token: paymentToken }, { month, cap, mode: "paypal_sandbox" }, "user");
    return NextResponse.redirect(new URL("/app/budget?approved=paypal", req.url));
  } catch (e) {
    return NextResponse.redirect(new URL(`/app/budget?paypal_error=${encodeURIComponent(String(e).slice(0, 200))}`, req.url));
  }
}
