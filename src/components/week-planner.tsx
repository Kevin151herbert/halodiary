"use client";

// Bryntum Calendar: the drag-and-drop week planner. Moving a visit shows what the agreement
// says it costs before anything changes, then asks the other side through HaloDiary.
import "@bryntum/calendar/calendar.css";
import "@bryntum/calendar/stockholm-light.css";
import "@bryntum/calendar/fontawesome/css/fontawesome.css";
import "@bryntum/calendar/fontawesome/css/solid.css";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { movePreviewAction, providerAction, respondAction } from "@/app/app/actions";
import { fmt } from "@/lib/time";

export type PlannerVisit = {
  id: string;
  scheduled_at: string;
  minutes: number;
  title: string; // service
  who: string; // the other party
  status: string;
  amount: number; // what this visit is worth to the viewer
};

type Pending = {
  visit: PlannerVisit;
  local: string; // YYYY-MM-DDTHH:mm in the viewer's time zone
  label: string;
  preview: { late: boolean; amount: number; reason: string; status?: string } | null;
  error?: string;
  resolve: (ok: boolean) => void;
};

const MOVABLE = ["scheduled", "awaiting", "confirmed"];
const COLOR: Record<string, string> = {
  confirmed: "#2e8a74",
  awaiting: "#e5821c",
  scheduled: "#5d6480",
  completed: "#9aa1b8",
};

const pad = (n: number) => String(n).padStart(2, "0");
// With timeZone set, Bryntum hands back dates whose local fields are the wall clock in that zone.
const wallClock = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

function toEvents(visits: PlannerVisit[], nowMs: number) {
  return visits
    .filter((v) => !["skipped", "cancelled"].includes(v.status))
    .map((v) => ({
      id: v.id,
      // The other person's name rides in the title so every view (week, day, agenda) shows it.
      name: `${v.title} · ${v.who}`,
      startDate: v.scheduled_at,
      duration: v.minutes / 60,
      durationUnit: "h",
      eventColor: COLOR[v.status] ?? "#5d6480",
      draggable: MOVABLE.includes(v.status) && new Date(v.scheduled_at).getTime() > nowMs,
      resizable: false,
      who: v.who,
      status: v.status,
    }));
}

