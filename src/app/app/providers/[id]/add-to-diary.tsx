"use client";

import { useMemo, useState } from "react";
import { btn, field, money } from "@/components/ui";
import { CADENCE_KEYS, CADENCES, cadenceLabel, defaultWeekdays, WEEKDAY_NAMES } from "@/lib/cadence";
import { TermSelect } from "@/components/term-select";
import { clauses, defaultTermsFor, TERM_OPTIONS, type Terms } from "@/lib/contract";
import { addPlanAction } from "../../actions";

type Offer = { id: string; name: string; price: number; cadence: string };

export function AddToDiary({
  providerId,
  providerName,
  offers,
  initialService,
  currency,
  clientName,
}: {
  providerId: string;
  providerName: string;
  offers: Offer[];
  initialService: string;
  currency: string;
  clientName: string;
}) {
  const [serviceId, setServiceId] = useState(initialService);
  const [terms, setTerms] = useState<Terms>(defaultTermsFor(initialService));
  const [agreed, setAgreed] = useState(false);
  const offer = offers.find((o) => o.id === serviceId)!;
  const [cadence, setCadence] = useState(offer.cadence);
  const [weekdays, setWeekdays] = useState<number[]>(defaultWeekdays(offer.cadence));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const c = CADENCES[cadence as keyof typeof CADENCES];
  const usesWeekdays = c?.kind === "weekdays";
  const perMonth = useMemo(() => (usesWeekdays ? (weekdays.length * 52) / 12 : c?.perMonth ?? 0), [usesWeekdays, weekdays, c]);

  return (
    <form
      action={async (fd) => {
        setBusy(true);
        const res = await addPlanAction(fd);
        if (res?.error) {
          setError(res.error);
          setBusy(false);
        }
      }}
      className="clay p-6 sm:p-7"
    >
      <h2 className="text-xl font-bold">Add {providerName.split(" ")[0]} to your diary</h2>
      <p className="mt-1 text-sm text-slate">Set it once. Every visit is checked the day before and paid inside your monthly budget.</p>
      <input type="hidden" name="provider_id" value={providerId} />

      <label className="mt-5 block text-sm font-bold">
        Service
        <select
          name="service_id"
          value={serviceId}
          onChange={(e) => {
            const o = offers.find((x) => x.id === e.target.value)!;
            setServiceId(o.id);
            setTerms(defaultTermsFor(o.id));
            setAgreed(false);
            setCadence(o.cadence);
            setWeekdays(defaultWeekdays(o.cadence));
          }}
          className={`${field} mt-1.5`}
        >
          {offers.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}, {money(o.price, currency)}
            </option>
          ))}
        </select>
      </label>

      <label className="mt-4 block text-sm font-bold">
        How often
        <select
          name="cadence"
          value={cadence}
          onChange={(e) => {
            setCadence(e.target.value);
            setWeekdays(defaultWeekdays(e.target.value));
          }}
          className={`${field} mt-1.5`}
        >
          {CADENCE_KEYS.map((k) => (
            <option key={k} value={k}>
              {CADENCES[k].label}
            </option>
          ))}
        </select>
      </label>

      {usesWeekdays && (
        <fieldset className="mt-4">
          <legend className="text-sm font-bold">On these days</legend>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {[1, 2, 3, 4, 5, 6, 0].map((d) => {
              const on = weekdays.includes(d);
              return (
                <label key={d} className={`cursor-pointer rounded-full px-3 py-1.5 text-sm font-bold transition ${on ? "clay-btn-ink" : "clay-btn-ghost text-slate"}`}>
                  <input
                    type="checkbox"
                    name="weekdays"
                    value={d}
                    checked={on}
                    onChange={() => setWeekdays((w) => (on ? w.filter((x) => x !== d) : [...w, d]))}
                    className="sr-only"
                  />
                  {WEEKDAY_NAMES[d]}
                </label>
              );
            })}
          </div>
        </fieldset>
      )}

      <label className="mt-4 block text-sm font-bold">
        Time
        <input type="time" name="time" defaultValue="10:00" className={`${field} mt-1.5`} />
      </label>

      <div className="clay-inset mt-6 flex items-baseline justify-between px-4 py-3">
        <span className="text-sm text-slate">About {perMonth.toFixed(perMonth < 1 ? 2 : 1)} visits a month</span>
        <span className="font-display text-lg font-bold">{money(perMonth * offer.price, currency)}/mo</span>
      </div>
      <fieldset className="mt-7">
        <legend className="text-lg font-bold">Service agreement</legend>
        <p className="mt-1 text-sm text-slate">Both of you are bound by these terms. Set yours; {providerName.split(" ")[0]}&apos;s commitments are fixed.</p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <TermSelect label="Free changes up to" name="cancellation_notice_hours" value={terms.cancellation_notice_hours} unit={(v) => `${v}h before`} onChange={(v) => setTerms((t) => ({ ...t, cancellation_notice_hours: v, reminder_hours: Math.max(t.reminder_hours, v + 12) }))} />
          <TermSelect label="Late change fee" name="late_cancellation_fee_pct" value={terms.late_cancellation_fee_pct} unit={(v) => (v ? `${v}% of visit` : "None")} onChange={(v) => setTerms((t) => ({ ...t, late_cancellation_fee_pct: v }))} />
          <TermSelect label="Free late moves" name="free_reschedules_per_month" value={terms.free_reschedules_per_month} unit={(v) => `${v} a month`} onChange={(v) => setTerms((t) => ({ ...t, free_reschedules_per_month: v }))} />
          <TermSelect label="Notice to end" name="termination_notice_days" value={terms.termination_notice_days} unit={(v) => (v ? `${v} days` : "Any time")} onChange={(v) => setTerms((t) => ({ ...t, termination_notice_days: v }))} />
          <TermSelect label="Reminder" name="reminder_hours" value={terms.reminder_hours} unit={(v) => `${v}h before`} options={TERM_OPTIONS.reminder_hours.filter((h) => h >= terms.cancellation_notice_hours + 12)} onChange={(v) => setTerms((t) => ({ ...t, reminder_hours: v }))} />
          <TermSelect label="Price fixed for" name="price_lock_months" value={terms.price_lock_months} unit={(v) => `${v} month${v > 1 ? "s" : ""}`} onChange={(v) => setTerms((t) => ({ ...t, price_lock_months: v }))} />
        </div>
        <div className="clay-inset mt-3 px-4 py-3 text-sm">
          <p className="font-bold">{providerName.split(" ")[0]} commits to</p>
          <p className="mt-1 text-slate">
            {terms.provider_change_notice_hours}h notice for any change. Later moves credit you {terms.provider_late_change_credit_pct}%; late cancellations credit you {terms.provider_cancellation_credit_pct}%, taken off the next payment.
          </p>
        </div>
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer font-bold text-slate hover:text-ink">Read the full agreement</summary>
          <ol className="mt-3 space-y-3">
            {clauses(terms, {
              client: clientName,
              provider: providerName,
              service: offer.name,
              price: offer.price,
              currency,
              schedule: cadenceLabel(cadence, weekdays).toLowerCase(),
            }).map((c, i) => (
              <li key={c.title}>
                <p className="font-bold">
                  {i + 1}. {c.title}
                </p>
                <p className="mt-0.5 leading-relaxed text-slate">{c.body}</p>
              </li>
            ))}
          </ol>
        </details>
        <label className="mt-4 flex cursor-pointer items-start gap-3 text-sm">
          <input type="checkbox" name="agree" required checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="clay-switch mt-0.5" />
          <span>
            I agree to this service agreement. {providerName.split(" ")[0]} signs it too before any payment is taken, and either of us can propose changes later.
          </span>
        </label>
      </fieldset>

      {error && <p className="mt-3 text-sm text-rose">{error}</p>}
      <button disabled={busy || !agreed || (usesWeekdays && weekdays.length === 0)} className={`${btn.primary} mt-5 w-full py-3.5`}>
        {busy ? "Adding…" : "Sign and add to diary"}
      </button>
    </form>
  );
}

