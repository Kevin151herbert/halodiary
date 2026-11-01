import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseKey, supabaseUrl } from "./env";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(supabaseUrl(), supabaseKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(toSet) {
        try {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component: the middleware refreshes the session instead.
        }
      },
    },
  });
}

/** The signed-in user and their profile, or nulls. */
export async function getSession() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, profile: null };
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  return { supabase, user, profile: profile as Profile | null };
}

export type Profile = {
  id: string;
  full_name: string;
  role: "client" | "provider";
  lat: number | null;
  lng: number | null;
  city: string | null;
  currency: string;
  timezone: string;
  assistant_enabled: boolean;
  proactive_enabled: boolean;
  auto_checks_enabled: boolean;
  paypal_payment_token: string | null;
  paypal_payer_email: string | null;
  clock_offset_hours: number;
  interests?: string[];
  monthly_budget?: number | null;
  onboarded_at?: string | null;
};
