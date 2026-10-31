// A fresh snapshot of the user's world for every assistant request, so nobody repeats themselves.
// Scoped by role: a provider's snapshot never contains a client's budget or PayPal details.

import type { SupabaseClient } from "@supabase/supabase-js";
import { upcomingVisits } from "../actions-core";
import { cadenceLabel } from "../cadence";
import { forecastMonth, monthKey, nowFor, spentInMonth } from "../engine";
import type { Profile } from "../supabase/server";
import { fmtShort, monthLabel } from "../time";

const PAGE_NAMES: Record<string, string> = {
  "/app": "Diary (their schedule and day-before checks)",
  "/app/discover": "Discover (searching providers near them)",
  "/app/budget": "Budget (monthly cap, PayPal approval and payments ledger)",
  "/app/provider": "Provider view (answering visits as a provider)",
  "/app/activity": "Activity log",
  "/app/settings": "Settings (assistant switches)",
};

export async function buildContext(supabase: SupabaseClient, profile: Profile, page: string) {
  const tz = profile.timezone;
  const now = nowFor(profile);
  const pageName =
    PAGE_NAMES[page] ?? (page.startsWith("/app/providers/") ? `A provider's profile page (provider id ${page.split("/").pop()})` : page);

  const lines: string[] = [
    `Name: ${profile.full_name}. Role: ${profile.role}. Location: ${profile.city ?? "set"}. Time zone: ${tz}. Currency: ${profile.currency}.`,
    `Current date and time (demo clock${profile.clock_offset_hours ? ` is ${profile.clock_offset_hours}h ahead of real time` : ""}): ${fmtShort(now, tz)} (${now.toISOString()}).`,
    `They are looking at: ${pageName}.`,
    `Assistant settings: proactive suggestions ${profile.proactive_enabled ? "ON" : "OFF"}; auto-answer routine day-before checks ${profile.auto_checks_enabled ? "ON" : "OFF"}.`,
  ];

  if (profile.role === "client") {
    const month = monthKey(now, tz);
    const [{ data: plans }, visits, forecast, { data: budget }, spent, { data: activity }] = await Promise.all([
      supabase.from("plans").select("*, services(name), providers(display_name)").eq("client_id", profile.id).neq("status", "ended"),
      upcomingVisits(supabase, profile, 10),
      forecastMonth(supabase, profile, month),
      supabase.from("budgets").select("*").eq("client_id", profile.id).eq("month", month).maybeSingle(),
      spentInMonth(supabase, profile, month),
      supabase.from("activity_log").select("actor, action, created_at").eq("user_id", profile.id).order("created_at", { ascending: false }).limit(6),
    ]);

    lines.push("", "RECURRING SERVICES (plans):");
    if (!plans?.length) lines.push("- none yet");
    for (const p of plans ?? [])
      lines.push(
        `- plan ${p.id}: ${p.services?.name} with ${p.providers?.display_name} (provider ${p.provider_id}), ${cadenceLabel(p.cadence, p.weekdays)} at ${String(p.time_of_day).slice(0, 5)}, ${profile.currency} ${Number(p.price).toFixed(2)} a visit, status ${p.status}`,
      );

    lines.push("", "NEXT 10 DAYS OF VISITS:");
    if (!visits.length) lines.push("- none");
    for (const v of visits.slice(0, 25))
      lines.push(
        `- visit ${v.id}: ${fmtShort(v.scheduled_at, tz)}, ${v.services?.name} with ${v.providers?.display_name}, ${profile.currency} ${Number(v.price).toFixed(2)}, status ${v.status}${v.status === "awaiting" && !v.client_response ? " (WAITING FOR THE CLIENT'S ANSWER)" : ""}`,
      );

    lines.push(
      "",
      `BUDGET ${monthLabel(month)}: forecast ${profile.currency} ${forecast.total.toFixed(2)}, suggested cap ${profile.currency} ${forecast.cap.toFixed(2)}; ` +
        (budget?.status === "approved"
          ? `APPROVED cap ${profile.currency} ${Number(budget.cap).toFixed(2)} (${budget.approval_mode === "paypal_sandbox" ? "via PayPal" : "simulated"}), used ${profile.currency} ${spent.toFixed(2)}, left ${profile.currency} ${(Number(budget.cap) - spent).toFixed(2)}.`
          : "NOT APPROVED yet, so visits cannot be confirmed and paid until it is."),
      `PayPal account saved: ${profile.paypal_payment_token ? "yes" : "no"}.`,
    );

    lines.push("", "RECENT ACTIVITY:");
    for (const a of activity ?? []) lines.push(`- ${fmtShort(a.created_at, tz)} [${a.actor}] ${a.action}`);
  } else {
    const { data: me } = await supabase.from("providers").select("id, display_name, headline").eq("profile_id", profile.id).maybeSingle();
    lines.push("", me ? `PROVIDER LISTING: ${me.display_name} (${me.headline}), provider id ${me.id}.` : "No provider listing yet.");
    if (me) {
      const { data: services } = await supabase.from("provider_services").select("price, services(name)").eq("provider_id", me.id);
      lines.push(`Offers: ${(services ?? []).map((s) => `${(s.services as unknown as { name: string })?.name} ${profile.currency} ${Number(s.price).toFixed(2)}`).join(", ")}`);
      const { data: visits } = await supabase
        .from("visits")
        .select("id, scheduled_at, status, price, provider_response, services(name)")
        .eq("provider_id", me.id)
        .gte("scheduled_at", now.toISOString())
        .order("scheduled_at")
        .limit(25);
      lines.push("", "UPCOMING VISITS (client details are private):");
      for (const v of visits ?? [])
        lines.push(
          `- visit ${v.id}: ${fmtShort(v.scheduled_at, tz)}, ${(v.services as unknown as { name: string })?.name}, status ${v.status}, your answer ${v.provider_response ?? "none"}`,
        );
    }
  }
  return lines.join("\n");
}
