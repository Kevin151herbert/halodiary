"use client";

import { FileText } from "lucide-react";
import { useState, useTransition } from "react";
import { btn } from "@/components/ui";
import { sendStatementAction } from "../actions";

/** Emails a PayPal invoice, marked paid, listing everything charged this month. */
export function StatementButton({ month, label }: { month: string; label: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        className={btn.ghost}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await sendStatementAction(month);
            setMsg(
              r && "error" in r && r.error
                ? { ok: false, text: r.error }
                : { ok: true, text: `PayPal statement sent (invoice ${(r as { invoiceId?: string }).invoiceId}), marked paid.` },
            );
          })
        }
      >
        <FileText size={16} aria-hidden /> {pending ? "Asking PayPal…" : `Get a PayPal statement for ${label}`}
      </button>
      {msg && <span className={`text-sm ${msg.ok ? "text-sage" : "text-rose"}`}>{msg.text}</span>}
    </div>
  );
}
