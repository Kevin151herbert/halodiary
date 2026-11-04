import { Card, Meter, money } from "@/components/ui";
import { forecastMonth, monthKey, nowFor, spentInMonth } from "@/lib/engine";
import { paypalConfigured } from "@/lib/paypal";
import { getSession } from "@/lib/supabase/server";
import { fmt, monthLabel } from "@/lib/time";
import { SimulatedApprove } from "./simulated-approve";
import { PayPalV6Button } from "./paypal-v6-button";
import { StatementButton } from "./statement-button";
import { LedgerGrid } from "@/components/ledger-grid-lazy";

const LABEL: Record<string, string> = {
  hold: "Held",
  capture: "Charged",
  void: "Released",
  payout: "Paid provider",
  refund: "Refunded",
  fee: "Late change fee",
  credit: "Agreement credit",
  extra: "Extra paid in chat",
};

type LedgerRow = {
  id: string;
  kind: string;
  amount: number;
  paypal_ref: string | null;
  mode: string;
  note: string | null;
  created_at: string;
  paypal_confirmed_at: string | null;
  providers: { display_name: string } | null;
  visits: { scheduled_at: string; services: { name: string } | null } | null;
};

export default async function BudgetPage({ searchParams }: { searchParams: Promise<{ m?: string; approved?: string; paypal_error?: string; welcome?: string }> }) {
  const { m, approved, paypal_error, welcome } = await searchParams;
  const { supabase, profile } = await getSession();
  const p = profile!;
  const now = nowFor(p);
  const thisMonth = monthKey(now, p.timezone);
  const nextMonth = monthKey(now, p.timezone, 1);
  const month = m === "next" ? nextMonth : thisMonth;
  const label = monthLabel(month);

  const [raw, { data: budget }, used, { data: ledger }, { data: openCredits }] = await Promise.all([
    forecastMonth(supabase, p, month),
    supabase.from("budgets").select("*").eq("client_id", p.id).eq("month", month).maybeSingle(),
    spentInMonth(supabase, p, month),
    supabase
      .from("ledger_entries")
      .select("id, kind, amount, paypal_ref, mode, note, created_at, paypal_confirmed_at, paypal_status, providers(display_name), visits(scheduled_at, services(name))")
      .eq("client_id", p.id)
      .order("created_at", { ascending: false })
      .limit(500),
    supabase.from("ledger_entries").select("amount").eq("client_id", p.id).eq("kind", "credit").is("settled_at", null),
  ]);
  // The budget chosen during setup becomes the suggested cap when it covers the forecast.
  const forecast = { ...raw, cap: p.monthly_budget && Number(p.monthly_budget) >= raw.total ? Number(p.monthly_budget) : raw.cap };

  const cap = budget ? Number(budget.cap) : forecast.cap;
  const pct = cap ? Math.min(100, (used / cap) * 100) : 0;
  const credit = (openCredits ?? []).reduce((s, c) => s + Number(c.amount), 0);
  const realPayPal = paypalConfigured();
  // The first line that went through PayPal: simulated lines after it mean PayPal failed and HaloDiary carried on.
  const paypalSince =
    ((ledger ?? []) as unknown as LedgerRow[]).filter((e) => e.mode === "paypal_sandbox").map((e) => e.created_at).sort().at(0) ?? "9999-12-31";

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold sm:text-4xl">Budget for {label}</h1>
          <p className="mt-2 max-w-prose text-slate">
            Approve once with PayPal. Each visit is then held when it&apos;s confirmed and charged only after it&apos;s done, always inside this cap.
          </p>
        </div>
        <nav className="clay-inset flex gap-1 rounded-full p-1 text-sm font-bold" aria-label="Month">
          <a href="/app/budget" className={`rounded-full px-4 py-1.5 ${month === thisMonth ? "clay-btn-ink" : ""}`}>
            This month
          </a>
          <a href="/app/budget?m=next" className={`rounded-full px-4 py-1.5 ${month === nextMonth ? "clay-btn-ink" : ""}`}>
            Next month
          </a>
        </nav>
      </div>

      {welcome && !budget && (
        <div className="clay flex flex-wrap items-center gap-4 p-5">
          <span className="clay-btn-halo inline-flex h-11 w-11 items-center justify-center rounded-2xl font-display text-lg font-extrabold">✓</span>
          <div className="min-w-0 flex-1">
            <p className="font-bold">Your services are on the diary and the agreements are signed.</p>
            <p className="text-sm text-slate">Last step: approve {label} with PayPal. Nothing is charged until a visit is done.</p>
          </div>
        </div>
      )}
      {approved && <p className="clay-sm px-4 py-3 font-bold text-sage">Budget approved{approved === "paypal" ? " with PayPal" : ""}. Visits will now confirm on their own.</p>}
      {paypal_error && (
        <p className="clay-sm px-4 py-3 text-sm text-rose">
          {paypal_error === "cancelled"
            ? "PayPal approval was cancelled. Nothing was saved."
            : paypal_error === "not_configured"
              ? "PayPal sandbox keys aren't set on this deployment, so use the simulated approval."
              : `PayPal couldn't finish: ${paypal_error}`}
        </p>
      )}

      <section className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card className="p-6">
          <h2 className="text-lg font-bold">What {label} will cost</h2>
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="text-left text-slate">
                <th className="pb-2 font-normal">Service</th>
                <th className="pb-2 text-right font-normal">Visits</th>
                <th className="pb-2 text-right font-normal">Each</th>
                <th className="pb-2 text-right font-normal">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-mist">
              {forecast.lines.map((l) => (
                <tr key={l.planId}>
                  <td className="py-2.5">
                    <span className="font-bold">{l.service}</span> <span className="text-slate">{l.provider}</span>
                  </td>
                  <td className="py-2.5 text-right">{l.visits}</td>
                  <td className="py-2.5 text-right">{l.subscription ? <span className="text-xs font-bold text-[#003087]">PayPal monthly</span> : money(l.price, p.currency)}</td>
                  <td className="py-2.5 text-right font-bold">{money(l.total, p.currency)}</td>
                </tr>
              ))}
              {forecast.lines.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-4 text-slate">
                    No recurring services yet. Add one from Discover.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td className="pt-3 font-bold" colSpan={3}>
                  Forecast
                </td>
                <td className="pt-3 text-right font-bold">{money(forecast.total, p.currency)}</td>
              </tr>
              <tr className="text-slate">
                <td className="pt-1" colSpan={3}>
                  Suggested cap, with a 10% buffer
                </td>
                <td className="pt-1 text-right">{money(forecast.cap, p.currency)}</td>
              </tr>
            </tfoot>
          </table>
        </Card>

        <Card className="flex flex-col p-6">
          {budget?.status === "approved" ? (
            <>
              <p className="text-sm font-bold text-sage">Approved {budget.approval_mode === "paypal_sandbox" ? "with PayPal sandbox" : "(simulated)"}</p>
              <p className="mt-2 font-display text-4xl font-extrabold">{money(cap, p.currency)}</p>
              <p className="text-sm text-slate">monthly cap</p>
              <div className="mt-6">
                <Meter value={pct / 100} label={`${pct.toFixed(0)}% of the cap used`} />
              </div>
              <p className="mt-3 text-sm">
                {money(used, p.currency)} held or paid, {money(Math.max(0, cap - used), p.currency)} left
              </p>
              {credit > 0 && (
                <p className="clay-inset mt-4 px-3 py-2 text-sm">
                  <span className="font-bold text-sage">{money(credit, p.currency)} credit</span> from provider changes, taken off your next payments.
                </p>
              )}
              {p.paypal_payer_email && <p className="mt-auto pt-6 text-xs text-slate">Paying with PayPal account {p.paypal_payer_email}</p>}
              {realPayPal && !p.paypal_payment_token && (
                <form action="/api/paypal/start" method="post" className="mt-auto pt-6">
                  <input type="hidden" name="month" value={month} />
                  <input type="hidden" name="cap" value={cap} />
                  <p className="mb-2 text-xs text-slate">This month was approved without PayPal. Switch to real PayPal sandbox payments:</p>
                  <button className="w-full rounded-full bg-[#ffc439] px-5 py-3 text-sm font-bold text-[#003087] shadow-[0_12px_22px_-8px_rgba(255,170,0,0.7),inset_1px_2px_2px_rgba(255,255,255,0.6)] hover:brightness-95">Switch to PayPal</button>
                </form>
              )}
            </>
          ) : (
            <>
              <p className="text-sm text-slate">Approve once for {label}</p>
              <p className="mt-2 font-display text-4xl font-extrabold">{money(forecast.cap, p.currency)}</p>
              <p className="text-sm text-slate">
                cap, charged per visit{p.monthly_budget && Number(p.monthly_budget) >= raw.total ? " (the budget you set)" : ""}
              </p>
              <div className="mt-6 space-y-3">
                {realPayPal && (
                  forecast.lines.length ? (
                    <PayPalV6Button
                      month={month}
                      cap={forecast.cap}
                      currency={p.currency}
                      fallback={
                  <form action="/api/paypal/start" method="post">
                    <input type="hidden" name="month" value={month} />
                    <input type="hidden" name="cap" value={forecast.cap} />
                    <button disabled={!forecast.lines.length} className="w-full rounded-full bg-[#ffc439] px-5 py-3.5 font-bold text-[#003087] shadow-[0_12px_22px_-8px_rgba(255,170,0,0.7),inset_1px_2px_2px_rgba(255,255,255,0.6)] hover:brightness-95 disabled:opacity-50">
                      Approve with PayPal
                    </button>
                  </form>
                      }
                    />
                  ) : (
                  <form action="/api/paypal/start" method="post">
                    <input type="hidden" name="month" value={month} />
                    <input type="hidden" name="cap" value={forecast.cap} />
                    <button disabled={!forecast.lines.length} className="w-full rounded-full bg-[#ffc439] px-5 py-3.5 font-bold text-[#003087] shadow-[0_12px_22px_-8px_rgba(255,170,0,0.7),inset_1px_2px_2px_rgba(255,255,255,0.6)] hover:brightness-95 disabled:opacity-50">
                      Approve with PayPal
                    </button>
                  </form>
                  )
                )}
                {realPayPal ? (
                  // PayPal is the product; simulation is a fallback, not a choice next to it.
                  <details className="text-center text-xs text-slate">
                    <summary className="cursor-pointer font-bold underline decoration-mist decoration-2 underline-offset-2">Can&apos;t use PayPal right now?</summary>
                    <p className="mt-2">Approve with a simulated payment instead. Every step still runs, labelled &quot;Simulated&quot; in the ledger.</p>
                    <div className="mt-2">
                      <SimulatedApprove month={month} cap={forecast.cap} disabled={!forecast.lines.length} primary={false} />
                    </div>
                  </details>
                ) : (
                  <SimulatedApprove month={month} cap={forecast.cap} disabled={!forecast.lines.length} primary />
                )}
              </div>
              <p className="mt-auto pt-6 text-xs text-slate">
                {realPayPal
                  ? "PayPal sandbox: log in with a sandbox personal account. You approve once; no money moves until a visit is done."
                  : "PayPal sandbox keys are not set on this deployment, so approvals and payments are simulated."}
              </p>
            </>
          )}
        </Card>
      </section>

      <section>
        <h2 className="text-xl font-bold">Payments ledger</h2>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate">Every hold, charge, release, refund and payout, with its PayPal reference. A tick means PayPal confirmed it by webhook.</p>
          {realPayPal && p.paypal_payer_email && <StatementButton month={month} label={label} />}
        </div>
        <div className="mt-4">
          <LedgerGrid
            currency={p.currency}
            fileName={`halodiary-ledger-${month.slice(0, 7)}.csv`}
            rows={((ledger ?? []) as unknown as LedgerRow[]).map((e) => ({
              id: e.id,
              when: e.created_at,
              whenLabel: fmt(e.created_at, p.timezone, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
              what: LABEL[e.kind as string] ?? e.kind,
              service: e.visits?.services?.name ?? "",
              party: e.providers?.display_name ?? "",
              amount: ["credit", "refund", "void"].includes(e.kind) ? -Number(e.amount) : Number(e.amount),
              ref: e.paypal_ref ?? "",
              // With a saved PayPal account every money line should be PayPal; a simulated one means PayPal failed and the app carried on.
              mode: e.mode === "paypal_sandbox" ? "Sandbox" : p.paypal_payment_token && e.kind !== "credit" && new Date(e.created_at) > new Date(paypalSince) ? "Simulated: PayPal unavailable" : "Simulated",
              confirmed: e.paypal_confirmed_at ? "PayPal ✓" : e.mode === "paypal_sandbox" ? "Waiting" : "",
              note: e.note ?? "",
            }))}
          />
        </div>
      </section>
    </div>
  );
}
