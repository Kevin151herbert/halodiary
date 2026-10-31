"use server";

import { redirect } from "next/navigation";
import { log } from "@/lib/engine";
import { getSession } from "@/lib/supabase/server";
import { isValidTz } from "@/lib/time";

export async function finishOnboarding(input: {
  lat: number;
  lng: number;
  city: string;
  timezone?: string;
  offers?: { serviceId: string; price: number }[];
  headline?: string;
}) {
  const { supabase, profile } = await getSession();
  if (!profile) redirect("/login");
  const timezone = isValidTz(input.timezone) ? input.timezone! : profile.timezone;
  await supabase.from("profiles").update({ lat: input.lat, lng: input.lng, city: input.city, timezone }).eq("id", profile.id);

  if (profile.role === "provider" && input.offers?.length) {
    const { data: existing } = await supabase.from("providers").select("id").eq("profile_id", profile.id).maybeSingle();
    let providerId = existing?.id as string | undefined;
    if (!providerId) {
      const { data: created, error } = await supabase
        .from("providers")
        .insert({
          profile_id: profile.id,
          display_name: profile.full_name,
          headline: input.headline || "New on HaloDiary",
          bio: "",
          avatar_hue: Math.floor(Math.random() * 360),
          rating: 5.0,
          review_count: 0,
          lat: input.lat,
          lng: input.lng,
        })
        .select("id")
        .single();
      if (error) return { error: error.message };
      providerId = created.id;
    } else {
      await supabase.from("providers").update({ lat: input.lat, lng: input.lng }).eq("id", providerId);
    }
    await supabase.from("provider_services").delete().eq("provider_id", providerId);
    await supabase
      .from("provider_services")
      .insert(input.offers.map((o) => ({ provider_id: providerId, service_id: o.serviceId, price: o.price })));
  }
  await log(supabase, profile.id, "user", `Set location to ${input.city}`);
  redirect(profile.role === "provider" ? "/app/provider" : "/app/discover");
}
