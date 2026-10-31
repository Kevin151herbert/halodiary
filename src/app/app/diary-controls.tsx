"use client";

import { useState, useTransition } from "react";
import { btn } from "@/components/ui";
import { markNotificationReadAction, planStatusAction, providerAction, respondAction, setClockAction } from "./actions";

// Times typed here are wall-clock times in the user's own time zone; the server reads them that way.
export function VisitAnswer({ visitId, suggested }: { visitId: string; suggested: string }) {
  const [pending, start] = useTransition();
  const [moving, setMoving] = useState(false);
  const [when, setWhen] = useState(suggested);
  const [error, setError] = useState<string | null>(null);

  const run = (action: "proceed" | "skip" | "reschedule", t?: string) =>
    start(async () => {
      const res = await respondAction(visitId, action, t);
      if (res && "error" in res && res.error) setError(res.error);
    });

  return (
    <div className="mt-4">
      {!moving ? (
        <div className="flex flex-wrap gap-2">
          <button className={btn.primary} disabled={pending} onClick={() => run("proceed")}>
            Proceed
          </button>
          <button className={btn.ghost} disabled={pending} onClick={() => setMoving(true)}>
            Move it
          </button>
          <button className={btn.ghost} disabled={pending} onClick={() => run("skip")}>
            Skip this one
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={`when-${visitId}`}>
            New time
          </label>
          <input
            id={`when-${visitId}`}
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            className="rounded-full border border-mist px-4 py-2 text-sm"
          />
          <button className={btn.primary} disabled={pending} onClick={() => run("reschedule", when)}>
            Move visit
          </button>
          <button className={btn.quiet} onClick={() => setMoving(false)}>
            Cancel
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-rose">{error}</p>}
    </div>
  );
}

export function ProposalAnswer({ notificationId, visitId, newTime }: { notificationId: string; visitId: string; newTime: string }) {
  const [pending, start] = useTransition();
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      <button
        className={btn.primary}
        disabled={pending}
        onClick={() =>
          start(async () => {
            await respondAction(visitId, "reschedule", newTime);
            await markNotificationReadAction(notificationId);
          })
        }
      >
        Accept new time
      </button>
      <button
        className={btn.ghost}
        disabled={pending}
        onClick={() =>
          start(async () => {
            await providerAction(visitId, "proceed");
            await markNotificationReadAction(notificationId);
          })
        }
      >
        Keep the original time
      </button>
    </div>
  );
}

export function PlanControls({ planId, status }: { planId: string; status: string }) {
  const [pending, start] = useTransition();
  return (
    <span className="flex gap-1">
      {status === "active" ? (
        <button className={btn.quiet} disabled={pending} onClick={() => start(() => planStatusAction(planId, "paused"))}>
          Pause
        </button>
      ) : (
        <button className={btn.quiet} disabled={pending} onClick={() => start(() => planStatusAction(planId, "active"))}>
          Resume
        </button>
      )}
      <button
        className={btn.quiet}
        disabled={pending}
        onClick={() => {
          if (confirm("End this service? Future visits that are not confirmed will be removed.")) start(() => planStatusAction(planId, "ended"));
        }}
      >
        End
      </button>
    </span>
  );
}

/** Lets judges jump ahead in time to see day-before checks, holds and payouts happen. */
export function DemoClock({ offsetHours }: { offsetHours: number }) {
  const [pending, start] = useTransition();
  return (
    <section aria-labelledby="clock" className="rounded-2xl border border-dashed border-ink/25 p-5">
      <h2 id="clock" className="font-bold">
        Demo clock
      </h2>
      <p className="mt-1 text-sm text-slate">
        Move time forward to watch the day-before checks go out, payments get held, and providers get paid.
        {offsetHours !== 0 && ` Currently ${offsetHours} hours ahead.`}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button className={btn.ghost} disabled={pending} onClick={() => start(() => setClockAction(12))}>
          +12 hours
        </button>
        <button className={btn.ghost} disabled={pending} onClick={() => start(() => setClockAction(24))}>
          +1 day
        </button>
        <button className={btn.ghost} disabled={pending} onClick={() => start(() => setClockAction(72))}>
          +3 days
        </button>
        {offsetHours !== 0 && (
          <button className={btn.quiet} disabled={pending} onClick={() => start(() => setClockAction(0))}>
            Back to real time
          </button>
        )}
      </div>
    </section>
  );
}
