-- Hardening applied after the first deploy; keeps a fresh setup identical to the live database.

-- Faster lookups on the busiest screens
create index if not exists visits_provider_time on public.visits (provider_id, scheduled_at);
create index if not exists ledger_client_time on public.ledger_entries (client_id, created_at desc);
create index if not exists notifications_user on public.notifications (user_id, created_at desc);
create index if not exists activity_user on public.activity_log (user_id, created_at desc);

-- The sign-up trigger function must never be callable over the API
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Only signed-in users may search providers
revoke execute on function public.providers_near(double precision, double precision, text, double precision) from public, anon;
grant execute on function public.providers_near(double precision, double precision, text, double precision) to authenticated;

-- A real provider can't turn their listing into a demo one
drop policy "provider edits own listing" on public.providers;
create policy "provider edits own listing" on public.providers for update to authenticated
  using (profile_id = (select auth.uid())) with check (profile_id = (select auth.uid()) and not is_demo);

-- Move the security-rule helper out of the public API
create schema if not exists private;
grant usage on schema private to authenticated;

create or replace function private.is_my_provider(p_provider uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.providers where id = p_provider and profile_id = auth.uid());
$$;
revoke execute on function private.is_my_provider(uuid) from public, anon;
grant execute on function private.is_my_provider(uuid) to authenticated;

drop policy "provider sees plans" on public.plans;
create policy "provider sees plans" on public.plans for select to authenticated using (private.is_my_provider(provider_id));
drop policy "provider sees visits" on public.visits;
create policy "provider sees visits" on public.visits for select to authenticated using (private.is_my_provider(provider_id));
drop policy "provider answers visits" on public.visits;
create policy "provider answers visits" on public.visits for update to authenticated
  using (private.is_my_provider(provider_id)) with check (private.is_my_provider(provider_id));
drop policy "provider sees own ledger" on public.ledger_entries;
create policy "provider sees own ledger" on public.ledger_entries for select to authenticated using (private.is_my_provider(provider_id));
drop policy "provider notifies client" on public.notifications;
create policy "provider notifies client" on public.notifications for insert to authenticated
  with check (exists (select 1 from public.visits v where v.id = visit_id and v.client_id = user_id and private.is_my_provider(v.provider_id)));

drop function if exists public.is_my_provider(uuid);
drop function if exists public.is_demo_provider(uuid);
