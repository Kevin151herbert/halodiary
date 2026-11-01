"use client";

import { useState, useTransition } from "react";
import { TermSelect } from "@/components/term-select";
import { btn, field } from "@/components/ui";
import { TERM_OPTIONS, type Terms } from "@/lib/contract";
import { declineAgreementAction, proposeAmendmentAction, signAgreementAction } from "../actions";

export function SignButtons({ contractId, who }: { contractId: string; who: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<{ error?: string } | { ok: boolean } | undefined>) =>
    start(async () => {
      const res = await fn();
      if (res && "error" in res && res.error) setError(res.error);
    });
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <button className={btn.halo} disabled={pending} onClick={() => run(() => signAgreementAction(contractId))}>
          Sign as {who}
        </button>
        <button className={btn.ghost} disabled={pending} onClick={() => run(() => declineAgreementAction(contractId))}>
          Decline
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-rose">{error}</p>}
    </div>
  );
}

export function AmendForm({ planId, current, other }: { planId: string; current: Terms; other: string }) {
  const [open, setOpen] = useState(false);
  const [terms, setTerms] = useState(current);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  if (!open)
    return (
      <button className={btn.ghost} onClick={() => setOpen(true)}>
        Propose a change
      </button>
    );
  const set = (k: keyof Terms) => (v: number) => setTerms((t) => ({ ...t, [k]: v }));
  return (
    <form
      className="clay-inset space-y-4 p-4 sm:p-5"
      action={(fd) =>
        start(async () => {
          const res = await proposeAmendmentAction(fd);
          if (res && "error" in res && res.error) setMsg({ ok: false, text: res.error });
          else if (res && "active" in res)
            setMsg({ ok: true, text: res.active ? `${other} accepted. Version ${res.version} is now in force.` : `Sent to ${other} to sign as version ${res.version}.` });
        })
      }
    >
      <input type="hidden" name="plan_id" value={planId} />
      <div className="grid grid-cols-2 gap-3">
        <TermSelect label="Free changes up to" name="cancellation_notice_hours" value={terms.cancellation_notice_hours} unit={(v) => `${v}h before`} onChange={(v) => setTerms((t) => ({ ...t, cancellation_notice_hours: v, reminder_hours: Math.max(t.reminder_hours, v + 12) }))} />
        <TermSelect label="Late change fee" name="late_cancellation_fee_pct" value={terms.late_cancellation_fee_pct} unit={(v) => (v ? `${v}% of visit` : "None")} onChange={set("late_cancellation_fee_pct")} />
        <TermSelect label="Free late moves" name="free_reschedules_per_month" value={terms.free_reschedules_per_month} unit={(v) => `${v} a month`} onChange={set("free_reschedules_per_month")} />
        <TermSelect label="Notice to end" name="termination_notice_days" value={terms.termination_notice_days} unit={(v) => (v ? `${v} days` : "Any time")} onChange={set("termination_notice_days")} />
        <TermSelect label="Reminder" name="reminder_hours" value={terms.reminder_hours} unit={(v) => `${v}h before`} options={TERM_OPTIONS.reminder_hours.filter((h) => h >= terms.cancellation_notice_hours + 12)} onChange={set("reminder_hours")} />
        <TermSelect label="Price fixed for" name="price_lock_months" value={terms.price_lock_months} unit={(v) => `${v} month${v > 1 ? "s" : ""}`} onChange={set("price_lock_months")} />
      </div>
      <label className="block text-xs font-bold text-slate">
        Note for {other} (optional)
        <input name="note" maxLength={200} placeholder="Why the change" className={`${field} mt-1 text-ink`} />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn.primary} disabled={pending}>
          Sign and send version
        </button>
        <button type="button" className={btn.quiet} onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
      {msg && <p className={`text-sm font-bold ${msg.ok ? "text-sage" : "text-rose"}`}>{msg.text}</p>}
    </form>
  );
}
