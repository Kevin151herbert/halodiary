"use client";

import { AlertTriangle, Check, CreditCard, Plus, RotateCcw, Send, Sparkles, Star } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { btn, field } from "@/components/ui";
import type { Message } from "@/lib/chat";
import { createClient } from "@/lib/supabase/client";
import { fmt } from "@/lib/time";
import {
  acceptRefundAction,
  invoiceRequestAction,
  demoProblemAction,
  offerRefundAction,
  reportProblemAction,
  demoReplyAction,
  markChatReadAction,
  payRequestAction,
  rateVisitAction,
  requestPaymentAction,
  sendChatAction,
  sendPaymentAction,
} from "../../actions";

type Props = {
  conversationId: string;
  initial: Message[];
  as: "client" | "provider";
  otherName: string;
  isDemo: boolean;
  currency: string;
  tz: string;
  visits: { id: string; label: string }[];
  paysWithPayPal: boolean;
  reportable?: { id: string; label: string; price: number }[];
};

const REASONS: [string, string][] = [
  ["no_show", "Provider didn't show up"],
  ["incomplete", "Job not finished"],
  ["quality", "Poor quality"],
  ["damage", "Something was damaged"],
  ["late", "Very late"],
  ["other", "Something else"],
];

const PAYPAL_BTN =
  "inline-flex items-center justify-center gap-2 rounded-full bg-[#ffc439] px-5 py-3 text-sm font-bold text-[#003087] shadow-[0_12px_22px_-8px_rgba(255,170,0,0.7),inset_1px_2px_2px_rgba(255,255,255,0.6)] transition hover:brightness-95 disabled:opacity-50";

