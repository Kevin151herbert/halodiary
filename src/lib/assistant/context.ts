// A fresh snapshot of the user's world for every assistant request, so nobody repeats themselves.
// Scoped by role: a provider's snapshot never contains a client's budget or PayPal details.

import type { SupabaseClient } from "@supabase/supabase-js";
import { upcomingVisits } from "../actions-core";
import { cadenceLabel } from "../cadence";
import { forecastMonth, monthKey, nowFor, spentInMonth } from "../engine";
import type { Profile } from "../supabase/server";
import { fmtMoney, fmtShort, monthLabel } from "../time";

const PAGE_NAMES: Record<string, string> = {
  "/app": "Diary (their schedule and day-before checks)",
  "/app/discover": "Discover (searching providers near them)",
  "/app/budget": "Budget (monthly cap, PayPal approval and payments ledger)",
  "/app/provider": "Provider view (answering visits as a provider)",
  "/app/activity": "Activity log",
  "/app/agreements": "Agreements (the signed terms for each service)",
  "/app/messages": "Messages (chats with providers)",
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
        `- plan ${p.id}: ${p.services?.name} with ${p.providers?.display_name} (provider ${p.provider_id}), ${cadenceLabel(p.cadence, p.weekdays)} at ${String(p.time_of_day).slice(0, 5)}, ${fmtMoney(Number(p.price), profile.currency)} a visit, status ${p.status}, added ${fmtShort(p.created_at, tz)} by ${p.created_by === "assistant" ? "you, the assistant, after the user approved your card" : p.created_by === "mcp" ? "an outside AI agent" : "the user or the tour setup"}`,
      );

    // Several plans for one service (weekday walks and weekend walks, say) are intended, not duplicates.
    const byService = new Map<string, number>();
    for (const p of plans ?? []) byService.set(p.services?.name ?? "", (byService.get(p.services?.name ?? "") ?? 0) + 1);
    for (const [name, n] of byService)
      if (n > 1) lines.push(`- note: ${name} has ${n} separate plans on purpose (different days, times or providers). They are not duplicates; never suggest ending one unless the user asks.`);

    const { data: contracts } = await supabase
      .from("contracts")
      .select("id, plan_id, version, status, terms, client_signed_at, provider_signed_at")
      .eq("client_id", profile.id)
      .in("status", ["active", "pending"]);
    lines.push("", "SERVICE AGREEMENTS (terms both parties signed; HaloDiary enforces them automatically):");
    if (!contracts?.length) lines.push("- none");
    for (const c of contracts ?? []) {
      const t = c.terms as Record<string, number>;
      lines.push(
        `- agreement ${c.id} for plan ${c.plan_id}, v${c.version} ${c.status}${c.status === "pending" ? ` (waiting for ${c.provider_signed_at ? "client" : "provider"} signature)` : ""}: free changes up to ${t.cancellation_notice_hours}h before, late fee ${t.late_cancellation_fee_pct}% (first ${t.free_reschedules_per_month} late moves a month free), provider gives ${t.provider_change_notice_hours}h notice or credits ${t.provider_late_change_credit_pct}% (late cancel ${t.provider_cancellation_credit_pct}%), reminder ${t.reminder_hours}h before, ${t.termination_notice_days} days' notice to end, price fixed ${t.price_lock_months} months`,
      );
    }

    const { data: convs } = await supabase
      .from("conversations")
      .select("id, provider_id, last_message, last_message_at, client_read_at, providers(display_name)")
      .eq("client_id", profile.id)
      .order("last_message_at", { ascending: false })
      .limit(6);
    const { data: openRequests } = await supabase
      .from("messages")
      .select("body, amount, conversation_id, conversations!inner(client_id, providers(display_name))")
      .eq("kind", "payment_request")
      .eq("status", "open")
      .eq("conversations.client_id", profile.id)
      .limit(5);
    lines.push("", "CHATS WITH PROVIDERS (in-app, replaces WhatsApp; payments requested there are paid with the chat's Pay button):");
    if (!convs?.length) lines.push("- none yet");
    for (const c of convs ?? [])
      lines.push(
        `- ${(c.providers as unknown as { display_name: string })?.display_name} (provider ${c.provider_id}): last "${c.last_message}"${c.last_message_at > c.client_read_at ? " (UNREAD)" : ""}, open at /app/messages/${c.id}`,
      );
    for (const r of openRequests ?? [])
      lines.push(`- OPEN PAYMENT REQUEST from ${((r.conversations as unknown as { providers: { display_name: string } })?.providers)?.display_name}: ${r.body}, ${fmtMoney(Number(r.amount), profile.currency)}`);

    lines.push("", "NEXT 10 DAYS OF VISITS:");
    if (!visits.length) lines.push("- none");
    for (const v of visits.slice(0, 25))
      lines.push(
        `- visit ${v.id}: ${fmtShort(v.scheduled_at, tz)}, ${v.services?.name} with ${v.providers?.display_name}, ${fmtMoney(Number(v.price), profile.currency)}, status ${v.status}${v.status === "awaiting" && !v.client_response ? " (WAITING FOR THE CLIENT'S ANSWER)" : ""}${v.provider_response === "cancel" ? ` (provider cancelled: ${v.cancel_reason})` : ""}, starts in ${Math.round((new Date(v.scheduled_at).getTime() - now.getTime()) / 3_600_000)}h`,
      );

    lines.push(
      "",
      `BUDGET ${monthLabel(month)}: forecast ${fmtMoney(forecast.total, profile.currency)}, suggested cap ${fmtMoney(forecast.cap, profile.currency)}; ` +
        (budget?.status === "approved"
          ? `APPROVED cap ${fmtMoney(Number(budget.cap), profile.currency)} (${budget.approval_mode === "paypal_sandbox" ? "via PayPal" : "simulated"}), used ${fmtMoney(spent, profile.currency)}, left ${fmtMoney((Number(budget.cap) - spent), profile.currency)}.`
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
      lines.push(`Offers: ${(services ?? []).map((s) => `${(s.services as unknown as { name: string })?.name} ${fmtMoney(Number(s.price), profile.currency)}`).join(", ")}`);
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
