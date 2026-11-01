"use server";

import { anthropic } from "@ai-sdk/anthropic";
import { generateObject, generateText } from "ai";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import * as core from "@/lib/actions-core";
import { CADENCE_KEYS, defaultWeekdays, type CadenceKey } from "@/lib/cadence";
import { attendanceFor } from "@/lib/attendance";
import { log, nowFor } from "@/lib/engine";
import { rankProviders, targets, type Match } from "@/lib/match";
import { getSession } from "@/lib/supabase/server";
import { fmt, isValidTz } from "@/lib/time";

const model = () => anthropic(process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5");

async function session() {
  const s = await getSession();
  if (!s.user || !s.profile) redirect("/login");
  return { supabase: s.supabase, profile: s.profile! };
}

export async function saveStartLocation(lat: number, lng: number, city: string, timezone: string) {
  const { supabase, profile } = await session();
  await supabase
    .from("profiles")
    .update({ lat, lng, city, timezone: isValidTz(timezone) ? timezone : profile.timezone })
    .eq("id", profile.id);
  await log(supabase, profile.id, "user", `Set location to ${city}`);
  return { ok: true };
}

/** A short, personal hello from the assistant. Falls back to a fixed text without an API key. */
export async function welcomeAction() {
  const { profile } = await session();
  const first = profile.full_name.split(" ")[0] || "there";
  const local = fmt(new Date(), profile.timezone, { weekday: "long", hour: "2-digit", minute: "2-digit" });
  const fallback = `Hi ${first}, I'm your HaloDiary assistant. Tell me which services keep your home and family running, and the monthly budget you're happy with. I'll find the most reliable people near ${profile.city ?? "you"}, put every visit on one diary, check with both of you the day before, and pay through PayPal inside your budget. You won't have to chase anyone on WhatsApp again.`;
  if (!process.env.ANTHROPIC_API_KEY) return { text: fallback, ai: false };
  try {
    const { text } = await generateText({
      abortSignal: AbortSignal.timeout(20_000),
      model: model(),
      instructions:
        "You are the HaloDiary assistant greeting a new user. HaloDiary runs a household's recurring services (cleaning, tutoring, dog walking, pool care, car servicing and more) like subscriptions: one diary, a check with both sides the day before each visit, signed agreements, in-app chat, and PayPal payments inside a monthly budget approved once. Write 3 short sentences, warm and concrete, in plain words. Mention the time it saves. Never use em dashes. No markdown, no emojis, no lists.",
      prompt: `Their first name is ${first}. They are in ${profile.city ?? "an unknown city"}; it is ${local} there. Greet them and tell them what happens next: pick services, set a budget, then meet the best matches nearby.`,
    });
    return { text: text.replace(/—/g, ","), ai: true };
  } catch {
    return { text: fallback, ai: false };
  }
}

const routineSchema = z.object({
  services: z.array(z.object({ id: z.string(), cadence: z.enum(CADENCE_KEYS as [string, ...string[]]) })),
  monthly_budget: z.number().positive().nullable(),
});

/** Turn a sentence like "cleaning twice a week and a dog walker at weekends, about 400 a month" into choices. */
export async function parseRoutineAction(text: string, catalog: { id: string; name: string; default_cadence: string }[]) {
  await session();
  const clean = text.trim().slice(0, 600);
  if (!clean) return { services: [], monthly_budget: null };
  const ids = new Set(catalog.map((c) => c.id));
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const { object } = await generateObject({
        abortSignal: AbortSignal.timeout(20_000),
        model: model(),
        schema: routineSchema,
        instructions: `Map what the user needs to HaloDiary's service catalogue. Catalogue (id: name, usual cadence): ${catalog.map((c) => `${c.id}: ${c.name}, ${c.default_cadence}`).join("; ")}. Cadences: ${CADENCE_KEYS.join(", ")}. Use the usual cadence when they don't say. Only use ids from the catalogue. monthly_budget is the number they mention for a month, else null.`,
        prompt: clean,
      });
      return { services: object.services.filter((s) => ids.has(s.id)), monthly_budget: object.monthly_budget };
    } catch {
      /* fall through to keywords */
    }
  }
  const lower = clean.toLowerCase();
  const services = catalog
    .filter((c) => lower.includes(c.name.toLowerCase().split(" ")[0]) || lower.includes(c.id.replace("-", " ")))
    .map((c) => ({ id: c.id, cadence: c.default_cadence }));
  const budget = lower.match(/(\d{2,5})\s*(€|eur|euros|a month|per month|monthly)/);
  return { services, monthly_budget: budget ? Number(budget[1]) : null };
}

