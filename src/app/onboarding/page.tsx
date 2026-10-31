import { redirect } from "next/navigation";
import { getSession } from "@/lib/supabase/server";
import { Onboarding } from "./onboarding";

export default async function OnboardingPage() {
  const { supabase, profile } = await getSession();
  if (!profile) redirect("/login");
  const { data: services } = await supabase.from("services").select("id, name, typical_price, category").order("sort_order");
  return <Onboarding role={profile.role} name={profile.full_name} services={services ?? []} />;
}
