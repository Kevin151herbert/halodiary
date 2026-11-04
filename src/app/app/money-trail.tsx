import type { SupabaseClient } from "@supabase/supabase-js";
import { Check, Clock, Hourglass } from "lucide-react";
import type { Profile } from "@/lib/supabase/server";
import { fmt } from "@/lib/time";
import { TrailRefresher } from "./trail-refresher";

type Line = {
  kind: string;
  amount: number;
  mode: string;
  paypal_ref: string | null;
  paypal_confirmed_at: string | null;
  created_at: string;
  visit_id: string | null;
  visits: { scheduled_at: string; services: { name: string } | null; providers: { display_name: string } | null } | null;
};

type Step = { key: string; label: string; line: Line | null };

/** Every visit's money, step by step: held on PayPal, charged after the visit, paid out to the provider, each ticked when PayPal confirms it. */
export async function MoneyTrail({ supabase, profile }: { supabase: SupabaseClient; profile: Profile }) {
  const { data } = await supabase
    .from("ledger_entries")
    .select("kind, amount, mode, paypal_ref, paypal_confirmed_at, created_at, visit_id, note, visits(scheduled_at, status, services(name), providers(display_name))")
    .eq("client_id", profile.id)
    .in("kind", ["hold", "capture", "void", "payout", "refund"])
    .not("visit_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(40);
  // Only the visit's own money: extras paid in chat and their payouts have their own lines in the ledger.
  const lines = ((data ?? []) as unknown as (Line & { note: string | null })[]).filter(
    (l) => !(l.kind === "payout" && /^(Extra paid in chat|Provider share of an invoice)/.test(l.note ?? "")),
  );
  if (!lines.length) return null;

  // Group by visit, newest activity first, four visits at most.
  const byVisit = new Map<string, Line[]>();
  for (const l of lines) byVisit.set(l.visit_id!, [...(byVisit.get(l.visit_id!) ?? []), l]);
  // A visit's trail starts with its hold; visits covered by a subscription have no hold and show in the ledger instead.
  const visits = [...byVisit.entries()].filter(([, ls]) => ls.some((l) => l.kind === "hold")).slice(0, 4);
  if (!visits.length) return null;
  const money = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: profile.currency }).format(n);
  let waiting = false;

  return (
    <section aria-labelledby="money" className="clay p-5 sm:p-6">
      <h2 id="money" className="text-xl font-bold">
        Where your money is
      </h2>
      <p className="mt-1 text-sm text-slate">Each visit is held on PayPal when confirmed, charged only after it happens, then paid out. A tick means PayPal confirmed it.</p>
      <ul className="mt-4 space-y-4">
        {visits.map(([id, ls]) => {
          const v = ls[0].visits;
          const find = (k: string) => ls.find((l) => l.kind === k) ?? null;
          const voided = find("void");
          const steps: Step[] = [
            { key: "hold", label: "Held on PayPal", line: find("hold") },
            voided ? { key: "void", label: "Released, not charged", line: voided } : { key: "capture", label: "Charged after the visit", line: find("capture") },
            ...(voided ? [] : [{ key: "payout", label: `Paid to ${v?.providers?.display_name?.split(" ")[0] ?? "provider"}`, line: find("payout") }]),
          ];
          const refund = find("refund");
          return (
            <li key={id} className="clay-inset p-4">
              <p className="text-sm">
                <span className="font-bold">{v?.services?.name ?? "Visit"}</span>
                <span className="text-slate">
                  {" "}
                  with {v?.providers?.display_name}
                  {v ? `, ${fmt(v.scheduled_at, profile.timezone, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}
                </span>
              </p>
              <ol className="mt-3 grid gap-2 sm:grid-cols-3" aria-label="Payment steps">
                {steps.map((s) => {
                  const l = s.line;
                  const paypal = l?.mode === "paypal_sandbox";
                  const confirmed = Boolean(l?.paypal_confirmed_at);
                  if (paypal && !confirmed) waiting = true;
                  return (
                    <li key={s.key} className={`rounded-2xl px-3 py-2.5 text-xs ${l ? "bg-white/80" : "bg-white/30 text-slate"}`}>
                      <span className="flex items-center gap-1.5 font-bold">
                        {l ? (
                          confirmed ? (
                            <Check size={14} className="text-sage" aria-label="Confirmed by PayPal" />
                          ) : paypal ? (
                            <Hourglass size={14} className="text-halo" aria-label="Waiting for PayPal to confirm" />
                          ) : (
                            <Check size={14} className="text-slate" aria-label="Done (simulated)" />
                          )
                        ) : (
                          <Clock size={14} aria-label="Not yet" />
                        )}
                        {s.key === "hold" && l && !paypal ? "Held (simulated)" : s.label}
                      </span>
                      {l ? (
                        <span className="mt-1 block text-slate">
                          {money(Number(l.amount))} ·{" "}
                          {paypal ? (
                            <>
                              PayPal <span className="font-mono">{l.paypal_ref?.slice(0, 17)}</span>
                              {confirmed ? " · confirmed" : " · confirming…"}
                            </>
                          ) : (
                            "simulated"
                          )}
                        </span>
                      ) : (
                        <span className="mt-1 block">{s.key === "capture" ? "After the visit" : "After the charge"}</span>
                      )}
                    </li>
                  );
                })}
              </ol>
              {refund && (
                <p className="mt-2 text-xs text-slate">
                  Refunded {money(Number(refund.amount))} {refund.mode === "paypal_sandbox" ? "to PayPal" : "(simulated)"}
                  {refund.paypal_confirmed_at ? ", confirmed by PayPal" : ""}.
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <TrailRefresher active={waiting} />
    </section>
  );
}
