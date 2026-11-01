import { redirect } from "next/navigation";
import { getSession } from "@/lib/supabase/server";
import { ProfileEditor } from "./editor";

export default async function ProviderProfilePage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const { new: isNew } = await searchParams;
  const { supabase, profile } = await getSession();
  if (profile?.role !== "provider") redirect("/app");
  const { data: me } = await supabase.from("providers").select("*").eq("profile_id", profile.id).maybeSingle();
  if (!me) redirect("/onboarding");
  const [{ data: offers }, { data: services }] = await Promise.all([
    supabase.from("provider_services").select("service_id, price").eq("provider_id", me.id),
    supabase.from("services").select("id, name, category, typical_price").order("sort_order"),
  ]);
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-extrabold sm:text-4xl">Your profile</h1>
        <p className="mt-2 max-w-prose text-slate">What clients see when HaloDiary suggests you. The more you share, the higher you rank in their matches.</p>
      </div>
      <ProfileEditor
        providerId={me.id}
        profileId={profile.id}
        hue={me.avatar_hue}
        currency={profile.currency}
        isNew={Boolean(isNew)}
        services={(services ?? []).map((s) => ({ ...s, typical_price: Number(s.typical_price) }))}
        initial={{
          display_name: me.display_name,
          headline: me.headline ?? "",
          bio: me.bio ?? "",
          photo_url: me.photo_url,
          years_experience: me.years_experience ?? 1,
          languages: me.languages ?? [],
          team_size: me.team_size ?? 1,
          team: me.team ?? [],
          website: me.website ?? "",
          socials: me.socials ?? {},
          certifications: me.certifications ?? "",
          insured: Boolean(me.insured),
          service_radius_km: me.service_radius_km ?? 10,
          accepting_clients: me.accepting_clients !== false,
          paypal_email: me.paypal_email ?? "",
          offers: (offers ?? []).map((o) => ({ service_id: o.service_id, price: Number(o.price) })),
        }}
      />
    </div>
  );
}
