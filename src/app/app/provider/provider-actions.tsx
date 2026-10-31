"use client";

import { useState, useTransition } from "react";
import { btn } from "@/components/ui";
import { providerAction } from "../actions";

export function ProviderVisitActions({
  visitId,
  status,
  suggested,
  answered,
}: {
  visitId: string;
  status: string;
  suggested: string;
  answered: string | null;
}) {
  const [pending, start] = useTransition();
  const [proposing, setProposing] = useState(false);
  const [when, setWhen] = useState(suggested);
  const [msg, setMsg] = useState<string | null>(null);

  const run = (action: "proceed" | "propose" | "complete", t?: string) =>
    start(async () => {
      const res = await providerAction(visitId, action, t);
      setMsg(res && "error" in res && res.error ? res.error : action === "propose" ? "New time sent to the client." : null);
      setProposing(false);
    });

  if (["completed", "skipped"].includes(status)) return null;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {status === "confirmed" ? (
        <button className={btn.primary} disabled={pending} onClick={() => run("complete")}>
          Mark as done and get paid
        </button>
      ) : proposing ? (
        <>
          <input
            type="datetime-local"
            aria-label="Proposed time"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            className="rounded-full border border-mist px-4 py-2 text-sm"
          />
          <button className={btn.primary} disabled={pending} onClick={() => run("propose", when)}>
            Send to client
          </button>
          <button className={btn.quiet} onClick={() => setProposing(false)}>
            Cancel
          </button>
        </>
      ) : (
        <>
          {answered !== "proceed" && (
            <button className={btn.primary} disabled={pending} onClick={() => run("proceed")}>
              Confirm visit
            </button>
          )}
          <button className={btn.ghost} disabled={pending} onClick={() => setProposing(true)}>
            Propose a new time
          </button>
          {answered === "proceed" && <span className="text-sm text-sage">You confirmed this visit.</span>}
        </>
      )}
      {msg && <span className="text-sm text-slate">{msg}</span>}
    </div>
  );
}
