"use client";

import Script from "next/script";
import { useRouter } from "next/navigation";
import { createElement, useCallback, useEffect, useRef, useState } from "react";

type SaveSession = { start: (opts: { presentationMode: string }, setup: Promise<{ vaultSetupToken: string }>) => Promise<void> };
type SdkInstance = {
  findEligibleMethods: (o: { currencyCode: string; paymentFlow: string }) => Promise<{ isEligible: (m: string) => boolean }>;
  createPayPalSavePaymentSession: (o: { onApprove: (d: { vaultSetupToken: string }) => Promise<void>; onCancel: () => void; onError: (e: unknown) => void }) => SaveSession;
};
declare global {
  interface Window {
    paypal?: { createInstance: (o: { clientToken: string; components: string[]; pageType: string }) => Promise<SdkInstance> };
  }
}

const SDK = process.env.NEXT_PUBLIC_PAYPAL_ENV === "live" ? "https://www.paypal.com/web-sdk/v6/core" : "https://www.sandbox.paypal.com/web-sdk/v6/core";

/**
 * Approve the month with PayPal's JS SDK v6 in a popup, without leaving HaloDiary. The payer saves PayPal once;
 * the token stays on the server. Falls back to the redirect form if the SDK can't load.
 */
export function PayPalV6Button({ month, cap, currency, fallback }: { month: string; cap: number; currency: string; fallback: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<"loading" | "ready" | "busy" | "fallback">("loading");
  const [msg, setMsg] = useState<string | null>(null);
  const session = useRef<SaveSession | null>(null);

  const init = useCallback(async () => {
    try {
      const tok = await fetch("/api/paypal/v6").then((r) => r.json());
      if (!tok.accessToken || !window.paypal) throw new Error(tok.error ?? "SDK unavailable");
      const sdk = await window.paypal.createInstance({ clientToken: tok.accessToken, components: ["paypal-payments"], pageType: "checkout" });
      const methods = await sdk.findEligibleMethods({ currencyCode: currency, paymentFlow: "VAULT_WITHOUT_PAYMENT" });
      if (!methods.isEligible("paypal")) throw new Error("PayPal not eligible here");
      session.current = sdk.createPayPalSavePaymentSession({
        async onApprove({ vaultSetupToken }) {
          setState("busy");
          const r = await fetch("/api/paypal/v6", { method: "POST", body: JSON.stringify({ step: "save", vaultSetupToken, month, cap }) }).then((x) => x.json());
          if (r.error) {
            setMsg(r.error);
            setState("ready");
            return;
          }
          router.push("/app/budget?approved=paypal");
          router.refresh();
        },
        onCancel() {
          setMsg("PayPal approval was cancelled. Nothing was saved.");
          setState("ready");
        },
        onError(e) {
          setMsg(`PayPal couldn't finish: ${e instanceof Error ? e.message : String(e)}`);
          setState("ready");
        },
      });
      setState("ready");
    } catch {
      setState("fallback");
    }
  }, [cap, currency, month, router]);

  useEffect(() => {
    if (window.paypal && state === "loading") init();
  }, [init, state]);

  const click = async () => {
    if (!session.current) return;
    setMsg(null);
    // Start the popup straight from the click; the setup token is created while it opens.
    const setup = fetch("/api/paypal/v6", { method: "POST", body: JSON.stringify({ step: "setup", month, cap }) })
      .then((r) => r.json())
      .then((j) => {
        if (!j.id) throw new Error(j.error ?? "No setup token");
        return { vaultSetupToken: j.id as string };
      });
    try {
      await session.current.start({ presentationMode: "auto" }, setup);
    } catch (e) {
      setMsg(`PayPal couldn't start: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  if (state === "fallback") return <>{fallback}</>;
  return (
    <div>
      <Script src={SDK} strategy="afterInteractive" onLoad={() => state === "loading" && init()} onError={() => setState("fallback")} />
      {state === "loading" ? (
        <div className="h-[50px] w-full animate-pulse rounded-full bg-[#ffc439]/40" aria-label="Loading PayPal" />
      ) : (
        <div onClickCapture={click} className={state === "busy" ? "pointer-events-none opacity-60" : ""}>
          {createElement("paypal-button", { type: "pay", class: "block w-full" })}
        </div>
      )}
      {state === "busy" && <p className="mt-2 text-xs text-slate">Saving your PayPal approval…</p>}
      {msg && <p className="mt-2 text-xs text-rose">{msg}</p>}
      <p className="mt-2 text-[11px] text-slate">PayPal JS SDK v6: approve in a PayPal window without leaving HaloDiary.</p>
    </div>
  );
}
