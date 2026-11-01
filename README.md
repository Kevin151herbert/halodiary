# HaloDiary

**Book every recurring service once. Never chase one again.**

HaloDiary runs a household's recurring services (cleaning twice a week, tutoring three times a week, dog walking on weekends, pool care twice a month, car servicing every quarter) like subscriptions on one diary. The client approves one monthly budget with PayPal. The day before each visit, both sides get a check: proceed, move it, or skip it. Payment is held when a visit is confirmed, charged only after it is done, and the provider is paid out through PayPal. A context-aware AI assistant can search, book, reschedule, answer checks and explain spending, and it asks before it changes anything. It can be switched off, and the app keeps working without it.

Built for the PayPal AI Hackathon (Devpost, November 2026).

**Live demo:** https://halodiary.vercel.app (press "Try it instantly", no email needed)

## What judges can try

1. Open the live demo and press **Start as a client** (one click, no email).
2. Pick a city or share your location. The AI assistant greets you; describe your routine in one sentence and it picks the services, cadences and budget, or choose them yourself. Set a monthly budget, then meet your matches: ranked by attendance (25%), ratings (25%), distance (20%), price fit against your budget (15%) and how much each provider shares about themselves (15%). Swipe right to pick, left to pass, or browse them as a list. Sign the agreements and you land on Budget to approve the month with PayPal.
3. In **Discover**, pick a service and provider. Tap the provider to see their **attendance**: a ring with the share of booked visits rendered (green), moved to an alternative time (yellow) or cancelled (red), and one dot per visit. Hover or tap a red dot to read the reason. Choose a cadence, set the **service agreement** terms (free-change window, late fee, free late moves, notice to end, reminder timing, price lock), sign, and add it to the diary. Or open the assistant and type a routine, for example *"cleaning twice a week and a dog walker on weekends under €20 a walk"*.
4. In **Budget**, approve the month with PayPal (sandbox) or with the simulated button.
5. On the **Diary**, use the **demo clock** (+1 day) to watch day-before checks arrive. Proceed, move, or skip a visit.
6. Open **Provider view** to answer as the provider, propose a new time, or mark a visit done. The ledger shows the hold, the charge and the provider payout with PayPal references.
7. **Agreements** lists every signed agreement with its clauses, both signatures, a fingerprint of the signed terms and the version history. Propose a change and it becomes a new version once both sides sign. The scheduler enforces the terms: a late skip charges the agreed fee through PayPal and pays it on to the provider; a late provider move or cancellation credits the client, and the credit comes off the next payment; ending a service keeps the visits inside the notice period.
8. **Messages** is the in-app chat between client and provider, so arrangements don't end up in WhatsApp. Tap **Extra service** to ask for more work (an oven clean, an extra hour); the provider quotes in the thread and the client pays with the **Pay with PayPal** button right in the chat (90% goes to the provider, recorded in the ledger). **Pay** sends a tip or an agreed extra. After every visit a **Rate this visit** card appears; the stars go on the provider's public profile. Demo providers have no login, so HaloDiary's AI replies in their voice and quotes fair prices.
9. **Start as a provider** to see the other side: publish a listing, build a profile (photo, about, team, website and social handles, certifications, insurance, services and prices, travel radius, PayPal payout email) with a live profile-detail score, then **Load sample clients** to get a regular client with history and a new one waiting for you to **Accept and sign**. The dashboard shows your schedule, attendance %, rating, payouts and latest reviews.
10. **Activity** shows every action and who took it: you, the assistant, or the scheduler.

## How PayPal is used

| Step | PayPal capability |
| --- | --- |
| Monthly budget approval | Vault: setup token, payer approval on PayPal, payment token (`/v3/vault/setup-tokens`, `/v3/vault/payment-tokens`) |
| Visit confirmed (day before) | Orders v2 with the vaulted PayPal account, intent `AUTHORIZE` |
| Visit done | Capture the authorization (`/v2/payments/authorizations/{id}/capture`) |
| Visit skipped or moved | Void the authorization |
| Provider paid | Payouts API (`/v1/payments/payouts`), minus a 10% platform fee |

Without PayPal keys the app runs in a clearly labelled **simulated** mode, so the demo never breaks.

## How AI is used

The assistant (`src/app/api/assistant`, `src/lib/assistant`) uses Claude through the Vercel AI SDK with tool calling:

- **Context aware:** every request carries a fresh snapshot: role, current page, schedule, visits waiting for an answer, budget and spend, recent activity, and the user's assistant settings.
- **Bounded autonomy:** read tools (search providers, diary, budget, payments) run straight away. Tools that change the diary or money (`add_recurring_service`, `answer_visit`, `change_service_status`, `approve_budget`, `answer_as_provider`) pause for a one-tap approval card in the chat.
- **On and off:** a switch in the panel and in Settings, plus finer switches for proactive suggestions and for letting the assistant answer routine day-before checks. The scheduler and payments are ordinary code, so everything keeps running with the assistant off.
- **Scoped by role:** a provider's assistant never sees a client's budget or PayPal details.
- **Memory:** the last 40 messages are kept per user so the assistant can pick up where you left off.

## Stack

Next.js 15 (App Router, TypeScript, Tailwind 4), Supabase (Postgres, Auth, row level security), PayPal REST APIs (sandbox), and the Vercel AI SDK 7 with Anthropic Claude.

## Run it yourself

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. In **SQL Editor**, run `supabase/migrations/0001_schema.sql`, then `supabase/seed.sql`.
3. In **Authentication > Sign In / Providers > Email**, turn **Confirm email** off, so the one-click demo account works.
4. Copy the project URL and publishable (anon) key from **Project Settings > API**.

The seed holds 22 services, 87 demo providers and 340 reviews. Demo providers are stored as offsets in kilometres, so they appear around whoever signs in, anywhere in the world. Regenerate with `node scripts/generate-seed.mjs`.

### 2. PayPal sandbox (optional)

1. At [developer.paypal.com](https://developer.paypal.com), create a sandbox app and copy its client ID and secret.
2. Enable **Vault** and **Payouts** for the app if they are not already on.
3. Use a sandbox personal account to log in when approving a budget, and set `PAYPAL_PAYOUT_RECEIVER` to a sandbox email that should receive provider payouts.

### 3. Environment

Copy `.env.example` to `.env.local` and fill it in. Then:

```bash
npm install
npm run dev
```

### 4. Deploy

Push to GitHub and import the repo in [Vercel](https://vercel.com) (free tier). Add the same environment variables, and set `NEXT_PUBLIC_SITE_URL` to the deployed URL so PayPal returns to the right place.

## Project layout

```
supabase/migrations/0001_schema.sql   tables, security rules, providers_near()
supabase/seed.sql                     services, demo providers, reviews (generated)
src/lib/engine.ts                     scheduler: visits, day-before checks, holds, captures, payouts
src/lib/paypal.ts                     PayPal sandbox client
src/lib/cadence.ts, src/lib/time.ts   recurring dates in each user's own time zone
src/lib/actions-core.ts               operations shared by buttons and the assistant
src/lib/assistant/                    context snapshot and tools
src/app/app/                          diary, discover, budget, provider view, activity, settings
```

## Licence

MIT