export function Chat({ conversationId, initial, as, otherName, isDemo, currency, tz, visits, paysWithPayPal, reportable = [] }: Props) {
  const [messages, setMessages] = useState<Message[]>(initial);
  const [text, setText] = useState("");
  const [panel, setPanel] = useState<null | "extra" | "pay" | "request" | "problem" | "refund">(null);
  const [typing, setTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);
  const supabase = useMemo(() => createClient(), []);
  const money = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(n);
  const first = otherName.split(" ")[0];

  const merge = (rows: Message[]) =>
    setMessages((cur) => {
      const map = new Map(cur.map((m) => [m.id, m]));
      for (const r of rows) map.set(r.id, { ...map.get(r.id), ...r });
      return [...map.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
    });

  // Live updates, with a light poll as a safety net.
  useEffect(() => {
    const refresh = async () => {
      const { data } = await supabase.from("messages").select("*").eq("conversation_id", conversationId).order("created_at").limit(300);
      if (data) merge(data as Message[]);
    };
    const channel = supabase
      .channel(`chat-${conversationId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` }, (p) => {
        if (p.new && "id" in p.new) merge([p.new as Message]);
      })
      .subscribe();
    const t = setInterval(refresh, 7000);
    return () => {
      clearInterval(t);
      supabase.removeChannel(channel);
    };
  }, [supabase, conversationId]);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, typing]);

  useEffect(() => {
    markChatReadAction(conversationId);
  }, [conversationId, messages.length]);

  const fail = (res: unknown) => {
    if (res && typeof res === "object" && "error" in res && (res as { error?: string }).error) {
      setError((res as { error: string }).error);
      return true;
    }
    setError(null);
    return false;
  };

  const afterClientMessage = async () => {
    if (!isDemo || as !== "client") return;
    setTyping(true);
    try {
      const r = await demoReplyAction(conversationId);
      if (r && "reply" in r) merge([r.reply, r.request].filter(Boolean) as Message[]);
    } finally {
      setTyping(false);
    }
  };

  const send = (body: string, kind: "text" | "extra_request" = "text", visitId?: string | null) => {
    // Show the message straight away; swap in the saved copy when the server answers.
    const tempId = `temp-${Date.now()}`;
    merge([
      {
        id: tempId,
        conversation_id: conversationId,
        sender: as,
        kind,
        body,
        amount: null,
        status: kind === "extra_request" ? "open" : null,
        visit_id: visitId ?? null,
        reply_to: null,
        meta: { sending: true },
        created_at: new Date().toISOString(),
      },
    ]);
    setText("");
    setPanel(null);
    start(async () => {
      const res = await sendChatAction(conversationId, body, kind, visitId);
      setMessages((cur) => cur.filter((m) => m.id !== tempId));
      if (fail(res)) {
        setText(body);
        return;
      }
      if (res && "message" in res && res.message) merge([res.message]);
      await afterClientMessage();
    });
  };

  return (
    <div className="flex flex-col">
      <ol className="space-y-3 pb-4" aria-live="polite">
        {messages.length === 0 && (
          <li className="clay-inset px-5 py-4 text-sm text-slate">
            Keep everything with {first} here: questions, extra requests, payments and ratings. It sits next to your agreement, so nothing gets lost in
            WhatsApp.
          </li>
        )}
        {messages.map((m) => (
          <Bubble key={m.id} m={m} as={as} first={first} money={money} tz={tz} paysWithPayPal={paysWithPayPal} onError={setError} onMerge={merge} aiVoice={isDemo && as === "client"} />
        ))}
        {typing && (
          <li className="flex">
            <span className="clay-sm inline-flex items-center gap-2 px-4 py-2.5 text-sm text-slate">
              <span className="flex gap-1" aria-hidden>
                {[0, 1, 2].map((i) => (
                  <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate/60" style={{ animationDelay: `${i * 120}ms` }} />
                ))}
              </span>
              {first} is typing
            </span>
          </li>
        )}
      </ol>
      <div ref={end} />

      <div className="clay sticky bottom-24 z-10 mt-2 p-3 md:bottom-4">
        {panel === "extra" && <ExtraPanel visits={visits} pending={pending} onSend={(b, v) => send(b, "extra_request", v)} onClose={() => setPanel(null)} />}
        {panel === "pay" && (
          <PayPanel
            first={first}
            currency={currency}
            pending={pending}
            paysWithPayPal={paysWithPayPal}
            onPay={(amount, note) =>
              start(async () => {
                const r = await sendPaymentAction(conversationId, amount, note);
                if (!fail(r)) setPanel(null);
              })
            }
            onClose={() => setPanel(null)}
          />
        )}
        {panel === "problem" && (
          <ProblemPanel
            visits={reportable}
            pending={pending}
            onSend={(visitId, reason, details) =>
              start(async () => {
                const r = await reportProblemAction(conversationId, visitId, reason, details);
                if (fail(r)) return;
                if (r && "message" in r && r.message) merge([r.message]);
                setPanel(null);
                if (r && "demo" in r && r.demo && "problemId" in r && r.problemId) {
                  setTyping(true);
                  try {
                    const d = await demoProblemAction(r.problemId);
                    if (d && "messages" in d && d.messages) merge(d.messages);
                  } finally {
                    setTyping(false);
                  }
                }
              })
            }
            onClose={() => setPanel(null)}
          />
        )}
        {panel === "refund" && (
          <RefundPanel
            currency={currency}
            pending={pending}
            onSend={(amount, note) =>
              start(async () => {
                const r = await offerRefundAction(conversationId, amount, note);
                if (fail(r)) return;
                if (r && "message" in r && r.message) merge([r.message]);
                setPanel(null);
              })
            }
            onClose={() => setPanel(null)}
          />
        )}
        {panel === "request" && (
          <RequestPanel
            currency={currency}
            pending={pending}
            onSend={(body, amount) =>
              start(async () => {
                const r = await requestPaymentAction(conversationId, body, amount);
                if (fail(r)) return;
                if (r && "message" in r && r.message) merge([r.message]);
                setPanel(null);
              })
            }
            onClose={() => setPanel(null)}
          />
        )}

        <div className="mb-2 flex flex-wrap gap-2">
          {as === "client" ? (
            <>
              <button type="button" onClick={() => setPanel(panel === "extra" ? null : "extra")} className={`${btn.ghost} px-3.5 py-2 text-xs`}>
                <Plus size={14} aria-hidden /> Extra service
              </button>
              <button type="button" onClick={() => setPanel(panel === "pay" ? null : "pay")} className={`${btn.ghost} px-3.5 py-2 text-xs`}>
                <CreditCard size={14} aria-hidden /> Pay {first}
              </button>
              {reportable.length > 0 && (
                <button type="button" onClick={() => setPanel(panel === "problem" ? null : "problem")} className={`${btn.ghost} px-3.5 py-2 text-xs text-rose`}>
                  <AlertTriangle size={14} aria-hidden /> Report a problem
                </button>
              )}
            </>
          ) : (
            <>
              <button type="button" onClick={() => setPanel(panel === "request" ? null : "request")} className={`${btn.ghost} px-3.5 py-2 text-xs`}>
                <CreditCard size={14} aria-hidden /> Request payment
              </button>
              {messages.some((m) => m.kind === "problem" && m.status === "open") && (
                <button type="button" onClick={() => setPanel(panel === "refund" ? null : "refund")} className={`${btn.ghost} px-3.5 py-2 text-xs`}>
                  <RotateCcw size={14} aria-hidden /> Offer a refund
                </button>
              )}
            </>
          )}
        </div>
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) send(text);
          }}
        >
          <label htmlFor="chat-input" className="sr-only">
            Message
          </label>
          <textarea
            id="chat-input"
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (text.trim()) send(text);
              }
            }}
            placeholder={`Message ${first}`}
            className={`${field} max-h-32 min-h-[46px] flex-1 resize-none`}
          />
          <button disabled={pending || !text.trim()} className="clay-btn-ink inline-flex h-[46px] w-[46px] items-center justify-center rounded-2xl disabled:opacity-40" aria-label="Send">
            <Send size={18} aria-hidden />
          </button>
        </form>
        {error && <p className="mt-2 text-sm text-rose">{error}</p>}
        {isDemo && as === "client" && (
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-slate">
            <Sparkles size={12} className="text-halo" aria-hidden /> Demo provider: {first}&apos;s replies are written by HaloDiary&apos;s AI.
          </p>
        )}
      </div>
    </div>
  );
}

