-- Richer provider profiles, client onboarding answers, profile photos, and sample clients
-- that a provider-side judge can load to see a working schedule straight away.

-- ---------- Provider profiles ----------
alter table public.providers add column photo_url text;
alter table public.providers add column website text;
alter table public.providers add column socials jsonb not null default '{}';   -- {"instagram": "handle", ...}
alter table public.providers add column team jsonb not null default '[]';      -- [{"name": "...", "role": "..."}]
alter table public.providers add column team_size integer not null default 1 check (team_size between 1 and 500);
alter table public.providers add column service_radius_km integer not null default 10 check (service_radius_km between 1 and 100);
alter table public.providers add column accepting_clients boolean not null default true;
alter table public.providers add column certifications text not null default '';
alter table public.providers add column insured boolean not null default false;

-- Demo providers get varied, fictional extras so profiles differ in how much they tell you.
update public.providers p set
  team_size = case when h % 5 = 0 then 3 when h % 7 = 0 then 2 else 1 end,
  insured = (h % 3 <> 0),
  certifications = case
    when h % 4 = 0 then 'Background checked, first aid certified'
    when h % 4 = 1 then 'Background checked'
    else '' end,
  socials = case
    when h % 3 = 0 then jsonb_build_object('instagram', lower(regexp_replace(split_part(p.display_name, ' ', 1), '[^A-Za-z]', '', 'g')) || '.homecare')
    when h % 3 = 1 then jsonb_build_object('instagram', lower(regexp_replace(split_part(p.display_name, ' ', 1), '[^A-Za-z]', '', 'g')) || '_services', 'facebook', lower(regexp_replace(split_part(p.display_name, ' ', 1), '[^A-Za-z]', '', 'g')) || 'services')
    else '{}'::jsonb end,
  team = case
    when h % 5 = 0 then '[{"name": "Sara", "role": "Partner"}, {"name": "Iván", "role": "Assistant"}]'::jsonb
    when h % 7 = 0 then '[{"name": "Noor", "role": "Assistant"}]'::jsonb
    else '[]'::jsonb end,
  service_radius_km = 5 + (h % 4) * 5
from (select id, abs(hashtext(id::text)) as h from public.providers where is_demo) x
where p.id = x.id;

-- ---------- Client onboarding ----------
alter table public.profiles add column interests text[] not null default '{}';
alter table public.profiles add column monthly_budget numeric(10, 2);
alter table public.profiles add column onboarded_at timestamptz;
update public.profiles set onboarded_at = now() where onboarded_at is null;

-- ---------- Profile photos ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "avatar upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatar update own folder" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatar delete own folder" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------- Sample clients for provider-side demos ----------
create table private.sample_clients (id uuid primary key references public.profiles (id) on delete cascade, ord integer not null);
insert into private.sample_clients (id, ord) values
  ('75633e2e-f61d-4ef9-b805-fce3d0aa4a7c', 0),
  ('429e41a9-35b6-47ed-bc7c-91ed7858a113', 1)
on conflict do nothing;

-- Gives the calling provider two sample clients: one long-standing (past visits, ratings, payouts,
-- an extra request in chat) and one new (an agreement waiting for the provider to accept).
create or replace function public.load_sample_clients()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  prov record;
  sc record;
  svc record;
  n_services integer;
  i integer := 0;
  v_plan uuid;
  v_conv uuid;
  d date;
  v_at timestamptz;
  wd integer[];
  t time;
  k integer;
  st text;
  terms jsonb := '{"cancellation_notice_hours":24,"late_cancellation_fee_pct":50,"free_reschedules_per_month":1,"provider_change_notice_hours":24,"provider_late_change_credit_pct":20,"provider_cancellation_credit_pct":100,"price_lock_months":3,"termination_notice_days":7,"reminder_hours":36,"dispute_window_hours":48}';
  tz text;
