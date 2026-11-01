-- Attendance records and the visit fields the agreement rules need.

-- What happened to each booked slot, from the provider's side
alter table public.visits add column cancel_reason text;             -- provider's reason for cancelling
alter table public.visits add column provider_changed_at timestamptz; -- when the provider moved or cancelled
alter table public.visits add column credit_assessed boolean not null default false;
alter table public.visits add column late_change boolean not null default false; -- client changed inside the notice window
alter table public.visits add column moved_by text check (moved_by in ('client', 'provider')); -- on one-off visits created by a move

-- The check before each visit goes out this many hours ahead (set by the agreement)
alter table public.plans add column check_hours integer not null default 36;

-- A client may notify the real provider of a service they have booked
create policy "client notifies provider" on public.notifications for insert to authenticated
  with check (
    exists (
      select 1 from public.plans pl join public.providers p on p.id = pl.provider_id
      where pl.client_id = (select auth.uid()) and p.profile_id = user_id
    )
  );

-- A provider's track record before HaloDiary (demo providers) or with other clients.
-- Real visits on HaloDiary are added on top of this when attendance is shown.
create table public.service_records (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers (id) on delete cascade,
  service_id text not null references public.services (id),
  occurred_at timestamptz not null,
  outcome text not null check (outcome in ('rendered', 'alternative', 'cancelled')),
  note text not null default ''
);
create index service_records_provider on public.service_records (provider_id, occurred_at desc);
alter table public.service_records enable row level security;
create policy "track records are public" on public.service_records for select to authenticated using (true);

-- Seed demo track records. Lower-rated providers cancel and move more often.
select setseed(0.4242);
insert into public.service_records (provider_id, service_id, occurred_at, outcome, note)
select p.id, s.service_id, r.at, r.outcome,
  case r.outcome
    when 'cancelled' then (array[
      'Van broke down on the way',
      'Ill on the day',
      'Double-booked by mistake',
      'Family emergency',
      'Severe weather warning',
      'Parts delivery did not arrive',
      'Previous job overran'
    ])[1 + floor(random() * 7)::int]
    when 'alternative' then (array[
      'Moved to the next morning after a late job',
      'Offered an earlier slot the same day',
      'Sent a colleague from the same team',
      'Moved two hours later because of traffic',
      'Moved to the following day, client agreed'
    ])[1 + floor(random() * 5)::int]
    else ''
  end
from public.providers p
cross join lateral (
  select ps.service_id from public.provider_services ps where ps.provider_id = p.id order by ps.service_id limit 1
) s
cross join lateral (
  select
    now() - make_interval(days => g * 4 + floor(random() * 3)::int, hours => floor(random() * 8)::int) as at,
    case
      when x < (5.0 - p.rating) * 0.09 + 0.01 then 'cancelled'
      when x < (5.0 - p.rating) * 0.09 + 0.01 + (5.0 - p.rating) * 0.10 + 0.04 then 'alternative'
      else 'rendered'
    end as outcome
  from (
    select g, random() as x from generate_series(1, 20 + (abs(hashtext(p.id::text)) % 21)) g
  ) t
) r
where p.is_demo;
