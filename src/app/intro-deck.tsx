"use client";

import { ArrowLeft, ArrowRight, BadgeCheck, Bot, CalendarCheck, CalendarHeart, Clock, HandCoins, MessageCircleWarning, Pause, Play, RefreshCw, ShieldCheck, Sparkles, Wallet, X } from "lucide-react";
import { type CSSProperties, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Logo } from "@/components/ui";
import { DemoLoginButton } from "./demo-login";

const SEEN_KEY = "hd-intro-seen";
const OPEN_EVENT = "halodiary:intro";

// The time maths, shown on the slides so a judge can check it.
const MIN_PER_VISIT = 12; // confirm, reschedule, transfer, chase: HaloDiary's estimate per visit
const VISITS_PER_MONTH = 17; // cleaner twice a week (8.7) + dog walker at weekends (8.7)
const HOURS_A_YEAR = Math.round((MIN_PER_VISIT * VISITS_PER_MONTH * 12) / 60); // 41

/** Opens the intro from anywhere on the landing page. */
export function OpenIntroButton({ className = "" }: { className?: string }) {
  return (
    <button type="button" onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))} className={className}>
      <Play size={14} aria-hidden className="fill-current" /> Watch the 60-second intro
    </button>
  );
}

/** Staggered entrance for one element of a slide. */
function Rise({ i = 0, children, className = "", as: Tag = "div" }: { i?: number; children: ReactNode; className?: string; as?: "div" | "li" | "p" | "h2" | "span" }) {
  return (
    <Tag className={`deck-rise ${className}`} style={{ "--d": `${120 + i * 110}ms` } as CSSProperties}>
      {children}
    </Tag>
  );
}

function CountUp({ to, ms = 1400, active }: { to: number; ms?: number; active: boolean }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return setN(to);
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      setN(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, ms, active]);
  return <>{n}</>;
}

const Kicker = ({ children }: { children: ReactNode }) => (
  <Rise i={0}>
    <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-slate">{children}</p>
  </Rise>
);

const Title = ({ children, i = 1 }: { children: ReactNode; i?: number }) => (
  <Rise i={i}>
    <h2 className="mt-3 max-w-2xl font-display text-[2.1rem] font-extrabold leading-[1.04] sm:text-5xl lg:text-[3.4rem]">{children}</h2>
  </Rise>
);

const Lead = ({ children, i = 2 }: { children: ReactNode; i?: number }) => (
  <Rise i={i}>
    <p className="mt-4 max-w-xl text-base leading-relaxed text-slate sm:text-lg">{children}</p>
  </Rise>
);

type Slide = { ms: number; label: string; render: (active: boolean, close: () => void) => ReactNode };