export function WeekPlanner({
  visits,
  tz,
  currency,
  side,
  nowIso,
  height = 560,
}: {
  visits: PlannerVisit[];
  tz: string;
  currency: string;
  side: "client" | "provider";
  nowIso: string;
  height?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const cal = useRef<{ eventStore: { data: unknown }; destroy: () => void } | null>(null);
  const byId = useRef(new Map<string, PlannerVisit>());
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const router = useRouter();
  const money = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(n);
  const nowMs = new Date(nowIso).getTime();

  byId.current = new Map(visits.map((v) => [v.id, v]));

  useEffect(() => {
    let dead = false;
    (async () => {
      const { Calendar, StringHelper } = await import("@bryntum/calendar");
      if (dead || !host.current) return;
      const narrow = window.innerWidth < 640;
      cal.current = new Calendar({
        appendTo: host.current,
        date: new Date(nowIso),
        timeZone: tz,
        // The week starts today, so the view is always "the next seven days".
        weekStartDay: new Date(new Date(nowIso).toLocaleString("en-US", { timeZone: tz })).getDay(),
        mode: narrow ? "agenda" : "week",
        sidebar: false,
        modes: {
          day: { dayStartTime: 7, dayEndTime: 22, hourHeight: 64 },
          week: { dayStartTime: 7, dayEndTime: 22, hourHeight: 64 },
          month: null,
          year: null,
          agenda: { descriptionRenderer: () => "Next visits" },
        },
        features: {
          eventEdit: false,
          eventMenu: false,
          scheduleMenu: false,
          drag: { creatable: false, resizable: false },
          eventTooltip: {
            renderer: ({ eventRecord }: { eventRecord: { name: string; data: { who: string; status: string } } }) =>
              `<b>${StringHelper.encodeHtml(eventRecord.name)}</b><br>${StringHelper.encodeHtml(eventRecord.data.status)}`,
          },
        },
        events: toEvents([...byId.current.values()], nowMs),
        listeners: {
          beforeDragMoveEnd: ({ eventRecord, newStartDate }: { eventRecord: { id: string }; newStartDate: Date }) => {
            const visit = byId.current.get(String(eventRecord.id));
            if (!visit) return false;
            const local = wallClock(newStartDate);
            const label = fmt(`${local}:00Z`, "UTC", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
            return new Promise<boolean>((resolve) => {
              setPending({ visit, local, label, preview: null, resolve });
              movePreviewAction(visit.id).then((p) =>
                setPending((cur) => (cur && cur.visit.id === visit.id ? ("error" in p && p.error ? { ...cur, error: p.error } : { ...cur, preview: p as Pending["preview"] }) : cur)),
              );
            });
          },
        },
      } as never) as unknown as typeof cal.current;
    })();
    return () => {
      dead = true;
      cal.current?.destroy();
      cal.current = null;
    };
    // The calendar is built once; data changes flow in below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tz, nowIso.slice(0, 10)]);

  useEffect(() => {
    if (cal.current) cal.current.eventStore.data = toEvents(visits, nowMs);
  }, [visits, nowMs]);

  const close = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };

  const confirm = () => {
    if (!pending) return;
    const p = pending;
    start(async () => {
      const res =
        side === "client" ? await respondAction(p.visit.id, "reschedule", p.local) : await providerAction(p.visit.id, "propose", p.local);
      if (res && "error" in res && res.error) {
        setPending({ ...p, error: String(res.error) });
        return;
      }
      p.resolve(side === "client");
      setPending(null);
      setNote(
        side === "client"
          ? `${p.visit.title} moved to ${p.label}. ${p.visit.who} has been told.`
          : `Asked ${p.visit.who} to move ${p.visit.title} to ${p.label}. It moves when they accept.`,
      );
      router.refresh();
    });
  };

  return (
    <div>
      <div ref={host} className="hd-planner overflow-hidden rounded-3xl bg-white" style={{ height }} />
      <p className="mt-3 text-xs text-slate">
        Drag a visit to a new time. You see what your agreement says before anything changes. Powered by Bryntum Calendar.
      </p>
      {note && (
        <p role="status" className="clay-inset mt-3 px-4 py-3 text-sm">
          {note}
        </p>
      )}

      {pending && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/30 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="move-title">
          <div className="clay w-full max-w-md p-6">
            <h3 id="move-title" className="text-lg font-bold">
              Move {pending.visit.title}?
            </h3>
            <p className="mt-1 text-sm text-slate">
              With {pending.visit.who}, to <b className="text-ink">{pending.label}</b>
            </p>
            <div className="clay-inset mt-4 px-4 py-3 text-sm" aria-live="polite">
              {pending.error ? (
                <span className="text-rose">{pending.error}</span>
              ) : !pending.preview ? (
                "Checking your agreement…"
              ) : side === "client" ? (
                pending.preview.amount > 0 ? (
                  <>
                    Late change: a fee of <b>{money(pending.preview.amount)}</b> is charged through PayPal ({pending.preview.reason}).
                  </>
                ) : (
                  <>
                    {pending.preview.late ? "A late move, but your agreement charges nothing for it." : "No fee: there is enough notice under your agreement."}{" "}
                    {pending.preview.status === "confirmed" ? "Your PayPal hold moves with the visit." : "The visit is held on PayPal once it is confirmed."}
                  </>
                )
              ) : pending.preview.amount > 0 ? (
                <>
                  Short notice: your client gets a credit of <b>{money(pending.preview.amount)}</b> off their next payment ({pending.preview.reason}).
                </>
              ) : (
                <>Enough notice, so nothing is owed. Your client is asked to accept the new time.</>
              )}
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <button onClick={() => close(false)} disabled={busy} className="clay-btn-ghost rounded-full px-5 py-2.5 font-bold">
                Keep the time
              </button>
              <button
                onClick={confirm}
                disabled={busy || !pending.preview || Boolean(pending.error)}
                className="clay-btn-ink rounded-full px-5 py-2.5 font-bold disabled:opacity-50"
              >
                {busy ? "Saving…" : side === "client" ? "Move it" : "Ask to move"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