/** Ranked matches for each chosen service, using the budget to set a fair target price. */
export async function matchesAction(choices: { id: string; cadence: string; typical_price: number }[], budget: number) {
  const { supabase, profile } = await session();
  const t = targets(budget, choices);
  const out: Record<string, Match[]> = {};
  for (const c of choices) out[c.id] = (await rankProviders(supabase, profile, c.id, t[c.id] ?? null, profile.currency)).slice(0, 12);
  return { matches: out, targets: t };
}

const TIMES: Record<string, string> = { tutoring: "17:00", lessons: "18:00", "dog-walking": "09:00", babysitting: "19:00", "personal-trainer": "08:00" };

export async function finishStartAction(input: {
  interests: string[];
  budget: number;
  picks: { providerId: string; serviceId: string; cadence: string }[];
  agree: boolean;
}) {
  const { supabase, profile } = await session();
  if (input.picks.length && !input.agree) return { error: "Please agree to the service agreements first." };
  await supabase
    .from("profiles")
    .update({ interests: input.interests.slice(0, 22), monthly_budget: input.budget > 0 ? input.budget : null, onboarded_at: new Date().toISOString() })
    .eq("id", profile.id);
  const added: string[] = [];
  for (const p of input.picks) {
    const cadence = (CADENCE_KEYS as string[]).includes(p.cadence) ? p.cadence : "weekly";
    const res = await core.createPlan(
      supabase,
      profile,
      { providerId: p.providerId, serviceId: p.serviceId, cadence, weekdays: defaultWeekdays(cadence as CadenceKey), time: TIMES[p.serviceId] ?? "10:00" },
      "user",
    );
    if ("error" in res && res.error) return { error: res.error };
    if ("summary" in res && res.summary) added.push(res.summary);
  }
  await log(supabase, profile.id, "user", `Finished setup: ${added.length} services, ${profile.currency} ${input.budget} a month`, { interests: input.interests });
  revalidatePath("/app", "layout");
  if (!added.length) redirect("/app/discover");
  redirect("/app/budget?welcome=1");
}

export async function skipStartAction() {
  const { supabase, profile } = await session();
  await supabase.from("profiles").update({ onboarded_at: new Date().toISOString() }).eq("id", profile.id);
  redirect("/app/discover");
}


/** Everything the profile sheet in the matching step shows, without leaving setup. */
export async function providerPreviewAction(providerId: string, serviceId: string) {
  const { supabase, profile } = await session();
  const [{ data: p }, { data: offers }, { data: reviews }, attendance] = await Promise.all([
    supabase
      .from("providers")
      .select("display_name, headline, bio, avatar_hue, photo_url, years_experience, languages, responds_within_hours, verified, insured, certifications, team, team_size, socials, website, is_demo, service_radius_km, rating, review_count")
      .eq("id", providerId)
      .maybeSingle(),
    supabase.from("provider_services").select("price, services(id, name)").eq("provider_id", providerId),
    supabase.from("reviews").select("author_name, rating, body").eq("provider_id", providerId).order("created_at", { ascending: false }).limit(4),
    attendanceFor(supabase, providerId, nowFor(profile).toISOString()),
  ]);
  if (!p) return null;
  return {
    ...p,
    serviceId,
    offers: (offers ?? []).map((o) => ({ name: (o.services as unknown as { name: string })?.name, price: Number(o.price) })),
    reviews: reviews ?? [],
    attendance: {
      total: attendance.total,
      rendered: attendance.rendered,
      alternative: attendance.alternative,
      cancelled: attendance.cancelled,
      recentCancellations: attendance.items.filter((i) => i.outcome === "cancelled").slice(0, 3).map((i) => i.note),
    },
  };
}