function Bubble({
  m,
  as,
  first,
  money,
  tz,
  paysWithPayPal,
  onError,
  onMerge,
  aiVoice = false,
}: {
  aiVoice?: boolean;
  m: Message;
  as: "client" | "provider";
  first: string;
  money: (n: number) => string;
  tz: string;
  paysWithPayPal: boolean;
  onError: (e: string | null) => void;
  onMerge: (rows: Message[]) => void;
}) {
  const mine = m.sender === as;
  const time = fmt(m.created_at, tz, { hour: "2-digit", minute: "2-digit" });
  const [pending, start] = useTransition();

  if (m.kind === "payment") {
    return (
      <li className="flex justify-center">
        <span className="clay-sm inline-flex max-w-md items-start gap-2 px-4 py-2.5 text-sm">
          <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sage text-white" aria-hidden>
            <Check size={12} />
          </span>
          <span>
            {m.body}
            {typeof m.meta?.paypal_ref === "string" && (
              <span className="mt-0.5 block text-[11px] text-slate">
                Reference <code>{m.meta.paypal_ref}</code>
              </span>
            )}
          </span>
        </span>
      </li>
    );
  }

  if (m.kind === "problem") {
    const reason = REASONS.find(([k]) => k === (m.meta as { reason?: string })?.reason)?.[1] ?? "PayPal dispute";
    return (
      <li className={`flex ${m.sender === "system" ? "justify-center" : mine ? "justify-end" : ""}`}>
        <div className="clay w-full max-w-md p-5 ring-2 ring-rose/25">
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-rose">
            <AlertTriangle size={14} aria-hidden /> Problem reported · {reason}
          </p>
          <p className="mt-2 text-sm leading-relaxed">{m.body}</p>
          <p className="mt-2 text-[11px] text-slate">
            {time} · {m.status === "open" ? "Waiting for a response" : "Resolved"}
            {m.sender === "client" ? " · summarised by AI from the client's words" : ""}
          </p>
        </div>
      </li>
    );
  }

  if (m.kind === "refund_offer") {
    return (
      <li className={`flex ${mine ? "justify-end" : ""}`}>
        <div className="clay w-full max-w-sm p-5">
          <p className="text-xs font-bold uppercase tracking-wide text-slate">Refund offered</p>
          <p className="mt-1 font-bold">{m.body}</p>
          <p className="mt-2 font-display text-3xl font-extrabold text-sage">{money(Number(m.amount))}</p>
          {m.status === "paid" || m.status === "done" ? (
            <p className="mt-3 inline-flex items-center gap-1.5 text-sm font-bold text-sage">
              <Check size={16} aria-hidden /> Refunded
            </p>
          ) : as === "client" ? (
            <button
              className={`${PAYPAL_BTN} mt-4 w-full`}
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await acceptRefundAction(m.id);
                  if (r && "error" in r && r.error) onError(r.error);
                  else onMerge([{ ...m, status: "paid" }]);
                })
              }
            >
              {pending ? "Refunding…" : `Accept refund to ${paysWithPayPal ? "PayPal" : "PayPal (simulated)"}`}
            </button>
          ) : (
            <p className="mt-3 text-sm text-slate">Waiting for your client to accept.</p>
          )}
          <p className="mt-2 text-[11px] text-slate">{time}</p>
        </div>
      </li>
    );
  }

  if (m.kind === "rating_request" && m.status === "cancelled") return null;
  if (m.kind === "rating_request") return <RatingCard m={m} as={as} first={first} onError={onError} onMerge={onMerge} />;

  if (m.kind === "payment_request") {
    return (
      <li className={`flex ${mine ? "justify-end" : ""}`}>
        <div className="clay w-full max-w-sm p-5">
          <p className="text-xs font-bold uppercase tracking-wide text-slate">Payment request</p>
          <p className="mt-1 font-bold">{m.body}</p>
          <p className="mt-2 font-display text-3xl font-extrabold">{money(Number(m.amount))}</p>
          {m.status === "paid" ? (
            <p className="mt-3 inline-flex items-center gap-1.5 text-sm font-bold text-sage">
              <Check size={16} aria-hidden /> Paid{typeof m.meta?.mode === "string" && m.meta.mode === "simulated" ? " (simulated)" : " with PayPal"}
            </p>
          ) : as === "client" ? (
            <button
              className={`${PAYPAL_BTN} mt-4 w-full`}
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await payRequestAction(m.id);
                  if (r && "error" in r && r.error) onError(r.error);
                  else onMerge([{ ...m, status: "paid" }]);
                })
              }
            >
              {pending ? "Paying…" : `Pay ${money(Number(m.amount))} with ${paysWithPayPal ? "PayPal" : "PayPal (simulated)"}`}
            </button>
          ) : null}
          {as === "client" && m.status === "open" && paysWithPayPal && (
            <div className="mt-2 text-center text-xs">
              {typeof m.meta?.invoice_url === "string" ? (
                <a href={m.meta.invoice_url} target="_blank" rel="noreferrer" className="font-bold text-[#003087] underline">
                  Open the PayPal invoice
                </a>
              ) : (
                <button
                  type="button"
                  disabled={pending}
                  className="font-bold text-slate underline hover:text-ink"
                  onClick={() =>
                    start(async () => {
                      const r = await invoiceRequestAction(m.id);
                      if (r && "error" in r && r.error) onError(r.error);
                      else if (r && "url" in r && r.url) {
                        onMerge([{ ...m, meta: { ...m.meta, invoice_url: r.url } }]);
                        window.open(r.url, "_blank", "noopener");
                      }
                    })
                  }
                >
                  Prefer an invoice? Get a PayPal invoice
                </button>
              )}
            </div>
          )}
          {as === "provider" && m.status === "open" && <p className="mt-3 text-sm text-slate">Waiting for your client to pay.</p>}
          <p className="mt-2 text-[11px] text-slate">{time}</p>
        </div>
      </li>
    );
  }

  if (m.kind === "extra_request") {
    return (
      <li className={`flex ${mine ? "justify-end" : ""}`}>
        <div className={`max-w-[85%] p-4 ${mine ? "clay-btn-ink rounded-3xl rounded-br-lg" : "clay-sm rounded-3xl rounded-bl-lg"}`}>
          <p className={`text-[11px] font-bold uppercase tracking-wide ${mine ? "text-halo" : "text-slate"}`}>Extra service request</p>
          <p className="mt-1 whitespace-pre-wrap">{m.body}</p>
          <p className={`mt-2 text-[11px] ${mine ? "text-white/70" : "text-slate"}`}>
            {time} · {m.status === "accepted" ? "Quoted" : `Waiting for ${mine ? first : "your"} quote`}
          </p>
        </div>
      </li>
    );
  }

  if (m.kind === "rating") {
    const r = Number(m.meta?.rating ?? 0);
    return (
      <li className={`flex ${mine ? "justify-end" : ""}`}>
        <div className={`max-w-[85%] px-4 py-3 ${mine ? "clay-btn-ink rounded-3xl rounded-br-lg" : "clay-sm rounded-3xl rounded-bl-lg"}`}>
          <Stars value={r} />
          {m.body && <p className="mt-1 whitespace-pre-wrap">{m.body}</p>}
          <p className={`mt-1 text-[11px] ${mine ? "text-white/70" : "text-slate"}`}>{time}</p>
        </div>
      </li>
    );
  }

  return (
    <li className={`flex ${mine ? "justify-end" : ""}`}>
      <div className={`max-w-[85%] px-4 py-2.5 ${mine ? "clay-btn-ink rounded-3xl rounded-br-lg" : "clay-sm rounded-3xl rounded-bl-lg"}`}>
        <p className="whitespace-pre-wrap">{m.body}</p>
        <p className={`mt-1 text-right text-[11px] ${mine ? "text-white/70" : "text-slate"}`}>
          {aiVoice && !mine && m.sender === "provider" ? "AI reply for a demo provider · " : ""}
          {time}
        </p>
      </div>
    </li>
  );
}

