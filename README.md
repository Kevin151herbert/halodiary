# HaloDiary

**Book every recurring service once. Never chase one again.**

HaloDiary runs a household's recurring services (cleaning twice a week, tutoring three times a week, dog walking at weekends, pool care, car servicing) like subscriptions on one diary. The client approves a monthly budget once with PayPal. The day before each visit both sides get a check: go ahead, move it or skip it. PayPal holds the money when a visit is confirmed, captures it only after the visit is done, and pays the provider out. Every service runs on a signed agreement that the scheduler enforces, so late changes, credits and refunds settle themselves.

An AI assistant (Claude) can find providers, book, move visits, answer checks, explain spending and send PayPal statements, and it asks before it changes anything. Other AI agents can do the same through HaloDiary's MCP server, inside a spending limit the user sets.

Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/) (Devpost, October to November 2026). The project was started during the submission period (first commit 31 October 2026).

- **Live demo:** https://halodiary.vercel.app
- **Demo video:** https://youtu.be/47XUlaDFxpo
- **Devpost:** https://devpost.com/software/halodiary
- **Licence:** MIT

## Testing it (judges)

No sign-up or email is needed, and the demo stays free to test until judging ends. Payments run in the PayPal **sandbox**; no real money moves.

### The 90-second tour (recommended)

1. Open https://halodiary.vercel.app. A 60-second intro plays the first time (problem, cost, solution, how PayPal and AI are used). Reopen it any time with **Watch the 60-second intro**, or at https://halodiary.vercel.app/?intro=1.
2. Press **Take the 90-second tour**. You get a ready household in Barcelona with a cleaner twice a week and a dog walker at weekends, and a five-step checklist at the top of every page:
   1. **Approve the month once with PayPal** on Budget (JS SDK v6 popup, sandbox). Nothing is charged yet.
   2. **Skip to tomorrow and confirm the visit.** The demo clock moves time forward; press **Proceed** on the day-before check and PayPal places a hold. On Fridays and Saturdays the weekend dog walk's check is already waiting, so the button reads **Show me the check**.
   3. **Skip past the visit.** The hold is captured and the provider is paid out (90%). Watch it under **Where your money is** and in the ledger, with PayPal references and webhook ticks.
   4. **Let the AI book, inside your limits.** The assistant books a babysitter after one tap, showing the monthly cost and agreement terms, then refuses a car service that is over the AI spending limit.
   5. **See the provider's side:** schedule, attendance, ratings and payouts.

### Exploring further

- **Set up my own household** (on the landing page) runs the full onboarding: describe your routine in one sentence, then swipe through matches ranked by attendance, ratings, distance, price fit and profile detail, and sign the service agreements.
- **Diary:** drag a visit in the planner to move it and see the agreement's fee or credit first. The demo clock (**Skip to tomorrow**, **+12 hours**, **+3 days**) makes checks, holds and payouts happen.
- **Messages:** chat with each provider. Ask for an extra service, get a quote, pay it with PayPal or as a PayPal invoice, report a problem and accept a refund. Demo providers reply through the AI.
- **Budget:** the PayPal ledger (AG Grid, CSV export), **Get a PayPal statement**, and per service **Pay … /mo flat with PayPal (5% off)** as a PayPal subscription.
- **Start as a provider** (link under the landing buttons) shows the other side: build a profile, **Load sample clients**, accept and sign a new client, and manage the calendar, attendance, ratings and earnings.
- **Settings:** the AI switches, the **AI spending limit**, and **Outside AI assistants** to connect Claude Desktop or another MCP agent to your diary.
- **Activity:** every action and who took it: you, the assistant, an outside agent or the scheduler.

**PayPal sandbox login for the approval step:** use any PayPal **sandbox personal account** (create one free under *Sandbox > Accounts* at developer.paypal.com). If you'd rather skip PayPal, open **Can't use PayPal right now?** under the PayPal button: every step still runs and is labelled "Simulated" in the ledger.

