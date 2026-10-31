import { getSession } from "@/lib/supabase/server";
import { fmt } from "@/lib/time";

const actorLabel: Record<string, [string, string]> = {
  user: ["You", "bg-mist text-ink"],
  assistant: ["Assistant", "bg-halo-soft text-ink"],
  system: ["HaloDiary", "bg-sage-soft text-sage"],
};

export default async function ActivityPage() {
  const { supabase, profile } = await getSession();
  const { data } = await supabase
    .from("activity_log")
    .select("*")
    .eq("user_id", profile!.id)
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <div>
      <h1 className="text-3xl font-extrabold sm:text-4xl">Activity</h1>
      <p className="mt-2 max-w-prose text-slate">
        Every action on your account, and who took it: you, your assistant, or HaloDiary&apos;s scheduler. Nothing moves money without a line here.
      </p>
      <ol className="mt-8 space-y-2">
        {(data ?? []).map((a) => {
          const [label, cls] = actorLabel[a.actor] ?? [a.actor, "bg-mist"];
          return (
            <li key={a.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-xl border border-mist bg-card px-4 py-3">
              <span className="w-32 shrink-0 text-sm text-slate">
                {fmt(a.created_at, profile!.timezone, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              </span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${cls}`}>{label}</span>
              <span className="min-w-0 flex-1">{a.action}</span>
            </li>
          );
        })}
        {!data?.length && <li className="text-slate">Nothing yet.</li>}
      </ol>
    </div>
  );
}
