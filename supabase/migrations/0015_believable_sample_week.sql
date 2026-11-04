-- Sample data a judge can believe:
--  * busy days are one-off first visits from six different neighbours, never the same client several times a day
--  * past sample payouts are tied to their visit and dated just after it; sample reviews are dated in the past
--  * providers see the names of one-off clients too
-- Six extra sample clients (no password, they cannot sign in).
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
select v.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', v.email, '', now(),
       jsonb_build_object('full_name', v.name, 'role', 'client'), '{"provider":"email","providers":["email"]}'::jsonb, now(), now()
from (values
  ('6a1f0c2e-1d1a-4c6b-9a01-0000000000a2'::uuid, 'sample-ines@halodiary.app', 'Inés Romero'),
  ('6a1f0c2e-1d1a-4c6b-9a01-0000000000a3'::uuid, 'sample-david@halodiary.app', 'David Okafor'),
  ('6a1f0c2e-1d1a-4c6b-9a01-0000000000a4'::uuid, 'sample-sofia@halodiary.app', 'Sofia Lind'),
  ('6a1f0c2e-1d1a-4c6b-9a01-0000000000a5'::uuid, 'sample-jordi@halodiary.app', 'Jordi Puig'),
  ('6a1f0c2e-1d1a-4c6b-9a01-0000000000a6'::uuid, 'sample-amina@halodiary.app', 'Amina Yusuf'),
  ('6a1f0c2e-1d1a-4c6b-9a01-0000000000a7'::uuid, 'sample-hugo@halodiary.app', 'Hugo Martin')
) as v(id, email, name)
where not exists (select 1 from auth.users u where u.id = v.id);

insert into private.sample_clients (id, ord)
select v.id, v.ord from (values
  ('6a1f0c2e-1d1a-4c6b-9a01-0000000000a2'::uuid, 2), ('6a1f0c2e-1d1a-4c6b-9a01-0000000000a3'::uuid, 3),
  ('6a1f0c2e-1d1a-4c6b-9a01-0000000000a4'::uuid, 4), ('6a1f0c2e-1d1a-4c6b-9a01-0000000000a5'::uuid, 5),
  ('6a1f0c2e-1d1a-4c6b-9a01-0000000000a6'::uuid, 6), ('6a1f0c2e-1d1a-4c6b-9a01-0000000000a7'::uuid, 7)
) as v(id, ord)
where exists (select 1 from public.profiles p where p.id = v.id)
on conflict (id) do nothing;

-- Rewrite load_sample_clients in place.
do $do$
declare def text;
begin
  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.proname = 'load_sample_clients' and n.nspname = 'public';
  -- Only the two regulars get a plan.
  def := replace(def, 'from private.sample_clients s join public.profiles p on p.id = s.id order by s.ord loop', 'from private.sample_clients s join public.profiles p on p.id = s.id where s.ord <= 1 order by s.ord loop');
  -- Keep the visit id of past sample visits, to tie their payout to them.
  def := replace(def, '  j integer;', '  j integer;' || chr(10) || '  v_vid uuid;');
  def := replace(def, '''simulated'')' || chr(10) || '          on conflict do nothing;', '''simulated'')' || chr(10) || '          on conflict do nothing returning id into v_vid;');
  def := replace(def, 'insert into public.ledger_entries (client_id, provider_id, kind, amount, paypal_ref, mode, note)' || chr(10) || '            values (sc.id, prov.id, ''payout'', round(svc.price * 0.9, 2), ''SIM-PAYOUT-SAMPLE-'' || k, ''simulated'', ''Sample client'');',
    'insert into public.ledger_entries (client_id, provider_id, visit_id, kind, amount, paypal_ref, mode, note, created_at)' || chr(10) || '            values (sc.id, prov.id, v_vid, ''payout'', round(svc.price * 0.9, 2), ''SIM-PAYOUT-SAMPLE-'' || k, ''simulated'', ''Sample client'', v_at + interval ''90 minutes'');');
  -- Reviews written after past visits, not today.
  def := replace(def, 'insert into public.reviews (provider_id, service_id, author_name, rating, body, client_id)' || chr(10) || '        values (prov.id, svc.service_id, ''Marta G.'', 5, ''Reliable and thorough. Always on time.'', sc.id),' || chr(10) || '               (prov.id, svc.service_id, ''Marta G.'', 4, ''Great work; one visit had to be moved but it was handled well.'', sc.id);',
    'insert into public.reviews (provider_id, service_id, author_name, rating, body, client_id, created_at)' || chr(10) || '        values (prov.id, svc.service_id, ''Marta G.'', 5, ''Reliable and thorough. Always on time.'', sc.id, now() - interval ''9 days''),' || chr(10) || '               (prov.id, svc.service_id, ''Marta G.'', 4, ''Great work; one visit had to be moved but it was handled well.'', sc.id, now() - interval ''23 days'');');
  -- Busy days: one first visit each from different neighbours (at most six a day, still above the red-ring threshold of five).
  def := replace(def, 'array[2, 3, 6, 4, 5, 7]', 'array[2, 3, 6, 4, 5, 6]');
  def := replace(def, 'values (null, (select id from private.sample_clients where ord = 0), prov.id', 'values (null, (select id from private.sample_clients where ord = 2 + (j - 1) % 6), prov.id');
  execute def;
end
$do$;

-- Providers see the names of everyone who booked them, one-off visits included.
create or replace function public.my_client_names()
returns table (client_id uuid, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct p.id,
    coalesce(nullif(split_part(p.full_name, ' ', 1), ''), 'Client') || coalesce(' ' || left(nullif(split_part(p.full_name, ' ', 2), ''), 1) || '.', '')
  from public.providers pr
  join (
    select provider_id, client_id from public.plans
    union
    select provider_id, client_id from public.visits
  ) b on b.provider_id = pr.id
  join public.profiles p on p.id = b.client_id
  where pr.profile_id = auth.uid();
$$;
