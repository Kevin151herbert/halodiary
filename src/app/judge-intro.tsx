import { Bot, FileSignature, Heart, MessagesSquare, Wallet } from "lucide-react";
import { IconChip } from "@/components/ui";

const STEPS = [
  { icon: Bot, tone: "ink" as const, title: "Tell the AI your routine", body: "\"Cleaning twice a week, a dog walker at weekends.\" It picks the services and suggests a budget." },
  { icon: Heart, tone: "halo" as const, title: "Swipe your matches", body: "Ranked by attendance, ratings, distance, price and how much each provider shares about themselves." },
  { icon: FileSignature, tone: "sage" as const, title: "Sign, then approve once with PayPal", body: "Both sides sign an agreement. One PayPal approval covers the month." },
  { icon: Wallet, tone: "ink" as const, title: "It runs itself", body: "Checks before every visit, money held and paid only when the job is done." },
  { icon: MessagesSquare, tone: "rose" as const, title: "Chat, pay extras, rate", body: "Extras, tips and ratings happen in the app, not on WhatsApp." },
];

/** What a judge is about to see, shown beside the login form. */
export function JudgeIntro() {
  return (
    <section className="clay p-6 sm:p-8" aria-labelledby="intro-title">
      <p className="text-xs font-bold uppercase tracking-wide text-slate">What you&apos;ll see</p>
      <h2 id="intro-title" className="mt-1 text-2xl font-extrabold sm:text-3xl">
        Your home&apos;s recurring services, run by an AI on a PayPal budget
      </h2>
      <ol className="mt-6 space-y-4">
        {STEPS.map(({ icon: Icon, tone, title, body }) => (
          <li key={title} className="flex gap-4">
            <IconChip tone={tone} size={40}>
              <Icon size={18} />
            </IconChip>
            <div>
              <p className="font-bold">{title}</p>
              <p className="text-sm text-slate">{body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