function Stars({ value, onPick, size = 16 }: { value: number; onPick?: (n: number) => void; size?: number }) {
  return (
    <span className="inline-flex gap-1" role={onPick ? "radiogroup" : "img"} aria-label={onPick ? "Rating" : `${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) =>
        onPick ? (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} star${n > 1 ? "s" : ""}`}
            onClick={() => onPick(n)}
            className={`clay-sm inline-flex h-11 w-11 items-center justify-center rounded-2xl transition ${n <= value ? "text-halo" : "text-[#cfd4de]"}`}
          >
            <Star size={size} fill="currentColor" aria-hidden />
          </button>
        ) : (
          <Star key={n} size={size} className={n <= value ? "text-halo" : "text-[#cfd4de]"} fill="currentColor" aria-hidden />
        ),
      )}
    </span>
  );
}

function RatingCard({ m, as, first, onError, onMerge }: { m: Message; as: "client" | "provider"; first: string; onError: (e: string | null) => void; onMerge: (rows: Message[]) => void }) {
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");
  const [pending, start] = useTransition();
  const done = m.status === "done";
  return (
    <li className="flex justify-center">
      <div className="clay w-full max-w-md p-5 text-center">
        <p className="text-xs font-bold uppercase tracking-wide text-slate">Rate this visit</p>
        <p className="mt-1 font-bold">{m.body}</p>
        {done ? (
          <div className="mt-3">
            <Stars value={Number(m.meta?.rating ?? 0)} size={20} />
            <p className="mt-1 text-sm text-slate">Thanks, your rating is on {first}&apos;s profile.</p>
          </div>
        ) : as === "client" ? (
          <div className="mt-4 space-y-3">
            <Stars value={stars} onPick={setStars} size={20} />
            {stars > 0 && (
              <>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={2}
                  maxLength={600}
                  placeholder={stars >= 4 ? "What went well? (optional)" : "What should improve? (optional)"}
                  className={`${field} resize-none text-left`}
                />
                <button
                  className={`${btn.halo} w-full`}
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await rateVisitAction(m.id, stars, comment);
                      if (r && "error" in r && r.error) onError(r.error);
                      else onMerge([{ ...m, status: "done", meta: { rating: stars } }]);
                    })
                  }
                >
                  Send rating
                </button>
              </>
            )}
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate">Waiting for your client&apos;s rating.</p>
        )}
      </div>
    </li>
  );
}

