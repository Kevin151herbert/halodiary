import { redirect } from "next/navigation";
import { AssistantShell } from "@/components/assistant/shell";
import { Logo } from "@/components/ui";
import { unreadCount } from "@/lib/chat";
import { advanceIfStale, nowFor } from "@/lib/engine";
import { getSession } from "@/lib/supabase/server";
import { fmtShort } from "@/lib/time";
import { Nav } from "./nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { supabase, profile } = await getSession();
  if (!profile) redirect("/login");
  if (profile.role === "client" && !profile.onboarded_at) redirect("/start");
  if (profile.lat == null) redirect(profile.role === "client" ? "/start" : "/onboarding");

  // Move visits along the timeline (day-before checks, holds, captures) before rendering.
  await advanceIfStale(supabase, profile);

  const [{ count: unread }, chats] = await Promise.all([
    supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", profile.id).is("read_at", null),
    unreadCount(supabase, profile),
  ]);
  const now = nowFor(profile);
  const aiConfigured = Boolean(process.env.ANTHROPIC_API_KEY);

  return (
    <AssistantShell
      enabled={profile.assistant_enabled}
      configured={aiConfigured}
      role={profile.role}
      firstName={profile.full_name.split(" ")[0]}
    >
      <div className="flex min-h-dvh">
        <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 p-4 md:flex">
          <div className="clay flex w-full flex-col px-4 py-6">
          <Logo className="px-2" />
          <Nav role={profile.role} unread={unread ?? 0} chats={chats} />
          <div className="mt-auto space-y-1 px-2 text-xs text-slate">
            <p className="font-bold text-ink">{profile.full_name}</p>
            <p>{profile.city ?? "Location set"}</p>
            {profile.clock_offset_hours !== 0 && (
              <p className="clay-inset px-3 py-2 font-bold text-ink">
                Demo time: {fmtShort(now, profile.timezone)}
              </p>
            )}
          </div>
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex items-center justify-between bg-paper/85 px-5 py-3 backdrop-blur md:hidden">
            <Logo />
          </header>
          <main className="mx-auto w-full max-w-5xl flex-1 px-5 pb-28 pt-6 sm:px-8 md:pb-12 md:pt-10">{children}</main>
          <div className="clay fixed inset-x-3 bottom-3 z-20 md:hidden">
            <Nav role={profile.role} unread={unread ?? 0} chats={chats} compact />
          </div>
        </div>
      </div>
    </AssistantShell>
  );
}
