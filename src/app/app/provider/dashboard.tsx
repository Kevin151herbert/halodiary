import { CalendarHeart, Star, Wallet } from "lucide-react";
import Link from "next/link";
import { AttendanceCard } from "@/components/attendance";
import { LedgerGrid } from "@/components/ledger-grid-lazy";
import { Avatar, IconChip, Meter, money, Rating, RingGauge } from "@/components/ui";
import { attendanceFor } from "@/lib/attendance";
import { cadenceLabel } from "@/lib/cadence";
import { COMMISSION, nowFor, VISIT_SELECT, type VisitRow } from "@/lib/engine";
import { profileCompleteness } from "@/lib/match-shared";
import { getSession } from "@/lib/supabase/server";
import { dayKey, fmt, fmtDay, monthKey, monthRange } from "@/lib/time";
import { NewClientActions, SampleClientsButton } from "./dashboard-controls";
import { ScheduleCalendar } from "./schedule-calendar";
import { WeekPlanner } from "@/components/week-planner-lazy";

/** A real provider's home: schedule, new client requests, ratings and attendance. */
export async function ProviderDashboard({ providerId }: { providerId: string }) {
  const { supabase, profile } = await getSession();
  const me = profile!;
  const tz = me.timezone;
  const now = nowFor(me);

  const [{ data: p }, { data: names }, { data: visitsRaw }, { data: pending }, { data: payouts }, { data: reviews }, attendance, { count: planCount }] =
    await Promise.all([
      supabase.from("providers").select("*").eq("id", providerId).single(),
      supabase.rpc("my_client_names"),
      supabase
        .from("visits")
        .select(VISIT_SELECT)
        .eq("provider_id", providerId)
        .gte("scheduled_at", monthRange(monthKey(now, tz, -1), tz).start.toISOString())
        .lt("scheduled_at", monthRange(monthKey(now, tz, 1), tz).end.toISOString())
        .not("status", "in", "(cancelled,skipped)")
        .order("scheduled_at"),
      supabase
        .from("contracts")
        .select("id, client_id, plan_id, version, created_at, terms, plans(cadence, weekdays, time_of_day, price, services(name))")
        .eq("provider_id", providerId)
        .eq("status", "pending")
        .is("provider_signed_at", null)
        .order("created_at", { ascending: false }),
      supabase
        .from("ledger_entries")
        .select("id, kind, amount, created_at, client_id, paypal_ref, mode, note, paypal_confirmed_at, visits(services(name))")
        .eq("provider_id", providerId)
        .in("kind", ["payout", "refund", "credit"])
        .order("created_at", { ascending: false })
        .limit(500),
      supabase.from("reviews").select("author_name, rating, body, created_at").eq("provider_id", providerId).order("created_at", { ascending: false }).limit(4),
      attendanceFor(supabase, providerId, now.toISOString()),
      supabase.from("plans").select("id", { count: "exact", head: true }).eq("provider_id", providerId),
    ]);
  const nameOf = new Map(((names ?? []) as { client_id: string; name: string }[]).map((n) => [n.client_id, n.name]));
  // Visits of a client still waiting for your signature are not on your schedule yet.
  const pendingPlans = new Set((pending ?? []).map((c) => (c as { plan_id: string }).plan_id));
  const all = ((visitsRaw ?? []) as VisitRow[]).filter((v) => !v.plan_id || !pendingPlans.has(v.plan_id));
  const visits = all.filter((v) => new Date(v.scheduled_at).getTime() >= now.getTime() - 6 * 3_600_000 && new Date(v.scheduled_at).getTime() <= now.getTime() + 14 * 86_400_000);
  const earned = (payouts ?? []).filter((e) => e.kind === "payout").reduce((s, e) => s + Number(e.amount), 0);
  const weekEnd = now.getTime() + 7 * 86_400_000;
  const thisWeek = visits.filter((v) => new Date(v.scheduled_at).getTime() <= weekEnd);
  const comp = profileCompleteness({ ...p, website: p.website ?? null, socials: p.socials ?? {}, team: p.team ?? [] });

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-center gap-5">
        <Avatar name={p.display_name} hue={p.avatar_hue} size={72} photo={p.photo_url} />
        <div className="min-w-0 flex-1">
          <p className="text-slate">{fmtDay(now, tz)}</p>
          <h1 className="text-3xl font-extrabold sm:text-4xl">Hi {p.display_name.split(" ")[0]}</h1>
          <p className="mt-1 text-sm">
            {p.accepting_clients ? (
              <span className="font-bold text-sage">Accepting new clients</span>
            ) : (
              <span className="font-bold text-rose">Not accepting new clients</span>
            )}
            <span className="text-slate"> · {me.city ?? "Location set"} · {p.service_radius_km} km radius</span>
          </p>
        </div>
        <Link href="/app/provider/profile" className="clay-btn-ghost rounded-full px-5 py-2.5 text-sm font-bold">
          Edit profile
        </Link>
      </header>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4" aria-label="Your numbers">
        <div className="clay flex flex-col items-center p-5 text-center">
          {attendance.total ? (
            <RingGauge value={attendance.rate} size={96} label={`Attendance ${Math.round(attendance.rate * 100)}%`} />
          ) : (
            <span className="flex h-24 w-24 items-center justify-center rounded-full border-4 border-dashed border-mist font-display text-lg font-bold text-slate">New</span>
          )}
          <p className="mt-2 text-sm font-bold">Attendance</p>
          <p className="text-xs text-slate">{attendance.total ? `${attendance.total} booked visits` : "No visits yet"}</p>
        </div>
        <Tile icon={<Star size={18} />} tone="halo" big={p.review_count ? Number(p.rating).toFixed(1) : "New"} label="Rating" sub={p.review_count ? `${p.review_count} reviews` : "Ratings appear after visits"} />
        <Tile icon={<CalendarHeart size={18} />} tone="ink" big={String(thisWeek.length)} label="Visits this week" sub={`${visits.length} in the next 14 days`} />
        <Tile icon={<Wallet size={18} />} tone="sage" big={money(earned, me.currency)} label="Paid out" sub="through PayPal" />
      </section>

      {!planCount && (
        <section className="clay p-6">
          <h2 className="text-lg font-bold">No clients yet</h2>
          <p className="mt-1 max-w-prose text-sm text-slate">
            Clients within {p.service_radius_km} km see you in their matches. To see the provider side working straight away, load two sample clients: one
            regular with past visits, ratings and an extra request, and one new client waiting for you to accept.
          </p>
          <div className="mt-4">
            <SampleClientsButton />
          </div>
        </section>
      )}

      {!!pending?.length && (
        <section aria-labelledby="requests">
          <h2 id="requests" className="text-xl font-bold">
            New client requests
          </h2>
          <ul className="mt-3 grid gap-3 md:grid-cols-2">
            {pending.map((c) => {
              const pl = c.plans as unknown as { cadence: string; weekdays: number[]; time_of_day: string; price: number; services: { name: string } };
              const t = c.terms as Record<string, number>;
              return (
                <li key={c.id} className="clay p-5">
                  <div className="flex items-center gap-3">
                    <Avatar name={nameOf.get(c.client_id) ?? "Client"} hue={(c.client_id.charCodeAt(0) * 37) % 360} size={44} />
                    <div className="min-w-0 flex-1">
                      <p className="font-bold">{nameOf.get(c.client_id) ?? "New client"}</p>
                      <p className="text-sm text-slate">
                        {pl?.services?.name}, {pl ? cadenceLabel(pl.cadence, pl.weekdays).toLowerCase() : ""} at {String(pl?.time_of_day).slice(0, 5)}
                      </p>
                    </div>
                    <span className="font-display text-lg font-bold">{money(Number(pl?.price ?? 0), me.currency)}</span>
                  </div>
                  <p className="clay-inset mt-4 px-4 py-3 text-xs text-slate">
                    Agreement v{c.version}: free changes up to {t.cancellation_notice_hours}h, {t.late_cancellation_fee_pct}% late fee to you, you give{" "}
                    {t.provider_change_notice_hours}h notice, {t.termination_notice_days} days to end.{" "}
                    <Link href={`/app/agreements/${c.id}`} className="font-bold text-ink underline">
                      Read it
                    </Link>
                  </p>
                  <NewClientActions contractId={c.id} />
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[1.5fr_1fr]">
        <ScheduleCalendar
          tz={tz}
          currency={me.currency}
          todayKey={dayKey(now, tz)}
          monthKeys={[monthKey(now, tz, -1), monthKey(now, tz), monthKey(now, tz, 1)]}
          visits={all.map((v) => ({
            id: v.id,
            scheduled_at: v.scheduled_at,
            status: v.status,
            service: v.services?.name ?? "Visit",
            client: nameOf.get(v.client_id) ?? "a client",
            earn: Math.round(Number(v.price) * (1 - COMMISSION) * 100) / 100,
            provider_response: v.provider_response,
          }))}
        />

        <aside className="space-y-6">
          <section className="clay p-6">
            <div className="flex items-baseline justify-between">
              <h2 className="font-bold">Profile detail</h2>
              <span className="font-display text-2xl font-extrabold">{Math.round(comp.score * 100)}%</span>
            </div>
            <div className="mt-3">
              <Meter value={comp.score} label="Profile detail" />
            </div>
            {comp.missing.length > 0 ? (
              <p className="mt-3 text-sm text-slate">
                Add {comp.missing.slice(0, 3).join(", ").toLowerCase()} to rank higher.{" "}
                <Link href="/app/provider/profile" className="font-bold text-ink underline">
                  Edit
                </Link>
              </p>
            ) : (
              <p className="mt-3 text-sm text-sage">Complete. Clients see everything they need.</p>
            )}
          </section>

          <section className="clay p-6">
            <h2 className="font-bold">Latest ratings</h2>
            <ul className="mt-3 space-y-3">
              {(reviews ?? []).map((r, i) => (
                <li key={i} className="clay-inset p-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-bold">{r.author_name}</span>
                    <Rating value={r.rating} />
                  </div>
                  <p className="mt-1 text-sm">{r.body}</p>
                  <p className="mt-1 text-[11px] text-slate">{fmt(r.created_at, tz, { day: "numeric", month: "short" })}</p>
                </li>
              ))}
              {!reviews?.length && <li className="text-sm text-slate">Clients rate you in the chat after each visit.</li>}
            </ul>
          </section>
        </aside>
      </div>

      <section aria-labelledby="planner" className="clay p-5 sm:p-6">
        <h2 id="planner" className="text-xl font-bold">
          Week planner
        </h2>
        <p className="mb-4 text-sm text-slate">Drag a visit to ask your client for a new time.</p>
        <WeekPlanner
          side="provider"
          tz={tz}
          currency={me.currency}
          nowIso={now.toISOString()}
          visits={all.map((v) => ({
            id: v.id,
            scheduled_at: v.scheduled_at,
            minutes: Number((v as unknown as { duration_minutes?: number }).duration_minutes ?? 60),
            title: v.services?.name ?? "Visit",
            who: nameOf.get(v.client_id) ?? "a client",
            status: v.status,
            amount: Math.round(Number(v.price) * (1 - COMMISSION) * 100) / 100,
          }))}
        />
      </section>

      <section aria-labelledby="earnings">
        <h2 id="earnings" className="text-xl font-bold">
          Earnings
        </h2>
        <p className="mt-1 text-sm text-slate">Every PayPal payout, refund and agreement credit. Search, sort and export it for your accounts.</p>
        <div className="mt-4">
          <LedgerGrid
            currency={me.currency}
            partyLabel="Client"
            fileName="halodiary-earnings.csv"
            rows={(payouts ?? []).map((e) => ({
              id: e.id,
              when: e.created_at,
              whenLabel: fmt(e.created_at, tz, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
              what: e.kind === "payout" ? "Payout" : e.kind === "refund" ? "Refunded" : "Credit to client",
              service: (e.visits as unknown as { services?: { name: string } } | null)?.services?.name ?? "",
              party: nameOf.get(e.client_id) ?? "Client",
              amount: e.kind === "payout" ? Number(e.amount) : -Number(e.amount),
              ref: e.paypal_ref ?? "",
              mode: e.mode === "paypal_sandbox" ? "Sandbox" : "Simulated",
              confirmed: e.paypal_confirmed_at ? "PayPal ✓" : "",
              note: e.note ?? "",
            }))}
          />
        </div>
      </section>

      {attendance.total > 0 && <AttendanceCard data={attendance} tz={tz} name={p.display_name} />}
    </div>
  );
}

function Tile({ icon, tone, big, label, sub }: { icon: React.ReactNode; tone: "ink" | "halo" | "sage"; big: string; label: string; sub: string }) {
  return (
    <div className="clay flex flex-col justify-between p-5">
      <IconChip tone={tone} size={40}>
        {icon}
      </IconChip>
      <div className="mt-4">
        <p className="font-display text-3xl font-extrabold">{big}</p>
        <p className="text-sm font-bold">{label}</p>
        <p className="text-xs text-slate">{sub}</p>
      </div>
    </div>
  );
}