function ExtraPanel({ visits, pending, onSend, onClose }: { visits: { id: string; label: string }[]; pending: boolean; onSend: (body: string, visitId: string | null) => void; onClose: () => void }) {
  const [body, setBody] = useState("");
  const [visit, setVisit] = useState(visits[0]?.id ?? "");
  return (
    <div className="clay-inset mb-3 space-y-3 p-4">
      <p className="text-sm font-bold">Ask for something extra</p>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} maxLength={500} placeholder="For example: also clean the oven and the inside of the fridge" className={`${field} resize-none bg-white`} />
      {visits.length > 0 && (
        <label className="block text-xs font-bold text-slate">
          For
          <select value={visit} onChange={(e) => setVisit(e.target.value)} className={`${field} mt-1 bg-white text-ink`}>
            {visits.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
            <option value="">Not tied to a visit</option>
          </select>
        </label>
      )}
      <div className="flex gap-2">
        <button className={btn.primary} disabled={pending || !body.trim()} onClick={() => onSend(body, visit || null)}>
          Send request
        </button>
        <button className={btn.quiet} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

function PayPanel({
  first,
  currency,
  pending,
  paysWithPayPal,
  onPay,
  onClose,
}: {
  first: string;
  currency: string;
  pending: boolean;
  paysWithPayPal: boolean;
  onPay: (amount: number, note: string) => void;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState("10");
  const [note, setNote] = useState("");
  const n = Number(amount);
  return (
    <div className="clay-inset mb-3 space-y-3 p-4">
      <p className="text-sm font-bold">Pay {first} for something extra, or leave a tip</p>
      <p className="-mt-2 text-xs text-slate">Charged straight away, separately from any visit hold. {first} gets 90% of it.</p>
      <div className="flex gap-2">
        <label className="w-28 text-xs font-bold text-slate">
          Amount ({currency})
          <input type="number" min={1} max={500} step="0.5" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${field} mt-1 bg-white text-ink`} />
        </label>
        <label className="flex-1 text-xs font-bold text-slate">
          What for
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={140} placeholder="Tip, extra hour, materials…" className={`${field} mt-1 bg-white text-ink`} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button className={PAYPAL_BTN} disabled={pending || !(n > 0 && n <= 500)} onClick={() => onPay(n, note)}>
          {pending ? "Paying…" : `Pay with ${paysWithPayPal ? "PayPal" : "PayPal (simulated)"}`}
        </button>
        <button className={btn.quiet} onClick={onClose}>
          Close
        </button>
      </div>
      <p className="text-[11px] text-slate">Paid straight away with your saved PayPal account. {first} receives 90%; it shows in your payments ledger.</p>
    </div>
  );
}

function RequestPanel({ currency, pending, onSend, onClose }: { currency: string; pending: boolean; onSend: (body: string, amount: number) => void; onClose: () => void }) {
  const [body, setBody] = useState("");
  const [amount, setAmount] = useState("");
  const n = Number(amount);
  return (
    <div className="clay-inset mb-3 space-y-3 p-4">
      <p className="text-sm font-bold">Request a payment for extra work</p>
      <div className="flex gap-2">
        <label className="flex-1 text-xs font-bold text-slate">
          What for
          <input value={body} onChange={(e) => setBody(e.target.value)} maxLength={140} placeholder="Oven deep clean" className={`${field} mt-1 bg-white text-ink`} />
        </label>
        <label className="w-28 text-xs font-bold text-slate">
          Amount ({currency})
          <input type="number" min={1} step="0.5" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${field} mt-1 bg-white text-ink`} />
        </label>
      </div>
      <div className="flex gap-2">
        <button className={btn.primary} disabled={pending || !body.trim() || !(n > 0)} onClick={() => onSend(body, n)}>
          Send request
        </button>
        <button className={btn.quiet} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

function ProblemPanel({
  visits,
  pending,
  onSend,
  onClose,
}: {
  visits: { id: string; label: string }[];
  pending: boolean;
  onSend: (visitId: string, reason: string, details: string) => void;
  onClose: () => void;
}) {
  const [visit, setVisit] = useState(visits[0]?.id ?? "");
  const [reason, setReason] = useState("quality");
  const [details, setDetails] = useState("");
  return (
    <div className="clay-inset mb-3 space-y-3 p-4">
      <p className="text-sm font-bold">Report a problem with a visit</p>
      <p className="text-xs text-slate">Inside your agreement&apos;s window. The AI summarises it fairly for your provider; refunds go straight back to PayPal.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <select aria-label="Which visit" value={visit} onChange={(e) => setVisit(e.target.value)} className={`${field} bg-white`}>
          {visits.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
        <select aria-label="What went wrong" value={reason} onChange={(e) => setReason(e.target.value)} className={`${field} bg-white`}>
          {REASONS.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={2} maxLength={1200} placeholder="What happened?" className={`${field} resize-none bg-white`} />
      <div className="flex gap-2">
        <button className={btn.primary} disabled={pending || !visit} onClick={() => onSend(visit, reason, details)}>
          {pending ? "Sending…" : "Send report"}
        </button>
        <button className={btn.quiet} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

function RefundPanel({ currency, pending, onSend, onClose }: { currency: string; pending: boolean; onSend: (amount: number, note: string) => void; onClose: () => void }) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const n = Number(amount);
  return (
    <div className="clay-inset mb-3 space-y-3 p-4">
      <p className="text-sm font-bold">Offer a refund</p>
      <div className="flex gap-2">
        <label className="w-28 text-xs font-bold text-slate">
          Amount ({currency})
          <input type="number" min={1} step="0.5" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${field} mt-1 bg-white text-ink`} />
        </label>
        <label className="flex-1 text-xs font-bold text-slate">
          Note
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={140} placeholder="Sorry, I'll finish the kitchen next time" className={`${field} mt-1 bg-white text-ink`} />
        </label>
      </div>
      <div className="flex gap-2">
        <button className={btn.primary} disabled={pending || !(n > 0)} onClick={() => onSend(n, note)}>
          Send offer
        </button>
        <button className={btn.quiet} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
