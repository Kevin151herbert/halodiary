import Link from "next/link";
import { Avatar, Card, money, StatusPill } from "@/components/ui";
import { COMMISSION, nowFor, VISIT_SELECT, type VisitRow } from "@/lib/engine";
import { getSession } from "@/lib/supabase/server";
import { fmtShort, localInputValue } from "@/lib/time";
import { ProviderVisitActions } from "./provider-actions";

export default async function ProviderView({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const { p: pick } = await searchParams;
  const { supabase, profile } = await getSession();
  const me = profile!;
  const now = nowFor(me);
  const fmt = (iso: string) => fmtShort(iso, me.timezone);

  let providerId: string | null = null;
  let providerName = "";
  let hue = 200;
  let choices: { id: string; name: string; hue: number }[] = [];

  if (me.role === "provider") {
    const { data } = await supabase.from("providers").select("id, display_name, avatar_hue").eq("profile_id", me.id).maybeSingle();
    if (!data)
      return (
        <div>
          <h1 className="text-3xl font-extrabold">Finish your listing</h1>
          <p className="mt-2 text-slate">Add your services and prices so clients near you can find you.</p>
          <Link href="/onboarding" className="mt-4 inline-block font-bold underline">
            Set up my listing
          </Link>
        </div>
      );
    providerId = data.id;
    providerName = data.display_name;
    hue = data.avatar_hue;
  } else {
    // Clients can step into the shoes of the demo providers they book, to see both sides.
    const { data: plans } = await supabase.from("plans").select("provider_id, providers(display_name, avatar_hue, is_demo)").eq("client_id", me.id);
    const seen = new Map<string, { id: string; name: string; hue: number }>();
    for (const row of plans ?? []) {
      const pr = row.providers as unknown as { display_name: string; avatar_hue: number; is_demo: boolean };
      if (pr?.is_demo && !seen.has(row.provider_id)) seen.set(row.provider_id, { id: row.provider_id, name: pr.display_name, hue: pr.avatar_hue });
    }
    choices = [...seen.values()];
    const chosen = choices.find((c) => c.id === pick) ?? choices[0];
    if (!chosen)
      return (
        <div>
          <h1 className="text-3xl font-extrabold">Provider view</h1>
          <p className="mt-2 max-w-prose text-slate">
            Once you add a service, you can see it from the provider&apos;s side here: their day-before checks, proposing a new time, and getting paid.
          </p>
          <Link href="/app/discover" className="mt-4 inline-block font-bold underline">
            Find a service
          </Link>
        </div>
      );
    providerId = chosen.id;
    providerName = chosen.name;
    hue = chosen.hue;
  }

  const { data } = await supabase
    .from("visits")
    .select(VISIT_SELECT)
    .eq("provider_id", providerId)
    .gte("scheduled_at", new Date(now.getTime() - 3 * 86_400_000).toISOString())
    .lte("scheduled_at", new Date(now.getTime() + 14 * 86_400_000).toISOString())
    .not("status", "in", "(cancelled)")
    .order("scheduled_at");
  const visits = (data ?? []) as VisitRow[];
  const { data: payouts } = await supabase.from("ledger_entries").select("amount").eq("provider_id", providerId).eq("kind", "payout");
  const earned = (payouts ?? []).reduce((s, e) => s + Number(e.amount), 0);
  const upcoming = visits.filter((v) => ["scheduled", "awaiting", "confirmed"].includes(v.status));

  return (
    <div className="space-y-8">
      {me.role === "client" && (
        <p className="rounded-xl bg-halo-soft px-4 py-3 text-sm">
          You&apos;re seeing your demo provider&apos;s side of HaloDiary. Demo providers have no login, so you can answer for them here and watch it reach your diary.
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Avatar name={providerName} hue={hue} size={60} />
          <div>
            <h1 className="text-3xl font-extrabold">{providerName}</h1>
            <p className="text-slate">
              {upcoming.length} upcoming {upcoming.length === 1 ? "visit" : "visits"}, {money(earned, me.currency)} paid out through PayPal
            </p>
          </div>
        </div>
        {choices.length > 1 && (
          <nav className="flex flex-wrap gap-1" aria-label="Choose provider">
            {choices.map((c) => (
              <Link
                key={c.id}
                href={`/app/provider?p=${c.id}`}
                className={`rounded-full border px-3 py-1.5 text-sm font-bold ${c.id === providerId ? "border-ink bg-ink text-white" : "border-mist bg-card"}`}
              >
                {c.name}
              </Link>
            ))}
          </nav>
        )}
      </div>

      <ul className="space-y-3">
        {visits.map((v) => (
          <li key={v.id}>
            <Card className="p-4">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="w-40 font-display font-bold">{fmt(v.scheduled_at)}</span>
                <span className="flex-1">
                  <span className="font-bold">{v.services?.name}</span>
                  <span className="text-slate">
                    {" "}
                    for {me.role === "client" ? "you" : "a client"}, you receive {money(Number(v.price) * (1 - COMMISSION), me.currency)}
                  </span>
                </span>
                <StatusPill status={v.status} />
              </div>
              <ProviderVisitActions
                visitId={v.id}
                status={v.status}
                suggested={localInputValue(new Date(new Date(v.scheduled_at).getTime() + 86_400_000), me.timezone)}
                answered={v.provider_response}
              />
            </Card>
          </li>
        ))}
        {!visits.length && <p className="text-slate">No visits in the next two weeks.</p>}
      </ul>
    </div>
  );
}