begin
  select * into prov from public.providers where profile_id = auth.uid();
  if not found then raise exception 'Create your provider listing first'; end if;
  select count(*) into n_services from public.provider_services where provider_id = prov.id;
  if n_services = 0 then raise exception 'Add at least one service first'; end if;
  if exists (select 1 from public.plans where provider_id = prov.id and client_id in (select id from private.sample_clients)) then return 0; end if;
  select coalesce(timezone, 'Europe/Madrid') into tz from public.profiles where id = auth.uid();

  for sc in select s.id, s.ord, p.full_name from private.sample_clients s join public.profiles p on p.id = s.id order by s.ord loop
    select ps.service_id, ps.price into svc from public.provider_services ps
      where ps.provider_id = prov.id order by ps.service_id offset (i % n_services) limit 1;
    wd := case when i = 0 then array[2, 5] else array[1, 4] end;
    t := case when i = 0 then time '10:00' else time '17:00' end;
    insert into public.plans (client_id, provider_id, service_id, cadence, weekdays, time_of_day, price, start_date, notes, created_by, check_hours)
    values (sc.id, prov.id, svc.service_id, 'twice_weekly', wd, t, svc.price, current_date - (case when i = 0 then 35 else 0 end), 'Sample client', 'user', 36)
    returning id into v_plan;

    insert into public.contracts (plan_id, client_id, provider_id, version, status, terms, terms_hash, proposed_by, change_note, client_signed_at, provider_signed_at)
    values (v_plan, sc.id, prov.id, 1, case when i = 0 then 'active' else 'pending' end, terms,
      encode(sha256(convert_to(v_plan::text || sc.id::text || prov.id::text || terms::text, 'UTF8')), 'hex'),
      'client', 'Original agreement', now() - interval '35 days' * (1 - i), case when i = 0 then now() - interval '35 days' else null end);

    k := 0;
    for d in select generate_series(current_date - (case when i = 0 then 35 else 0 end), current_date + 14, interval '1 day')::date loop
      if extract(dow from d)::int = any (wd) then
        v_at := (d + t) at time zone tz;
        if v_at < now() then
          k := k + 1;
          st := 'completed';
          insert into public.visits (plan_id, client_id, provider_id, service_id, scheduled_at, price, status, client_response, provider_response, cancel_reason, provider_changed_at, credit_assessed, payment_mode)
          values (v_plan, sc.id, prov.id, svc.service_id, v_at, svc.price,
            case when k = 4 then 'cancelled' else 'completed' end,
            'proceed',
            case when k = 4 then 'cancel' when k = 7 then 'reschedule' else 'done' end,
            case when k = 4 then 'Van broke down on the way' else null end,
            case when k in (4, 7) then v_at - interval '30 hours' else null end,
            true, 'simulated')
          on conflict do nothing;
          if k <> 4 then
            insert into public.ledger_entries (client_id, provider_id, kind, amount, paypal_ref, mode, note)
            values (sc.id, prov.id, 'payout', round(svc.price * 0.9, 2), 'SIM-PAYOUT-SAMPLE-' || k, 'simulated', 'Sample client');
          end if;
        else
          insert into public.visits (plan_id, client_id, provider_id, service_id, scheduled_at, price, status)
          values (v_plan, sc.id, prov.id, svc.service_id, v_at, svc.price, 'scheduled')
          on conflict do nothing;
        end if;
      end if;
    end loop;

    insert into public.conversations (client_id, provider_id) values (sc.id, prov.id)
      on conflict (client_id, provider_id) do update set last_message_at = now() returning id into v_conv;
    if i = 0 then
      insert into public.messages (conversation_id, sender, kind, body, created_at)
        values (v_conv, 'client', 'text', 'Thanks for last week, everything was spotless.', now() - interval '2 days');
      insert into public.messages (conversation_id, sender, kind, body, status, created_at)
        values (v_conv, 'client', 'extra_request', 'Could you also water the balcony plants on your next visit?', 'open', now() - interval '3 hours');
      update public.conversations set last_message = 'Extra request: Could you also water the balcony plants on your next visit?', last_message_at = now() - interval '3 hours' where id = v_conv;
      insert into public.reviews (provider_id, service_id, author_name, rating, body, client_id)
        values (prov.id, svc.service_id, 'Marta G.', 5, 'Reliable and thorough. Always on time.', sc.id),
               (prov.id, svc.service_id, 'Marta G.', 4, 'Great work; one visit had to be moved but it was handled well.', sc.id);
      update public.providers set
        rating = round(((rating * review_count) + 9) / (review_count + 2)::numeric, 1),
        review_count = review_count + 2
      where id = prov.id;
    else
      insert into public.messages (conversation_id, sender, kind, body, created_at)
        values (v_conv, 'client', 'text', 'Hello! We just moved nearby and would love regular help. I have sent you the agreement to sign.', now() - interval '1 hour');
      update public.conversations set last_message = 'Hello! We just moved nearby and would love regular help.', last_message_at = now() - interval '1 hour' where id = v_conv;
    end if;
    i := i + 1;
  end loop;
  return i;
end;
$$;
revoke execute on function public.load_sample_clients() from public, anon;
grant execute on function public.load_sample_clients() to authenticated;

-- Providers see their clients' first names and initials, nothing else from the client's profile.
create or replace function public.my_client_names()
returns table (client_id uuid, name text) language sql stable security definer set search_path = '' as $$
  select distinct p.id,
    coalesce(nullif(split_part(p.full_name, ' ', 1), ''), 'Client') || coalesce(' ' || left(nullif(split_part(p.full_name, ' ', 2), ''), 1) || '.', '')
  from public.plans pl
  join public.providers pr on pr.id = pl.provider_id and pr.profile_id = auth.uid()
  join public.profiles p on p.id = pl.client_id;
$$;
revoke execute on function public.my_client_names() from public, anon;
grant execute on function public.my_client_names() to authenticated;
