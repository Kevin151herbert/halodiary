"use client";

import { useState, useTransition } from "react";
import { btn, field } from "@/components/ui";
import { providerAction } from "../actions";

export function ProviderVisitActions({
  visitId,
  status,
  suggested,
  answered,
  autoAccepted = false,
}: {
  visitId: string;
  status: string;
  suggested: string;
  answered: string | null;
  /** A demo provider took the client's new time without being asked. */
  autoAccepted?: boolean;
}) {
  const [pending, start] = useTransition();
  const [proposing, setProposing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [when, setWhen] = useState(suggested);
  const [msg, setMsg] = useState<string | null>(null);

  const run = (action: "proceed" | "propose" | "complete" | "cancel", t?: string, r?: string) =>
    start(async () => {
      const res = await providerAction(visitId, action, t, r);
      const failed = res && "error" in res && res.error;
      setMsg(failed ? res.error! : action === "propose" ? "New time sent to the client." : action === "cancel" ? "Cancelled. The client has been told why." : null);
      if (!failed) {
        setProposing(false);
        setCancelling(false);
      }
    });

  if (["completed", "skipped"].includes(status)) return null;
  if (answered === "cancel") return <p className="mt-3 text-sm font-bold text-rose">You cancelled this visit.</p>;

  if (cancelling)
    return (
      <div className="clay-inset mt-3 space-y-3 p-4">
        <label className="block text-sm font-bold">
          Reason the client will see
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={200}
            placeholder="For example: van broke down"
            className={`${field} mt-1.5 bg-white`}
          />
        </label>
        <p className="text-xs text-slate">Under the agreement, cancelling inside the notice period credits the client part of the visit price.</p>
        <div className="flex flex-wrap gap-2">
          <button className={btn.primary} disabled={pending || !reason.trim()} onClick={() => run("cancel", undefined, reason)}>
            Cancel visit
          </button>
          <button className={btn.quiet} onClick={() => setCancelling(false)}>
            Keep it
          </button>
        </div>
        {msg && <p className="text-sm text-rose">{msg}</p>}
      </div>
    );

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {status === "confirmed" ? (
        <>
          <button className={btn.primary} disabled={pending} onClick={() => run("complete")}>
            Mark as done and get paid
          </button>
          <button className={btn.quiet} disabled={pending} onClick={() => setCancelling(true)}>
            Cancel visit
          </button>
        </>
      ) : proposing ? (
        <>
          <input
            type="datetime-local"
            aria-label="Proposed time"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            className={`${field} w-auto rounded-full`}
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
          <button className={btn.quiet} disabled={pending} onClick={() => setCancelling(true)}>
            Cancel visit
          </button>
          {answered === "proceed" &&
            (autoAccepted ? (
              <span className="text-sm text-slate">Moved by the client. Demo providers accept new times automatically; a real provider confirms first.</span>
            ) : (
              <span className="text-sm text-sage">You confirmed this visit.</span>
            ))}
        </>
      )}
      {msg && <span className="text-sm text-slate">{msg}</span>}
    </div>
  );
}
