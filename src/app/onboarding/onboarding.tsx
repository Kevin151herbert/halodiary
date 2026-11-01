"use client";

import { useState, useTransition } from "react";
import { btn, Logo, money } from "@/components/ui";
import { CITIES } from "@/lib/cities";
import { finishOnboarding } from "./actions";

type Service = { id: string; name: string; typical_price: number; category: string };

export function Onboarding({ role, name, services }: { role: "client" | "provider"; name: string; services: Service[] }) {
  const [loc, setLoc] = useState<{ lat: number; lng: number; city: string } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const [offers, setOffers] = useState<Record<string, number>>({});
  const [headline, setHeadline] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function useMyLocation() {
    if (!navigator.geolocation) return setLocError("Your browser doesn't share location. Pick a city instead.");
    setLocating(true);
    setLocError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude, city: "Your location" });
      },
      () => {
        setLocating(false);
        setLocError("Location was blocked. Pick the nearest city instead.");
      },
      { enableHighAccuracy: false, timeout: 10000 },
    );
  }

  const canFinish = loc && (role === "client" || Object.keys(offers).length > 0);

  return (
    <div className="mx-auto max-w-2xl px-5 py-10">
      <Logo />
      <h1 className="mt-10 text-3xl font-extrabold">Hi {name.split(" ")[0]}, where are you?</h1>
      <p className="mt-2 text-slate">
        {role === "client"
          ? "We'll show service providers near you. Your exact position stays on your account and is never shown to providers."
          : "Clients near you will find you in their search."}
      </p>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <button onClick={useMyLocation} className={btn.primary} disabled={locating}>
          {locating ? "Finding you…" : "Use my location"}
        </button>
        <span className="text-sm text-slate">or pick a city</span>
        <select
          aria-label="City"
          className="clay-btn-ghost rounded-full px-4 py-2 text-sm font-bold"
          value={loc && loc.city !== "Your location" ? loc.city : ""}
          onChange={(e) => {
            const c = CITIES.find((x) => x.name === e.target.value);
            if (c) setLoc({ lat: c.lat, lng: c.lng, city: c.name });
          }}
        >
          <option value="">Choose…</option>
          {CITIES.map((c) => (
            <option key={c.name}>{c.name}</option>
          ))}
        </select>
      </div>
      {locError && <p className="mt-3 text-sm text-rose">{locError}</p>}
      {loc && (
        <p className="mt-4 text-sm text-sage">
          Set to {loc.city}
          {loc.city === "Your location" && ` (${loc.lat.toFixed(3)}, ${loc.lng.toFixed(3)})`}.
        </p>
      )}

      {role === "provider" && (
        <section className="mt-10">
          <h2 className="text-xl font-bold">What do you offer?</h2>
          <p className="mt-1 text-sm text-slate">Tick your services and set your price per visit.</p>
          <label className="mt-4 block text-sm font-bold">
            One line about you
            <input
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              placeholder="e.g. Detailed home cleaning, eco products"
              className="clay-inset mt-1.5 w-full px-4 py-3 font-normal"
            />
          </label>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {services.map((s) => {
              const on = s.id in offers;
              return (
                <li key={s.id} className={`flex items-center gap-3 rounded-2xl p-3 ${on ? "clay-sm ring-2 ring-halo" : "clay-inset"}`}>
                  <input
                    type="checkbox"
                    id={`svc-${s.id}`}
                    checked={on}
                    onChange={(e) =>
                      setOffers((o) => {
                        const n = { ...o };
                        if (e.target.checked) n[s.id] = Number(s.typical_price);
                        else delete n[s.id];
                        return n;
                      })
                    }
                  />
                  <label htmlFor={`svc-${s.id}`} className="flex-1 text-sm font-bold">
                    {s.name}
                  </label>
                  {on ? (
                    <input
                      type="number"
                      min={5}
                      step={1}
                      aria-label={`Price for ${s.name}`}
                      value={offers[s.id]}
                      onChange={(e) => setOffers((o) => ({ ...o, [s.id]: Number(e.target.value) }))}
                      className="clay-inset w-20 rounded-lg px-2 py-1 text-right text-sm"
                    />
                  ) : (
                    <span className="text-xs text-slate">from {money(Number(s.typical_price))}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {error && <p className="mt-6 text-sm text-rose">{error}</p>}
      <button
        className={`${btn.halo} mt-10 px-8 py-3`}
        disabled={!canFinish || pending}
        onClick={() =>
          start(async () => {
            const res = await finishOnboarding({
              ...loc!,
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              headline,
              offers: Object.entries(offers).map(([serviceId, price]) => ({ serviceId, price })),
            });
            if (res?.error) setError(res.error);
          })
        }
      >
        {pending ? "Saving…" : role === "client" ? "Show services near me" : "Publish my listing"}
      </button>
    </div>
  );
}
