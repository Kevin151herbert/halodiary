import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, Clock } from "lucide-react";
import { Avatar, StatusPill } from "@/components/ui";
import { getContract } from "@/lib/actions-core";
import { cadenceLabel } from "@/lib/cadence";
import { clauses, type Contract } from "@/lib/contract";
import { getSession } from "@/lib/supabase/server";
import { fmt } from "@/lib/time";
import { AmendForm, SignButtons } from "../controls";

export default async function AgreementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, profile } = await getSession();
  const p = profile!;
  const c = await getContract(supabase, id);
  if (!c) notFound();
  const asProvider = p.role === "provider";
  const { data: history } = await supabase
    .from("contracts")
    .select("id, version, status, proposed_by, change_note, created_at")
    .eq("plan_id", c.plan_id)
    .order("version", { ascending: false });
  const { data: plan } = await supabase.from("plans").select("status").eq("id", c.plan_id).maybeSingle();

  const provider = c.providers?.display_name ?? "The provider";
  const client = asProvider ? "Your client" : p.full_name || "You";
  const service = c.plans?.services?.name ?? "Service";
  const schedule = c.plans ? `${cadenceLabel(c.plans.cadence, c.plans.weekdays).toLowerCase()} at ${String(c.plans.time_of_day).slice(0, 5)}` : "";
  const list = clauses(c.terms, { client, provider, service, price: Number(c.plans?.price ?? 0), currency: p.currency, schedule });
  const mineSigned = asProvider ? c.provider_signed_at : c.client_signed_at;
  const when = (iso: string) => fmt(iso, p.timezone, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="space-y-8">
      <Link href="/app/agreements" className="clay-btn-ghost inline-flex rounded-full px-4 py-2 text-sm font-bold">
        All agreements
      </Link>

      <header className="flex flex-wrap items-center gap-4">
        <Avatar name={provider} hue={c.providers?.avatar_hue ?? 200} size={56} />
        <div className="flex-1">
          <p className="text-sm text-slate">Service agreement, version {c.version}</p>
          <h1 className="text-3xl font-extrabold">
            {service} with {asProvider ? "your client" : provider}
          </h1>
        </div>
        <StatusPill status={c.status} />
      </header>

      {c.status === "pending" && !mineSigned && (
        <section className="clay p-5">
          <p className="font-bold">{c.proposed_by === (asProvider ? "client" : "provider") ? "New terms were proposed to you." : "This version needs your signature."}</p>
          {c.change_note && <p className="mt-1 text-sm text-slate">&ldquo;{c.change_note}&rdquo;</p>}
          <div className="mt-4">
            <SignButtons contractId={c.id} who={asProvider ? provider : "client"} />
          </div>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <section className="clay p-6 sm:p-8">
          <ol className="space-y-6">
            {list.map((cl, i) => (
              <li key={cl.title} className="flex gap-4">
                <span className="clay-sm flex h-9 w-9 shrink-0 items-center justify-center font-display font-bold">{i + 1}</span>
                <div>
                  <h2 className="font-bold">{cl.title}</h2>
                  <p className="mt-1 leading-relaxed text-slate">{cl.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <aside className="space-y-6">
          <section className="clay p-6">
            <h2 className="font-bold">Signatures</h2>
            <ul className="mt-4 space-y-3">
              {[
                { who: client, at: c.client_signed_at, role: "Client" },
                { who: provider, at: c.provider_signed_at, role: "Provider" },
              ].map((s) => (
                <li key={s.role} className="clay-inset flex items-center gap-3 px-4 py-3">
                  <span
                    className={`inline-flex h-8 w-8 items-center justify-center rounded-full ${s.at ? "bg-sage text-white" : "bg-white text-slate"}`}
                    aria-hidden
                  >
                    {s.at ? <Check size={16} /> : <Clock size={16} />}
                  </span>
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="block font-bold">{s.who}</span>
                    <span className="text-slate">{s.at ? `Signed ${when(s.at)}` : `${s.role} has not signed yet`}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-slate">Fingerprint of the signed terms</p>
            <code className="mt-1 block break-all text-[11px] text-slate">{c.terms_hash}</code>
          </section>

          {plan?.status !== "ended" && (c.status === "active" || c.status === "pending") && (
            <section className="clay p-6">
              <h2 className="font-bold">Change the terms</h2>
              <p className="mt-1 mb-4 text-sm text-slate">
                A change becomes a new version. The current one stays in force until {asProvider ? "your client" : provider} signs it
                {!asProvider && c.providers?.is_demo ? " (demo providers sign straight away)" : ""}.
              </p>
              <AmendForm planId={c.plan_id} current={c.terms as Contract["terms"]} other={asProvider ? "your client" : provider} />
            </section>
          )}

          <section className="clay p-6">
            <h2 className="font-bold">Versions</h2>
            <ol className="mt-3 space-y-2 text-sm">
              {(history ?? []).map((h) => (
                <li key={h.id}>
                  <Link href={`/app/agreements/${h.id}`} className={`flex items-center gap-2 rounded-xl px-2 py-1.5 ${h.id === c.id ? "clay-inset" : "hover:bg-white/60"}`}>
                    <span className="font-bold">v{h.version}</span>
                    <span className="flex-1 truncate text-slate">{h.change_note || (h.proposed_by === "client" ? "Proposed by client" : "Proposed by provider")}</span>
                    <StatusPill status={h.status} />
                  </Link>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </div>
  );
}
