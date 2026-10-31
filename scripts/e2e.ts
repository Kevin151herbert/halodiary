// End-to-end run against a live Supabase project, using the app's own code paths.
// Run: npx tsx --env-file=.env.local scripts/e2e.ts
import { createClient } from "@supabase/supabase-js";
import * as core from "../src/lib/actions-core";
import { advance, forecastMonth, monthKey, nowFor } from "../src/lib/engine";
import type { Profile } from "../src/lib/supabase/server";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
let failures = 0;
const check = (label: string, ok: boolean, extra = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`);
};

async function main() {
  const anon = createClient(url, key, { auth: { persistSession: false } });
  const id = Math.random().toString(36).slice(2, 8);
  const email = `judge-${id}@halodiary.app`;
  const password = crypto.randomUUID();
  const { data: su, error: suErr } = await anon.auth.signUp({ email, password, options: { data: { full_name: `Guest ${id.toUpperCase()}`, role: "client" } } });
  check("instant sign-up returns a session (no email confirmation)", !!su.session, suErr?.message);
  if (!su.session) return;
  const supabase = createClient(url, key, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${su.session.access_token}` } },
  });
  const uid = su.user!.id;

  const profileOf = async () => (await supabase.from("profiles").select("*").eq("id", uid).single()).data as Profile;
  let p = await profileOf();
  check("profile created by sign-up trigger", !!p && p.role === "client", p?.full_name);

  // Onboarding: Barcelona, Madrid time
  await supabase.from("profiles").update({ lat: 41.3874, lng: 2.1686, city: "Barcelona", timezone: "Europe/Madrid" }).eq("id", uid);
  p = await profileOf();

  // Discover near you
  const near = await core.searchProviders(supabase, p, { radiusKm: 12 });
  const services = new Set(near.results.map((r) => r.service_id));
  check("providers near the user, every service covered", services.size === 22, `${near.results.length} listings, ${services.size} services`);
  const pick = async (service: string) => (await core.searchProviders(supabase, p, { service })).results.sort((a, b) => Number(b.rating) - Number(a.rating))[0];
  const cleaner = await pick("cleaning");
  const walker = await pick("dog-walking");
  const tutor = await pick("tutoring");

  // Add three recurring services
  for (const [prov, cadence, weekdays, time] of [
    [cleaner, "twice_weekly", [2, 5], "10:00"],
    [walker, "weekends", [6, 0], "09:00"],
    [tutor, "thrice_weekly", [1, 3, 5], "16:30"],
  ] as const) {
    const r = await core.createPlan(supabase, p, { providerId: prov.provider_id, serviceId: prov.service_id, cadence, weekdays: [...weekdays], time }, "user");
    check(`add ${prov.service_name}`, !("error" in r && r.error), "summary" in r ? r.summary : (r as { error: string }).error);
  }
  const visits0 = await core.upcomingVisits(supabase, p, 14);
  check("visits generated for next two weeks", visits0.length >= 14, `${visits0.length} visits`);
  const tenAm = visits0.find((v) => v.services?.name === "Cleaning");
  const local = tenAm && new Date(tenAm.scheduled_at).toLocaleTimeString("en-GB", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit" });
  check("cleaning lands at 10:00 Madrid time", local === "10:00", local);

  // Budget
  const month = monthKey(nowFor(p), p.timezone);
  const f = await forecastMonth(supabase, p, month);
  check("monthly forecast and cap", f.total > 0 && f.cap >= f.total, `forecast ${f.total}, cap ${f.cap}`);
  const ap = await core.approveBudget(supabase, p, { month, mode: "simulated" }, "user");
  check("budget approved (simulated)", !!(ap as { ok?: boolean }).ok);
  // Next month too, so visits after the month boundary can be held
  await core.approveBudget(supabase, p, { month: monthKey(nowFor(p), p.timezone, 1), mode: "simulated" }, "user");

  // Demo clock +24h: day-before checks
  const nowVisits = async () => core.upcomingVisits(supabase, p, 10);
  await supabase.from("profiles").update({ clock_offset_hours: 72 }).eq("id", uid);
  p = await profileOf();
  await advance(supabase, p);
  const { data: jumped } = await supabase.from("visits").select("status").eq("client_id", uid).lt("scheduled_at", nowFor(p).toISOString());
  const js = (jumped ?? []).map((v) => v.status);
  check("visits inside the clock jump went ahead and were paid, not skipped", js.length > 0 && js.every((x) => ["confirmed", "completed"].includes(x)), js.join(","));
  let vs = await nowVisits();
  const awaiting = vs.filter((v) => v.status === "awaiting");
  check("day-before checks sent after the clock jump", awaiting.length >= 1, `${awaiting.length} awaiting`);
  check("demo provider answered automatically", awaiting.every((v) => v.provider_response === "proceed"));

  // Answer: proceed the awaiting one, skip and move two later visits
  const a1 = awaiting[0];
  const [a2, a3] = vs.filter((v) => v.status === "scheduled").slice(0, 2);
  if (a1) check("client proceeds", !(await core.clientRespond(supabase, p, { visitId: a1.id, action: "proceed" }, "user") as { error?: string }).error);
  if (a2) check("client skips", !(await core.clientRespond(supabase, p, { visitId: a2.id, action: "skip" }, "user") as { error?: string }).error);
  if (a3) {
    const at = new Date(new Date(a3.scheduled_at).getTime() + 86_400_000);
    const localStr = at.toLocaleString("sv-SE", { timeZone: "Europe/Madrid" }).slice(0, 16).replace(" ", "T");
    const r = (await core.clientRespond(supabase, p, { visitId: a3.id, action: "reschedule", newTime: localStr }, "user")) as { error?: string };
    check("client moves a visit by a day", !r.error, r.error);
  }
  vs = await nowVisits();
  check("proceeded visit is confirmed with payment held", vs.find((v) => v.id === a1?.id)?.status === "confirmed");
  check("skipped visit is skipped", vs.find((v) => v.id === a2?.id)?.status === "skipped");
  check("moved visit shows as a new one-off", vs.some((v) => v.rescheduled_from === a3?.scheduled_at));

  // Provider proposes a new time on another visit (judge acting for a demo provider)
  const later = vs.filter((v) => v.status === "scheduled").at(-1);
  if (later) {
    const r = (await core.providerRespond(supabase, p, { visitId: later.id, action: "propose", newTime: "2026-12-01T11:00" }, "user")) as { error?: string };
    const { count } = await supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", uid).eq("kind", "reschedule_request");
    check("provider proposal reaches the client's diary", !r.error && (count ?? 0) > 0);
  }

  // +3 days: silent visits go ahead at the cut-off, finished visits are captured and paid out
  await supabase.from("profiles").update({ clock_offset_hours: 24 * 6 }).eq("id", uid);
  p = await profileOf();
  await advance(supabase, p);
  const { data: ledger } = await supabase.from("ledger_entries").select("kind, amount, mode").eq("client_id", uid);
  const kinds = (ledger ?? []).reduce<Record<string, number>>((m, e) => ({ ...m, [e.kind]: (m[e.kind] ?? 0) + 1 }), {});
  check("holds recorded", (kinds.hold ?? 0) > 0, JSON.stringify(kinds));
  check("charges and provider payouts recorded", (kinds.capture ?? 0) > 0 && kinds.capture === kinds.payout);
  const payout = (ledger ?? []).find((e) => e.kind === "payout");
  const capture = (ledger ?? []).find((e) => e.kind === "capture");
  check("provider gets 90% of the price", !!payout && !!capture && Math.abs(Number(payout.amount) - Number(capture.amount) * 0.9) < 0.01 * Number(capture.amount) + 0.01);
  const { data: done } = await supabase.from("visits").select("status").eq("client_id", uid).eq("status", "completed");
  check("visits completed", (done?.length ?? 0) > 0, `${done?.length} completed`);

  // Repeated page loads don't duplicate notifications
  const before = (await supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", uid)).count;
  await advance(supabase, p);
  await advance(supabase, p);
  const after = (await supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", uid)).count;
  check("no duplicate notifications on repeat loads", before === after, `${before} then ${after}`);

  // Activity log has user and system entries
  const { data: act } = await supabase.from("activity_log").select("actor").eq("user_id", uid);
  const actors = new Set((act ?? []).map((a) => a.actor));
  check("activity log records user and scheduler actions", actors.has("user") && actors.has("system"), `${act?.length} entries`);

  // Privacy: a second user sees none of this
  const other = await anon.auth.signUp({ email: `judge-${id}b@halodiary.app`, password: crypto.randomUUID() });
  const s2 = createClient(url, key, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${other.data.session!.access_token}` } } });
  const leaks = await Promise.all(["plans", "visits", "ledger_entries", "budgets", "notifications", "activity_log"].map(async (t) => (await s2.from(t).select("*", { count: "exact", head: true })).count ?? 0));
  check("another user sees none of this user's data", leaks.every((n) => n === 0), leaks.join(","));
  const fresh = createClient(url, key, { auth: { persistSession: false } });
  const anonView = await fresh.from("providers").select("id", { count: "exact", head: true });
  check("signed-out visitors can't list providers", (anonView.count ?? 0) === 0);

  console.log(`\nTest account: ${email}\n${failures ? `${failures} FAILED` : "ALL PASSED"}`);
  console.log(`USER_IDS ${uid} ${other.data.user?.id}`);
  console.log(`SESSION ${JSON.stringify({ access_token: su.session.access_token, refresh_token: su.session.refresh_token })}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