const SLIDES: Slide[] = [
  {
    ms: 7000,
    label: "The problem",
    render: () => (
      <div className="grid items-center gap-10 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <Kicker>
            <Sparkles size={14} className="text-halo" aria-hidden /> HaloDiary in 60 seconds
          </Kicker>
          <Title>Your home runs on help. The help runs on WhatsApp.</Title>
          <Lead>Cleaners, tutors, dog walkers, babysitters. Recurring visits that someone has to confirm, move, pay for and chase, every single week.</Lead>
        </div>
        <ul className="space-y-3" aria-label="A typical week of messages">
          {[
            ["them", "Are you still coming tomorrow?"],
            ["me", "Can we move Thursday to Friday?"],
            ["them", "Sent €82. Did it arrive?"],
            ["me", "Sorry, can't make it today."],
            ["them", "Which week was that payment for?"],
          ].map(([who, text], i) => (
            <Rise key={text} i={i + 2} as="li" className={`flex ${who === "me" ? "justify-end" : ""}`}>
              <span
                className={`max-w-[80%] px-4 py-2.5 text-sm sm:text-base ${
                  who === "me" ? "clay-btn-ink rounded-3xl rounded-br-lg" : "clay-sm rounded-3xl rounded-bl-lg"
                }`}
              >
                {text}
              </span>
            </Rise>
          ))}
        </ul>
      </div>
    ),
  },
  {
    ms: 7000,
    label: "Why it hurts",
    render: () => (
      <div>
        <Kicker>The hidden job</Kicker>
        <Title>Every visit is a small admin task.</Title>
        <Lead>Nobody owns the schedule, nobody holds the money, and when a visit doesn&apos;t happen, getting it back is awkward.</Lead>
        <ul className="mt-6 grid grid-cols-2 gap-3 sm:mt-8 sm:grid-cols-4">
          {[
            { icon: CalendarCheck, t: "Confirm", b: "Is it still on? Chase it the day before." },
            { icon: RefreshCw, t: "Reschedule", b: "Five messages to move one visit." },
            { icon: HandCoins, t: "Pay", b: "Transfers, cash, often before the work." },
            { icon: MessageCircleWarning, t: "Chase", b: "No-shows, refunds and missing receipts." },
          ].map((x, i) => (
            <Rise key={x.t} i={i + 3} as="li" className="clay p-4 sm:p-5">
              <x.icon size={22} className="text-rose" aria-hidden />
              <p className="mt-3 font-display text-lg font-bold">{x.t}</p>
              <p className="mt-1 text-sm text-slate">{x.b}</p>
            </Rise>
          ))}
        </ul>
      </div>
    ),
  },
  {
    ms: 8500,
    label: "The cost",
    render: (active) => (
      <div className="grid items-center gap-10 lg:grid-cols-[1fr_1fr]">
        <div>
          <Kicker>
            <Clock size={14} aria-hidden /> What it costs
          </Kicker>
          <Title>About {HOURS_A_YEAR} hours a year, lost to admin.</Title>
          <Lead>For one ordinary household with a cleaner twice a week and a dog walker at weekends. Plus money paid before the work is done.</Lead>
        </div>
        <Rise i={3} className="clay p-6 sm:p-8">
          <p className="font-display text-7xl font-extrabold leading-none sm:text-8xl">
            <CountUp to={HOURS_A_YEAR} active={active} />
            <span className="ml-2 text-3xl text-slate sm:text-4xl">h</span>
          </p>
          <p className="mt-2 text-sm font-bold text-slate">every year</p>
          <ol className="mt-6 space-y-2 text-sm">
            <li className="flex justify-between gap-4 border-b border-mist pb-2">
              <span className="text-slate">Admin per visit</span>
              <b>{MIN_PER_VISIT} min</b>
            </li>
            <li className="flex justify-between gap-4 border-b border-mist pb-2">
              <span className="text-slate">Visits a month</span>
              <b>× {VISITS_PER_MONTH}</b>
            </li>
            <li className="flex justify-between gap-4">
              <span className="text-slate">Months</span>
              <b>× 12</b>
            </li>
          </ol>
          <p className="mt-5 text-[11px] leading-relaxed text-slate">
            HaloDiary estimate. For context, UK adults report about 8 hours 48 minutes of personal admin a week (Brightpearl survey of 2,000 adults, 2021).
          </p>
        </Rise>
      </div>
    ),
  },
  {
    ms: 8500,
    label: "The solution",
    render: () => (
      <div>
        <Kicker>
          <CalendarHeart size={14} className="text-halo" aria-hidden /> The solution
        </Kicker>
        <Title>Book it once. HaloDiary runs the rest.</Title>
        <Lead>One diary for every recurring service, with the money handled by PayPal from booking to payout.</Lead>
        <ol className="deck-flow mt-6 grid gap-2.5 sm:mt-9 sm:grid-cols-5 sm:gap-3" aria-label="How a visit runs">
          {[
            { t: "Book", b: "Tell the AI your week in one sentence." },
            { t: "Check", b: "Both sides confirm the day before. Silence means go." },
            { t: "Hold", b: "PayPal holds the price once it's confirmed." },
            { t: "Visit", b: "Late changes follow the signed agreement." },
            { t: "Pay", b: "Charged after the visit, 90% paid to the provider." },
          ].map((x, i) => (
            <Rise key={x.t} i={i + 3} as="li" className="clay relative flex items-start gap-3 rounded-3xl p-3.5 sm:block sm:p-4">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-bold text-white">{i + 1}</span>
              <span className="block">
                <span className="block font-display text-lg font-bold sm:mt-3">{x.t}</span>
                <span className="mt-0.5 block text-sm text-slate sm:mt-1">{x.b}</span>
              </span>
            </Rise>
          ))}
        </ol>
      </div>
    ),
  },
  {
    ms: 9000,
    label: "PayPal and AI",
    render: () => (
      <div>
        <Kicker>How it&apos;s built</Kicker>
        <Title>PayPal and AI, inside every step.</Title>
        <div className="mt-6 grid gap-4 sm:mt-8 lg:grid-cols-2">
          <Rise i={2} className="clay p-5 sm:p-6">
            <p className="flex items-center gap-2 font-display text-xl font-bold">
              <Wallet size={20} className="text-[#003087]" aria-hidden /> PayPal moves the money
            </p>
            <ul className="mt-4 space-y-2.5 text-sm">
              {[
                ["Vault", "approve the month once, no card details stored"],
                ["Orders", "authorise when confirmed, capture after the visit"],
                ["Payouts", "the provider is paid straight after"],
                ["Webhooks", "every step confirmed in the ledger"],
                ["Subscriptions and Invoicing", "for fixed plans and extras"],
              ].map(([k, v]) => (
                <li key={k} className="flex gap-2">
                  <BadgeCheck size={16} className="mt-0.5 shrink-0 text-sage" aria-hidden />
                  <span>
                    <b>{k}:</b> <span className="text-slate">{v}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Rise>
          <Rise i={3} className="clay p-5 sm:p-6">
            <p className="flex items-center gap-2 font-display text-xl font-bold">
              <Bot size={20} className="text-halo" aria-hidden /> AI does the busywork
            </p>
            <ul className="mt-4 space-y-2.5 text-sm">
              {[
                ["Assistant", "finds, books, moves and explains, with one-tap approval"],
                ["Spending limits", "checked before any approval card appears"],
                ["Any agent", "connect your own AI through MCP, under the same limits"],
                ["Provider chat", "quotes extras and settles them with PayPal in the thread"],
              ].map(([k, v]) => (
                <li key={k} className="flex gap-2">
                  <ShieldCheck size={16} className="mt-0.5 shrink-0 text-sage" aria-hidden />
                  <span>
                    <b>{k}:</b> <span className="text-slate">{v}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Rise>
        </div>
      </div>
    ),
  },
  {
    ms: 8500,
    label: "What it saves",
    render: (active) => (
      <div>
        <Kicker>The payoff</Kicker>
        <Title>What one household gets back in a year.</Title>
        <ul className="mt-6 grid grid-cols-2 gap-3 sm:mt-8 lg:grid-cols-4">
          {[
            { big: <CountUp to={HOURS_A_YEAR} active={active} />, unit: "hours", b: "of confirming, rescheduling and chasing, handled for you" },
            { big: <CountUp to={VISITS_PER_MONTH * 12} active={active} />, unit: "payments", b: "made automatically, with no bank transfers" },
            { big: "0", unit: "visits prepaid", b: "money is held, then charged only after each visit" },
            { big: "1", unit: "approval a month", b: "inside a budget and AI limits you set" },
          ].map((x, i) => (
            <Rise key={x.unit} i={i + 2} as="li" className="clay p-4 sm:p-6">
              <p className="font-display text-4xl font-extrabold leading-none sm:text-5xl">{x.big}</p>
              <p className="mt-1 text-sm font-bold">{x.unit}</p>
              <p className="mt-2 text-xs text-slate sm:text-sm">{x.b}</p>
            </Rise>
          ))}
        </ul>
        <Rise i={6}>
          <p className="mt-6 text-sm text-slate">
            And for providers: <b className="text-ink">no chasing</b>. They are paid out after every visit, and late changes are compensated under the agreement.
          </p>
        </Rise>
      </div>
    ),
  },
  {
    ms: 0,
    label: "Try it",
    render: (_active, close) => (
      <div className="mx-auto max-w-2xl text-center">
        <Rise i={0} className="mx-auto mb-6 flex justify-center">
          <span className="halo-ring animate inline-block" style={{ "--fill": 0.82 } as CSSProperties}>
            <span className="flex h-20 w-20 items-center justify-center">
              <CalendarHeart size={30} className="text-halo" aria-hidden />
            </span>
          </span>
        </Rise>
        <Title i={1}>See it run in 90 seconds.</Title>
        <Rise i={2}>
          <p className="mx-auto mt-4 max-w-lg text-base text-slate sm:text-lg">
            One click gives you a ready household. A checklist walks you through approving with PayPal, the day-before check, the payout and the AI.
          </p>
        </Rise>
        <Rise i={3} className="mt-8 flex flex-wrap justify-center gap-3">
          {/* Starting the tour counts as having seen the intro, so it doesn't greet them again on the way back. */}
          <span
            className="contents"
            onClickCapture={() => {
              try {
                localStorage.setItem(SEEN_KEY, "1");
              } catch {}
            }}
          >
            <DemoLoginButton role="client" tour label="Take the 90-second tour" className="px-7 py-3.5" />
          </span>
          <button type="button" onClick={close} className="clay-btn-ghost rounded-full px-6 py-3.5 font-bold">
            Explore the site
          </button>
        </Rise>
        <Rise i={4}>
          <p className="mt-4 text-xs text-slate">No sign-up. Payments run in the PayPal sandbox; no real money moves.</p>
        </Rise>
      </div>
    ),
  },
];

/** A short startup-style intro for first-time visitors (judges): problem, cost, solution, build, payoff, then the tour. */
export function IntroDeck() {
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  const [dir, setDir] = useState<"next" | "prev">("next");
  const [playing, setPlaying] = useState(true);
  const root = useRef<HTMLDivElement>(null);
  const touchX = useRef<number | null>(null);

  // First visit opens it; ?intro=1 always does (handy for recording); the hero button reopens it.
  useEffect(() => {
    let seen = false;
    try {
      seen = localStorage.getItem(SEEN_KEY) === "1";
    } catch {}
    const forced = new URLSearchParams(window.location.search).get("intro") === "1";
    if (forced || !seen) setOpen(true);
    const onOpen = () => {
      setI(0);
      setDir("next");
      setPlaying(true);
      setOpen(true);
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {}
  }, []);

  const go = useCallback(
    (to: number, manual = true) => {
      if (to < 0 || to >= SLIDES.length || to === i) return;
      if (manual) setPlaying(false);
      setDir(to > i ? "next" : "prev");
      setI(to);
    },
    [i],
  );

  useEffect(() => {
    if (!open) return;
    root.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight" || e.key === "PageDown") go(Math.min(SLIDES.length - 1, i + 1));
      else if (e.key === "ArrowLeft" || e.key === "PageUp") go(Math.max(0, i - 1));
      else if (e.key === " " && (e.target as HTMLElement)?.tagName !== "BUTTON") {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, i, go, close]);

  if (!open) return null;
  const slide = SLIDES[i];
  const last = i === SLIDES.length - 1;

  return (
    <div
      ref={root}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-roledescription="slideshow"
      aria-label="HaloDiary intro"
      className="deck fixed inset-0 z-[60] flex flex-col bg-paper outline-none"
      onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchX.current == null) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        touchX.current = null;
        if (Math.abs(dx) > 50) go(dx < 0 ? Math.min(SLIDES.length - 1, i + 1) : Math.max(0, i - 1));
      }}
    >
      <div className="deck-glow" aria-hidden />
      <header className="relative mx-auto flex w-full max-w-6xl items-center gap-4 px-5 pt-5 sm:px-8">
        <Logo />
        <ol className="flex flex-1 gap-1.5" aria-label="Slides">
          {SLIDES.map((s, k) => (
            <li key={s.label} className="flex-1">
              <button type="button" onClick={() => go(k)} className="block w-full py-2" aria-label={`${k + 1}. ${s.label}`} aria-current={k === i ? "step" : undefined}>
                <span className="block h-1 overflow-hidden rounded-full bg-mist">
                  <span
                    key={`${k}-${i}`}
                    className={`block h-full rounded-full bg-ink ${k === i && s.ms ? "deck-bar" : ""}`}
                    style={{
                      width: k < i || (k === i && !s.ms) ? "100%" : k === i ? undefined : "0%",
                      animationDuration: `${s.ms}ms`,
                      animationPlayState: playing ? "running" : "paused",
                    }}
                    onAnimationEnd={() => k === i && go(i + 1, false)}
                  />
                </span>
              </button>
            </li>
          ))}
        </ol>
        <button type="button" onClick={close} className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-bold text-slate hover:text-ink">
          Skip <X size={16} aria-hidden />
        </button>
      </header>

      <main className="relative flex flex-1 overflow-y-auto">
        <section key={i} aria-roledescription="slide" aria-label={`${i + 1} of ${SLIDES.length}: ${slide.label}`} className={`deck-slide deck-${dir} m-auto w-full max-w-6xl px-5 py-6 sm:px-8 sm:py-8`}>
          {slide.render(true, close)}
        </section>
      </main>

      <footer className="relative mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-5 pb-5 sm:px-8">
        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          disabled={!slide.ms}
          className="clay-btn-ghost inline-flex h-11 w-11 items-center justify-center rounded-full disabled:opacity-0"
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? <Pause size={16} aria-hidden /> : <Play size={16} aria-hidden />}
        </button>
        <p className="hidden text-xs text-slate sm:block">Use the arrow keys, or swipe</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => go(i - 1)} disabled={i === 0} className="clay-btn-ghost inline-flex h-11 w-11 items-center justify-center rounded-full disabled:opacity-40" aria-label="Previous slide">
            <ArrowLeft size={18} aria-hidden />
          </button>
          {!last && (
            <button type="button" onClick={() => go(i + 1)} className="clay-btn-ink inline-flex h-11 items-center gap-2 rounded-full px-5 font-bold" aria-label="Next slide">
              Next <ArrowRight size={18} aria-hidden />
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
