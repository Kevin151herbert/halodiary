import Link from "next/link";
import { FileSignature } from "lucide-react";
import { Avatar, IconChip, StatusPill } from "@/components/ui";
import { cadenceLabel } from "@/lib/cadence";
import type { Contract } from "@/lib/contract";
import { getSession } from "@/lib/supabase/server";
import { fmt } from "@/lib/time";

type Row = Contract & {
  plans: { status: string; cadence: string; weekdays: number[]; services: { name: string } } | null;
  providers: { display_name: string; avatar_hue: number } | null;
};

export default async function AgreementsPage() {
  const { supabase, profile } = await getSession();
  const p = profile!;
  const asProvider = p.role === "provider";
  const { data } = await supabase
    .from("contracts")
    .select("*, plans(status, cadence, weekdays, services(name)), providers(display_name, avatar_hue)")
    .order("version", { ascending: false });
  const rows = (data ?? []) as Row[];

  // One card per service: the version in force, plus any version waiting for a signature.
  const byPlan = new Map<string, Row[]>();
  for (const r of rows) byPlan.set(r.plan_id, [...(byPlan.get(r.plan_id) ?? []), r]);
  const groups = [...byPlan.values()].map((versions) => {
    const active = versions.find((v) => v.status === "active");
    const pending = versions.find((v) => v.status === "pending");
    const shown = active ?? pending ?? versions[0];
    const waitingOnMe = pending && !(asProvider ? pending.provider_signed_at : pending.client_signed_at) ? pending : null;
    return { shown, pending, waitingOnMe, count: versions.length };
  });
  groups.sort((a, b) => Number(Boolean(b.waitingOnMe)) - Number(Boolean(a.waitingOnMe)));

  return (
    <div className="space-y-8">
      <div className="flex items-start gap-4">
        <IconChip tone="ink" size={52}>
          <FileSignature size={24} />
        </IconChip>
        <div>
          <h1 className="text-3xl font-extrabold sm:text-4xl">Agreements</h1>
          <p className="mt-2 max-w-prose text-slate">
            Every recurring service runs on an agreement both sides sign: notice for changes, late fees, credits when a provider moves or cancels, and how to end it. HaloDiary applies the terms automatically.
          </p>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="clay p-6 text-slate">No agreements yet. One is created when you add a service to your diary.</div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {groups.map(({ shown, pending, waitingOnMe, count }) => (
            <li key={shown.plan_id} className="min-w-0">
              <Link href={`/app/agreements/${(waitingOnMe ?? shown).id}`} className="clay flex h-full flex-col p-5">
                <div className="flex items-center gap-3">
                  <Avatar name={shown.providers?.display_name ?? ""} hue={shown.providers?.avatar_hue ?? 200} size={40} />
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-lg font-bold">{shown.plans?.services?.name}</p>
                    <p className="truncate text-sm text-slate">
                      {asProvider ? "With your client" : `With ${shown.providers?.display_name}`},{" "}
                      {shown.plans ? cadenceLabel(shown.plans.cadence, shown.plans.weekdays).toLowerCase() : ""}
                    </p>
                  </div>
                  <StatusPill status={shown.status} />
                </div>
                <dl className="clay-inset mt-4 grid grid-cols-3 gap-2 px-3 py-3 text-center text-xs">
                  <div>
                    <dt className="text-slate">Free changes</dt>
                    <dd className="font-display text-base font-bold">{shown.terms.cancellation_notice_hours}h</dd>
                  </div>
                  <div>
                    <dt className="text-slate">Late fee</dt>
                    <dd className="font-display text-base font-bold">{shown.terms.late_cancellation_fee_pct}%</dd>
                  </div>
                  <div>
                    <dt className="text-slate">To end</dt>
                    <dd className="font-display text-base font-bold">{shown.terms.termination_notice_days ? `${shown.terms.termination_notice_days}d` : "Any time"}</dd>
                  </div>
                </dl>
                <p className="mt-4 text-sm">
                  {waitingOnMe ? (
                    <span className="font-bold text-rose">Version {waitingOnMe.version} needs your signature</span>
                  ) : pending ? (
                    <span className="text-slate">Version {pending.version} sent, waiting for the other side</span>
                  ) : (
                    <span className="text-slate">
                      Version {shown.version}
                      {shown.client_signed_at && `, signed ${fmt(shown.client_signed_at, p.timezone, { day: "numeric", month: "short", year: "numeric" })}`}
                      {count > 1 && `, ${count} versions`}
                    </span>
                  )}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
