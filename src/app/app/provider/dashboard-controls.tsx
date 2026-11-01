"use client";

import { useState, useTransition } from "react";
import { btn } from "@/components/ui";
import { declineAgreementAction, signAgreementAction } from "../actions";
import { loadSampleClientsAction } from "./actions";

export function NewClientActions({ contractId }: { contractId: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const run = (fn: () => Promise<{ error?: string } | { ok: boolean; active?: boolean } | undefined>) =>
    start(async () => {
      const r = await fn();
      if (r && "error" in r && r.error) setMsg(r.error);
    });
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <button className={btn.halo} disabled={pending} onClick={() => run(() => signAgreementAction(contractId))}>
        Accept and sign
      </button>
      <button className={btn.ghost} disabled={pending} onClick={() => run(() => declineAgreementAction(contractId))}>
        Decline
      </button>
      {msg && <span className="text-sm text-rose">{msg}</span>}
    </div>
  );
}

export function SampleClientsButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        className={btn.primary}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await loadSampleClientsAction();
            if (r && "error" in r && r.error) setMsg(r.error);
          })
        }
      >
        {pending ? "Loading…" : "Load sample clients"}
      </button>
      {msg && <span className="text-sm text-rose">{msg}</span>}
    </div>
  );
}
