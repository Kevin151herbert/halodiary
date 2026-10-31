"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import * as core from "@/lib/actions-core";
import { log } from "@/lib/engine";
import { getSession } from "@/lib/supabase/server";

async function session() {
  const s = await getSession();
  if (!s.user || !s.profile) redirect("/login");
  return { supabase: s.supabase, profile: s.profile! };
}

function done(path = "/app") {
  revalidatePath(path, "layout");
}

export async function addPlanAction(form: FormData) {
  const { supabase, profile } = await session();
  const weekdays = form.getAll("weekdays").map(Number);
  const res = await core.createPlan(
    supabase,
    profile,
    {
      providerId: String(form.get("provider_id")),
      serviceId: String(form.get("service_id")),
      cadence: String(form.get("cadence")),
      weekdays,
      time: String(form.get("time") || "10:00"),
    },
    "user",
  );
  if ("error" in res && res.error) return { error: res.error };
  done();
  redirect("/app?added=1");
}

export async function respondAction(visitId: string, action: "proceed" | "skip" | "reschedule", newTime?: string) {
  const { supabase, profile } = await session();
  const res = await core.clientRespond(supabase, profile, { visitId, action, newTime }, "user");
  done();
  return res;
}

export async function providerAction(visitId: string, action: "proceed" | "propose" | "complete", newTime?: string) {
  const { supabase, profile } = await session();
  const res = await core.providerRespond(supabase, profile, { visitId, action, newTime }, "user");
  done();
  return res;
}

export async function planStatusAction(planId: string, status: "active" | "paused" | "ended") {
  const { supabase, profile } = await session();
  await core.setPlanStatus(supabase, profile, planId, status, "user");
  done();
}

export async function approveBudgetSimulatedAction(month: string, cap: number) {
  const { supabase, profile } = await session();
  const res = await core.approveBudget(supabase, profile, { month, cap, mode: "simulated" }, "user");
  done();
  return res;
}

export async function setClockAction(hours: number) {
  const { supabase, profile } = await session();
  const next = hours === 0 ? 0 : profile.clock_offset_hours + hours;
  await supabase.from("profiles").update({ clock_offset_hours: next }).eq("id", profile.id);
  await log(supabase, profile.id, "user", hours === 0 ? "Reset the demo clock" : `Moved the demo clock forward ${hours} hours`);
  done();
}

export async function saveSettingsAction(form: FormData) {
  const { supabase, profile } = await session();
  const patch = {
    full_name: String(form.get("full_name") ?? profile.full_name),
    assistant_enabled: form.get("assistant_enabled") === "on",
    proactive_enabled: form.get("proactive_enabled") === "on",
    auto_checks_enabled: form.get("auto_checks_enabled") === "on",
  };
  await supabase.from("profiles").update(patch).eq("id", profile.id);
  await log(supabase, profile.id, "user", "Updated settings", patch);
  done();
  redirect("/app/settings?saved=1");
}

export async function toggleAssistantAction(enabled: boolean) {
  const { supabase, profile } = await session();
  await supabase.from("profiles").update({ assistant_enabled: enabled }).eq("id", profile.id);
  await log(supabase, profile.id, "user", enabled ? "Turned the assistant on" : "Turned the assistant off");
  done();
}

export async function markNotificationReadAction(id: string) {
  const { supabase, profile } = await session();
  await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", profile.id).eq("id", id);
  done();
}

export async function markNotificationsReadAction() {
  const { supabase, profile } = await session();
  await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", profile.id).is("read_at", null);
  done();
}

export async function saveLocationAction(lat: number, lng: number, city: string) {
  const { supabase, profile } = await session();
  await supabase.from("profiles").update({ lat, lng, city }).eq("id", profile.id);
  await log(supabase, profile.id, "user", `Set location to ${city}`);
  done();
}

export async function signOutAction() {
  const { supabase } = await session();
  await supabase.auth.signOut();
  redirect("/");
}
