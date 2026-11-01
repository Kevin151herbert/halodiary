import Link from "next/link";
import { Avatar, ButtonLink, Card, Halo, money, StatusPill } from "@/components/ui";
import { cadenceLabel } from "@/lib/cadence";
import { changeCost, upcomingVisits } from "@/lib/actions-core";
import { forecastMonth, MINUTES_SAVED_PER_VISIT, monthKey, nowFor } from "@/lib/engine";
import { getSession } from "@/lib/supabase/server";
import { addDays, dayKey as dayKeyZ, fmt, fmtDay as fmtDayZ, fmtTime as fmtTimeZ, localInputValue, zonedTime, zParts } from "@/lib/time";
import { DemoClock, PlanControls, ProposalAnswer, VisitAnswer } from "./diary-controls";

export default async function DiaryPage({ searchParams }: { searchParams: Promise<{ added?: string }> }) {
  const { added } = await searchParams;
  const { supabase, profile } = await getSession();
  const p = profile!;
  const now = nowFor(p);
  const tz = p.timezone;
  const currency = p.currency;
  const dayKey = (d: Date) => dayKeyZ(d, tz);
  const fmtDay = (d: Date) => fmtDayZ(d, tz);
  const fmtTime = (d: Date) => fmtTimeZ(d, tz);

  const visits = await upcomingVisits(supabase, p, 14);
  const { data: plans } = await supabase
    .from("plans")
    .select("*, services(name), providers(id, display_name, avatar_hue)")
    .eq("client_id", p.id)
    .neq("status", "ended")
    .order("created_at");
  const { count: handled } = await supabase
    .from("visits")
    .select("id", { count: "exact", head: true })
    .eq("client_id", p.id)
    .in("status", ["confirmed", "completed", "skipped"]);
  const { data: proposals } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", p.id)
    .eq("kind", "reschedule_request")
    .is("read_at", null);
  const { data: recent } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", p.id)
    .neq("kind", "reschedule_request")
    .order("created_at", { ascending: false })
    .limit(4);
  const { data: budget } = await supabase
    .from("budgets")
    .select("*")
    .eq("client_id", p.id)
    .eq("month", monthKey(now, tz))
    .maybeSingle();
  const forecast = await forecastMonth(supabase, p, monthKey(now, tz));

  const needsAnswer = visits.filter((v) => v.status === "awaiting" && !v.client_response);
  // What skipping or moving each visit would cost right now under its agreement.
  const costs = new Map(
    await Promise.all(
      needsAnswer.map(async (v) => [v.id, { skip: await changeCost(supabase, p, v, "skip"), move: await changeCost(supabase, p, v, "reschedule") }] as const),
    ),
  );
  const hours = Math.round(((handled ?? 0) * MINUTES_SAVED_PER_VISIT) / 6) / 10;

  // Fourteen days in the user's time zone, today first; the first seven get halos.
  const today = zParts(now, tz);
  const fortnight = Array.from({ length: 14 }, (_, i) => {
    const d = addDays(today.y, today.m, today.d, i);
    return zonedTime(d.y, d.m, d.d, 12, 0, tz);
  });
  const days = fortnight.slice(0, 7);
  const byDay = new Map<string, typeof visits>();
  for (const v of visits) {
    const k = dayKey(new Date(v.scheduled_at));
    byDay.set(k, [...(byDay.get(k) ?? []), v]);
  }

  if (!plans?.length) {
    return (
      <div>
        <h1 className="text-3xl font-extrabold sm:text-4xl">Your diary is empty</h1>
        <p className="mt-2 max-w-prose text-slate">
          Add the services you book again and again. HaloDiary puts every visit on this page, checks with you and the provider the day
          before, and pays inside one monthly budget.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <ButtonLink href="/app/discover">Find a service near you</ButtonLink>
          <span className="self-center text-sm text-slate">or tell the assistant your routine in one message.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <section className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-slate">{fmtDay(now)}</p>
          <h1 className="mt-1 text-3xl font-extrabold sm:text-4xl">
            {needsAnswer.length ? `${needsAnswer.length} ${needsAnswer.length === 1 ? "visit needs" : "visits need"} a quick answer` : "Everything is on track"}
          </h1>
          {added && <p className="mt-2 font-bold text-sage">Added to your diary. The first visits are below.</p>}
        </div>
        <div className="flex gap-4 text-right">
          <div className="clay-sm px-5 py-3">
            <p className="font-display text-3xl font-extrabold">{hours}h</p>
            <p className="text-xs text-slate">time saved so far</p>
          </div>
          <div className="clay-sm px-5 py-3">
            <p className="font-display text-3xl font-extrabold">{money(budget ? Number(budget.cap) : forecast.cap, currency)}</p>
            <p className="text-xs text-slate">{budget?.status === "approved" ? "budget approved" : "budget to approve"}</p>
          </div>
        </div>
      </section>

      <section aria-label="Next seven days" className="clay px-3 py-5 sm:px-6">
        <ol className="grid grid-cols-7 gap-1 sm:gap-4">
          {days.map((d, i) => {
            const list = byDay.get(dayKey(d)) ?? [];
            const live = list.filter((v) => !["skipped", "cancelled"].includes(v.status));
            return (
              <li key={i} className="flex flex-col items-center gap-2">
                <a href={live.length ? `#day-${i}` : undefined} className="rounded-full">
                  <Halo fill={Math.min(1, live.length / 3)} size={48} animate label={`${fmt(d, tz, { weekday: "long" })}: ${live.length} visits`}>
                    <span className="text-[10px] text-slate">{fmt(d, tz, { weekday: "short" })}</span>
                    <span className="font-display text-base font-bold">{fmt(d, tz, { day: "numeric" })}</span>
                  </Halo>
                </a>
                <span className="text-xs text-slate">{live.length ? `${live.length} visit${live.length > 1 ? "s" : ""}` : "Free"}</span>
              </li>
            );
          })}
        </ol>
      </section>

      {(needsAnswer.length > 0 || (proposals?.length ?? 0) > 0) && (
        <section aria-labelledby="answers">
          <h2 id="answers" className="text-xl font-bold">
            Day-before checks
          </h2>
          <p className="mt-1 text-sm text-slate">No answer by 2 hours before means the visit goes ahead as planned.</p>
          <ul className="mt-4 space-y-3">
            {proposals?.map((n) => {
              const [text, iso] = String(n.body).split("|");
              return (
                <li key={n.id}>
                  <Card className="p-5 ring-2 ring-rose/20">
                    <p className="font-bold">{n.title}</p>
                    <p className="mt-1 text-sm text-slate">{text}</p>
                    <ProposalAnswer notificationId={n.id} visitId={n.visit_id} newTime={iso} />
                  </Card>
                </li>
              );
            })}
            {needsAnswer.map((v) => {
              const at = new Date(v.scheduled_at);
              return (
                <li key={v.id}>
                  <Card className="p-5">
                    <div className="flex items-start gap-4">
                      <Avatar name={v.providers?.display_name ?? ""} hue={v.providers?.avatar_hue ?? 200} />
                      <div className="flex-1">
                        <p className="text-sm text-slate">
                          {fmtDay(at)}, {fmtTime(at)}
                        </p>
                        <p className="font-display text-lg font-bold">
                          {v.services?.name} with {v.providers?.display_name}
                        </p>
                        <p className="text-sm text-slate">
                          {v.provider_response === "proceed" ? `${v.providers?.display_name.split(" ")[0]} has confirmed.` : "Waiting for the provider too."}{" "}
                          {money(Number(v.price), currency)} will be held when you confirm.
                        </p>
                        <VisitAnswer
                          visitId={v.id}
                          suggested={localInputValue(new Date(at.getTime() + 86_400_000), tz)}
                          skipFee={costs.get(v.id)?.skip.fee ? money(costs.get(v.id)!.skip.fee, currency) : null}
                          moveFee={costs.get(v.id)?.move.fee ? money(costs.get(v.id)!.move.fee, currency) : null}
                          lateNote={costs.get(v.id)?.skip.late ? costs.get(v.id)!.move.reason || costs.get(v.id)!.skip.reason : null}
                        />
                      </div>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section aria-labelledby="upcoming">
        <h2 id="upcoming" className="text-xl font-bold">
          Next two weeks
        </h2>
        <div className="mt-4 space-y-6">
          {fortnight.map((d, i) => {
              const list = byDay.get(dayKey(d));
              if (!list?.length) return null;
              return (
                <div key={i} id={`day-${i}`}>
                  <h3 className="text-sm font-bold text-slate">{fmtDay(d)}</h3>
                  <ul className="clay-sm mt-2 divide-y divide-mist/70 px-1">
                    {list.map((v) => {
                      const at = new Date(v.scheduled_at);
                      return (
                        <li key={v.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                          <span className="w-12 font-display font-bold">{fmtTime(at)}</span>
                          <span className="min-w-0 flex-1">
                            <span className="font-bold">{v.services?.name}</span>
                            <span className="text-slate"> with </span>
                            <Link href={`/app/providers/${v.provider_id}`} className="text-slate underline decoration-mist decoration-2 underline-offset-2 hover:text-ink">
                              {v.providers?.display_name}
                            </Link>
                            {v.rescheduled_from && <span className="text-sm text-slate"> (moved)</span>}
                          </span>
                          <span className="text-sm">{money(Number(v.price), currency)}</span>
                          {v.provider_response === "cancel" ? (
                            <span className="tip inline-flex rounded-full bg-rose-soft px-2.5 py-1 text-xs font-bold text-rose" tabIndex={0}>
                              Cancelled by provider
                              <span className="tip-body clay-sm px-3 py-2 text-xs font-normal text-ink" role="tooltip">
                                {v.cancel_reason || "No reason given"}
                              </span>
                            </span>
                          ) : (
                            <StatusPill status={v.status} />
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
        </div>
      </section>

      <section aria-labelledby="plans">
        <h2 id="plans" className="text-xl font-bold">
          Your recurring services
        </h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {plans.map((pl) => {
            const line = forecast.lines.find((l) => l.planId === pl.id);
            return (
              <li key={pl.id}>
                <Card className="flex h-full flex-col p-4">
                  <Link href={`/app/providers/${pl.provider_id}?service=${pl.service_id}`} className="group flex items-center gap-3">
                    <Avatar name={pl.providers?.display_name ?? ""} hue={pl.providers?.avatar_hue ?? 200} size={40} />
                    <div className="min-w-0 flex-1">
                      <p className="font-bold">{pl.services?.name}</p>
                      <p className="text-sm text-slate">
                        <span className="font-bold text-ink underline decoration-mist decoration-2 underline-offset-2 group-hover:decoration-halo">
                          {pl.providers?.display_name}
                        </span>
                        , {cadenceLabel(pl.cadence, pl.weekdays).toLowerCase()} at {String(pl.time_of_day).slice(0, 5)}
                      </p>
                    </div>
                  </Link>
                  <div className="mt-3 flex items-center justify-between text-sm">
                    <span className="text-slate">
                      {pl.status === "paused" ? "Paused" : `${line?.visits ?? 0} visits this month, ${money(line?.total ?? 0, currency)}`}
                    </span>
                    <PlanControls planId={pl.id} status={pl.status} />
                  </div>
                  <div className="mt-2 flex gap-3 text-xs font-bold text-slate">
                    <Link href={`/app/providers/${pl.provider_id}?service=${pl.service_id}`} className="hover:text-ink">
                      Attendance
                    </Link>
                    <Link href="/app/agreements" className="hover:text-ink">
                      Agreement
                    </Link>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
        <Link href="/app/discover" className="mt-4 inline-block text-sm font-bold underline">
          Add another service
        </Link>
      </section>

      {!!recent?.length && (
        <section aria-labelledby="recent">
          <h2 id="recent" className="text-xl font-bold">
            Latest updates
          </h2>
          <ul className="clay mt-3 space-y-3 p-5 text-sm">
            {recent.map((n) => (
              <li key={n.id} className="flex gap-3">
                <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${n.read_at ? "bg-[#d5dae3]" : "fill-halo"}`} aria-hidden />
                <span>
                  <span className="font-bold">{n.title}</span>
                  {n.body && <span className="text-slate"> {n.body}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <DemoClock offsetHours={p.clock_offset_hours} />
      <p className="text-xs text-slate">Time saved is estimated at {MINUTES_SAVED_PER_VISIT} minutes per visit handled for you.</p>
    </div>
  );
}
