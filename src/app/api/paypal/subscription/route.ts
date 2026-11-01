import { NextResponse } from "next/server";
import { getSession } from "@/lib/supabase/server";
import { confirmSubscription } from "@/lib/subscriptions";

/** PayPal sends the payer back here after approving a subscription. */
export async function GET(req: Request) {
  const { supabase, profile } = await getSession();
  if (!profile) return NextResponse.redirect(new URL("/login", req.url));
  const planId = new URL(req.url).searchParams.get("plan") ?? "";
  try {
    const r = await confirmSubscription(supabase, profile, planId);
    return NextResponse.redirect(new URL(`/app?subscription=${r.ok ? "active" : (r.status ?? "pending").toLowerCase()}`, req.url));
  } catch (e) {
    return NextResponse.redirect(new URL(`/app?subscription=error&detail=${encodeURIComponent(String(e).slice(0, 150))}`, req.url));
  }
}
