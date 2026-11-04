import Link from "next/link";
import { MessagesSquare } from "lucide-react";
import { Avatar, IconChip } from "@/components/ui";
import { CONVERSATION_SELECT, type Conversation } from "@/lib/chat";
import { getSession } from "@/lib/supabase/server";
import { fmt } from "@/lib/time";
import { openChatAction } from "../actions";

export default async function MessagesPage() {
  const { supabase, profile } = await getSession();
  const p = profile!;
  const asProvider = p.role === "provider";
  const { data } = await supabase.from("conversations").select(CONVERSATION_SELECT).order("last_message_at", { ascending: false });
  const convs = (data ?? []) as Conversation[];
  // Providers cannot read client profiles; this returns just the names of their own clients.
  const { data: names } = asProvider ? await supabase.rpc("my_client_names") : { data: null };
  const nameOf = new Map(((names ?? []) as { client_id: string; name: string }[]).map((n) => [n.client_id, n.name]));

  // Clients can start a thread with any provider they have booked.
  let booked: { id: string; name: string; hue: number }[] = [];
  if (!asProvider) {
    const { data: plans } = await supabase.from("plans").select("provider_id, providers(display_name, avatar_hue)").eq("client_id", p.id).neq("status", "ended");
    const have = new Set(convs.map((c) => c.provider_id));
    const seen = new Map<string, { id: string; name: string; hue: number }>();
    for (const pl of plans ?? []) {
      const pr = pl.providers as unknown as { display_name: string; avatar_hue: number };
      if (!have.has(pl.provider_id)) seen.set(pl.provider_id, { id: pl.provider_id, name: pr?.display_name, hue: pr?.avatar_hue });
    }
    booked = [...seen.values()];
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="flex items-start gap-4">
        <IconChip tone="ink" size={52}>
          <MessagesSquare size={24} />
        </IconChip>
        <div>
          <h1 className="text-3xl font-extrabold sm:text-4xl">Messages</h1>
          <p className="mt-2 max-w-prose text-slate">
            One thread per {asProvider ? "client" : "provider"} for extra requests, payments and ratings. It stays on the record beside the agreement, so
            nothing spills into WhatsApp.
          </p>
        </div>
      </div>

      {convs.length > 0 && (
        <ul className="space-y-3">
          {convs.map((c) => {
            const unread = c.last_message_at > (asProvider ? c.provider_read_at : c.client_read_at);
            const name = asProvider ? (nameOf.get(c.client_id) ?? "Client") : (c.providers?.display_name ?? "");
            return (
              <li key={c.id}>
                <Link href={`/app/messages/${c.id}`} className="clay-sm flex items-center gap-4 p-4">
                  <Avatar name={name} hue={c.providers?.avatar_hue ?? 200} size={46} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className={`truncate font-bold ${unread ? "text-ink" : ""}`}>{name}</span>
                      <span className="shrink-0 text-xs text-slate">{fmt(c.last_message_at, p.timezone, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                    </span>
                    <span className={`block truncate text-sm ${unread ? "font-bold text-ink" : "text-slate"}`}>{c.last_message || "No messages yet"}</span>
                  </span>
                  {unread && <span className="fill-halo h-3 w-3 shrink-0 rounded-full" aria-label="Unread" />}
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {booked.length > 0 && (
        <section>
          <h2 className="text-lg font-bold">Start a conversation</h2>
          <ul className="mt-3 flex flex-wrap gap-3">
            {booked.map((b) => (
              <li key={b.id}>
                <form action={openChatAction.bind(null, b.id)}>
                  <button className="clay-btn-ghost inline-flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-4 text-sm font-bold">
                    <Avatar name={b.name} hue={b.hue} size={30} />
                    {b.name}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      {convs.length === 0 && booked.length === 0 && (
        <div className="clay p-6 text-slate">{asProvider ? "No conversations yet. Clients can message you once they book." : "Book a service first, then message your provider here."}</div>
      )}
    </div>
  );
}
