import { BadgeCheck, Bot, CalendarHeart, Clock, CreditCard, FileSignature, Heart, MessagesSquare, ShieldCheck, Sparkles, Star, Store, Wallet } from "lucide-react";
import Link from "next/link";
import { ButtonLink, Halo, IconChip, Logo, RingGauge } from "@/components/ui";
import { DemoLoginButton } from "./demo-login";

const week = [
  { day: "Mon", n: 1, fill: 0.25 },
  { day: "Tue", n: 1, fill: 0.3 },
  { day: "Wed", n: 2, fill: 0.55 },
  { day: "Thu", n: 0, fill: 0 },
  { day: "Fri", n: 2, fill: 0.6 },
  { day: "Sat", n: 2, fill: 0.65 },
  { day: "Sun", n: 1, fill: 0.3 },
];

const HOW = [
  { icon: Bot, tone: "ink" as const, title: "Tell the AI your week", body: "Write it in one sentence or tap the services you need. The assistant sets cadences and suggests a monthly budget." },
  { icon: Heart, tone: "halo" as const, title: "Swipe your best matches", body: "Every provider gets a match score from attendance, ratings, distance, price fit and how much they share. Swipe or browse a list." },
  { icon: FileSignature, tone: "sage" as const, title: "Sign once, approve once", body: "A service agreement binds both sides on notice, fees and credits. One PayPal approval covers the whole month." },
  { icon: CalendarHeart, tone: "rose" as const, title: "It runs itself", body: "Both sides get a check before each visit. PayPal holds the money when it's confirmed and pays the provider when it's done." },
];

const JUDGE = [
  ["Start as a client", "Tell the assistant your routine, set a budget, swipe right on your matches and sign."],
  ["Approve with PayPal", "On Budget, approve the month with a PayPal sandbox personal account. No real money moves."],
  ["Jump ahead", "On the Diary, press +1 day on the demo clock. Checks go out, money is held, providers are paid."],
  ["Chat like a client", "Open Messages, ask for an extra service, pay the quote with the PayPal button, then rate the visit."],
  ["Switch sides", "Start as a provider: build a profile, load sample clients, accept a new client and see your attendance score."],
];