Health check of the PayPal and scheduler wiring (open it while signed in to the demo): https://halodiary.vercel.app/api/paypal/health

## How PayPal is used

| Moment | PayPal | Where in the code |
| --- | --- | --- |
| Client approves a monthly budget | JS SDK v6 save-payment button (`VAULT_WITHOUT_PAYMENT`), Vault setup token and payment token, redirect fallback | `src/app/app/budget/paypal-v6-button.tsx`, `src/app/api/paypal/v6` |
| Visit confirmed the day before | Orders v2 with the vaulted account, intent `AUTHORIZE` (a hold) | `src/lib/paypal.ts` `authorizeWithVault` |
| Visit done | Capture the authorization | `captureAuthorization` |
| Visit skipped or moved | Void the authorization | `voidAuthorization` |
| Provider paid | Payouts, minus a 10% platform fee | `src/lib/engine.ts` |
| Late change under the agreement | Fee captured and paid on to the provider | `src/lib/actions-core.ts` |
| Problem reported, refund accepted | Refund of the visit's capture | `src/lib/problems.ts` |
| Paying monthly instead of per visit | Subscriptions: product, plan and subscription, cancelled when the service ends | `src/lib/subscriptions.ts` |
| Extra work quoted in chat | Pay in chat, or a PayPal invoice the client pays on PayPal | `src/lib/paypal-agent.ts` `invoiceForRequest` |
| Monthly statement | Invoicing: create, send, record payment | `sendMonthlyStatement` |
| What actually happened | Signed webhooks confirm holds, captures, voids, refunds, payouts, disputes, subscriptions and invoices; disputes open a problem in the chat | `src/app/api/paypal/webhook` |

The server uses the **PayPal Server SDK** (`@paypal/paypal-server-sdk`, generated by APIMatic) for orders, payments, vault and subscriptions, and the **PayPal Agent Toolkit** (`@paypal/agent-toolkit`) for products, invoices and statements. Without PayPal keys, or if a PayPal call fails, the app runs that step in a clearly labelled **simulated** mode, so the demo never breaks and nothing claims PayPal did what it didn't.

## How AI is used

Model: **Anthropic Claude Sonnet 5.5** (`claude-sonnet-5-5`, set with `ANTHROPIC_MODEL`), called through the **Vercel AI SDK** (`ai`, `@ai-sdk/anthropic`). It powers every AI feature below.

- **Assistant with tools** (`src/app/api/assistant`, `src/lib/assistant`): Claude with HaloDiary's own tools, streamed with the Vercel AI SDK. Every request carries a fresh snapshot of the user's schedule, budget, agreements and open checks. Read tools run straight away; tools that change the diary or money pause for a one-tap approval card. It can be switched off, and the app keeps working without it.
- **PayPal Agent Toolkit, scoped to the user:** the toolkit runs server-side for the signed-in user only. The model never gets raw merchant tools that could see other customers.
- **AI spending limit:** every AI action is priced first. Anything above the user's per-payment limit is refused, logged and sent to the user (`src/lib/agent-guard.ts`).
- **MCP server for outside agents** (`src/app/api/mcp`): Claude Desktop, ChatGPT or any MCP client connects with a personal access token from Settings and gets the same tools under the user's own session and row level security. Every action needs a reason, which shows in Activity. Tokens can be disconnected at any time.
- **Onboarding:** a personal welcome, and one sentence turned into services, cadences and a budget.
- **Chat:** demo providers reply and quote fair prices in their own voice; problem reports get a neutral summary and a suggested refund.

## Sponsor tools

| Tool | Use |
| --- | --- |
| **AG Grid** (Community) | Payments ledger on Budget and provider earnings: search, sort, filter, CSV export, PayPal webhook confirmation column (`src/components/ledger-grid.tsx`) |
| **Bryntum Calendar** | Week planner for clients and providers: drag a visit, see the agreement's fee or credit, then move it or ask the client (`src/components/week-planner.tsx`). Uses the public trial package, so a trial watermark shows |
| **Render** | Cron job that runs the scheduler for every user every 10 minutes (`render.yaml`, `scripts/run-scheduler.mjs`, `/api/cron/advance`) |
| **APIMatic** | The PayPal Server SDK HaloDiary is built on is generated by APIMatic |

