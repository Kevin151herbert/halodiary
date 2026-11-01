-- PayPal webhooks, problem reports with refunds, PayPal subscriptions, and agent access tokens.

-- Every PayPal webhook event, stored once (PayPal retries; the id makes it idempotent).
create table public.paypal_events (
  id text primary key,
  event_type text not null,
  resource_id text,
  resource jsonb not null default '{}',
  received_at timestamptz not null default now(),
  outcome text not null default ''
);
alter table public.paypal_events enable row level security; -- no policies: only the server's service role reads it

-- PayPal's own confirmation of a ledger line, set by the webhook
alter table public.ledger_entries add column paypal_confirmed_at timestamptz;
alter table public.ledger_entries add column paypal_status text;
create index ledger_paypal_ref on public.ledger_entries (paypal_ref);

-- Problem reports: raised in the app or as a PayPal dispute
create table public.problems (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid references public.visits (id) on delete set null,
  client_id uuid not null references public.profiles (id) on delete cascade,
  provider_id uuid not null references public.providers (id),
  conversation_id uuid references public.conversations (id) on delete set null,
  source text not null default 'app' check (source in ('app', 'paypal_dispute')),
  reason text not null,
  details text not null default '',
  ai_summary text not null default '',
  status text not null default 'open' check (status in ('open', 'offered', 'refunded', 'declined', 'closed')),
  refund_amount numeric(10, 2),
  refund_ref text,
  paypal_dispute_id text unique,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index problems_client on public.problems (client_id, created_at desc);
create index problems_provider on public.problems (provider_id, created_at desc);
alter table public.problems enable row level security;
create policy "client problems" on public.problems for all to authenticated
  using (client_id = (select auth.uid())) with check (client_id = (select auth.uid()));
create policy "provider sees problems" on public.problems for select to authenticated
  using (private.is_my_provider(provider_id));
create policy "provider answers problems" on public.problems for update to authenticated
  using (private.is_my_provider(provider_id)) with check (private.is_my_provider(provider_id));

alter table public.messages drop constraint messages_kind_check;
alter table public.messages add constraint messages_kind_check
  check (kind in ('text', 'extra_request', 'payment_request', 'payment', 'rating_request', 'rating', 'problem', 'refund_offer'));
drop policy "provider messages write" on public.messages;
create policy "provider messages write" on public.messages for insert to authenticated
  with check (
    sender = 'provider' and kind in ('text', 'payment_request', 'refund_offer')
    and exists (select 1 from public.conversations c where c.id = conversation_id and private.is_my_provider(c.provider_id))
  );

-- Flat monthly plans billed as PayPal Subscriptions
alter table public.plans add column billing text not null default 'per_visit' check (billing in ('per_visit', 'subscription'));
alter table public.plans add column paypal_subscription_id text;
alter table public.plans add column subscription_status text;
alter table public.plans add column monthly_price numeric(10, 2);

-- The agent's spending limit, beyond the monthly cap
alter table public.profiles add column agent_max_per_payment numeric(10, 2);

-- Personal access tokens for HaloDiary's MCP server (other AI assistants acting for the user)
create table public.agent_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  label text not null default 'AI assistant',
  token_hash text not null unique,
  token_hint text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
alter table public.agent_tokens enable row level security;
create policy "own agent tokens" on public.agent_tokens for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
