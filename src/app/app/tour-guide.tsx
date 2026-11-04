"use client";

import { Check, ChevronDown, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { btn } from "@/components/ui";
import { dismissTourAction } from "../start/actions";
import { setClockAction } from "./actions";

export type TourState = { approved: boolean; paypal: boolean; held: boolean; charged: boolean; asked: boolean; month: string };

const BUYER_EMAIL = process.env.NEXT_PUBLIC_SANDBOX_BUYER_EMAIL;
const BUYER_PASSWORD = process.env.NEXT_PUBLIC_SANDBOX_BUYER_PASSWORD;

/** Opens the assistant panel with a message already sent. */
export function askAssistant(text: string) {
  window.dispatchEvent(new CustomEvent("halodiary:ask", { detail: { text } }));
}

/** The 90-second judge tour: five steps, each ticked from what actually happened in this account. */
export function TourGuide({ state }: { state: TourState }) {
  const [providerSeen, setProviderSeen] = useState(false);
  const [open, setOpen] = useState(true);
  const [pending, start] = useTransition();
  useEffect(() => {
    try {
      setProviderSeen(localStorage.getItem("hd-tour-provider") === "1");
      setOpen(localStorage.getItem("hd-tour-collapsed") !== "1");
    } catch {
      /* storage blocked: defaults are fine */
    }
  }, []);
  const toggle = () => {
    setOpen((o) => {
      try {
        localStorage.setItem("hd-tour-collapsed", o ? "1" : "0");
      } catch {}
      return !o;
    });
  };

  const steps = [
    {
      done: state.approved,
      title: "Approve the month once with PayPal",
      body: (
        <>
          On Budget, press the PayPal button and approve. Nothing is charged now; each visit is paid only after it happens.
          {BUYER_EMAIL && (
            <span className="mt-1 block">
              Sandbox login: <span className="font-mono">{BUYER_EMAIL}</span>
              {BUYER_PASSWORD && (
                <>
                  {" "}
                  / <span className="font-mono">{BUYER_PASSWORD}</span>
                </>
              )}
            </span>
          )}
        </>
      ),
      action: (
        <Link href="/app/budget" className={`${btn.primary} px-4 py-2 text-sm`}>
          Go to Budget
        </Link>
      ),
    },
    {
      done: state.held,
      title: "Skip to tomorrow and confirm the visit",
      body: "The day-before check for the first cleaning arrives. Press Proceed on the Diary and PayPal holds the price.",
      action: (
        <span className="flex flex-wrap gap-2">
          <button className={`${btn.primary} px-4 py-2 text-sm`} disabled={pending} onClick={() => start(() => setClockAction(24))}>
            {pending ? "Moving time…" : "Skip to tomorrow"}
          </button>
          <Link href="/app#answers" className={`${btn.ghost} px-4 py-2 text-sm`}>
            Show the check
          </Link>
        </span>
      ),
    },
    {
      done: state.charged,
      title: "Skip past the visit",
      body: "The cleaning happens. PayPal captures the hold and the cleaner is paid out. Watch it under \"Where your money is\".",
      action: (
        <button className={`${btn.primary} px-4 py-2 text-sm`} disabled={pending} onClick={() => start(() => setClockAction(72))}>
          {pending ? "Moving time…" : "Skip ahead 3 days"}
        </button>
      ),
    },
    {
      done: state.asked,
      title: "Let the AI book something",
      body: "Ask the assistant for a babysitter. It searches, picks, and asks you to approve before anything is booked or paid. Your AI spending limit is €75 a payment: try a bigger one and watch it refuse.",
      action: (
        <span className="flex flex-wrap gap-2">
          <button className={`${btn.primary} px-4 py-2 text-sm`} onClick={() => askAssistant("Find me a babysitter for Saturday evenings and add it to my diary.")}>
            Ask the assistant
          </button>
          <button className={`${btn.ghost} px-4 py-2 text-sm`} onClick={() => askAssistant("Add a car service every quarter with the best garage near me.")}>
            Try going over the limit
          </button>
        </span>
      ),
    },
    {
      done: providerSeen,
      title: "See the provider's side",
      body: "Schedule, attendance score, ratings and PayPal payouts for the people you hire.",
      action: (
        <Link
          href="/app/provider"
          className={`${btn.primary} px-4 py-2 text-sm`}
          onClick={() => {
            try {
              localStorage.setItem("hd-tour-provider", "1");
            } catch {}
            setProviderSeen(true);
          }}
        >
          Open provider view
        </Link>
      ),
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const current = steps.findIndex((s) => !s.done);

  return (
    <section aria-labelledby="tour" className="clay mb-6 p-4 sm:p-5" data-tour>
      <div className="flex items-center gap-3">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-ink text-halo" aria-hidden>
          <Sparkles size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="tour" className="font-bold">
            {current === -1 ? "Tour complete: you have seen HaloDiary end to end" : "90-second tour"}
          </h2>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-mist" aria-hidden>
              <span className="block h-full rounded-full bg-sage transition-all" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
            </span>
            <span className="text-xs font-bold text-slate">
              {doneCount} of {steps.length}
            </span>
          </div>
        </div>
        <button onClick={toggle} className="rounded-full p-2 hover:bg-white/70" aria-expanded={open} aria-label={open ? "Collapse tour" : "Expand tour"}>
          <ChevronDown size={18} className={`transition ${open ? "rotate-180" : ""}`} aria-hidden />
        </button>
        <button onClick={() => start(() => dismissTourAction())} className="rounded-full p-2 hover:bg-white/70" aria-label="Close tour">
          <X size={18} aria-hidden />
        </button>
      </div>
      {open && (
        <ol className="mt-4 space-y-2">
          {steps.map((s, i) => (
            <li key={s.title} className={`rounded-2xl px-3 py-2.5 ${i === current ? "bg-white/80" : ""}`}>
              <div className="flex items-start gap-3">
                <span
                  className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    s.done ? "bg-sage text-white" : i === current ? "bg-ink text-white" : "bg-mist text-slate"
                  }`}
                  aria-label={s.done ? "Done" : `Step ${i + 1}`}
                >
                  {s.done ? <Check size={14} /> : i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-bold ${s.done ? "text-slate line-through decoration-1" : ""}`}>{s.title}</p>
                  {i === current && (
                    <>
                      <p className="mt-1 text-sm text-slate">{s.body}</p>
                      <div className="mt-3">{s.action}</div>
                    </>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
