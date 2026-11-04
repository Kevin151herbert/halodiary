// Shared operations used by the UI (server actions) and by the AI assistant's tools.
// Every function runs as the signed-in user, so Supabase row level security applies.

import type { SupabaseClient } from "@supabase/supabase-js";
import { CADENCES, cadenceLabel, defaultWeekdays } from "./cadence";
import {
  clientChangeCost,
  defaultTermsFor,
  governingContract,
  planIdForVisit,
  providerChangeCredit,
  reminderFor,
  sanitizeTerms,
  type Contract,
  type Terms,
} from "./contract";
import { fingerprint } from "./contract-hash";
import { advance, chargeFee, completeVisit, ensureVisits, forecastMonth, log, notifyProvider, nowFor, releaseHold, VISIT_SELECT, type VisitRow } from "./engine";
import type { Profile } from "./supabase/server";
import { dayKey, fmtShort, monthKey, monthLabel, monthRange, parseLocalInput, fmtMoney } from "./time";

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
  return { error: null, results: opts.limit ? rows.slice(0, opts.limit) : rows };
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
  input: { providerId: string; serviceId: string; cadence: string; weekdays?: number[]; time?: string; notes?: string; terms?: Partial<Terms> },
  actor: Actor,
) {
  if (!(input.cadence in CADENCES)) return { error: `Unknown cadence ${input.cadence}` };
  const { data: ps, error: psErr } = await supabase
    .from("provider_services")
    .select("price, providers(display_name, is_demo, profile_id), services(name)")
    .eq("provider_id", input.providerId)
    .eq("service_id", input.serviceId)
    .maybeSingle();
  if (psErr || !ps) return { error: "That provider does not offer this service." };

  const weekdays = input.weekdays?.length ? input.weekdays : defaultWeekdays(input.cadence);
  const now = nowFor(profile);
  const terms = sanitizeTerms(input.terms, defaultTermsFor(input.serviceId));
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
      check_hours: reminderFor(terms),
    })
    .select()
    .single();
  if (error) return { error: error.message };

  const prov = ps.providers as unknown as { display_name: string; is_demo: boolean; profile_id: string | null };
  const provider = prov?.display_name;
  const service = (ps.services as unknown as { name: string })?.name;

  // Version 1 of the agreement: the client signs by adding the service. Demo providers sign at once.
  const signedAt = new Date().toISOString();
  const { data: contract, error: cErr } = await supabase
    .from("contracts")
    .insert({
      plan_id: plan.id,
      client_id: profile.id,
      provider_id: input.providerId,
      version: 1,
      status: prov?.is_demo ? "active" : "pending",
      terms,
      terms_hash: fingerprint({ planId: plan.id, clientId: profile.id, providerId: input.providerId, version: 1, price: Number(ps.price), terms }),
      proposed_by: "client",
      change_note: "Original agreement",
      client_signed_at: signedAt,
      provider_signed_at: prov?.is_demo ? signedAt : null,
    })
    .select("id")
    .single();
  if (cErr) {
    await supabase.from("plans").delete().eq("id", plan.id);
    return { error: cErr.message };
  }
  await log(supabase, profile.id, actor, `Added ${service} with ${provider}, ${cadenceLabel(input.cadence, weekdays)}`, {
    plan: plan.id,
  });
  await log(supabase, profile.id, actor, `Signed the service agreement with ${provider}`, { contract: contract.id });
  if (prov?.is_demo) {
    await log(supabase, profile.id, "system", `${provider} signed the service agreement`, { contract: contract.id });
  } else if (prov?.profile_id) {
    await supabase.from("notifications").insert({
      user_id: prov.profile_id,
      kind: "agreement",
      title: `${profile.full_name || "A client"} wants ${service}, ${cadenceLabel(input.cadence, weekdays)}`,
      body: "Review and sign the service agreement to start.",
    });
  }
  await ensureVisits(supabase, profile);
  await advance(supabase, profile);
  return { plan, contractId: contract.id, summary: `${service} with ${provider}, ${cadenceLabel(input.cadence, weekdays)} at ${(input.time || "10:00").slice(0, 5)}, ${fmtMoney(Number(ps.price), profile.currency)} a visit` };
}

