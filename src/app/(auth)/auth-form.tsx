"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { btn, Logo } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const params = useSearchParams();
  const [role, setRole] = useState<"client" | "provider">("client");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function submit(form: FormData) {
    setBusy(true);
    setError(null);
    setInfo(null);
    const supabase = createClient();
    const email = String(form.get("email"));
    const password = String(form.get("password"));

    if (mode === "signup") {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: String(form.get("full_name")), role } },
      });
      setBusy(false);
      if (error) return setError(error.message);
      if (!data.session) return setInfo("Check your email to confirm your account, then log in.");
      router.push("/onboarding");
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      setBusy(false);
      if (error) return setError("That email and password don't match an account.");
      router.push(params.get("next") || "/app");
    }
    router.refresh();
  }

  const field = "mt-1 w-full clay-sm px-4 py-3 text-base outline-none focus:border-ink";

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
      <Link href="/" className="mb-10 self-start">
        <Logo />
      </Link>
      <h1 className="text-3xl font-extrabold">{mode === "signup" ? "Create your account" : "Log in"}</h1>
      <p className="mt-2 text-slate">
        {mode === "signup" ? "Takes under a minute. Payments stay in the PayPal sandbox." : "Welcome back to your diary."}
      </p>

      <form action={submit} className="mt-8 flex flex-col gap-4">
        {mode === "signup" && (
          <>
            <fieldset>
              <legend className="text-sm font-bold">I want to</legend>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {(
                  [
                    ["client", "Book services", "Cleaning, tutoring, pets, car…"],
                    ["provider", "Offer services", "Get recurring clients near you"],
                  ] as const
                ).map(([value, title, sub]) => (
                  <label
                    key={value}
                    className={`cursor-pointer rounded-2xl p-3 transition ${role === value ? "clay-sm ring-2 ring-halo" : "clay-inset"}`}
                  >
                    <input type="radio" name="role" value={value} checked={role === value} onChange={() => setRole(value)} className="sr-only" />
                    <span className="block font-bold">{title}</span>
                    <span className="block text-sm text-slate">{sub}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="text-sm font-bold">
              Your name
              <input name="full_name" required autoComplete="name" className={field} />
            </label>
          </>
        )}
        <label className="text-sm font-bold">
          Email
          <input name="email" type="email" required autoComplete="email" className={field} />
        </label>
        <label className="text-sm font-bold">
          Password
          <input
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            className={field}
          />
        </label>
        {error && <p className="text-sm text-rose">{error}</p>}
        {info && <p className="text-sm text-sage">{info}</p>}
        <button disabled={busy} className={`${btn.primary} mt-2 py-3`}>
          {busy ? "One moment…" : mode === "signup" ? "Create account" : "Log in"}
        </button>
      </form>

      <p className="mt-6 text-sm text-slate">
        {mode === "signup" ? (
          <>
            Already have an account?{" "}
            <Link href="/login" className="font-bold text-ink underline">
              Log in
            </Link>
          </>
        ) : (
          <>
            New here?{" "}
            <Link href="/signup" className="font-bold text-ink underline">
              Create an account
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