## Architecture

```
Client and provider (Next.js 15 on Vercel)
  Bryntum week planner · AG Grid ledger · PayPal JS SDK v6 button
        │
AI assistant (Claude) ──── HaloDiary tools + PayPal Agent Toolkit
Outside agents (MCP) ────┘  every action: spending-limit check → approval → logged reason
        │
HaloDiary core: agreements · scheduler · ledger · chat · problems (Supabase, row level security)
        │                                   ▲
        ▼                                   │ signed webhooks
PayPal: vault · holds and captures · refunds · payouts · subscriptions · invoicing
        ▲
Render cron (every 10 min) → /api/cron/advance
```

## Run it yourself

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. In **SQL Editor**, run `supabase/migrations/0001_schema.sql` through `0009_job_runs.sql` in order, then `supabase/seed.sql`, then `0010_performance_indexes.sql` through `0017_multi_service_headlines.sql` in order.
3. In **Authentication > Sign In / Providers > Email**, turn **Confirm email** off so the one-click demo accounts work.
4. Copy the project URL, the publishable key and the service role key from **Project Settings > API**.

The seed holds 22 services, 87 demo providers and 340 reviews, stored as offsets in kilometres so they appear around whoever signs in. Regenerate with `node scripts/generate-seed.mjs`.

### 2. PayPal sandbox

1. At [developer.paypal.com](https://developer.paypal.com), create a sandbox app and copy its client ID and secret. Make sure Vault, Payouts, Subscriptions and Invoicing are enabled.
2. Add a webhook pointing at `https://YOUR-APP/api/paypal/webhook` for all events and copy its ID.
3. Create a sandbox personal account to approve budgets, and set `PAYPAL_PAYOUT_RECEIVER` to a sandbox email that receives payouts for demo providers. Optionally set `NEXT_PUBLIC_SANDBOX_BUYER_EMAIL` and `NEXT_PUBLIC_SANDBOX_BUYER_PASSWORD` to show a sandbox login on the tour card.

### 3. Environment

Copy `.env.example` to `.env.local`, fill it in, then:

```bash
npm install
npm run dev
```

`npx tsx scripts/e2e.ts` runs the end-to-end checks against your Supabase project.

### 4. Deploy

- **Vercel:** import the repo, add the same environment variables, and set `NEXT_PUBLIC_SITE_URL` to the deployed URL.
- **Render:** New > Blueprint with this repo, then set `CRON_SECRET` to the same value as on Vercel.

## Project layout

```
supabase/migrations/            schema, security rules, agreements, chat, PayPal platform tables
src/lib/engine.ts               scheduler: visits, day-before checks, holds, captures, payouts
src/lib/paypal.ts               PayPal Server SDK client
src/lib/paypal-agent.ts         PayPal Agent Toolkit: invoices and statements
src/lib/subscriptions.ts        PayPal Subscriptions
src/lib/problems.ts             problem reports and refunds
src/lib/contract.ts             service agreements and their fees and credits
src/lib/agent-guard.ts          AI spending limit
src/lib/agent-tokens.ts         tokens for outside agents
src/lib/assistant/              context snapshot and tools
src/app/api/                    assistant, MCP server, PayPal webhook and v6, cron
src/app/app/                    diary, discover, budget, messages, agreements, provider view, settings
```

## Security notes

- Secrets live only in environment variables. The service role key is used server-side only, for the cron, webhooks and agent tokens.
- Agent tokens are stored as SHA-256 hashes and shown once.
- PayPal webhooks are verified with PayPal before anything is recorded, and each event is stored once.

## Licence

MIT, see [LICENSE](LICENSE). Third-party packages keep their own licences. Bryntum Calendar is used through its public trial package for this hackathon.