export async function setPlanStatus(supabase: SupabaseClient, profile: Profile, planId: string, status: "active" | "paused" | "ended", actor: Actor) {
  const { data: plan } = await supabase
    .from("plans")
    .update({ status })
    .eq("id", planId)
    .select("*, services(name), providers(display_name, is_demo, profile_id)")
    .single();
  if (!plan) return { error: "Plan not found" };
  const contract = await governingContract(supabase, planId);
  let kept = 0;
  if (status !== "active") {
    // Visits inside the agreement's notice period still go ahead; later ones are cancelled.
    const terms = contract?.status === "active" ? contract.terms : null;
    const keepHours = !terms ? 0 : status === "ended" ? terms.termination_notice_days * 24 : terms.cancellation_notice_hours;
    const keepUntil = new Date(nowFor(profile).getTime() + keepHours * 3_600_000).toISOString();
    await supabase
      .from("visits")
      .update({ status: "cancelled" })
      .eq("plan_id", planId)
      .in("status", ["scheduled", "awaiting"])
      .gt("scheduled_at", keepUntil);
    const { count } = await supabase
      .from("visits")
      .select("id", { count: "exact", head: true })
      .eq("plan_id", planId)
      .in("status", ["scheduled", "awaiting", "confirmed"]);
    kept = count ?? 0;
    if (status === "ended" && contract) await supabase.from("contracts").update({ status: "terminated" }).eq("id", contract.id);
    if (status === "ended" && plan.paypal_subscription_id && plan.billing === "subscription") {
      const { cancelSubscription } = await import("./paypal");
      await cancelSubscription(plan.paypal_subscription_id, "Service ended in HaloDiary").catch(() => undefined);
      await supabase.from("plans").update({ billing: "per_visit", subscription_status: "CANCELLED" }).eq("id", planId);
    }
  }
  const verb = status === "active" ? "Resumed" : status === "paused" ? "Paused" : "Ended";
  await log(supabase, profile.id, actor, `${verb} ${plan.services?.name}${kept ? `; ${kept} visit${kept === 1 ? "" : "s"} inside the notice period still go ahead` : ""}`, {
    plan: planId,
  });
  const to = plan.providers?.is_demo ? null : plan.providers?.profile_id;
  if (to) {
    await supabase.from("notifications").insert({
      user_id: to,
      kind: "agreement",
      title: `${profile.full_name || "Your client"} ${verb.toLowerCase()} ${plan.services?.name}`,
      body: kept ? `${kept} visit${kept === 1 ? "" : "s"} inside the notice period still go ahead.` : "",
    });
  }
  if (status === "active") await ensureVisits(supabase, profile);
  return { ok: true, kept };
}

export async function getVisit(supabase: SupabaseClient, visitId: string) {
  const { data } = await supabase.from("visits").select(VISIT_SELECT).eq("id", visitId).single();
  return data as VisitRow | null;
}

/** What skipping or moving this visit would cost under its agreement right now. */
export async function changeCost(supabase: SupabaseClient, profile: Profile, v: VisitRow, kind: "skip" | "reschedule") {
  const contract = await governingContract(supabase, await planIdForVisit(supabase, v));
  if (!contract || contract.status !== "active") return { late: false, fee: 0, reason: "" };
  const hoursUntil = (new Date(v.scheduled_at).getTime() - nowFor(profile).getTime()) / 3_600_000;
  let lateMovesThisMonth = 0;
  if (kind === "reschedule") {
    const { start, end } = monthRange(monthKey(new Date(v.scheduled_at), profile.timezone), profile.timezone);
    const { count } = await supabase
      .from("visits")
      .select("id", { count: "exact", head: true })
      .eq("client_id", profile.id)
      .eq("client_response", "reschedule")
      .eq("late_change", true)
      .gte("scheduled_at", start.toISOString())
      .lt("scheduled_at", end.toISOString());
    lateMovesThisMonth = count ?? 0;
  }
  return clientChangeCost(contract.terms, { price: Number(v.price), hoursUntil, kind, lateMovesThisMonth });
}

