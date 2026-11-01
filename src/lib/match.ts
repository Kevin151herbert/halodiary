// Ranks providers for a client: who is close, affordable, well rated, reliable, and open about themselves.
// The weights are shown to the client, so a match is never a black box.

import type { SupabaseClient } from "@supabase/supabase-js";
import { searchProviders } from "./actions-core";
import { CADENCES, type CadenceKey } from "./cadence";
import { profileCompleteness } from "./match-shared";
import type { Profile } from "./supabase/server";

export const WEIGHTS = { attendance: 0.25, rating: 0.25, distance: 0.2, price: 0.15, profile: 0.15 } as const;
export type Part = keyof typeof WEIGHTS;

export type ProviderDetails = {
  id: string;
  photo_url: string | null;
  bio: string;
  headline: string;
  website: string | null;
  socials: Record<string, string>;
  team: { name: string; role: string }[];
  team_size: number;
  certifications: string;
  insured: boolean;
  verified: boolean;
  languages: string[];
  years_experience: number;
  accepting_clients: boolean;
  is_demo: boolean;
};

export { profileCompleteness };

export type Match = {
  provider_id: string;
  display_name: string;
  headline: string;
  avatar_hue: number;
  photo_url: string | null;
  service_id: string;
  service_name: string;
  price: number;
  rating: number;
  review_count: number;
  distance_km: number;
  attendance: number | null; // null when there is no history yet
  completeness: number;
  score: number; // 0 to 100
  parts: Record<Part, number>;
  reasons: string[];
  details: ProviderDetails;
};

const clamp = (n: number) => Math.max(0, Math.min(1, n));

/** Target price per visit for each service, sharing the monthly budget by typical cost. */
export function targets(budget: number, picks: { id: string; typical_price: number; cadence: string }[]) {
  const cost = picks.map((p) => ({ id: p.id, perMonth: CADENCES[p.cadence as CadenceKey]?.perMonth ?? 1, typical: Number(p.typical_price) }));
  const total = cost.reduce((s, c) => s + c.typical * c.perMonth, 0) || 1;
  return Object.fromEntries(cost.map((c) => [c.id, ((budget * (c.typical * c.perMonth)) / total) / c.perMonth]));
}

export async function rankProviders(
  supabase: SupabaseClient,
  profile: Profile,
  serviceId: string,
  targetPrice: number | null,
  currency: string,
  radiusKm = 15,
): Promise<Match[]> {
  const { results } = await searchProviders(supabase, profile, { service: serviceId, radiusKm });
  if (!results.length) return [];
  const ids = [...new Set(results.map((r) => r.provider_id))];
  const [{ data: details }, { data: records }, { data: visits }] = await Promise.all([
    supabase
      .from("providers")
      .select("id, photo_url, bio, headline, website, socials, team, team_size, certifications, insured, verified, languages, years_experience, accepting_clients, is_demo")
      .in("id", ids),
    supabase.from("service_records").select("provider_id, outcome").in("provider_id", ids).limit(6000),
    supabase.from("visits").select("provider_id, status, provider_response").in("provider_id", ids).in("status", ["completed", "cancelled"]).limit(2000),
  ]);
  const byId = new Map(((details ?? []) as ProviderDetails[]).map((d) => [d.id, d]));
  const tally = new Map<string, { r: number; t: number }>();
  const add = (id: string, rendered: boolean) => {
    const t = tally.get(id) ?? { r: 0, t: 0 };
    t.t += 1;
    if (rendered) t.r += 1;
    tally.set(id, t);
  };
  for (const r of records ?? []) add(r.provider_id, r.outcome === "rendered");
  for (const v of visits ?? []) {
    if (v.provider_response === "cancel" || v.provider_response === "reschedule") add(v.provider_id, false);
    else if (v.status === "completed") add(v.provider_id, true);
  }
  const money = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);

  return results
    .filter((r) => byId.get(r.provider_id)?.accepting_clients !== false)
    .map((r) => {
      const d = byId.get(r.provider_id)!;
      const t = tally.get(r.provider_id);
      const attendance = t && t.t >= 3 ? t.r / t.t : null;
      const comp = profileCompleteness(d);
      const price = Number(r.price);
      const parts: Record<Part, number> = {
        attendance: attendance == null ? 0.6 : clamp((attendance - 0.6) / 0.4),
        rating: clamp((Number(r.rating) - 3.5) / 1.5),
        distance: clamp(1 - r.distance_km / radiusKm),
        price: targetPrice ? (price <= targetPrice ? 1 : clamp(1 - ((price - targetPrice) / targetPrice) * 2)) : 0.7,
        profile: comp.score,
      };
      const score = Math.round((Object.keys(WEIGHTS) as Part[]).reduce((s, k) => s + parts[k] * WEIGHTS[k], 0) * 100);
      const reasons: string[] = [];
      if (attendance != null) reasons.push(`Shows up ${Math.round(attendance * 100)}% of the time`);
      else reasons.push("New, no attendance history yet");
      reasons.push(`${Number(r.rating).toFixed(1)}★ from ${r.review_count} reviews`);
      reasons.push(`${r.distance_km.toFixed(1)} km away`);
      if (targetPrice) reasons.push(price <= targetPrice ? `${money(price)} a visit, inside your budget` : `${money(price)} a visit, ${money(price - targetPrice)} over your target`);
      reasons.push(comp.score >= 0.75 ? "Detailed profile" : comp.score >= 0.5 ? "Good profile" : "Basic profile");
      return {
        provider_id: r.provider_id,
        display_name: r.display_name,
        headline: r.headline,
        avatar_hue: r.avatar_hue,
        photo_url: d.photo_url,
        service_id: r.service_id,
        service_name: r.service_name,
        price,
        rating: Number(r.rating),
        review_count: r.review_count,
        distance_km: r.distance_km,
        attendance,
        completeness: comp.score,
        score,
        parts,
        reasons,
        details: d,
      };
    })
    .sort((a, b) => b.score - a.score);
}
