import { btn } from "@/components/ui";
import { getSession } from "@/lib/supabase/server";
import { headers } from "next/headers";
import { fmt } from "@/lib/time";
import { DEFAULT_AGENT_LIMIT } from "@/lib/agent-guard";
import { saveSettingsAction, signOutAction } from "../actions";
import { AgentConnections } from "./agents";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const { saved } = await searchParams;
  const { supabase, profile } = await getSession();
  const p = profile!;
  const { data: tokens } = await supabase
    .from("agent_tokens")
    .select("id, label, token_hint, created_at, last_used_at")
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  const h = await headers();
  const mcpUrl = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}/api/mcp`;

  const toggles = [
    {
      name: "assistant_enabled",
      title: "Assistant",
      body: "Off removes the assistant panel and stops all AI actions. Your diary, checks and payments keep working without it.",
      on: p.assistant_enabled,
    },
    {
      name: "proactive_enabled",
      title: "Proactive suggestions",
      body: "Tips such as moving a service you keep skipping to a lighter cadence. Off keeps the assistant quiet until you ask.",
      on: p.proactive_enabled,
    },
    {
      name: "auto_checks_enabled",
      title: "Let the assistant answer routine day-before checks",
      body: "When a visit is unchanged and inside your budget, the assistant confirms it for you and logs it. Off sends every check to you.",
      on: p.auto_checks_enabled,
    },
  ];

  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-extrabold sm:text-4xl">Settings</h1>
      {saved && <p className="clay-sm mt-4 px-4 py-3 font-bold text-sage">Settings saved.</p>}
      <form action={saveSettingsAction} className="mt-8 space-y-8">
        <label className="block text-sm font-bold">
          Name
          <input name="full_name" defaultValue={p.full_name} className="clay-inset mt-1.5 w-full px-4 py-3 font-normal" />
        </label>

        <fieldset>
          <legend className="text-xl font-bold">AI assistant</legend>
          <div className="mt-4 clay divide-y divide-mist/70">
            {toggles.map((t) => (
              <label key={t.name} className="flex cursor-pointer items-start gap-4 p-5">
                <span className="flex-1">
                  <span className="block font-bold">{t.title}</span>
                  <span className="block text-sm text-slate">{t.body}</span>
                </span>
                <input type="checkbox" name={t.name} defaultChecked={t.on} className="clay-switch mt-0.5" />
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-xl font-bold">AI spending limit</legend>
          <label className="clay mt-4 block p-5">
            <span className="block font-bold">Most an AI may approve in one payment</span>
            <span className="block text-sm text-slate">
              Applies to the assistant here and to any outside assistant you connect. Anything higher is refused, logged and sent to you to do yourself. Empty means no
              limit here and {p.currency} {DEFAULT_AGENT_LIMIT} for outside assistants.
            </span>
            <span className="mt-3 flex items-center gap-2">
              <span className="font-bold">{p.currency}</span>
              <input
                name="agent_max_per_payment"
                type="number"
                min="0"
                step="1"
                inputMode="decimal"
                defaultValue={p.agent_max_per_payment == null ? "" : Number(p.agent_max_per_payment)}
                placeholder="No limit"
                className="clay-inset w-36 px-4 py-2.5"
              />
            </span>
          </label>
        </fieldset>

        <section className="text-sm text-slate">
          <p>
            Location: <span className="font-bold text-ink">{p.city ?? "set"}</span>.{" "}
            <a href="/onboarding" className="font-bold text-ink underline">
              Change
            </a>
          </p>
          {p.paypal_payer_email && <p className="mt-1">PayPal account saved: {p.paypal_payer_email}</p>}
        </section>

        <button className={btn.primary}>Save settings</button>
      </form>
      <section className="mt-10" aria-labelledby="agents">
        <h2 id="agents" className="text-xl font-bold">
          Outside AI assistants
        </h2>
        <AgentConnections
          mcpUrl={mcpUrl}
          tokens={(tokens ?? []).map((t) => ({
            id: t.id,
            label: t.label,
            token_hint: t.token_hint,
            used: t.last_used_at ? `last used ${fmt(t.last_used_at, p.timezone, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : "not used yet",
          }))}
        />
      </section>
      <form action={signOutAction} className="mt-10">
        <button className={btn.ghost}>Log out</button>
      </form>
    </div>
  );
}
