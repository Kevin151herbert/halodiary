"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { btn } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

/** Creates a throwaway account in one click, so judges can explore without filling a form. */
export function DemoLoginButton({ role = "client", label, variant = "halo", className = "" }: { role?: "client" | "provider"; label?: string; variant?: keyof typeof btn; className?: string }) {
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
      options: { data: { full_name: role === "provider" ? `Guest Pro ${id.toUpperCase()}` : `Guest ${id.toUpperCase()}`, role } },
    });
    if (error || !data.session) {
      setBusy(false);
      setError(error?.message ?? "Instant demo needs email confirmation turned off in Supabase.");
      return;
    }
    router.push(role === "provider" ? "/onboarding" : "/start");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      <button onClick={go} disabled={busy} className={`${btn[variant]} ${className}`}>
        {busy ? "Setting up…" : (label ?? (role === "provider" ? "Start as a provider" : "Start as a client"))}
      </button>
      {error && <p className="max-w-xs text-sm text-rose">{error}</p>}
    </div>
  );
}
