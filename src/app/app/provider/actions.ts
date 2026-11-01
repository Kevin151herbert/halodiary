"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { log } from "@/lib/engine";
import { getSession } from "@/lib/supabase/server";

export type ProfileInput = {
  display_name: string;
  headline: string;
  bio: string;
  photo_url: string | null;
  years_experience: number;
  languages: string[];
  team_size: number;
  team: { name: string; role: string }[];
  website: string;
  socials: Record<string, string>;
  certifications: string;
  insured: boolean;
  service_radius_km: number;
  accepting_clients: boolean;
  paypal_email: string;
  offers: { service_id: string; price: number }[];
};

const clean = (s: string, n: number) => s.replace(/\s+/g, " ").trim().slice(0, n);

export async function saveProviderProfile(input: ProfileInput) {
  const { supabase, profile } = await getSession();
  if (!profile || profile.role !== "provider") redirect("/login");
  const { data: me } = await supabase.from("providers").select("id").eq("profile_id", profile.id).maybeSingle();
  if (!me) return { error: "Finish setting up your listing first." };

  let website = input.website.trim();
  if (website && !/^https?:\/\//i.test(website)) website = `https://${website}`;
  if (website) {
    try {
      const u = new URL(website);
      if (!["http:", "https:"].includes(u.protocol)) website = "";
    } catch {
      return { error: "That website address doesn't look right." };
    }
  }
  const socials = Object.fromEntries(
    Object.entries(input.socials)
      .map(([k, v]) => [k, v.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?[^/]+\//, "").slice(0, 60)])
      .filter(([k, v]) => ["instagram", "facebook", "tiktok", "linkedin", "x"].includes(k) && v),
  );
  const offers = input.offers.filter((o) => o.service_id && o.price > 0 && o.price <= 5000);
  if (!offers.length) return { error: "Offer at least one service with a price." };
  if (!clean(input.display_name, 60)) return { error: "Add your name or business name." };
  const paypal = input.paypal_email.trim();
  if (paypal && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(paypal)) return { error: "That PayPal email doesn't look right." };

  const { error } = await supabase
    .from("providers")
    .update({
      display_name: clean(input.display_name, 60),
      headline: clean(input.headline, 120),
      bio: input.bio.trim().slice(0, 1500),
      photo_url: input.photo_url,
      years_experience: Math.max(0, Math.min(60, Math.round(input.years_experience || 0))),
      languages: input.languages.map((l) => clean(l, 30)).filter(Boolean).slice(0, 8),
      team_size: Math.max(1, input.team.filter((t) => t.name.trim()).length + 1, Math.min(500, Math.round(input.team_size || 1))),
      team: input.team.map((t) => ({ name: clean(t.name, 40), role: clean(t.role, 40) })).filter((t) => t.name).slice(0, 20),
      website: website || null,
      socials,
      certifications: clean(input.certifications, 200),
      insured: input.insured,
      service_radius_km: Math.max(1, Math.min(100, Math.round(input.service_radius_km || 10))),
      accepting_clients: input.accepting_clients,
      paypal_email: paypal || null,
    })
    .eq("id", me.id);
  if (error) return { error: error.message };

  // Services: update prices, add new ones, remove ones no longer offered.
  const { data: current } = await supabase.from("provider_services").select("service_id").eq("provider_id", me.id);
  const keep = new Set(offers.map((o) => o.service_id));
  const drop = (current ?? []).map((c) => c.service_id).filter((id) => !keep.has(id));
  if (drop.length) await supabase.from("provider_services").delete().eq("provider_id", me.id).in("service_id", drop);
  await supabase
    .from("provider_services")
    .upsert(offers.map((o) => ({ provider_id: me.id, service_id: o.service_id, price: Math.round(o.price * 100) / 100 })), { onConflict: "provider_id,service_id" });

  await log(supabase, profile.id, "user", "Updated provider profile");
  revalidatePath("/app", "layout");
  return { ok: true };
}

export async function loadSampleClientsAction() {
  const { supabase, profile } = await getSession();
  if (!profile || profile.role !== "provider") redirect("/login");
  const { data, error } = await supabase.rpc("load_sample_clients");
  if (error) return { error: error.message };
  await log(supabase, profile.id, "user", "Loaded sample clients");
  revalidatePath("/app", "layout");
  return { ok: true, added: data as number };
}
