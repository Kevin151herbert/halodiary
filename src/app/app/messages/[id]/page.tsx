import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar } from "@/components/ui";
import { getConversation, listMessages } from "@/lib/chat";
import { reportableVisits } from "@/lib/problems";
import { nowFor } from "@/lib/engine";
import { getSession } from "@/lib/supabase/server";
import { fmtShort } from "@/lib/time";
import { Chat } from "./chat";

export default async function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, profile } = await getSession();
  const p = profile!;
  const [conv, messages] = await Promise.all([getConversation(supabase, id), listMessages(supabase, id)]);
  if (!conv) notFound();
  const as = p.role === "provider" ? "provider" : "client";

  const { data: visits } = await supabase
    .from("visits")
    .select("id, scheduled_at, services(name)")
    .eq("client_id", conv.client_id)
    .eq("provider_id", conv.provider_id)
    .gte("scheduled_at", nowFor(p).toISOString())
    .in("status", ["scheduled", "awaiting", "confirmed"])
    .order("scheduled_at")
    .limit(6);
  const { data: contract } =
    as === "client"
      ? await supabase.from("contracts").select("id").eq("client_id", p.id).eq("provider_id", conv.provider_id).eq("status", "active").limit(1).maybeSingle()
      : { data: null };

  const reportable = as === "client" ? await reportableVisits(supabase, p, conv.provider_id) : [];
  const clientName =
    as === "provider" ? (((await supabase.rpc("my_client_names")).data ?? []) as { client_id: string; name: string }[]).find((n) => n.client_id === conv.client_id)?.name : null;
  const name = as === "client" ? (conv.providers?.display_name ?? "Provider") : (clientName ?? "Your client");
  const next = visits?.[0];

  return (
    <div className="mx-auto max-w-3xl">
      <header className="clay flex flex-wrap items-center gap-4 p-4 sm:p-5">
        <Link href="/app/messages" className="clay-btn-ghost rounded-full px-3 py-1.5 text-sm font-bold" aria-label="All messages">
          ←
        </Link>
        <Avatar name={name} hue={conv.providers?.avatar_hue ?? 200} size={48} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-xl font-extrabold">{name}</h1>
          <p className="truncate text-sm text-slate">
            {next ? `Next: ${(next.services as unknown as { name: string })?.name}, ${fmtShort(next.scheduled_at, p.timezone)}` : as === "client" ? conv.providers?.headline : "No upcoming visits"}
          </p>
        </div>
        {as === "client" && (
          <nav className="flex w-full gap-2 text-xs font-bold sm:w-auto">
            <Link href={`/app/providers/${conv.provider_id}`} className="clay-btn-ghost rounded-full px-3 py-2">
              Attendance
            </Link>
            {contract && (
              <Link href={`/app/agreements/${contract.id}`} className="clay-btn-ghost rounded-full px-3 py-2">
                Agreement
              </Link>
            )}
          </nav>
        )}
      </header>

      <div className="mt-6">
        <Chat
          conversationId={id}
          initial={messages}
          as={as}
          otherName={name}
          isDemo={Boolean(conv.providers?.is_demo)}
          currency={p.currency}
          tz={p.timezone}
          visits={(visits ?? []).map((v) => ({ id: v.id, label: `${(v.services as unknown as { name: string })?.name}, ${fmtShort(v.scheduled_at, p.timezone)}` }))}
          paysWithPayPal={Boolean(p.paypal_payment_token)}
          reportable={reportable}
        />
      </div>
    </div>
  );
}
