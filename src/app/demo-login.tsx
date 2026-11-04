"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { btn } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { startTourAction } from "./start/actions";

const FIRST = ["Ana", "Marco", "Lucía", "Sam", "Priya", "Tom", "Elena", "Jonas", "Amara", "Leo", "Nadia", "Kai"];
const LAST = "BCDFGHJKLMNPRSTVW";

/** A friendly name for a one-click demo account, so screens read like a real household, not a test. */
function demoName() {
  const first = FIRST[Math.floor(Math.random() * FIRST.length)];
  const initial = LAST.charAt(Math.floor(Math.random() * LAST.length));
  return `${first} ${initial}.`;
}

/** Creates a throwaway account in one click, so judges can explore without filling a form. */
export function DemoLoginButton({
  role = "client",
  label,
  variant = "halo",
  className = "",
  tour = false,
}: {
  role?: "client" | "provider";
  label?: string;
  variant?: keyof typeof btn;
  className?: string;
  tour?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const id = Math.random().toString(36).slice(2, 8);
    const { data, error } = await supabase.auth.signUp({
      email: `judge-${role === "provider" ? "pro-" : ""}${id}@halodiary.app`,
      password: crypto.randomUUID(),
      options: { data: { full_name: demoName(), role } },
    });
    if (error || !data.session) {
      setBusy(false);
      setError(error?.message ?? "Instant demo needs email confirmation turned off in Supabase.");
      return;
    }
    if (tour) {
      const r = await startTourAction().catch(() => null);
      if (!r?.ok) {
        setBusy(false);
        setError("The tour could not start. Try \"Start as a client\" instead.");
        return;
      }
      router.push("/app");
      router.refresh();
      return;
    }
    router.push(role === "provider" ? "/onboarding" : "/start");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      <button onClick={go} disabled={busy} className={`${btn[variant]} ${className}`}>
        {busy ? (tour ? "Preparing your household…" : "Setting up…") : (label ?? (role === "provider" ? "Start as a provider" : "Start as a client"))}
      </button>
      {error && <p className="max-w-xs text-sm text-rose">{error}</p>}
    </div>
  );
}

/** A small text button that starts a provider account, for the line under the main buttons. */
export function DemoLinkProvider() {
  return <DemoLoginButton role="provider" variant="quiet" label="start as a provider" className="!p-0 text-xs underline" />;
}
