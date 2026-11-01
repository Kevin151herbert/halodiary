import { btn } from "@/components/ui";
import { getSession } from "@/lib/supabase/server";
import { saveSettingsAction, signOutAction } from "../actions";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const { saved } = await searchParams;
  const { profile } = await getSession();
  const p = profile!;

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
      <form action={signOutAction} className="mt-10">
        <button className={btn.ghost}>Log out</button>
      </form>
    </div>
  );
}
