import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/supabase/server";
import { StartFlow } from "./flow";

export const metadata: Metadata = { title: "Get started · HaloDiary" };

export default async function StartPage() {
  const { supabase, profile } = await getSession();
  if (!profile) redirect("/login?next=/start");
  if (profile.role === "provider") redirect("/onboarding");
  const { data: services } = await supabase.from("services").select("id, name, category, default_cadence, typical_price").order("sort_order");
  return (
    <StartFlow
      name={profile.full_name.split(" ")[0] || "there"}
      hasLocation={profile.lat != null}
      city={profile.city}
      currency={profile.currency}
      services={(services ?? []).map((s) => ({ ...s, typical_price: Number(s.typical_price) }))}
      initialInterests={profile.interests ?? []}
      initialBudget={profile.monthly_budget ? Number(profile.monthly_budget) : null}
    />
  );
}
