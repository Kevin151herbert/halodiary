"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses, type UIMessage } from "ai";
import { Power, RotateCcw, Send, Sparkles, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { CADENCES, type CadenceKey } from "@/lib/cadence";
import { defaultTermsFor } from "@/lib/contract";
import { toggleAssistantAction } from "@/app/app/actions";
import { btn } from "../ui";

type ToolPart = {
  type: string;
  toolCallId: string;
  state: string;
  input?: Record<string, unknown>;
  output?: unknown;
  errorText?: string;
  approval?: { id: string; approved?: boolean; isAutomatic?: boolean; reason?: string };
};

const WORKING: Record<string, string> = {
  list_services: "Checking the service catalogue",
  search_providers: "Searching providers near you",
  get_diary: "Reading your diary",
  get_budget: "Checking your budget",
  get_payments: "Looking at your payments",
  add_recurring_service: "Adding to your diary",
  answer_visit: "Updating the visit",
  change_service_status: "Updating the service",
  approve_budget: "Approving the budget",
  update_assistant_settings: "Updating settings",
  answer_as_provider: "Answering as the provider",
};

const APPROVE_LABEL: Record<string, string> = {
  add_recurring_service: "Add to diary",
  answer_visit: "Confirm",
  change_service_status: "Confirm",
  approve_budget: "Approve budget",
  update_assistant_settings: "Update",
  answer_as_provider: "Confirm",
  propose_agreement_change: "Sign and propose",
  sign_agreement: "Sign",
  message_provider: "Send",
  send_paypal_statement: "Send statement",
};

function approvalText(name: string, input: Record<string, unknown> = {}) {
  if (name === "add_recurring_service") {
    return `${input.service_name} with ${input.provider_name}, ${String(input.cadence).replace(/_/g, " ")}${input.time ? ` at ${input.time}` : ""}, ${input.price_per_visit} a visit.`;
  }
  return String(input.summary ?? name.replace(/_/g, " "));
}

const SUGGESTIONS: Record<string, string[]> = {
  client: [
    "I need cleaning twice a week and a dog walker on weekends, under €20 a walk",
    "What do I need to answer this week?",
    "Why is next month more expensive?",
    "Find a maths tutor for Mon, Wed and Fri at 16:30",
  ],
  provider: ["What visits do I have this week?", "Propose moving my next visit to the following day"],
};

/** Very small markdown: **bold**, line breaks and "- " bullets. */
function Text({ text }: { text: string }) {
  return (
    <div className="space-y-2">
      {text.split(/\n{2,}/).map((block, i) => {
        const lines = block.split("\n");
        const bullets = lines.every((l) => /^\s*[-*] /.test(l));
        const inline = (s: string) =>
          s.split(/(\*\*[^*]+\*\*)/g).map((seg, j) => (seg.startsWith("**") ? <strong key={j}>{seg.slice(2, -2)}</strong> : <span key={j}>{seg}</span>));
        return bullets ? (
          <ul key={i} className="list-disc space-y-1 pl-5">
            {lines.map((l, j) => (
              <li key={j}>{inline(l.replace(/^\s*[-*] /, ""))}</li>
            ))}
          </ul>
        ) : (
          <p key={i} className="whitespace-pre-wrap">
            {inline(block)}
          </p>
        );
      })}
    </div>
  );
}

function ProviderResults({ output }: { output: unknown }) {
  if (!Array.isArray(output) || !output.length) return null;
  return (
    <ul className="mt-1 space-y-1.5">
      {(output as { provider_id: string; name: string; price: string; rating: number; distance_km: number }[]).map((r) => (
        <li key={r.provider_id}>
          <a href={`/app/providers/${r.provider_id}`} className="clay-btn-ghost flex items-center justify-between rounded-xl px-3 py-2 text-sm">
            <span className="font-bold">{r.name}</span>
            <span className="text-slate">
              ★ {r.rating.toFixed(1)}, {r.distance_km.toFixed(1)} km, {r.price}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/** What approving a new service means: the monthly cost and the agreement the assistant will sign for you. */
function PlanTerms({ input }: { input: Record<string, unknown> }) {
  const price = Number(String(input.price_per_visit ?? "").replace(/[^0-9.]/g, "")) || 0;
  const cadence = CADENCES[String(input.cadence) as CadenceKey];
  const t = defaultTermsFor(String(input.service_id ?? ""));
  const monthly = price * (cadence?.perMonth ?? 4.3);
  const code = String(input.price_per_visit ?? "").match(/[A-Z]{3}/)?.[0] ?? "EUR";
  const fmtMoney = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: code, maximumFractionDigits: 0 }).format(n);
  return (
    <ul className="mt-2 space-y-1 text-xs text-slate">
      {price > 0 && <li>About {fmtMoney(monthly)} a month. HaloDiary checked it fits your monthly budget.</li>}
      <li>
        Approving signs the standard agreement for you: free changes up to {t.cancellation_notice_hours}h before, {t.late_cancellation_fee_pct}% fee for later
        ones, {t.termination_notice_days} days&apos; notice to end. You can change it later under Agreements.
      </li>
    </ul>
  );
}

function ToolView({ part, onApprove }: { part: ToolPart; onApprove: (id: string, approved: boolean) => void }) {
  const name = part.type.replace(/^tool-/, "");
  if (part.state === "approval-requested" && part.approval && !part.approval.isAutomatic) {
    return (
      <div className="clay-sm p-4 ring-2 ring-halo/70">
        <p className="text-xs font-bold text-slate">Needs your OK</p>
        <p className="mt-1 font-bold">{approvalText(name, part.input)}</p>
        {name === "add_recurring_service" && <PlanTerms input={part.input as Record<string, unknown>} />}
        <div className="mt-3 flex gap-2">
          <button className={btn.primary} onClick={() => onApprove(part.approval!.id, true)}>
            {APPROVE_LABEL[name] ?? "Approve"}
          </button>
          <button className={btn.ghost} onClick={() => onApprove(part.approval!.id, false)}>
            Not now
          </button>
        </div>
      </div>
    );
  }
  if (part.state === "output-denied" || (part.state === "approval-responded" && part.approval?.approved === false)) {
    return <p className="text-sm text-slate">Declined: {approvalText(name, part.input)}</p>;
  }
  if (part.state === "output-error") return <p className="text-sm text-rose">Couldn&apos;t finish: {part.errorText}</p>;
  if (part.state === "output-available") {
    const out = part.output as { error?: string } | undefined;
    if (out && typeof out === "object" && "error" in out && out.error)
      return (
        <p className="clay-inset px-3 py-2 text-sm">
          <span className="font-bold text-rose">Stopped by your limits. </span>
          {out.error}
        </p>
      );
    if (name === "search_providers") return <ProviderResults output={part.output} />;
    if (name in APPROVE_LABEL) return <p className="text-sm font-bold text-sage">Done: {approvalText(name, part.input)}</p>;
    return null;
  }
  return (
    <p className="flex items-center gap-2 text-sm text-slate">
      <span className="h-2 w-2 animate-pulse rounded-full bg-halo" aria-hidden />
      {WORKING[name] ?? "Working"}…
    </p>
  );
}

function Chat({
  role,
  firstName,
  onDisable,
  prompt,
  onPromptSent,
}: {
  role: string;
  firstName: string;
  onDisable: () => void;
  prompt?: string | null;
  onPromptSent?: () => void;
}) {
  const path = usePathname();
  const router = useRouter();
  const [input, setInput] = useState("");
  const [loaded, setLoaded] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const pathRef = useRef(path);
  pathRef.current = path;

  const { messages, sendMessage, addToolApprovalResponse, status, setMessages, error } = useChat({
    transport: new DefaultChatTransport({ api: "/api/assistant", body: () => ({ page: pathRef.current }) }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    onFinish: ({ messages: all }) => {
      router.refresh();
      fetch("/api/assistant/history", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: all }) });
    },
  });

  useEffect(() => {
    fetch("/api/assistant/history")
      .then((r) => r.json())
      .then((d: { messages: UIMessage[] }) => {
        if (d.messages?.length) setMessages(d.messages);
      })
      .finally(() => setLoaded(true));
  }, [setMessages]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, status]);

  const busy = status === "submitted" || status === "streaming";
  const send = (text: string) => {
    if (!text.trim() || busy) return;
    sendMessage({ text });
    setInput("");
  };

  // A message handed over by the tour (or any other button) is sent once the history has loaded.
  useEffect(() => {
    if (!prompt || !loaded || busy) return;
    sendMessage({ text: prompt });
    onPromptSent?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt, loaded]);

  return (
    <>
      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4" aria-live="polite">
        {loaded && messages.length === 0 && (
          <div>
            <p className="font-display text-xl font-bold">Hi {firstName}, what should I sort out?</p>
            <p className="mt-1 text-sm text-slate">
              I can find providers, set up recurring services, answer day-before checks and explain your spending. I ask before changing anything.
            </p>
            <ul className="mt-4 space-y-2">
              {(SUGGESTIONS[role] ?? SUGGESTIONS.client).map((s) => (
                <li key={s}>
                  <button onClick={() => send(s)} className="clay-btn-ghost w-full rounded-xl px-3 py-2 text-left text-sm">
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? "flex justify-end" : ""}>
            <div className={m.role === "user" ? "clay-btn-ink max-w-[85%] rounded-3xl rounded-br-lg px-4 py-2.5" : "space-y-2"}>
              {m.parts.map((part, i) => {
                if (part.type === "text") return <Text key={i} text={part.text} />;
                if (part.type.startsWith("tool-"))
                  return (
                    <ToolView
                      key={i}
                      part={part as unknown as ToolPart}
                      onApprove={(id, approved) => addToolApprovalResponse({ id, approved })}
                    />
                  );
                return null;
              })}
            </div>
          </div>
        ))}
        {status === "submitted" && (
          <p className="flex items-center gap-2 text-sm text-slate">
            <span className="h-2 w-2 animate-pulse rounded-full bg-halo" aria-hidden />
            Thinking…
          </p>
        )}
        {error && <p className="text-sm text-rose">{error.message || "The assistant couldn't answer. Try again."}</p>}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="p-3"
      >
        <div className="flex items-end gap-2 clay-inset p-2">
          <label htmlFor="assistant-input" className="sr-only">
            Message the assistant
          </label>
          <textarea
            id="assistant-input"
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder={role === "client" ? "Book, move, skip or ask about spending…" : "Ask about your visits…"}
            className="max-h-32 min-h-[2.5rem] flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none"
          />
          <button type="submit" disabled={busy || !input.trim()} className="clay-btn-ink rounded-2xl p-2.5 disabled:opacity-40" aria-label="Send">
            <Send size={16} />
          </button>
        </div>
        <div className="mt-2 flex items-center justify-between px-1 text-xs text-slate">
          <span>Every action lands in your Activity log.</span>
          <span className="flex gap-1">
            <button
              type="button"
              onClick={() => {
                setMessages([]);
                fetch("/api/assistant/history", { method: "DELETE" });
              }}
              className="inline-flex items-center gap-1 rounded-full px-2 py-1 hover:bg-mist/60"
            >
              <RotateCcw size={12} /> New chat
            </button>
            <button type="button" onClick={onDisable} className="inline-flex items-center gap-1 rounded-full px-2 py-1 hover:bg-mist/60">
              <Power size={12} /> Turn off
            </button>
          </span>
        </div>
      </form>
    </>
  );
}

export function AssistantShell({
  enabled,
  configured,
  role,
  firstName,
  children,
}: {
  enabled: boolean;
  configured: boolean;
  role: string;
  firstName: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    const onAsk = (e: Event) => {
      const text = (e as CustomEvent<{ text?: string }>).detail?.text;
      if (!text) return;
      setOpen(true);
      setPrompt(text);
    };
    window.addEventListener("halodiary:ask", onAsk);
    return () => window.removeEventListener("halodiary:ask", onAsk);
  }, []);
  const toggle = (on: boolean) => start(() => toggleAssistantAction(on));
  // In a chat thread the launcher would sit on top of the message box, so it moves up out of the way.
  const inThread = usePathname().startsWith("/app/messages/");

  return (
    <div className={open ? "sm:pr-[420px]" : ""}>
      {children}

      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label={enabled ? "Ask HaloDiary" : "Assistant off"}
          className={`fixed ${inThread ? "top-3 bottom-auto md:top-6 md:bottom-auto" : "bottom-24 md:bottom-6"} right-4 z-30 inline-flex items-center gap-2 rounded-full p-3.5 text-sm font-bold md:right-6 md:px-5 md:py-3 ${
            enabled ? "clay-btn-ink" : "clay-btn-ghost text-slate"
          }`}
        >
          <Sparkles size={18} className={enabled ? "text-halo" : ""} aria-hidden />
          <span className="hidden md:inline">{enabled ? "Ask HaloDiary" : "Assistant off"}</span>
        </button>
      )}

      {open && (
        <aside
          aria-label="Assistant"
          className="fixed inset-0 z-40 flex flex-col bg-paper sm:inset-y-3 sm:left-auto sm:right-3 sm:w-[420px] sm:rounded-[28px] sm:shadow-[18px_20px_50px_-10px_rgba(29,34,56,0.35)]"
        >
          <header className="flex items-center gap-3 px-5 py-4">
            <Sparkles size={18} className="text-halo" aria-hidden />
            <h2 className="flex-1 font-display text-lg font-bold">Assistant</h2>
            <button
              role="switch"
              aria-checked={enabled}
              aria-label="Assistant on or off"
              disabled={pending}
              onClick={() => toggle(!enabled)}
              className={`relative h-7 w-12 rounded-full transition ${enabled ? "clay-btn-ink" : "clay-inset"}`}
            >
              <span className={`knob absolute top-1 h-5 w-5 transition-all ${enabled ? "left-[24px]" : "left-1"}`} />
            </button>
            <button onClick={() => setOpen(false)} className="rounded-full p-1.5 hover:bg-mist/60" aria-label="Close assistant">
              <X size={18} />
            </button>
          </header>

          {!enabled ? (
            <div className="flex flex-1 flex-col justify-center px-8 text-center">
              <p className="font-display text-xl font-bold">The assistant is off</p>
              <p className="mt-2 text-sm text-slate">
                HaloDiary keeps running without it: visits are still checked the day before, and payments are still held and released by the scheduler. Turn it
                back on any time.
              </p>
              <button className={`${btn.primary} mx-auto mt-6`} disabled={pending} onClick={() => toggle(true)}>
                Turn the assistant on
              </button>
            </div>
          ) : !configured ? (
            <div className="flex flex-1 flex-col justify-center px-8 text-center">
              <p className="font-display text-xl font-bold">Almost ready</p>
              <p className="mt-2 text-sm text-slate">This deployment needs an ANTHROPIC_API_KEY before the assistant can answer.</p>
            </div>
          ) : (
            <Chat role={role} firstName={firstName} onDisable={() => toggle(false)} prompt={prompt} onPromptSent={() => setPrompt(null)} />
          )}
        </aside>
      )}
    </div>
  );
}
