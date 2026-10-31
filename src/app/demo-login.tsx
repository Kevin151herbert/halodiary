"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { btn } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

/** Creates a throwaway account in one click, so judges can explore without filling a form. */
export function DemoLoginButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const id = Math.random().toString(36).slice(2, 8);
    const { data, error } = await supabase.auth.signUp({
      email: `judge-${id}@halodiary.app`,
      password: crypto.randomUUID(),
      options: { data: { full_name: `Guest ${id.toUpperCase()}`, role: "client" } },
    });
    if (error || !data.session) {
      setBusy(false);
      setError(
        error?.message ??
          "Instant demo needs email confirmation turned off in Supabase (Authentication > Sign In / Providers > Email).",
      );
      return;
    }
    router.push("/onboarding");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      <button onClick={go} disabled={busy} className={btn.ghost}>
        {busy ? "Setting up your demo…" : "Try it instantly"}
      </button>
      {error && <p className="max-w-xs text-sm text-rose">{error}</p>}
    </div>
  );
}
