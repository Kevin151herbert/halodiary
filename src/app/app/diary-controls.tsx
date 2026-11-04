"use client";

import { useState, useTransition } from "react";
import { btn, field } from "@/components/ui";
import {
  markNotificationReadAction,
  planStatusAction,
  providerAction,
  respondAction,
  startSubscriptionAction,
  stopSubscriptionAction,
} from "./actions";
import { moveClock } from "./move-clock";

// Times typed here are wall-clock times in the user's own time zone; the server reads them that way.
export function VisitAnswer({
  visitId,
  suggested,
  skipFee,
  moveFee,
  lateNote,
}: {
  visitId: string;
  suggested: string;
  skipFee?: string | null;
  moveFee?: string | null;
  lateNote?: string | null;
}) {
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
            Move it{moveFee ? ` (${moveFee} late fee)` : ""}
          </button>
          <button
            className={btn.ghost}
            disabled={pending}
            onClick={() => {
              if (!skipFee || confirm(`Skipping now costs a ${skipFee} late fee under your agreement. Skip anyway?`)) run("skip");
            }}
          >
            Skip this one{skipFee ? ` (${skipFee} late fee)` : ""}
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
            className={`${field} w-auto rounded-full`}
          />
          <button className={btn.primary} disabled={pending} onClick={() => run("reschedule", when)}>
            Move visit{moveFee ? ` (${moveFee} fee)` : ""}
          </button>
          <button className={btn.quiet} onClick={() => setMoving(false)}>
            Cancel
          </button>
        </div>
      )}
      {lateNote && <p className="mt-2 text-xs text-slate">Inside the agreement&apos;s notice window: {lateNote}.</p>}
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
            await respondAction(visitId, "reschedule", newTime, true);
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
          if (confirm("End this service? Visits inside the agreement's notice period still go ahead; later ones are removed."))
            start(() => planStatusAction(planId, "ended"));
        }}
      >
        End
      </button>
    </span>
  );
}

/** Lets judges jump ahead in time to see day-before checks, holds and payouts happen. Real time keeps doing the same, just slower. */
export function DemoClock({ offsetHours }: { offsetHours: number }) {
  const [pending, start] = useTransition();
  return (
    <section aria-labelledby="clock" className="clay-inset p-5 sm:p-6">
      <h2 id="clock" className="font-bold">
        Skip ahead in time
      </h2>
      <p className="mt-1 text-sm text-slate">
        HaloDiary works on its own as days pass. Skip ahead to see it: tomorrow&apos;s visits get their day-before check, confirmed visits are held on
        PayPal, and finished ones are charged and paid out to the provider.
        {offsetHours !== 0 && ` You are ${offsetHours >= 24 ? `${Math.round(offsetHours / 24)} day${Math.round(offsetHours / 24) === 1 ? "" : "s"}` : `${offsetHours} hours`} ahead.`}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button className={btn.primary} disabled={pending} onClick={() => start(() => moveClock(24))}>
          {pending ? "Moving time…" : "Skip to tomorrow"}
        </button>
        <button className={btn.ghost} disabled={pending} onClick={() => start(() => moveClock(12))}>
          +12 hours
        </button>
        <button className={btn.ghost} disabled={pending} onClick={() => start(() => moveClock(72))}>
          +3 days
        </button>
        {offsetHours !== 0 && (
          <button className={btn.quiet} disabled={pending} onClick={() => start(() => moveClock(0))}>
            Back to real time
          </button>
        )}
      </div>
    </section>
  );
}

/** Switch a service between paying per visit and a flat monthly PayPal subscription. */
export function BillingControls({
  planId,
  billing,
  status,
  monthly,
  suggested,
  currency,
  paypalReady,
}: {
  planId: string;
  billing: string;
  status: string | null;
  monthly: number | null;
  suggested: number;
  currency: string;
  paypalReady: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const money = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
  if (!paypalReady) return null;
  if (billing === "subscription")
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-[#ffc439]/40 px-2.5 py-1 font-bold text-[#003087]">PayPal subscription · {money(Number(monthly))}/mo</span>
        <button
          className="font-bold text-slate underline hover:text-ink"
          disabled={pending}
          onClick={() => {
            if (confirm("Cancel the PayPal subscription and go back to paying per visit?"))
              start(async () => {
                const r = await stopSubscriptionAction(planId);
                if (r && "error" in r && r.error) setError(r.error);
              });
          }}
        >
          Pay per visit instead
        </button>
        {error && <span className="text-rose">{error}</span>}
      </div>
    );
  return (
    <div className="mt-3 text-xs">
      <button
        className="rounded-full bg-[#ffc439] px-3 py-1.5 font-bold text-[#003087] shadow-[0_6px_12px_-6px_rgba(255,170,0,0.7)] hover:brightness-95 disabled:opacity-50"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await startSubscriptionAction(planId);
            if (r && "approveUrl" in r && r.approveUrl) window.location.href = r.approveUrl;
            else setError((r as { error?: string })?.error ?? "PayPal couldn't start the subscription.");
          })
        }
      >
        {pending ? "Opening PayPal…" : `Pay ${money(suggested)}/mo flat with PayPal (5% under an average month)`}
      </button>
      {status === "APPROVAL_PENDING" && <span className="ml-2 text-slate">Waiting for your PayPal approval.</span>}
      {error && <p className="mt-1 text-rose">{error}</p>}
    </div>
  );
}
