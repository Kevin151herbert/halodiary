import { Card, Meter, money } from "@/components/ui";
import { forecastMonth, monthKey, nowFor, spentInMonth } from "@/lib/engine";
import { paypalConfigured } from "@/lib/paypal";
import { getSession } from "@/lib/supabase/server";
import { fmt, monthLabel } from "@/lib/time";
import { SimulatedApprove } from "./simulated-approve";

export default async function BudgetPage({ searchParams }: { searchParams: Promise<{ m?: string; approved?: string; paypal_error?: string; welcome?: string }> }) {
  const { m, approved, paypal_error, welcome } = await searchParams;
  const { supabase, profile } = await getSession();
  const p = profile!;
  const now = nowFor(p);
  const thisMonth = monthKey(now, p.timezone);
  const nextMonth = monthKey(now, p.timezone, 1);
  const month = m === "next" ? nextMonth : thisMonth;
  const label = monthLabel(month);

  const raw = await forecastMonth(supabase, p, month);
  // The budget chosen during setup becomes the suggested cap when it covers the forecast.
  const forecast = { ...raw, cap: p.monthly_budget && Number(p.monthly_budget) >= raw.total ? Number(p.monthly_budget) : raw.cap };
  const { data: budget } = await supabase.from("budgets").select("*").eq("client_id", p.id).eq("month", month).maybeSingle();
  const used = await spentInMonth(supabase, p, month);
  const { data: ledger } = await supabase
    .from("ledger_entries")
    .select("*, providers(display_name), visits(scheduled_at, services(name))")
    .eq("client_id", p.id)
    .order("created_at", { ascending: false })
    .limit(25);

  const cap = budget ? Number(budget.cap) : forecast.cap;
  const pct = cap ? Math.min(100, (used / cap) * 100) : 0;
  const { data: openCredits } = await supabase.from("ledger_entries").select("amount").eq("client_id", p.id).eq("kind", "credit").is("settled_at", null);
  const credit = (openCredits ?? []).reduce((s, c) => s + Number(c.amount), 0);
  const realPayPal = paypalConfigured();

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
                  <td className="py-2.5 text-right">{money(l.price, p.currency)}</td>
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
                  <form action="/api/paypal/start" method="post">
                    <input type="hidden" name="month" value={month} />
                    <input type="hidden" name="cap" value={forecast.cap} />
                    <button disabled={!forecast.lines.length} className="w-full rounded-full bg-[#ffc439] px-5 py-3.5 font-bold text-[#003087] shadow-[0_12px_22px_-8px_rgba(255,170,0,0.7),inset_1px_2px_2px_rgba(255,255,255,0.6)] hover:brightness-95 disabled:opacity-50">
                      Approve with PayPal
                    </button>
                  </form>
                )}
                <SimulatedApprove month={month} cap={forecast.cap} disabled={!forecast.lines.length} primary={!realPayPal} />
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
        <p className="mt-1 text-sm text-slate">Every hold, charge, release and provider payout, with its PayPal reference.</p>
        <div className="mt-4 overflow-x-auto clay">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-slate">
              <tr>
                <th className="px-4 py-2.5 font-normal">When</th>
                <th className="px-4 py-2.5 font-normal">What</th>
                <th className="px-4 py-2.5 font-normal">Visit</th>
                <th className="px-4 py-2.5 text-right font-normal">Amount</th>
                <th className="px-4 py-2.5 font-normal">PayPal reference</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-mist">
              {(ledger ?? []).map((e) => (
                <tr key={e.id}>
                  <td className="px-4 py-2.5 text-slate">{fmt(e.created_at, p.timezone, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                  <td className="px-4 py-2.5 font-bold">
                    {{ hold: "Held", capture: "Charged", void: "Released", payout: "Paid provider", refund: "Refunded", fee: "Late change fee", credit: "Agreement credit", extra: "Extra paid in chat" }[e.kind as string]}
                    {e.note && <span className="block text-xs font-normal text-slate">{e.note}</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    {e.visits?.services?.name}
                    {e.kind === "payout" && <span className="text-slate"> to {e.providers?.display_name}</span>}
                  </td>
                  <td className={`px-4 py-2.5 text-right ${e.kind === "credit" ? "text-sage" : ""}`}>
                    {e.kind === "credit" ? "−" : ""}
                    {money(Number(e.amount), p.currency)}
                  </td>
                  <td className="px-4 py-2.5">
                    <code className="text-xs">{e.paypal_ref}</code>{" "}
                    <span className={`ml-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${e.mode === "paypal_sandbox" ? "bg-[#ffc439]/40" : "bg-mist text-slate"}`}>
                      {e.mode === "paypal_sandbox" ? "Sandbox" : "Simulated"}
                    </span>
                  </td>
                </tr>
              ))}
              {!ledger?.length && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-slate">
                    Nothing yet. Payments appear here once visits are confirmed.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
