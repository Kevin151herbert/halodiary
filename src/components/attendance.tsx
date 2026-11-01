import type { Attendance, Outcome } from "@/lib/attendance";
import { fmt } from "@/lib/time";
import { RingGauge } from "./ui";

const TONE: Record<Outcome, { color: string; grad: string; label: string; short: string }> = {
  rendered: { color: "#2e8a74", grad: "linear-gradient(145deg,#6fd0b4,#2e8a74)", label: "Service rendered", short: "Rendered" },
  alternative: { color: "#eba721", grad: "linear-gradient(145deg,#fbe08f,#eba721)", label: "Offered an alternative", short: "Alternative" },
  cancelled: { color: "#c8506a", grad: "linear-gradient(145deg,#f09aae,#c8506a)", label: "Cancelled", short: "Cancelled" },
};

/** Attendance at a glance: a ring for the rate and one dot per booked visit, newest first. */
export function AttendanceCard({ data, tz, name }: { data: Attendance; tz: string; name: string }) {
  const pct = (n: number) => (data.total ? Math.round((n / data.total) * 100) : 0);
  const shown = data.items.slice(0, 48);
  return (
    <section aria-labelledby="attendance" className="clay p-6 sm:p-7">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="attendance" className="text-xl font-bold">
          Attendance
        </h2>
        <span className="text-xs text-slate">Last {data.total} booked visits</span>
      </div>

      <div className="mt-5 flex flex-col items-center gap-6 sm:flex-row sm:items-center">
        <RingGauge
          value={data.rate}
          size={156}
          label={`${name} rendered ${pct(data.rendered)}% of booked visits`}
          segments={(["rendered", "alternative", "cancelled"] as Outcome[]).map((o) => ({
            value: data.total ? data[o] / data.total : 0,
            color: TONE[o].color,
          }))}
        />
        <ul className="w-full flex-1 space-y-3">
          {(["rendered", "alternative", "cancelled"] as Outcome[]).map((o) => (
            <li key={o} className="flex items-center gap-3">
              <span aria-hidden className="h-4 w-4 shrink-0 rounded-full shadow-[2px_3px_6px_-1px_rgba(29,34,56,0.3)]" style={{ background: TONE[o].grad }} />
              <span className="flex-1 text-sm">{TONE[o].label}</span>
              <span className="font-display font-bold">{pct(data[o])}%</span>
              <span className="w-8 text-right text-xs text-slate">{data[o]}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="clay-inset relative mt-6 px-3 py-3.5">
        <ol className="flex flex-wrap gap-2" aria-label="Each booked visit, newest first">
          {shown.map((i, k) => {
            const when = fmt(i.at, tz, { day: "numeric", month: "short", year: "numeric" });
            const text =
              i.outcome === "cancelled"
                ? `Cancelled: ${i.note}`
                : i.outcome === "alternative"
                  ? `Alternative: ${i.note}`
                  : "Service rendered as booked";
            return (
              <li
                key={k}
                tabIndex={0}
                className="tip h-5 w-5 cursor-default rounded-full shadow-[2px_3px_5px_-1px_rgba(29,34,56,0.3),inset_1px_1px_1px_rgba(255,255,255,0.6)] outline-offset-2"
                style={{ background: TONE[i.outcome].grad }}
                aria-label={`${when}, ${i.service}: ${text}`}
              >
                <span className="tip-body clay-sm block px-3 py-2 text-left text-xs leading-snug text-ink" role="tooltip">
                  <span className="block font-bold" style={{ color: TONE[i.outcome].color }}>
                    {TONE[i.outcome].short}
                    {i.yours && <span className="font-normal text-slate"> · your booking</span>}
                  </span>
                  <span className="block text-slate">
                    {when}, {i.service}
                  </span>
                  {i.outcome !== "rendered" && <span className="mt-1 block">{i.note}</span>}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
      <p className="mt-3 text-xs text-slate">Hover or tap a dot to see what happened. Red dots show the reason the provider gave.</p>
    </section>
  );
}

/** Small attendance badge for result cards. */
export function AttendanceBadge({ rate }: { rate: number }) {
  const tone = rate >= 0.9 ? "#2e8a74" : rate >= 0.75 ? "#b07a10" : "#c8506a";
  return (
    <span className="inline-flex items-center gap-1.5 text-sm" title="Share of booked visits rendered as booked">
      <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: tone }} />
      <span className="font-bold" style={{ color: tone }}>
        {Math.round(rate * 100)}%
      </span>
      <span className="text-slate">attended</span>
    </span>
  );
}
