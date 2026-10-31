// Shared operations used by the UI (server actions) and by the AI assistant's tools.
// Every function runs as the signed-in user, so Supabase row level security applies.

import type { SupabaseClient } from "@supabase/supabase-js";
import { CADENCES, cadenceLabel, defaultWeekdays } from "./cadence";
import { advance, completeVisit, ensureVisits, forecastMonth, log, nowFor, releaseHold, VISIT_SELECT, type VisitRow } from "./engine";
import type { Profile } from "./supabase/server";
import { dayKey, fmtShort, monthLabel, parseLocalInput } from "./time";

type Actor = "user" | "assistant";

export async function searchProviders(
  supabase: SupabaseClient,
  profile: Profile,
  opts: { service?: string | null; maxPrice?: number | null; minRating?: number | null; radiusKm?: number | null; limit?: number },
) {
  if (profile.lat == null || profile.lng == null) return { error: "Location not set" as const, results: [] };
  const { data, error } = await supabase.rpc("providers_near", {
    p_lat: profile.lat,
    p_lng: profile.lng,
    p_service: opts.service ?? null,
    p_radius_km: opts.radiusKm ?? 15,
  });
  if (error) return { error: error.message, results: [] };
  let rows = (data ?? []) as NearRow[];
  if (opts.maxPrice != null) rows = rows.filter((r) => Number(r.price) <= opts.maxPrice!);
  if (opts.minRating != null) rows = rows.filter((r) => Number(r.rating) >= opts.minRating!);
  return { error: null, results: rows.slice(0, opts.limit ?? 50) };
}

export type NearRow = {
  provider_id: string;
  display_name: string;
  headline: string;
  avatar_hue: number;
  rating: number;
  review_count: number;
  years_experience: number;
  languages: string[];
  responds_within_hours: number;
  verified: boolean;
  service_id: string;
  service_name: string;
  price: number;
  distance_km: number;
};

export async function createPlan(
  supabase: SupabaseClient,
  profile: Profile,
  input: { providerId: string; serviceId: string; cadence: string; weekdays?: number[]; time?: string; notes?: string },
  actor: Actor,
) {
  if (!(input.cadence in CADENCES)) return { error: `Unknown cadence ${input.cadence}` };
  const { data: ps, error: psErr } = await supabase
    .from("provider_services")
    .select("price, providers(display_name), services(name)")
    .eq("provider_id", input.providerId)
    .eq("service_id", input.serviceId)
    .maybeSingle();
  if (psErr || !ps) return { error: "That provider does not offer this service." };

  const weekdays = input.weekdays?.length ? input.weekdays : defaultWeekdays(input.cadence);
  const now = nowFor(profile);
  const { data: plan, error } = await supabase
    .from("plans")
    .insert({
      client_id: profile.id,
      provider_id: input.providerId,
      service_id: input.serviceId,
      cadence: input.cadence,
      weekdays,
      time_of_day: input.time || "10:00",
      price: ps.price,
      start_date: dayKey(now, profile.timezone),
      notes: input.notes ?? "",
      created_by: actor,
    })
    .select()
    .single();
  if (error) return { error: error.message };

  const provider = (ps.providers as unknown as { display_name: string })?.display_name;
  const service = (ps.services as unknown as { name: string })?.name;
  await log(supabase, profile.id, actor, `Added ${service} with ${provider}, ${cadenceLabel(input.cadence, weekdays)}`, {
    plan: plan.id,
  });
  await ensureVisits(supabase, profile);
  await advance(supabase, profile);
  return { plan, summary: `${service} with ${provider}, ${cadenceLabel(input.cadence, weekdays)} at ${(input.time || "10:00").slice(0, 5)}, ${profile.currency} ${Number(ps.price).toFixed(2)} a visit` };
}

export async function setPlanStatus(supabase: SupabaseClient, profile: Profile, planId: string, status: "active" | "paused" | "ended", actor: Actor) {
  const { data: plan } = await supabase.from("plans").update({ status }).eq("id", planId).select("*, services(name)").single();
  if (!plan) return { error: "Plan not found" };
  if (status !== "active") {
    // Drop future visits that have not been confirmed yet.
    await supabase
      .from("visits")
      .update({ status: "cancelled" })
      .eq("plan_id", planId)
      .in("status", ["scheduled", "awaiting"]);
  }
  await log(supabase, profile.id, actor, `${status === "active" ? "Resumed" : status === "paused" ? "Paused" : "Ended"} ${plan.services?.name}`, { plan: planId });
  if (status === "active") await ensureVisits(supabase, profile);
  return { ok: true };
}

async function getVisit(supabase: SupabaseClient, visitId: string) {
  const { data } = await supabase.from("visits").select(VISIT_SELECT).eq("id", visitId).single();
  return data as VisitRow | null;
}