/** What dragging a visit to a new time would cost, shown before anything changes. */
export async function movePreview(supabase: SupabaseClient, profile: Profile, visitId: string) {
  const v = await getVisit(supabase, visitId);
  if (!v) return { error: "Visit not found" };
  if (!["scheduled", "awaiting", "confirmed"].includes(v.status)) return { error: "This visit can no longer be moved." };
  if (profile.role === "provider") {
    const contract = await governingContract(supabase, await planIdForVisit(supabase, v));
    const hoursUntil = (new Date(v.scheduled_at).getTime() - nowFor(profile).getTime()) / 3_600_000;
    const c = contract?.status === "active" ? providerChangeCredit(contract.terms, { price: Number(v.price), hoursUntil, kind: "move" }) : { late: false, credit: 0, reason: "" };
    return { ok: true, side: "provider" as const, late: c.late, amount: c.credit, reason: c.reason, service: v.services?.name ?? "Visit" };
  }
  const c = await changeCost(supabase, profile, v, "reschedule");
  return { ok: true, side: "client" as const, late: c.late, amount: c.fee, reason: c.reason, service: v.services?.name ?? "Visit" };
}

/** The client's answer to a day-before check (or any upcoming visit). */
export async function clientRespond(
  supabase: SupabaseClient,
  profile: Profile,
  input: { visitId: string; action: "proceed" | "skip" | "reschedule"; newTime?: string; acceptsProposal?: boolean },
  actor: Actor,
) {
  const v = await getVisit(supabase, input.visitId);
  if (!v) return { error: "Visit not found" };
  const name = v.services?.name;
  const cost = input.action === "proceed" || input.acceptsProposal ? null : await changeCost(supabase, profile, v, input.action);

  if (input.action === "proceed") {
    await supabase.from("visits").update({ client_response: "proceed" }).eq("id", v.id);
    await log(supabase, profile.id, actor, `Confirmed ${name}`, { visit: v.id });
  } else if (input.action === "skip") {
    await releaseHold(supabase, profile, v);
    await supabase.from("visits").update({ status: "skipped", client_response: "skip", late_change: Boolean(cost?.late) }).eq("id", v.id);
    if (cost?.fee) await chargeFee(supabase, profile, v, cost.fee, cost.reason);
    await log(
      supabase,
      profile.id,
      actor,
      `Skipped ${name}, ${cost?.fee ? `${fmtMoney(cost.fee, profile.currency)} late fee under the agreement` : "nothing charged"}`,
      { visit: v.id },
    );
    await notifyProvider(supabase, v, "client_change", `${profile.full_name || "Your client"} skipped ${name}, ${fmtShort(v.scheduled_at, profile.timezone)}`, cost?.fee ? `Late change: you receive the agreed fee.` : "");
  } else {
    if (!input.newTime) return { error: "A new time is needed to reschedule." };
    const at = parseLocalInput(input.newTime, profile.timezone);
    if (isNaN(+at)) return { error: "That time could not be read." };
    if (at <= nowFor(profile)) return { error: "The new time must be in the future." };
    await releaseHold(supabase, profile, v);
    // The original slot stays as a record; the moved visit is a new one-off.
    await supabase.from("visits").update({ status: "cancelled", client_response: "reschedule", late_change: Boolean(cost?.late) }).eq("id", v.id);
    if (cost?.fee) await chargeFee(supabase, profile, v, cost.fee, cost.reason);
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
        provider_response: v.providers?.is_demo || input.acceptsProposal ? "proceed" : null,
        rescheduled_from: v.scheduled_at,
        moved_by: input.acceptsProposal ? "provider" : "client",
      })
      .select("id")
      .single();
    await log(
      supabase,
      profile.id,
      actor,
      `Moved ${name} to ${fmtShort(at, profile.timezone)}${cost?.fee ? `, ${fmtMoney(cost.fee, profile.currency)} late fee under the agreement` : ""}`,
      { visit: moved?.id, from: v.scheduled_at },
    );
    await notifyProvider(
      supabase,
      v,
      "client_change",
      `${profile.full_name || "Your client"} moved ${name} to ${fmtShort(at, profile.timezone)}`,
      `It was booked for ${fmtShort(v.scheduled_at, profile.timezone)}.`,
    );
  }
  await advance(supabase, profile);
  return { ok: true };
}

