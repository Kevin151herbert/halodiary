import { ButtonLink, Halo, Logo } from "@/components/ui";
import { DemoLoginButton } from "./demo-login";

const week = [
  { day: "Mon", items: ["Tutoring 16:30"], fill: 0.25 },
  { day: "Tue", items: ["Cleaning 10:00"], fill: 0.3 },
  { day: "Wed", items: ["Tutoring 16:30", "Security check 18:00"], fill: 0.55 },
  { day: "Thu", items: [], fill: 0 },
  { day: "Fri", items: ["Cleaning 10:00", "Tutoring 16:30"], fill: 0.6 },
  { day: "Sat", items: ["Dog walk 09:00", "Pool 11:00"], fill: 0.65 },
  { day: "Sun", items: ["Dog walk 09:00"], fill: 0.3 },
];

export default function Landing() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-5 sm:px-8">
      <header className="flex items-center justify-between py-6">
        <Logo />
        <nav className="flex items-center gap-2">
          <ButtonLink href="/login" variant="ghost">
            Log in
          </ButtonLink>
        </nav>
      </header>

      <main className="grid flex-1 items-center gap-12 py-10 lg:grid-cols-[1.05fr_1fr] lg:py-16">
        <section>
          <h1 className="max-w-xl text-[2.6rem] font-extrabold leading-[1.02] sm:text-6xl">
            Book every recurring service once. Never chase one again.
          </h1>
          <p className="mt-6 max-w-lg text-lg leading-relaxed text-slate">
            Cleaning twice a week, tutoring three times, the dog walker on weekends, the car every quarter. HaloDiary
            keeps them on one diary, checks with everyone the day before, and pays through PayPal inside a budget you
            approve once a month.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <ButtonLink href="/signup" variant="primary">
              Start your diary
            </ButtonLink>
            <DemoLoginButton />
          </div>
          <dl className="mt-12 grid max-w-lg grid-cols-3 gap-3 sm:gap-4">
            <div className="clay-sm flex flex-col-reverse justify-end p-4">
              <dt className="mt-1 text-xs leading-snug text-slate">Bookings a year, typical busy home</dt>
              <dd className="font-display text-3xl font-extrabold">400</dd>
            </div>
            <div className="clay-sm flex flex-col-reverse justify-end p-4">
              <dt className="mt-1 text-xs leading-snug text-slate">Payment approvals a month</dt>
              <dd className="font-display text-3xl font-extrabold">1</dd>
            </div>
            <div className="clay-sm flex flex-col-reverse justify-end p-4">
              <dt className="mt-1 text-xs leading-snug text-slate">Questions you answer per visit</dt>
              <dd className="font-display text-3xl font-extrabold">0 or 1</dd>
            </div>
          </dl>
        </section>

        <section aria-label="A week on HaloDiary" className="clay p-6 sm:p-8">
          <div className="flex items-baseline justify-between">
            <h2 className="text-xl font-bold">This week</h2>
            <span className="text-sm text-slate">9 visits, all confirmed</span>
          </div>
          <ol className="mt-6 grid grid-cols-7 gap-1.5 sm:gap-3">
            {week.map((d, i) => (
              <li key={d.day} className="flex flex-col items-center gap-2">
                <Halo fill={d.fill} size={44} animate label={`${d.day}: ${d.items.length} visits`}>
                  <span className="text-[11px] font-bold">{d.day}</span>
                </Halo>
                <span className="sr-only">{d.items.join(", ")}</span>
                <span className="hidden text-center text-[11px] leading-tight text-slate sm:block" style={{ animationDelay: `${i * 60}ms` }}>
                  {d.items.length ? d.items.length : "Free"}
                </span>
              </li>
            ))}
          </ol>
          <div className="clay-inset mt-8 p-5">
            <p className="text-sm text-slate">Tomorrow, 10:00</p>
            <p className="mt-1 font-display text-lg font-bold">Cleaning with Amara S.</p>
            <p className="mt-1 text-sm text-slate">Amara has confirmed. Go ahead as planned?</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="clay-btn-ink rounded-full px-4 py-2 text-sm font-bold">Proceed</span>
              <span className="clay-btn-ghost rounded-full px-4 py-2 text-sm font-bold">Move it</span>
              <span className="clay-btn-ghost rounded-full px-4 py-2 text-sm font-bold">Skip</span>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between clay-inset p-5 text-sm">
            <span>November budget, approved with PayPal</span>
            <span className="font-bold">€640 cap</span>
          </div>
        </section>
      </main>

      <footer className="flex flex-col gap-2 py-6 text-sm text-slate sm:flex-row sm:justify-between">
        <span>Built for the PayPal AI Hackathon. Payments run in the PayPal sandbox; no real money moves.</span>
        <span>Demo providers are generated and appear around your location.</span>
      </footer>
    </div>
  );
}