export default function Landing() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-5 sm:px-8">
      <header className="flex items-center justify-between py-6">
        <Logo />
        <nav className="flex items-center gap-1 sm:gap-2">
          <a href="#how" className="hidden rounded-full px-3 py-2 text-sm font-bold text-slate hover:text-ink sm:inline">
            How it works
          </a>
          <a href="#judges" className="hidden rounded-full px-3 py-2 text-sm font-bold text-slate hover:text-ink sm:inline">
            For judges
          </a>
          <ButtonLink href="/login" variant="ghost">
            Log in
          </ButtonLink>
        </nav>
      </header>

      <main className="flex-1">
        <section className="grid items-center gap-12 py-8 lg:grid-cols-[1.05fr_1fr] lg:py-14">
          <div>
            <p className="clay-sm inline-flex items-center gap-2 px-3 py-1.5 text-xs font-bold">
              <Sparkles size={14} className="text-halo" aria-hidden /> PayPal + AI Hackathon entry
            </p>
            <h1 className="mt-5 max-w-xl text-[2.5rem] font-extrabold leading-[1.03] sm:text-6xl">
              Your home&apos;s recurring services, run by an AI on a PayPal budget.
            </h1>
            <p className="mt-6 max-w-lg text-lg leading-relaxed text-slate">
              Cleaning twice a week, tutoring three times, the dog walker at weekends, the car every quarter. Stop searching, messaging, reminding and paying
              one by one. HaloDiary finds reliable people near you, books them, checks with everyone before each visit, and pays through PayPal inside a
              budget you approve once a month.
            </p>
            <div className="mt-8 flex flex-wrap items-start gap-3">
              <DemoLoginButton role="client" className="px-7 py-3.5" />
              <DemoLoginButton role="provider" variant="ghost" className="px-6 py-3.5" />
            </div>
            <p className="mt-3 text-xs text-slate">One click, no email needed. Payments run in the PayPal sandbox.</p>
          </div>

          <div className="relative">
            <section aria-label="A week on HaloDiary" className="clay p-6 sm:p-8">
              <div className="flex items-baseline justify-between">
                <h2 className="text-xl font-bold">This week</h2>
                <span className="text-sm text-slate">9 visits, all confirmed</span>
              </div>
              <ol className="mt-6 grid grid-cols-7 gap-1.5 sm:gap-3">
                {week.map((d) => (
                  <li key={d.day} className="flex flex-col items-center gap-2">
                    <Halo fill={d.fill} size={44} animate label={`${d.day}: ${d.n} visits`}>
                      <span className="text-[11px] font-bold">{d.day}</span>
                    </Halo>
                    <span className="text-[11px] text-slate">{d.n || "Free"}</span>
                  </li>
                ))}
              </ol>
              <div className="clay-inset mt-7 flex items-center gap-4 p-4">
                <RingGauge value={0.96} size={74} label="96% attendance" />
                <div className="min-w-0">
                  <p className="font-display text-lg font-bold leading-tight">Amara S. · Cleaning</p>
                  <p className="text-sm text-slate">Shows up 96% of the time · 4.9★ · 1.2 km</p>
                  <p className="mt-1 text-xs font-bold text-sage">94% match for you</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="clay-inset p-4">
                  <p className="text-xs text-slate">November budget</p>
                  <p className="font-display text-xl font-extrabold">€640</p>
                  <p className="text-xs text-sage">Approved with PayPal</p>
                </div>
                <div className="clay-inset p-4">
                  <p className="text-xs text-slate">Time saved</p>
                  <p className="font-display text-xl font-extrabold">6.4h</p>
                  <p className="text-xs text-slate">this month</p>
                </div>
              </div>
            </section>
            <div className="clay absolute -bottom-6 -left-4 hidden items-center gap-3 px-4 py-3 sm:flex">
              <IconChip tone="halo" size={36}>
                <CreditCard size={16} />
              </IconChip>
              <div className="text-sm">
                <p className="font-bold">Oven clean, €16</p>
                <p className="text-xs text-slate">Paid in chat with PayPal</p>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-16 grid gap-4 sm:grid-cols-3" aria-label="The problem">
          {[
            [Clock, "12 min", "lost on every booking done by hand (our estimate): search, message, agree, remind, pay"],
            [MessagesSquare, "400", "bookings a year for a busy home, mostly over WhatsApp"],
            [Wallet, "1", "PayPal approval a month on HaloDiary, then it runs itself"],
          ].map(([Icon, big, text]) => {
            const I = Icon as typeof Clock;
            return (
              <div key={String(big)} className="clay flex items-center gap-4 p-5">
                <IconChip tone="ink" size={44}>
                  <I size={20} />
                </IconChip>
                <div>
                  <p className="font-display text-3xl font-extrabold">{String(big)}</p>
                  <p className="text-sm text-slate">{String(text)}</p>
                </div>
              </div>
            );
          })}
        </section>

        <section id="how" className="mt-20 scroll-mt-8">
          <h2 className="text-3xl font-extrabold sm:text-4xl">How it works</h2>
          <ol className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {HOW.map(({ icon: Icon, tone, title, body }, i) => (
              <li key={title} className="clay p-6">
                <div className="flex items-center justify-between">
                  <IconChip tone={tone} size={46}>
                    <Icon size={20} />
                  </IconChip>
                  <span className="font-display text-4xl font-extrabold text-[#d9dde6]">{i + 1}</span>
                </div>
                <h3 className="mt-5 text-lg font-bold">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate">{body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-20 grid gap-4 lg:grid-cols-3">
          {[
            [ShieldCheck, "Agreements both sides sign", "Notice for changes, late fees, credits when a provider cancels, notice to end. The scheduler enforces them and PayPal settles them."],
            [Star, "Attendance you can see", "Every provider shows the share of booked visits they turned up for, moved or cancelled, with the reasons they gave."],
            [Store, "A real provider side", "Providers build a profile with photo, team, website and socials, accept new clients, run their schedule and get paid out."],
          ].map(([Icon, title, body]) => {
            const I = Icon as typeof Clock;
            return (
              <div key={String(title)} className="clay-inset p-6">
                <I size={22} className="text-ink" aria-hidden />
                <h3 className="mt-3 font-bold">{String(title)}</h3>
                <p className="mt-1 text-sm leading-relaxed text-slate">{String(body)}</p>
              </div>
            );
          })}
        </section>

        <section id="judges" className="clay mt-20 scroll-mt-8 p-6 sm:p-10">
          <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr]">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-slate">For judges</p>
              <h2 className="mt-1 text-3xl font-extrabold">Try the whole loop in five minutes</h2>
              <p className="mt-3 text-slate">
                Demo providers with varied ratings and attendance appear around wherever you are. They have no login, so HaloDiary&apos;s AI answers their
                chat in character.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <DemoLoginButton role="client" />
                <DemoLoginButton role="provider" variant="ghost" />
              </div>
              <ul className="mt-8 space-y-2 text-sm">
                {[
                  "PayPal Vault: one approval saves the payer for the month",
                  "PayPal Orders: hold on confirm, capture when done, void on skip",
                  "PayPal Payouts: 90% to the provider after each visit",
                  "Claude: assistant with one-tap approvals, routine parsing, matching welcome, provider chat",
                ].map((t) => (
                  <li key={t} className="flex gap-2">
                    <BadgeCheck size={18} className="mt-0.5 shrink-0 text-sage" aria-hidden />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <ol className="space-y-3">
              {JUDGE.map(([title, body], i) => (
                <li key={title} className="clay-sm flex gap-4 p-4">
                  <span className="clay-btn-ink inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl font-display font-bold">{i + 1}</span>
                  <div>
                    <p className="font-bold">{title}</p>
                    <p className="text-sm text-slate">{body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>
      </main>

      <footer className="mt-16 flex flex-col gap-2 py-8 text-sm text-slate sm:flex-row sm:justify-between">
        <span>Built for the PayPal AI Hackathon. Payments run in the PayPal sandbox; no real money moves.</span>
        <Link href="/signup" className="font-bold text-ink underline">
          Create a full account
        </Link>
      </footer>
    </div>
  );
}