/** Provider side. For demo providers, the client may act for them (the judge's provider view). */
export async function providerRespond(
  supabase: SupabaseClient,
  profile: Profile,
  input: { visitId: string; action: "proceed" | "propose" | "complete" | "cancel"; newTime?: string; reason?: string },
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
    await supabase
      .from("visits")
      .update({ provider_response: "reschedule", provider_changed_at: nowFor(profile).toISOString(), credit_assessed: false })
      .eq("id", v.id);
    await supabase.from("notifications").insert({
      user_id: v.client_id,
      visit_id: v.id,
      kind: "reschedule_request",
      title: `${who} asks to move ${v.services?.name}`,
      body: `Proposed new time: ${fmtShort(at, profile.timezone)}|${at.toISOString()}`,
    });
    await log(supabase, profile.id, actor, `${who} proposed a new time for ${v.services?.name}`, { visit: v.id, proposed: at.toISOString() });
  } else if (input.action === "cancel") {
    const reason = input.reason?.trim();
    if (!reason) return { error: "A reason is needed to cancel; the client sees it." };
    if (!["scheduled", "awaiting", "confirmed"].includes(v.status)) return { error: "This visit can no longer be cancelled." };
    // The client's side releases any hold and applies the agreement the next time their diary updates.
    await supabase
      .from("visits")
      .update({ provider_response: "cancel", cancel_reason: reason.slice(0, 200), provider_changed_at: nowFor(profile).toISOString(), credit_assessed: false })
      .eq("id", v.id);
    await log(supabase, profile.id, actor, `${who} cancelled ${v.services?.name}: ${reason}`, { visit: v.id });
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
  await log(supabase, profile.id, actor, `Approved a ${fmtMoney(cap, profile.currency)} budget for ${monthLabel(input.month)}`, {
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

// ---------- Service agreements ----------

const CONTRACT_SELECT = "*, plans(cadence, weekdays, time_of_day, price, service_id, services(name)), providers(display_name, is_demo, profile_id, avatar_hue)";

export type ContractRow = Contract & {
  plans: { cadence: string; weekdays: number[]; time_of_day: string; price: number; service_id: string; services: { name: string } } | null;
  providers: { display_name: string; is_demo: boolean; profile_id: string | null; avatar_hue: number } | null;
};

export async function getContract(supabase: SupabaseClient, id: string) {
  const { data } = await supabase.from("contracts").select(CONTRACT_SELECT).eq("id", id).maybeSingle();
  return data as ContractRow | null;
}

/** Make a signed version the one in force: earlier active versions become history. */
async function activate(supabase: SupabaseClient, c: ContractRow) {
  await supabase.from("contracts").update({ status: "superseded" }).eq("plan_id", c.plan_id).eq("status", "active").neq("id", c.id);
  await supabase.from("contracts").update({ status: "active" }).eq("id", c.id);
  // The reminder timing lives on the plan so the scheduler can read it cheaply (client side only).
  await supabase.from("plans").update({ check_hours: reminderFor(c.terms) }).eq("id", c.plan_id);
}

/** Sign a pending agreement as whichever party the signed-in user is. */
export async function signAgreement(supabase: SupabaseClient, profile: Profile, contractId: string, actor: Actor) {
  const c = await getContract(supabase, contractId);
  if (!c || c.status !== "pending") return { error: "There is no pending agreement to sign." };
  const asProvider = profile.role === "provider";
  const at = new Date().toISOString();
  const patch = asProvider ? { provider_signed_at: at } : { client_signed_at: at };
  const { error } = await supabase.from("contracts").update(patch).eq("id", c.id);
  if (error) return { error: error.message };
  const both = asProvider ? Boolean(c.client_signed_at) : Boolean(c.provider_signed_at);
  if (both) await activate(supabase, c);
  const service = c.plans?.services?.name;
  await log(supabase, profile.id, actor, `Signed version ${c.version} of the ${service} agreement${both ? "; it is now in force" : ""}`, { contract: c.id });
  if (asProvider) {
    await supabase.from("notifications").insert({
      user_id: c.client_id,
      kind: "agreement",
      title: `${c.providers?.display_name} signed the ${service} agreement`,
      body: both ? `Version ${c.version} is now in force.` : "",
    });
  }
  return { ok: true, active: both };
}

export async function declineAgreement(supabase: SupabaseClient, profile: Profile, contractId: string, actor: Actor) {
  const c = await getContract(supabase, contractId);
  if (!c || c.status !== "pending") return { error: "There is no pending agreement to decline." };
  await supabase.from("contracts").update({ status: "declined" }).eq("id", c.id);
  const service = c.plans?.services?.name;
  await log(supabase, profile.id, actor, `Declined version ${c.version} of the ${service} agreement`, { contract: c.id });
  if (profile.role === "provider") {
    await supabase.from("notifications").insert({
      user_id: c.client_id,
      kind: "agreement",
      title: `${c.providers?.display_name} declined the ${service} agreement`,
      body: c.version === 1 ? "The service can't start on these terms. Propose different terms or choose another provider." : "The current version stays in force.",
    });
  }
  return { ok: true };
}

/** Propose new terms. They take effect only once the other party signs (demo providers accept straight away). */
export async function proposeAmendment(
  supabase: SupabaseClient,
  profile: Profile,
  input: { planId: string; terms: Partial<Terms>; note?: string },
  actor: Actor,
) {
  const current = await governingContract(supabase, input.planId);
  if (!current) return { error: "That service has no agreement yet." };
  const c = await getContract(supabase, current.id);
  if (!c) return { error: "Agreement not found" };
  const terms = sanitizeTerms(input.terms, current.terms);
  if (JSON.stringify(terms) === JSON.stringify(current.terms)) return { error: "Nothing changed in the terms." };
  const { data: latest } = await supabase.from("contracts").select("version").eq("plan_id", input.planId).order("version", { ascending: false }).limit(1);
  const version = (latest?.[0]?.version ?? current.version) + 1;
  // A newer proposal replaces any older one still waiting.
  await supabase.from("contracts").update({ status: "declined" }).eq("plan_id", input.planId).eq("status", "pending");
  const asProvider = profile.role === "provider";
  const at = new Date().toISOString();
  const autoAccept = !asProvider && c.providers?.is_demo;
  const { data: row, error } = await supabase
    .from("contracts")
    .insert({
      plan_id: input.planId,
      client_id: c.client_id,
      provider_id: c.provider_id,
      version,
      status: "pending",
      terms,
      terms_hash: fingerprint({ planId: input.planId, clientId: c.client_id, providerId: c.provider_id, version, price: Number(c.plans?.price ?? 0), terms }),
      proposed_by: asProvider ? "provider" : "client",
      change_note: (input.note ?? "").slice(0, 200),
      client_signed_at: asProvider ? null : at,
      provider_signed_at: asProvider || autoAccept ? at : null,
    })
    .select(CONTRACT_SELECT)
    .single();
  if (error) return { error: error.message };
  const service = c.plans?.services?.name;
  await log(supabase, profile.id, actor, `Proposed version ${version} of the ${service} agreement`, { contract: row.id, note: input.note });
  if (autoAccept) {
    await activate(supabase, row as ContractRow);
    await log(supabase, profile.id, "system", `${c.providers?.display_name} signed version ${version}; it is now in force`, { contract: row.id });
  } else if (asProvider) {
    await supabase.from("notifications").insert({
      user_id: c.client_id,
      kind: "agreement",
      title: `${c.providers?.display_name} proposed new terms for ${service}`,
      body: input.note || "Review and sign version " + version + " in Agreements.",
    });
  } else if (c.providers?.profile_id) {
    await supabase.from("notifications").insert({
      user_id: c.providers.profile_id,
      kind: "agreement",
      title: `${profile.full_name || "Your client"} proposed new terms for ${service}`,
      body: input.note || "Review and sign version " + version + ".",
    });
  }
  return { ok: true, contractId: row.id, version, active: Boolean(autoAccept) };
}


