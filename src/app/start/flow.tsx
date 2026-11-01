"use client";

import { ArrowLeft, Check, Heart, Layers, List, MapPin, Sparkles, Undo2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { CATEGORY_TINT, ServiceIcon } from "@/components/service-icon";
import { Avatar, btn, field, IconChip, Logo, RingGauge } from "@/components/ui";
import { CADENCE_KEYS, CADENCES, type CadenceKey } from "@/lib/cadence";
import { CITIES } from "@/lib/cities";
import type { Match, Part } from "@/lib/match";
import { finishStartAction, matchesAction, parseRoutineAction, saveStartLocation, skipStartAction, welcomeAction } from "./actions";

type Service = { id: string; name: string; category: string; default_cadence: string; typical_price: number };
type Step = "where" | "welcome" | "services" | "budget" | "matches" | "review";

const PART_LABEL: Record<Part, string> = {
  attendance: "Attendance",
  rating: "Ratings",
  distance: "Distance",
  price: "Price fit",
  profile: "Profile detail",
};
const WEIGHT_TEXT = "Attendance 25%, ratings 25%, distance 20%, price fit 15%, profile detail 15%";

export function StartFlow({
  name,
  hasLocation,
  city,
  currency,
  services,
  initialInterests,
  initialBudget,
}: {
  name: string;
  hasLocation: boolean;
  city: string | null;
  currency: string;
  services: Service[];
  initialInterests: string[];
  initialBudget: number | null;
}) {
  const steps: Step[] = [...(hasLocation ? [] : (["where"] as Step[])), "welcome", "services", "budget", "matches", "review"];
  const [step, setStep] = useState<Step>(steps[0]);
  const [chosen, setChosen] = useState<Record<string, string>>(() =>
    Object.fromEntries(initialInterests.map((id) => [id, services.find((s) => s.id === id)?.default_cadence ?? "weekly"])),
  );
  const [budget, setBudget] = useState<number>(initialBudget ?? 0);
  const [matches, setMatches] = useState<Record<string, Match[]>>({});
  const [picks, setPicks] = useState<Record<string, Match>>({});
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const money = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);

  const chosenList = services.filter((s) => s.id in chosen);
  const estimate = chosenList.reduce((sum, s) => sum + s.typical_price * (CADENCES[chosen[s.id] as CadenceKey]?.perMonth ?? 1), 0);
  const idx = steps.indexOf(step);
  const go = (s: Step) => {
    setError(null);
    setStep(s);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const loadMatches = () =>
    start(async () => {
      const b = budget || Math.ceil(estimate / 10) * 10;
      if (!budget) setBudget(b);
      const res = await matchesAction(
        chosenList.map((s) => ({ id: s.id, cadence: chosen[s.id], typical_price: s.typical_price })),
        b,
      );
      setMatches(res.matches);
      go("matches");
    });

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-5 py-5 sm:px-8">
        <Logo />
        <form action={skipStartAction}>
          <button className={btn.quiet}>Skip setup</button>
        </form>
      </header>

      <div className="mx-auto max-w-5xl px-5 pb-24 sm:px-8">
        <ol className="clay-inset mx-auto flex max-w-xl items-center justify-between gap-1 rounded-full p-1.5" aria-label="Setup progress">
          {steps.map((s, i) => (
            <li
              key={s}
              aria-current={s === step ? "step" : undefined}
              className={`flex-1 rounded-full px-2 py-1.5 text-center text-[11px] font-bold capitalize transition sm:text-xs ${
                s === step ? "clay-btn-ink" : i < idx ? "text-ink" : "text-slate/70"
              }`}
            >
              <span className={s === step ? "" : "hidden sm:inline"}>{s === "where" ? "Location" : s}</span>
              {s !== step && <span className="sm:hidden">{i + 1}</span>}
            </li>
          ))}
        </ol>

        <div className="mt-10">
          {step === "where" && <WhereStep onDone={() => go("welcome")} />}
          {step === "welcome" && (
            <WelcomeStep
              name={name}
              services={services}
              onParsed={(res) => {
                if (res.services.length) {
                  setChosen(Object.fromEntries(res.services.map((s) => [s.id, s.cadence])));
                  setAiNote(`I picked ${res.services.length} service${res.services.length > 1 ? "s" : ""} from what you wrote. Change anything you like.`);
                }
                if (res.monthly_budget) setBudget(res.monthly_budget);
                go("services");
              }}
              onSkip={() => go("services")}
            />
          )}
          {step === "services" && (
            <ServicesStep
              services={services}
              chosen={chosen}
              setChosen={setChosen}
              aiNote={aiNote}
              money={money}
              onBack={() => go("welcome")}
              onNext={() => {
                if (!budget) setBudget(Math.ceil((estimate * 1.1) / 10) * 10);
                go("budget");
              }}
            />
          )}
          {step === "budget" && (
            <BudgetStep
              chosen={chosen}
              services={chosenList}
              budget={budget}
              setBudget={setBudget}
              estimate={estimate}
              money={money}
              pending={pending}
              onBack={() => go("services")}
              onNext={loadMatches}
            />
          )}
          {step === "matches" && (
            <MatchesStep
              services={chosenList}
              matches={matches}
              picks={picks}
              setPicks={setPicks}
              money={money}
              city={city}
              onBack={() => go("budget")}
              onNext={() => go("review")}
            />
          )}
          {step === "review" && (
            <ReviewStep
              picks={picks}
              chosen={chosen}
              setChosen={setChosen}
              budget={budget}
              money={money}
              pending={pending}
              error={error}
              onBack={() => go("matches")}
              onFinish={(agree) =>
                start(async () => {
                  const res = await finishStartAction({
                    interests: Object.keys(chosen),
                    budget,
                    agree,
                    picks: Object.values(picks).map((m) => ({ providerId: m.provider_id, serviceId: m.service_id, cadence: chosen[m.service_id] })),
                  });
                  if (res?.error) setError(res.error);
                })
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- Location ----------

function WhereStep({ onDone }: { onDone: () => void }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
  const save = (lat: number, lng: number, label: string) =>
    start(async () => {
      await saveStartLocation(lat, lng, label, tz());
      onDone();
    });
  return (
    <section className="clay mx-auto max-w-xl p-6 text-center sm:p-10">
      <IconChip tone="halo" size={56}>
        <MapPin size={26} />
      </IconChip>
      <h1 className="mt-5 text-3xl font-extrabold">Where should we look?</h1>
      <p className="mt-2 text-slate">We match you with providers near you. Your exact position is never shown to them.</p>
      <div className="mt-7 flex flex-col items-center gap-3">
        <button
          className={btn.primary}
          disabled={pending}
          onClick={() => {
            if (!navigator.geolocation) return setMsg("Your browser doesn't share location. Pick a city instead.");
            navigator.geolocation.getCurrentPosition(
              (p) => save(p.coords.latitude, p.coords.longitude, "Your location"),
              () => setMsg("Location was blocked. Pick the nearest city instead."),
              { timeout: 10000 },
            );
          }}
        >
          {pending ? "Saving…" : "Use my location"}
        </button>
        <span className="text-sm text-slate">or</span>
        <select
          aria-label="Choose a city"
          defaultValue=""
          className={`${field} max-w-xs`}
          onChange={(e) => {
            const c = CITIES.find((x) => x.name === e.target.value);
            if (c) save(c.lat, c.lng, c.name);
          }}
        >
          <option value="">Choose a city…</option>
          {CITIES.map((c) => (
            <option key={c.name}>{c.name}</option>
          ))}
        </select>
        {msg && <p className="text-sm text-rose">{msg}</p>}
      </div>
    </section>
  );
}

// ---------- AI welcome ----------

function WelcomeStep({
  name,
  services,
  onParsed,
  onSkip,
}: {
  name: string;
  services: Service[];
  onParsed: (r: { services: { id: string; cadence: string }[]; monthly_budget: number | null }) => void;
  onSkip: () => void;
}) {
  const [text, setText] = useState("");
  const [shown, setShown] = useState("");
  const [ai, setAi] = useState(false);
  const [routine, setRoutine] = useState("");
  const [pending, start] = useTransition();
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    welcomeAction().then((r) => {
      setText(r.text);
      setAi(r.ai);
    });
  }, []);

  // Type the greeting out, like a person writing.
  useEffect(() => {
    if (!text) return;
    let i = 0;
    const t = setInterval(() => {
      i += 3;
      setShown(text.slice(0, i));
      if (i >= text.length) clearInterval(t);
    }, 18);
    return () => clearInterval(t);
  }, [text]);

  return (
    <section className="mx-auto max-w-2xl">
      <div className="flex items-start gap-4">
        <IconChip tone="ink" size={52}>
          <Sparkles size={24} className="text-halo" />
        </IconChip>
        <div className="clay flex-1 rounded-[28px] rounded-tl-lg p-6">
          <p className="text-xs font-bold uppercase tracking-wide text-slate">Your HaloDiary assistant{ai ? "" : ""}</p>
          {!text ? (
            <p className="mt-3 flex gap-1" aria-label="Writing">
              {[0, 1, 2].map((i) => (
                <span key={i} className="h-2 w-2 animate-bounce rounded-full bg-slate/50" style={{ animationDelay: `${i * 120}ms` }} />
              ))}
            </p>
          ) : (
            <p className="mt-2 text-lg leading-relaxed" aria-live="polite">
              {shown}
            </p>
          )}
        </div>
      </div>

      <div className="clay mt-8 p-6 sm:p-7">
        <h1 className="text-2xl font-extrabold">Hi {name}, what does your week need?</h1>
        <p className="mt-1 text-sm text-slate">Tell me in your own words and I&apos;ll set it up, or choose the services yourself.</p>
        <label htmlFor="routine" className="sr-only">
          Your routine
        </label>
        <textarea
          id="routine"
          value={routine}
          onChange={(e) => setRoutine(e.target.value)}
          rows={3}
          placeholder="Cleaning twice a week, a dog walker at weekends, maths tutoring 3 times a week after school. About €600 a month."
          className={`${field} mt-4 resize-none`}
        />
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            className={btn.halo}
            disabled={pending || !routine.trim()}
            onClick={() => start(async () => onParsed(await parseRoutineAction(routine, services)))}
          >
            <Sparkles size={16} aria-hidden /> {pending ? "Reading your routine…" : "Set it up for me"}
          </button>
          <button className={btn.ghost} onClick={onSkip}>
            I&apos;ll choose myself
          </button>
        </div>
      </div>
    </section>
  );
}

// ---------- Services ----------

function ServicesStep({
  services,
  chosen,
  setChosen,
  aiNote,
  money,
  onBack,
  onNext,
}: {
  services: Service[];
  chosen: Record<string, string>;
  setChosen: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  aiNote: string | null;
  money: (n: number) => string;
  onBack: () => void;
  onNext: () => void;
}) {
  const groups = useMemo(() => {
    const m = new Map<string, Service[]>();
    for (const s of services) m.set(s.category, [...(m.get(s.category) ?? []), s]);
    return [...m.entries()];
  }, [services]);
  const n = Object.keys(chosen).length;
  return (
    <section>
      <h1 className="text-center text-3xl font-extrabold sm:text-4xl">Which services do you book again and again?</h1>
      <p className="mx-auto mt-2 max-w-xl text-center text-slate">Pick as many as you like, and how often. You can change them later.</p>
      {aiNote && (
        <p className="clay-sm mx-auto mt-5 flex max-w-xl items-center gap-2 px-4 py-3 text-sm">
          <Sparkles size={16} className="shrink-0 text-halo" aria-hidden /> {aiNote}
        </p>
      )}
      <div className="mt-8 space-y-8">
        {groups.map(([cat, list]) => (
          <div key={cat}>
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate">{cat}</h2>
            <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {list.map((s) => {
                const on = s.id in chosen;
                return (
                  <li key={s.id} className={`rounded-[22px] p-3 transition ${on ? "clay-sm ring-2 ring-halo" : "clay-inset"}`}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        setChosen((c) => {
                          const next = { ...c };
                          if (on) delete next[s.id];
                          else next[s.id] = s.default_cadence;
                          return next;
                        })
                      }
                      className="flex w-full items-center gap-3 text-left"
                    >
                      <span
                        className="clay-chip inline-flex h-10 w-10 shrink-0 items-center justify-center text-ink"
                        style={{ background: CATEGORY_TINT[s.category] ?? CATEGORY_TINT.Home }}
                      >
                        <ServiceIcon id={s.id} size={18} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-bold leading-tight">{s.name}</span>
                        <span className="text-xs text-slate">from {money(s.typical_price)}</span>
                      </span>
                      {on && (
                        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sage text-white" aria-hidden>
                          <Check size={14} />
                        </span>
                      )}
                    </button>
                    {on && (
                      <select
                        aria-label={`How often for ${s.name}`}
                        value={chosen[s.id]}
                        onChange={(e) => setChosen((c) => ({ ...c, [s.id]: e.target.value }))}
                        className={`${field} mt-2 py-2 text-xs`}
                      >
                        {CADENCE_KEYS.map((k) => (
                          <option key={k} value={k}>
                            {CADENCES[k].label}
                          </option>
                        ))}
                      </select>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <Nav onBack={onBack} onNext={onNext} nextLabel={n ? `Continue with ${n}` : "Pick at least one"} disabled={!n} />
    </section>
  );
}

// ---------- Budget ----------

function BudgetStep({
  chosen,
  services,
  budget,
  setBudget,
  estimate,
  money,
  pending,
  onBack,
  onNext,
}: {
  chosen: Record<string, string>;
  services: Service[];
  budget: number;
  setBudget: (n: number) => void;
  estimate: number;
  money: (n: number) => string;
  pending: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  const max = Math.max(200, Math.ceil((estimate * 2) / 50) * 50);
  const pct = Math.min(100, (budget / max) * 100);
  const ratio = estimate ? budget / estimate : 1;
  return (
    <section className="mx-auto max-w-2xl">
      <h1 className="text-center text-3xl font-extrabold sm:text-4xl">Your monthly budget</h1>
      <p className="mx-auto mt-2 max-w-lg text-center text-slate">
        You approve it once with PayPal. Each visit is held when it&apos;s confirmed and charged after it&apos;s done, never above this amount.
      </p>
      <div className="clay mt-8 p-6 sm:p-8">
        <p className="text-center font-display text-6xl font-extrabold">{money(budget)}</p>
        <p className="mt-1 text-center text-sm text-slate">a month</p>
        <div className="relative mt-8">
          <div className="clay-inset relative h-4 rounded-full">
            <div className="fill-halo absolute inset-y-0 left-0 rounded-full" style={{ width: `${pct}%` }} />
          </div>
          <input
            type="range"
            min={20}
            max={max}
            step={10}
            value={budget}
            onChange={(e) => setBudget(Number(e.target.value))}
            aria-label="Monthly budget"
            className="absolute inset-0 h-4 w-full cursor-pointer opacity-0"
          />
          <span className="knob pointer-events-none absolute top-1/2 h-8 w-8 -translate-y-1/2" style={{ left: `calc(${pct}% - 16px)` }} aria-hidden />
        </div>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {[0.9, 1.1, 1.3].map((f) => {
            const v = Math.ceil((estimate * f) / 10) * 10;
            return (
              <button key={f} type="button" onClick={() => setBudget(v)} className={`${btn.ghost} px-4 py-2 text-xs`}>
                {f < 1 ? "Tight" : f < 1.2 ? "Recommended" : "Relaxed"} · {money(v)}
              </button>
            );
          })}
        </div>
        <ul className="clay-inset mt-7 divide-y divide-white/70 px-4 text-sm">
          {services.map((s) => {
            const per = CADENCES[chosen[s.id] as CadenceKey]?.perMonth ?? 1;
            return (
              <li key={s.id} className="flex items-center justify-between gap-3 py-2.5">
                <span>
                  <span className="font-bold">{s.name}</span>
                  <span className="text-slate"> · {CADENCES[chosen[s.id] as CadenceKey]?.label.toLowerCase()}</span>
                </span>
                <span className="shrink-0">≈ {money(s.typical_price * per)}</span>
              </li>
            );
          })}
          <li className="flex justify-between py-2.5 font-bold">
            <span>Typical total</span>
            <span>{money(estimate)}</span>
          </li>
        </ul>
        <p className={`mt-4 text-center text-sm ${ratio < 0.85 ? "text-rose" : "text-slate"}`}>
          {ratio < 0.85
            ? "That's below typical prices, so we'll favour lower-priced providers and you may need fewer visits."
            : ratio > 1.25
              ? "Plenty of room: we'll favour the most reliable providers even if they cost a little more."
              : "A good fit for typical prices near you."}
        </p>
      </div>
      <Nav onBack={onBack} onNext={onNext} nextLabel={pending ? "Finding your matches…" : "Find my matches"} disabled={pending || budget <= 0} />
    </section>
  );
}

// ---------- Matches ----------

function MatchesStep({
  services,
  matches,
  picks,
  setPicks,
  money,
  city,
  onBack,
  onNext,
}: {
  services: Service[];
  matches: Record<string, Match[]>;
  picks: Record<string, Match>;
  setPicks: React.Dispatch<React.SetStateAction<Record<string, Match>>>;
  money: (n: number) => string;
  city: string | null;
  onBack: () => void;
  onNext: () => void;
}) {
  const [active, setActive] = useState(services[0]?.id);
  const [view, setView] = useState<"swipe" | "list">("swipe");
  const list = matches[active] ?? [];
  const n = Object.keys(picks).length;

  const pick = (m: Match) => {
    setPicks((p) => ({ ...p, [m.service_id]: m }));
    const next = services.find((s) => s.id !== m.service_id && !picks[s.id]);
    if (next) setTimeout(() => setActive(next.id), 650);
  };

  return (
    <section>
      <h1 className="text-center text-3xl font-extrabold sm:text-4xl">Your best matches{city ? ` near ${city}` : ""}</h1>
      <p className="mx-auto mt-2 max-w-2xl text-center text-sm text-slate">Ranked by {WEIGHT_TEXT}.</p>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Services">
          {services.map((s) => (
            <button
              key={s.id}
              role="tab"
              aria-selected={active === s.id}
              onClick={() => setActive(s.id)}
              className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold ${active === s.id ? "clay-btn-ink" : "clay-btn-ghost"}`}
            >
              <ServiceIcon id={s.id} size={15} />
              {s.name}
              {picks[s.id] && (
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-sage text-white" aria-label="Chosen">
                  <Check size={12} />
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="clay-inset flex gap-1 rounded-full p-1 text-sm font-bold" role="group" aria-label="View">
          <button onClick={() => setView("swipe")} aria-pressed={view === "swipe"} className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 ${view === "swipe" ? "clay-btn-ink" : "text-slate"}`}>
            <Layers size={14} aria-hidden /> Swipe
          </button>
          <button onClick={() => setView("list")} aria-pressed={view === "list"} className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 ${view === "list" ? "clay-btn-ink" : "text-slate"}`}>
            <List size={14} aria-hidden /> List
          </button>
        </div>
      </div>

      <div className="mt-8">
        {list.length === 0 ? (
          <div className="clay p-8 text-center text-slate">No providers for this service within 15 km yet.</div>
        ) : view === "swipe" ? (
          <Deck key={active} matches={list} picked={picks[active]?.provider_id} onPick={pick} money={money} onList={() => setView("list")} />
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {list.map((m, i) => (
              <li key={m.provider_id}>
                <MatchCard m={m} rank={i + 1} money={money} compact>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      onClick={() => pick(m)}
                      className={`${picks[active]?.provider_id === m.provider_id ? btn.halo : btn.primary} flex-1`}
                      aria-pressed={picks[active]?.provider_id === m.provider_id}
                    >
                      {picks[active]?.provider_id === m.provider_id ? (
                        <>
                          <Check size={16} aria-hidden /> Chosen
                        </>
                      ) : (
                        "Choose"
                      )}
                    </button>
                    <a href={`/app/providers/${m.provider_id}?service=${m.service_id}`} target="_blank" rel="noreferrer" className={btn.ghost}>
                      Profile
                    </a>
                  </div>
                </MatchCard>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Nav onBack={onBack} onNext={onNext} nextLabel={n ? `Review ${n} choice${n > 1 ? "s" : ""}` : "Choose at least one provider"} disabled={!n} />
    </section>
  );
}

function MatchCard({ m, rank, money, compact = false, children }: { m: Match; rank: number; money: (n: number) => string; compact?: boolean; children?: React.ReactNode }) {
  const d = m.details;
  return (
    <article className="clay h-full p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <Avatar name={m.display_name} hue={m.avatar_hue} size={compact ? 56 : 76} photo={m.photo_url} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-slate">#{rank} match</p>
          <h3 className="font-display text-xl font-extrabold leading-tight">{m.display_name}</h3>
          <p className="mt-0.5 line-clamp-2 text-sm text-slate">{m.headline}</p>
        </div>
        <RingGauge value={m.score / 100} size={compact ? 70 : 92} label={`${m.score}% match`} />
      </div>

      <dl className="clay-inset mt-5 grid grid-cols-4 gap-1 px-2 py-3 text-center">
        <Stat label="Attended" value={m.attendance == null ? "New" : `${Math.round(m.attendance * 100)}%`} tone={m.attendance == null ? "" : m.attendance >= 0.9 ? "text-sage" : m.attendance >= 0.75 ? "text-[#b07a10]" : "text-rose"} />
        <Stat label="Rating" value={`${m.rating.toFixed(1)}★`} />
        <Stat label="Away" value={`${m.distance_km.toFixed(1)} km`} />
        <Stat label="A visit" value={money(m.price)} />
      </dl>

      <ul className="mt-4 space-y-2">
        {(Object.keys(PART_LABEL) as Part[]).map((k) => (
          <li key={k} className="flex items-center gap-3 text-xs">
            <span className="w-24 shrink-0 text-slate">{PART_LABEL[k]}</span>
            <span className="clay-inset relative h-2.5 flex-1 rounded-full">
              <span className="fill-halo absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.round(m.parts[k] * 100)}%` }} />
            </span>
          </li>
        ))}
      </ul>

      {!compact && (
        <ul className="mt-4 flex flex-wrap gap-1.5 text-xs">
          {m.reasons.map((r) => (
            <li key={r} className="rounded-full bg-white/80 px-2.5 py-1 font-bold shadow-[2px_3px_6px_-2px_rgba(29,34,56,0.15)]">
              {r}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-slate">
        {[
          d.team_size > 1 ? `Team of ${d.team_size}` : "Works solo",
          d.insured ? "Insured" : null,
          d.certifications || null,
          d.verified ? "ID checked" : null,
          `${d.years_experience} yrs experience`,
          Object.keys(d.socials ?? {}).length ? `On ${Object.keys(d.socials).join(" and ")}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {children}
    </article>
  );
}

function Stat({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <dd className={`font-display text-base font-extrabold ${tone}`}>{value}</dd>
      <dt className="text-[10px] uppercase tracking-wide text-slate">{label}</dt>
    </div>
  );
}

/** Tinder-style deck: drag or tap. Right picks the provider for this service, left passes. */
function Deck({ matches, picked, onPick, money, onList }: { matches: Match[]; picked?: string; onPick: (m: Match) => void; money: (n: number) => string; onList: () => void }) {
  const [i, setI] = useState(0);
  const [dx, setDx] = useState(0);
  const [dy, setDy] = useState(0);
  const [fly, setFly] = useState<0 | 1 | -1>(0);
  const startPt = useRef<{ x: number; y: number } | null>(null);
  const m = matches[i];

  const decide = (dir: 1 | -1) => {
    if (!m || fly) return;
    setFly(dir);
    if (dir === 1) onPick(m);
    setTimeout(() => {
      setFly(0);
      setDx(0);
      setDy(0);
      setI((n) => n + 1);
    }, 280);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") decide(1);
      if (e.key === "ArrowLeft") decide(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!m)
    return (
      <div className="clay mx-auto max-w-md p-8 text-center">
        <p className="font-bold">{picked ? "You've chosen for this service." : "That's everyone nearby for this service."}</p>
        <div className="mt-4 flex justify-center gap-2">
          <button className={btn.ghost} onClick={() => setI(0)}>
            <Undo2 size={16} aria-hidden /> Start again
          </button>
          <button className={btn.ghost} onClick={onList}>
            <List size={16} aria-hidden /> See the list
          </button>
        </div>
      </div>
    );

  const x = fly ? fly * 700 : dx;
  const rot = x / 18;
  return (
    <div className="mx-auto max-w-md">
      <div className="relative">
        {matches[i + 1] && (
          <div className="pointer-events-none absolute inset-x-0 top-0 scale-[0.94] opacity-70" aria-hidden>
            <MatchCard m={matches[i + 1]} rank={i + 2} money={money} />
          </div>
        )}
        <div
          className="relative cursor-grab touch-pan-y select-none active:cursor-grabbing"
          style={{
            transform: `translate(${x}px, ${fly ? dy : dy * 0.25}px) rotate(${rot}deg)`,
            transition: startPt.current ? "none" : "transform 280ms cubic-bezier(0.3,0.7,0.3,1)",
          }}
          onPointerDown={(e) => {
            startPt.current = { x: e.clientX, y: e.clientY };
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!startPt.current) return;
            setDx(e.clientX - startPt.current.x);
            setDy(e.clientY - startPt.current.y);
          }}
          onPointerUp={() => {
            const d = dx;
            startPt.current = null;
            if (d > 110) decide(1);
            else if (d < -110) decide(-1);
            else {
              setDx(0);
              setDy(0);
            }
          }}
          onPointerCancel={() => {
            startPt.current = null;
            setDx(0);
            setDy(0);
          }}
        >
          <MatchCard m={m} rank={i + 1} money={money} />
          <span
            className="pointer-events-none absolute left-6 top-6 rotate-[-12deg] rounded-xl border-4 border-sage px-3 py-1 font-display text-2xl font-extrabold text-sage"
            style={{ opacity: Math.max(0, Math.min(1, x / 120)) }}
            aria-hidden
          >
            PICK
          </span>
          <span
            className="pointer-events-none absolute right-6 top-6 rotate-[12deg] rounded-xl border-4 border-rose px-3 py-1 font-display text-2xl font-extrabold text-rose"
            style={{ opacity: Math.max(0, Math.min(1, -x / 120)) }}
            aria-hidden
          >
            PASS
          </span>
        </div>
      </div>
      <div className="mt-6 flex items-center justify-center gap-5">
        <button onClick={() => setI((n) => Math.max(0, n - 1))} className="clay-btn-ghost inline-flex h-12 w-12 items-center justify-center rounded-full" aria-label="Back to previous" disabled={i === 0}>
          <Undo2 size={18} aria-hidden />
        </button>
        <button onClick={() => decide(-1)} className="clay-btn-ghost inline-flex h-16 w-16 items-center justify-center rounded-full text-rose" aria-label="Pass">
          <X size={28} aria-hidden />
        </button>
        <button onClick={() => decide(1)} className="clay-btn-halo inline-flex h-16 w-16 items-center justify-center rounded-full" aria-label={`Pick ${m.display_name}`}>
          <Heart size={26} fill="currentColor" aria-hidden />
        </button>
        <a
          href={`/app/providers/${m.provider_id}?service=${m.service_id}`}
          target="_blank"
          rel="noreferrer"
          className="clay-btn-ghost inline-flex h-12 items-center justify-center rounded-full px-4 text-xs font-bold"
        >
          Profile
        </a>
      </div>
      <p className="mt-3 text-center text-xs text-slate">
        Drag right to pick, left to pass, or use the arrow keys. {i + 1} of {matches.length}.
      </p>
    </div>
  );
}

// ---------- Review ----------

function ReviewStep({
  picks,
  chosen,
  setChosen,
  budget,
  money,
  pending,
  error,
  onBack,
  onFinish,
}: {
  picks: Record<string, Match>;
  chosen: Record<string, string>;
  setChosen: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  budget: number;
  money: (n: number) => string;
  pending: boolean;
  error: string | null;
  onBack: () => void;
  onFinish: (agree: boolean) => void;
}) {
  const [agree, setAgree] = useState(false);
  const list = Object.values(picks);
  const total = list.reduce((s, m) => s + m.price * (CADENCES[chosen[m.service_id] as CadenceKey]?.perMonth ?? 1), 0);
  return (
    <section className="mx-auto max-w-2xl">
      <h1 className="text-center text-3xl font-extrabold sm:text-4xl">Your new routine</h1>
      <p className="mx-auto mt-2 max-w-lg text-center text-slate">Every visit goes on your diary. Both of you get a check before each one.</p>
      <ul className="mt-8 space-y-3">
        {list.map((m) => (
          <li key={m.service_id} className="clay-sm flex flex-wrap items-center gap-4 p-4">
            <Avatar name={m.display_name} hue={m.avatar_hue} size={48} photo={m.photo_url} />
            <div className="min-w-0 flex-1">
              <p className="font-bold">{m.service_name}</p>
              <p className="text-sm text-slate">
                {m.display_name} · {money(m.price)} a visit · {m.attendance == null ? "new" : `${Math.round(m.attendance * 100)}% attended`}
              </p>
            </div>
            <select
              aria-label={`How often for ${m.service_name}`}
              value={chosen[m.service_id]}
              onChange={(e) => setChosen((c) => ({ ...c, [m.service_id]: e.target.value }))}
              className={`${field} w-auto py-2 text-xs`}
            >
              {CADENCE_KEYS.map((k) => (
                <option key={k} value={k}>
                  {CADENCES[k].label}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ul>
      <div className="clay-inset mt-5 flex items-center justify-between px-5 py-4">
        <span className="text-sm text-slate">Expected each month</span>
        <span className={`font-display text-2xl font-extrabold ${total > budget ? "text-rose" : ""}`}>
          {money(total)} <span className="text-sm font-normal text-slate">of {money(budget)}</span>
        </span>
      </div>

      <div className="clay mt-6 p-6">
        <h2 className="font-bold">Service agreements</h2>
        <p className="mt-1 text-sm leading-relaxed text-slate">
          Each service runs on an agreement you both sign: free changes up to 24 hours before a visit (12 hours for lessons and dog walks), a 50% fee for later
          changes with one free late move a month, a credit to you if the provider moves or cancels late, and 7 days&apos; notice to end. You can change the
          terms for each service any time in Agreements.
        </p>
        <label className="mt-4 flex cursor-pointer items-start gap-3 text-sm">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="clay-switch mt-0.5" />
          <span>I agree to these service agreements. Providers sign them too before any payment is taken.</span>
        </label>
      </div>
      {error && <p className="mt-4 text-center text-sm text-rose">{error}</p>}
      <Nav onBack={onBack} onNext={() => onFinish(agree)} nextLabel={pending ? "Setting up your diary…" : `Sign and add ${list.length} service${list.length > 1 ? "s" : ""}`} disabled={pending || !agree || !list.length} />
      <p className="mt-3 text-center text-xs text-slate">Next you&apos;ll approve your monthly budget with PayPal.</p>
    </section>
  );
}

function Nav({ onBack, onNext, nextLabel, disabled }: { onBack: () => void; onNext: () => void; nextLabel: string; disabled?: boolean }) {
  return (
    <div className="mt-10 flex items-center justify-between gap-3">
      <button onClick={onBack} className={btn.ghost}>
        <ArrowLeft size={16} aria-hidden /> Back
      </button>
      <button onClick={onNext} disabled={disabled} className={`${btn.primary} px-7`}>
        {nextLabel}
      </button>
    </div>
  );
}
