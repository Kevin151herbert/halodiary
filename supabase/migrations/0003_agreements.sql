-- Service agreements: both parties sign the terms that govern a recurring service.
-- Every change is a new version that both sides sign; earlier versions are kept as history.

create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans (id) on delete cascade,
  client_id uuid not null references public.profiles (id) on delete cascade,
  provider_id uuid not null references public.providers (id),
  version integer not null default 1,
  status text not null default 'pending' check (status in ('pending', 'active', 'superseded', 'declined', 'terminated')),
  terms jsonb not null,
  terms_hash text not null,                 -- fingerprint of the exact terms both sides signed
  proposed_by text not null check (proposed_by in ('client', 'provider')),
  change_note text not null default '',
  client_signed_at timestamptz,
  provider_signed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (plan_id, version)
);
create index contracts_client on public.contracts (client_id, status);
create index contracts_provider on public.contracts (provider_id, status);

alter table public.contracts enable row level security;

create policy "client agreements" on public.contracts for all to authenticated
  using (client_id = (select auth.uid())) with check (client_id = (select auth.uid()));
create policy "provider sees agreements" on public.contracts for select to authenticated
  using (private.is_my_provider(provider_id));
create policy "provider signs agreements" on public.contracts for update to authenticated
  using (private.is_my_provider(provider_id)) with check (private.is_my_provider(provider_id));
create policy "provider proposes amendments" on public.contracts for insert to authenticated
  with check (private.is_my_provider(provider_id) and proposed_by = 'provider');

-- Fees (client late changes) and credits (provider late changes) in the ledger
alter table public.ledger_entries drop constraint ledger_entries_kind_check;
alter table public.ledger_entries add constraint ledger_entries_kind_check
  check (kind in ('hold', 'capture', 'void', 'payout', 'refund', 'fee', 'credit'));
alter table public.ledger_entries add column note text not null default '';
alter table public.ledger_entries add column settled_at timestamptz;

-- Providers can cancel a visit (counts against them under the agreement)
alter table public.visits drop constraint visits_provider_response_check;
alter table public.visits add constraint visits_provider_response_check
  check (provider_response in ('proceed', 'reschedule', 'done', 'cancel'));