/** The client's answer to a day-before check (or any upcoming visit). */
export async function clientRespond(
  supabase: SupabaseClient,
  profile: Profile,
  input: { visitId: string; action: "proceed" | "skip" | "reschedule"; newTime?: string },
  actor: Actor,
) {
  const v = await getVisit(supabase, input.visitId);
  if (!v) return { error: "Visit not found" };
  const name = v.services?.name;

  if (input.action === "proceed") {
    await supabase.from("visits").update({ client_response: "proceed" }).eq("id", v.id);
    await log(supabase, profile.id, actor, `Confirmed ${name}`, { visit: v.id });
  } else if (input.action === "skip") {
    await releaseHold(supabase, profile, v);
    await supabase.from("visits").update({ status: "skipped", client_response: "skip" }).eq("id", v.id);
    await log(supabase, profile.id, actor, `Skipped ${name}, nothing charged`, { visit: v.id });
  } else {
    if (!input.newTime) return { error: "A new time is needed to reschedule." };
    const at = parseLocalInput(input.newTime, profile.timezone);
    if (isNaN(+at)) return { error: "That time could not be read." };
    if (at <= nowFor(profile)) return { error: "The new time must be in the future." };
    await releaseHold(supabase, profile, v);
    // The original slot stays as a record; the moved visit is a new one-off.
    await supabase.from("visits").update({ status: "cancelled", client_response: "reschedule" }).eq("id", v.id);
    const { data: moved } = await supabase
      .from("visits")
      .insert({
        plan_id: null,
        client_id: v.client_id,
        provider_id: v.provider_id,
        service_id: v.service_id,
        scheduled_at: at.toISOString(),
        duration_minutes: v.duration_minutes,
        price: v.price,
        client_response: "proceed",
        provider_response: v.providers?.is_demo ? "proceed" : null,
        rescheduled_from: v.scheduled_at,
      })
      .select("id")
      .single();
    await log(
      supabase,
      profile.id,
      actor,
      `Moved ${name} to ${fmtShort(at, profile.timezone)}`,
      { visit: moved?.id, from: v.scheduled_at },
    );
  }
  await advance(supabase, profile);
  return { ok: true };
}

/** Provider side. For demo providers, the client may act for them (the judge's provider view). */
export async function providerRespond(
  supabase: SupabaseClient,
  profile: Profile,
  input: { visitId: string; action: "proceed" | "propose" | "complete"; newTime?: string },
  actor: Actor,
) {
  const v = await getVisit(supabase, input.visitId);
  if (!v) return { error: "Visit not found" };
  const who = v.providers?.display_name;
  if (input.action === "proceed") {
    await supabase.from("visits").update({ provider_response: "proceed" }).eq("id", v.id);
    await log(supabase, profile.id, actor, `${who} confirmed ${v.services?.name}`, { visit: v.id });
  } else if (input.action === "propose") {
    if (!input.newTime) return { error: "A new time is needed." };
    const at = parseLocalInput(input.newTime, profile.timezone);
    if (isNaN(+at)) return { error: "That time could not be read." };
    await supabase.from("visits").update({ provider_response: "reschedule" }).eq("id", v.id);
    await supabase.from("notifications").insert({
      user_id: v.client_id,
      visit_id: v.id,
      kind: "reschedule_request",
      title: `${who} asks to move ${v.services?.name}`,
      body: `Proposed new time: ${fmtShort(at, profile.timezone)}|${at.toISOString()}`,
    });
    await log(supabase, profile.id, actor, `${who} proposed a new time for ${v.services?.name}`, { visit: v.id, proposed: at.toISOString() });
  } else {
    if (v.status !== "confirmed") return { error: "Only confirmed visits can be marked done." };
    if (profile.role === "provider") {
      // The client's side settles the payment the next time their diary updates.
      await supabase.from("visits").update({ provider_response: "done" }).eq("id", v.id);
      await supabase.from("notifications").insert({
        user_id: v.client_id,
        visit_id: v.id,
        kind: "info",
        title: `${who} marked ${v.services?.name} as done`,
        body: "Payment will be released automatically.",
      });
    } else {
      await completeVisit(supabase, profile, v, "user");
    }
  }
  if (profile.role === "client") await advance(supabase, profile);
  return { ok: true };
}

export async function approveBudget(
  supabase: SupabaseClient,
  profile: Profile,
  input: { month: string; cap?: number; mode: "paypal_sandbox" | "simulated" },
  actor: Actor,
) {
  const f = await forecastMonth(supabase, profile, input.month);
  const cap = input.cap ?? f.cap;
  const { error } = await supabase.from("budgets").upsert(
    {
      client_id: profile.id,
      month: input.month,
      forecast: f.total,
      cap,
      status: "approved",
      approved_at: new Date().toISOString(),
      approval_mode: input.mode,
    },
    { onConflict: "client_id,month" },
  );
  if (error) return { error: error.message };
  await log(supabase, profile.id, actor, `Approved a ${profile.currency} ${cap.toFixed(2)} budget for ${monthLabel(input.month)}`, {
    mode: input.mode,
  });
  await advance(supabase, profile);
  return { ok: true, cap };
}

export async function upcomingVisits(supabase: SupabaseClient, profile: Profile, days = 14) {
  const now = nowFor(profile);
  const { data } = await supabase
    .from("visits")
    .select(VISIT_SELECT)
    .eq("client_id", profile.id)
    .gte("scheduled_at", new Date(now.getTime() - 6 * 3_600_000).toISOString())
    .lte("scheduled_at", new Date(now.getTime() + days * 86_400_000).toISOString())
    .not("status", "in", "(cancelled)")
    .order("scheduled_at");
  return (data ?? []) as VisitRow[];
}
