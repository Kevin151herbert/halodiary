"use client";

import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { StatusPill } from "@/components/ui";
import { dayKey, fmt, fmtDay, localInputValue } from "@/lib/time";
import { ProviderVisitActions } from "./provider-actions";

export type CalendarVisit = {
  id: string;
  scheduled_at: string;
  status: string;
  service: string;
  client: string;
  earn: number;
  provider_response: string | null;
};

/** Colour by how busy a day is: pale yellow to deep orange, red ring above five. */
function dayTone(n: number) {
  if (n === 0) return null;
  if (n > 5) return { bg: "linear-gradient(145deg,#fde3e8,#f8c7d1)", fg: "#a3304b", ring: "0 0 0 2.5px #c8506a" };
  const tones = [
    "linear-gradient(145deg,#fdf0c2,#f9df8a)", // 1
    "linear-gradient(145deg,#fbe08f,#f5c451)", // 2
    "linear-gradient(145deg,#f8c45a,#efa12a)", // 3
    "linear-gradient(145deg,#f3a640,#e5821c)", // 4
    "linear-gradient(145deg,#ea8a2c,#d4650f)", // 5
  ];
  return { bg: tones[n - 1], fg: n >= 4 ? "#ffffff" : "#1d2238", ring: "" };
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function ScheduleCalendar({
  visits,
  tz,
  currency,
  todayKey,
  monthKeys,
}: {
  visits: CalendarVisit[];
  tz: string;
  currency: string;
  todayKey: string;
  monthKeys: string[]; // "YYYY-MM-01", oldest first; the middle one is the current month
}) {
  const [mi, setMi] = useState(Math.min(1, monthKeys.length - 1));
  const [selected, setSelected] = useState<string | null>(todayKey);
  const [open, setOpen] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const money = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(n);

  const byDay = useMemo(() => {
    const m = new Map<string, CalendarVisit[]>();
    for (const v of visits) {
      const k = dayKey(new Date(v.scheduled_at), tz);
      m.set(k, [...(m.get(k) ?? []), v]);
    }
    return m;
  }, [visits, tz]);

  const key = monthKeys[mi];
  const [y, m] = key.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const firstWeekday = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // Monday first
  const cells: (string | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => `${y}-${String(m).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`),
  ];
  const monthVisits = visits.filter((v) => dayKey(new Date(v.scheduled_at), tz).startsWith(key.slice(0, 7)));
  const monthEarn = monthVisits.reduce((s, v) => s + v.earn, 0);
  const busiest = Math.max(0, ...cells.map((c) => (c ? (byDay.get(c)?.length ?? 0) : 0)));
  const list = selected ? (byDay.get(selected) ?? []) : [];

  const pick = (k: string) => {
    setSelected((cur) => (cur === k ? null : k));
    // Let the list open, then bring it into view on small screens.
    setTimeout(() => panel.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 60);
  };

  return (
    <section aria-labelledby="schedule" className="clay p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="schedule" className="text-xl font-bold">
            Your schedule
          </h2>
          <p className="text-sm text-slate">
            {monthVisits.length} visits in {fmt(`${key}T12:00:00Z`, "UTC", { month: "long" })}, {money(monthEarn)} to you
            {busiest ? ` · busiest day: ${busiest} visit${busiest === 1 ? "" : "s"}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMi((i) => Math.max(0, i - 1))}
            disabled={mi === 0}
            className="clay-btn-ghost inline-flex h-10 w-10 items-center justify-center rounded-full disabled:opacity-40"
            aria-label="Previous month"
          >
            <ChevronLeft size={18} aria-hidden />
          </button>
          <span className="w-32 text-center font-display font-bold">{fmt(`${key}T12:00:00Z`, "UTC", { month: "long", year: "numeric" })}</span>
          <button
            onClick={() => setMi((i) => Math.min(monthKeys.length - 1, i + 1))}
            disabled={mi === monthKeys.length - 1}
            className="clay-btn-ghost inline-flex h-10 w-10 items-center justify-center rounded-full disabled:opacity-40"
            aria-label="Next month"
          >
            <ChevronRight size={18} aria-hidden />
          </button>
        </div>
      </div>

      <div className="clay-inset mt-5 p-2 sm:p-4">
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-bold uppercase tracking-wide text-slate sm:gap-2">
          {WEEKDAYS.map((d) => (
            <span key={d} className="py-1">
              {d}
            </span>
          ))}
        </div>
        <ol className="mt-1 grid grid-cols-7 gap-1 sm:gap-2" aria-label="Days of the month">
          {cells.map((c, i) => {
            if (!c) return <li key={`x${i}`} aria-hidden />;
            const n = byDay.get(c)?.length ?? 0;
            const tone = dayTone(n);
            const isToday = c === todayKey;
            const isSel = c === selected;
            const past = c < todayKey;
            return (
              <li key={c} className="flex justify-center">
                <button
                  onClick={() => pick(c)}
                  aria-pressed={isSel}
                  aria-label={`${fmtDay(new Date(`${c}T12:00:00Z`), "UTC")}: ${n ? `${n} visit${n > 1 ? "s" : ""}` : "free"}`}
                  className={`relative flex aspect-square w-full max-w-[56px] flex-col items-center justify-center rounded-full text-sm font-bold transition ${
                    isSel ? "scale-110" : "hover:scale-105"
                  } ${past ? "opacity-55" : ""}`}
                  style={{
                    background: tone ? tone.bg : isSel ? "#fff" : "transparent",
                    color: tone ? tone.fg : "#1d2238",
                    boxShadow: [
                      tone?.ring,
                      tone ? "4px 5px 10px -4px rgba(29,34,56,0.35), inset 1px 1px 2px rgba(255,255,255,0.6)" : "",
                      isSel ? "0 0 0 3px #1d2238" : "",
                    ]
                      .filter(Boolean)
                      .join(", "),
                  }}
                >
                  <span className={isToday ? "underline decoration-2 underline-offset-4" : ""}>{Number(c.slice(8))}</span>
                  {n > 0 && <span className="text-[10px] font-bold leading-none opacity-80">{n}</span>}
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      <ul className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate" aria-label="Legend">
        {[1, 2, 3, 4, 5].map((n) => (
          <li key={n} className="flex items-center gap-1.5">
            <span className="h-4 w-4 rounded-full" style={{ background: dayTone(n)!.bg }} aria-hidden />
            {n}
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <span className="h-4 w-4 rounded-full" style={{ background: dayTone(6)!.bg, boxShadow: dayTone(6)!.ring }} aria-hidden />
          6 or more
        </li>
        <li className="flex items-center gap-1.5">
          <span className="font-bold text-ink underline decoration-2 underline-offset-2">1</span> today
        </li>
      </ul>

      <div ref={panel} className={`grid transition-all duration-300 ${selected ? "mt-5 grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
        <div className="overflow-hidden">
          {selected && (
            <div className="clay-inset p-4 sm:p-5" aria-live="polite">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="font-bold">{fmtDay(new Date(`${selected}T12:00:00Z`), "UTC")}</h3>
                <span className="text-sm text-slate">
                  {list.length ? `${list.length} visit${list.length > 1 ? "s" : ""}, ${money(list.reduce((s, v) => s + v.earn, 0))} to you` : "Free day"}
                </span>
              </div>
              <ul className="mt-3 divide-y divide-white/80 overflow-hidden rounded-2xl bg-white/60">
                {list.map((v) => {
                  const expanded = open === v.id;
                  const actionable = v.scheduled_at >= new Date(Date.now() - 6 * 3_600_000).toISOString();
                  return (
                    <li key={v.id}>
                      <button
                        type="button"
                        onClick={() => setOpen(expanded ? null : v.id)}
                        aria-expanded={expanded}
                        className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition hover:bg-white/70"
                      >
                        <span className="w-11 shrink-0 font-display font-bold">{fmt(v.scheduled_at, tz, { hour: "2-digit", minute: "2-digit" })}</span>
                        <span className="min-w-0 flex-1 truncate">
                          <span className="font-bold">{v.service}</span>
                          <span className="text-slate"> · {v.client}</span>
                        </span>
                        <span className="hidden shrink-0 text-slate sm:inline">{money(v.earn)}</span>
                        <span className="hidden sm:inline-flex">
                          <StatusPill status={v.status === "awaiting" && v.provider_response === "proceed" ? "awaiting_other" : v.status} />
                        </span>
                        <span
                          className={`h-2.5 w-2.5 shrink-0 rounded-full sm:hidden ${
                            v.status === "completed" ? "bg-sage" : v.status === "confirmed" ? "bg-sage/60" : v.status === "awaiting" ? "bg-rose" : "bg-[#cfd4de]"
                          }`}
                          aria-label={v.status}
                        />
                        <ChevronDown size={16} className={`shrink-0 text-slate transition ${expanded ? "rotate-180" : ""}`} aria-hidden />
                      </button>
                      {expanded && (
                        <div className="px-3 pb-3">
                          <div className="flex flex-wrap items-center gap-2 text-xs text-slate">
                            <span className="sm:hidden">
                              <StatusPill status={v.status === "awaiting" && v.provider_response === "proceed" ? "awaiting_other" : v.status} />
                            </span>
                            You receive {money(v.earn)}, paid out after the visit is done.
                          </div>
                          {actionable ? (
                            <ProviderVisitActions
                              visitId={v.id}
                              status={v.status}
                              suggested={localInputValue(new Date(new Date(v.scheduled_at).getTime() + 86_400_000), tz)}
                              answered={v.provider_response}
                            />
                          ) : (
                            <p className="mt-2 text-xs text-slate">This visit is in the past.</p>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
                {!list.length && <li className="px-3 py-3 text-sm text-slate">Nothing booked. Clients nearby can book this day.</li>}
              </ul>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
