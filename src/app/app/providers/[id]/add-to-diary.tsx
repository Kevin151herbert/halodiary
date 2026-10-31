"use client";

import { useMemo, useState } from "react";
import { btn, money } from "@/components/ui";
import { CADENCE_KEYS, CADENCES, defaultWeekdays, WEEKDAY_NAMES } from "@/lib/cadence";
import { addPlanAction } from "../../actions";

type Offer = { id: string; name: string; price: number; cadence: string };

export function AddToDiary({
  providerId,
  providerName,
  offers,
  initialService,
  currency,
}: {
  providerId: string;
  providerName: string;
  offers: Offer[];
  initialService: string;
  currency: string;
}) {
  const [serviceId, setServiceId] = useState(initialService);
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
      className="rounded-3xl border border-mist bg-card p-6"
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
            setCadence(o.cadence);
            setWeekdays(defaultWeekdays(o.cadence));
          }}
          className="mt-1 w-full rounded-xl border border-mist bg-card px-3 py-2.5 font-normal"
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
          className="mt-1 w-full rounded-xl border border-mist bg-card px-3 py-2.5 font-normal"
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
                <label key={d} className={`cursor-pointer rounded-full border px-3 py-1.5 text-sm font-bold ${on ? "border-ink bg-ink text-white" : "border-mist"}`}>
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
        <input type="time" name="time" defaultValue="10:00" className="mt-1 w-full rounded-xl border border-mist bg-card px-3 py-2.5 font-normal" />
      </label>

      <div className="mt-6 flex items-baseline justify-between rounded-2xl bg-paper px-4 py-3">
        <span className="text-sm text-slate">About {perMonth.toFixed(perMonth < 1 ? 2 : 1)} visits a month</span>
        <span className="font-display text-lg font-bold">{money(perMonth * offer.price, currency)}/mo</span>
      </div>
      {error && <p className="mt-3 text-sm text-rose">{error}</p>}
      <button disabled={busy || (usesWeekdays && weekdays.length === 0)} className={`${btn.primary} mt-5 w-full py-3`}>
        {busy ? "Adding…" : "Add to diary"}
      </button>
    </form>
  );
}
