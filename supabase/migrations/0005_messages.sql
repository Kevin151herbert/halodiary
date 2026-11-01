-- In-app chat between a client and a provider: extra requests, payments and ratings
-- happen in the conversation, so nobody needs to move to WhatsApp.

create or replace function private.is_demo_provider(p_provider uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.providers where id = p_provider and is_demo);
$$;
grant usage on schema private to authenticated;
grant execute on function private.is_demo_provider(uuid) to authenticated;

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles (id) on delete cascade,
  provider_id uuid not null references public.providers (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  last_message text not null default '',
  client_read_at timestamptz not null default now(),
  provider_read_at timestamptz not null default now(),
  unique (client_id, provider_id)
);
create index conversations_provider on public.conversations (provider_id, last_message_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender text not null check (sender in ('client', 'provider', 'system')),
  kind text not null default 'text'
    check (kind in ('text', 'extra_request', 'payment_request', 'payment', 'rating_request', 'rating')),
  body text not null default '' check (length(body) <= 2000),
  amount numeric(10, 2) check (amount is null or (amount > 0 and amount <= 5000)),
  status text check (status in ('open', 'accepted', 'declined', 'paid', 'cancelled', 'done')),
  visit_id uuid references public.visits (id) on delete set null,
  reply_to uuid references public.messages (id) on delete set null,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index messages_conversation on public.messages (conversation_id, created_at);

alter table public.conversations enable row level security;
alter table public.messages enable row level security;

create policy "client conversations" on public.conversations for all to authenticated
  using (client_id = (select auth.uid())) with check (client_id = (select auth.uid()));
create policy "provider conversations" on public.conversations for select to authenticated
  using (private.is_my_provider(provider_id));
create policy "provider marks read" on public.conversations for update to authenticated
  using (private.is_my_provider(provider_id)) with check (private.is_my_provider(provider_id));

-- Clients read and write their own threads. They may also post the provider side for demo
-- providers (who have no login and answer through HaloDiary's AI), and system receipts.
create policy "client messages read" on public.messages for select to authenticated
  using (exists (select 1 from public.conversations c where c.id = conversation_id and c.client_id = (select auth.uid())));
create policy "client messages write" on public.messages for insert to authenticated
  with check (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.client_id = (select auth.uid())
        and (sender in ('client', 'system') or private.is_demo_provider(c.provider_id))
    )
  );
create policy "client messages update" on public.messages for update to authenticated
  using (exists (select 1 from public.conversations c where c.id = conversation_id and c.client_id = (select auth.uid())))
  with check (exists (select 1 from public.conversations c where c.id = conversation_id and c.client_id = (select auth.uid())));

create policy "provider messages read" on public.messages for select to authenticated
  using (exists (select 1 from public.conversations c where c.id = conversation_id and private.is_my_provider(c.provider_id)));
create policy "provider messages write" on public.messages for insert to authenticated
  with check (
    sender = 'provider' and kind in ('text', 'payment_request')
    and exists (select 1 from public.conversations c where c.id = conversation_id and private.is_my_provider(c.provider_id))
  );
create policy "provider messages update" on public.messages for update to authenticated
  using (exists (select 1 from public.conversations c where c.id = conversation_id and private.is_my_provider(c.provider_id)))
  with check (exists (select 1 from public.conversations c where c.id = conversation_id and private.is_my_provider(c.provider_id)));

-- Extra payments made in chat
alter table public.ledger_entries drop constraint ledger_entries_kind_check;
alter table public.ledger_entries add constraint ledger_entries_kind_check
  check (kind in ('hold', 'capture', 'void', 'payout', 'refund', 'fee', 'credit', 'extra'));

-- Ratings after each visit: one per visit, written through rate_visit so the provider's
-- average stays consistent and only the client of a completed visit can rate it.
alter table public.reviews add column visit_id uuid unique references public.visits (id) on delete set null;
alter table public.reviews add column client_id uuid references public.profiles (id) on delete set null;

create or replace function public.rate_visit(p_visit uuid, p_rating integer, p_body text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v record;
  author text;
  rid uuid;
begin
  if p_rating < 1 or p_rating > 5 then raise exception 'Rating must be 1 to 5'; end if;
  select * into v from public.visits where id = p_visit and client_id = auth.uid() and status = 'completed';
  if not found then raise exception 'Only a completed visit of yours can be rated'; end if;
  if exists (select 1 from public.reviews where visit_id = p_visit) then raise exception 'This visit is already rated'; end if;
  select coalesce(nullif(split_part(full_name, ' ', 1), ''), 'Client') || ' ' || coalesce(left(nullif(split_part(full_name, ' ', 2), ''), 1) || '.', '')
    into author from public.profiles where id = auth.uid();
  insert into public.reviews (provider_id, service_id, author_name, rating, body, visit_id, client_id)
  values (v.provider_id, v.service_id, trim(author), p_rating, coalesce(nullif(trim(left(p_body, 600)), ''), 'Rated ' || p_rating || ' stars'), p_visit, auth.uid())
  returning id into rid;
  update public.providers p set
    rating = round(((p.rating * p.review_count) + p_rating) / (p.review_count + 1)::numeric, 1),
    review_count = p.review_count + 1
  where p.id = v.provider_id;
  return rid;
end;
$$;
revoke execute on function public.rate_visit(uuid, integer, text) from public, anon;
grant execute on function public.rate_visit(uuid, integer, text) to authenticated;

-- Live updates in the chat window
alter publication supabase_realtime add table public.messages;
