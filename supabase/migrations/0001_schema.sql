-- HaloDiary schema
-- Run in the Supabase SQL editor (or `supabase db push`). Safe to run once on a fresh project.

-- ---------------------------------------------------------------------------
-- Profiles: one row per auth user
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  role text not null default 'client' check (role in ('client', 'provider')),
  lat double precision,
  lng double precision,
  city text,
  currency text not null default 'EUR',
  timezone text not null default 'Europe/Madrid',
  -- AI assistant switches
  assistant_enabled boolean not null default true,
  proactive_enabled boolean not null default true,
  auto_checks_enabled boolean not null default false,
  -- PayPal vault token for hands-free payments (sandbox)
  paypal_payment_token text,
  paypal_payer_email text,
  -- demo clock: lets a judge jump forward in time to see day-before checks
  clock_offset_hours integer not null default 0,
  created_at timestamptz not null default now()
);

-- Create a profile automatically when someone signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    coalesce(nullif(new.raw_user_meta_data ->> 'role', ''), 'client')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Catalogue
-- ---------------------------------------------------------------------------
create table public.services (
  id text primary key,                    -- slug, e.g. 'cleaning'
  name text not null,
  category text not null,                 -- Home, Family, Pets, Vehicle, Wellness
  default_cadence text not null,          -- key from lib/cadence.ts
  typical_price numeric(10, 2) not null,
  sort_order integer not null default 100,
  is_core boolean not null default false  -- the seven services in the demo story
);

create table public.providers (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid unique references public.profiles (id) on delete cascade, -- null for demo providers
  display_name text not null,
  headline text not null default '',
  bio text not null default '',
  avatar_hue integer not null default 200,
  rating numeric(2, 1) not null default 5.0,
  review_count integer not null default 0,
  years_experience integer not null default 1,
  languages text[] not null default '{English}',
  responds_within_hours integer not null default 2,
  verified boolean not null default false,
  -- Demo providers float around whoever is looking: position = viewer + offset.
  is_demo boolean not null default false,
  offset_north_km double precision,
  offset_east_km double precision,
  -- Real providers have a fixed position.
  lat double precision,
  lng double precision,
  paypal_email text,
  created_at timestamptz not null default now(),
  constraint provider_position check (
    (is_demo and offset_north_km is not null and offset_east_km is not null)
    or (not is_demo)
  )
);

create table public.provider_services (
  provider_id uuid not null references public.providers (id) on delete cascade,
  service_id text not null references public.services (id) on delete cascade,
  price numeric(10, 2) not null,
  primary key (provider_id, service_id)
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers (id) on delete cascade,
  service_id text references public.services (id),
  author_name text not null,
  rating integer not null check (rating between 1 and 5),
  body text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- The diary: recurring plans, the visits they generate, budgets and money
-- ---------------------------------------------------------------------------
create table public.plans (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles (id) on delete cascade,
  provider_id uuid not null references public.providers (id),
  service_id text not null references public.services (id),
  cadence text not null,               -- key from lib/cadence.ts
  weekdays integer[] not null default '{}', -- 0 = Sunday ... 6 = Saturday, for weekly cadences
  time_of_day time not null default '10:00',
  duration_minutes integer not null default 60,
  price numeric(10, 2) not null,
  start_date date not null default current_date,
  status text not null default 'active' check (status in ('active', 'paused', 'ended')),
  notes text not null default '',
  created_by text not null default 'user' check (created_by in ('user', 'assistant')),
  created_at timestamptz not null default now()
);

create table public.visits (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid references public.plans (id) on delete cascade,
  client_id uuid not null references public.profiles (id) on delete cascade,
  provider_id uuid not null references public.providers (id),
  service_id text not null references public.services (id),
  scheduled_at timestamptz not null,
  duration_minutes integer not null default 60,
  price numeric(10, 2) not null,
  status text not null default 'scheduled' check (status in (
    'scheduled',   -- on the diary, more than a day away
    'awaiting',    -- day-before check sent, waiting for answers
    'confirmed',   -- both sides said go (or silence at cut-off), payment held
    'completed',   -- done, payment captured
    'skipped',     -- skipped by the client, nothing charged
    'cancelled'
  )),
  client_response text check (client_response in ('proceed', 'reschedule', 'skip')),
  provider_response text check (provider_response in ('proceed', 'reschedule', 'done')),
  check_sent_at timestamptz,
  rescheduled_from timestamptz,
  paypal_order_id text,
  paypal_authorization_id text,
  paypal_capture_id text,
  payment_mode text check (payment_mode in ('paypal_sandbox', 'simulated')),
  created_at timestamptz not null default now(),
  unique (plan_id, scheduled_at)
);
create index visits_client_time on public.visits (client_id, scheduled_at);

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles (id) on delete cascade,
  month date not null,                 -- first day of the month
  forecast numeric(10, 2) not null,
  cap numeric(10, 2) not null,
  status text not null default 'proposed' check (status in ('proposed', 'approved')),
  approved_at timestamptz,
  approval_mode text check (approval_mode in ('paypal_sandbox', 'simulated')),
  created_at timestamptz not null default now(),
  unique (client_id, month)
);

create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles (id) on delete cascade,
  visit_id uuid references public.visits (id) on delete set null,
  provider_id uuid references public.providers (id),
  kind text not null check (kind in ('hold', 'capture', 'void', 'payout', 'refund')),
  amount numeric(10, 2) not null,
  paypal_ref text,
  mode text not null default 'simulated' check (mode in ('paypal_sandbox', 'simulated')),
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  visit_id uuid references public.visits (id) on delete cascade,
  kind text not null,                  -- day_before_check, reschedule_request, payment, info
  title text not null,
  body text not null default '',
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.activity_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  actor text not null check (actor in ('user', 'assistant', 'system')),
  action text not null,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table public.assistant_conversations (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  messages jsonb not null default '[]',
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Providers near a point. Demo providers are placed relative to the viewer,
-- so every judge sees a full marketplace around wherever they are.
-- ---------------------------------------------------------------------------
create or replace function public.providers_near(
  p_lat double precision,
  p_lng double precision,
  p_service text default null,
  p_radius_km double precision default 15
)
returns table (
  provider_id uuid,
  display_name text,
  headline text,
  avatar_hue integer,
  rating numeric,
  review_count integer,
  years_experience integer,
  languages text[],
  responds_within_hours integer,
  verified boolean,
  service_id text,
  service_name text,
  price numeric,
  distance_km double precision,
  lat double precision,
  lng double precision
)
language sql
stable
security invoker
set search_path = public
as $$
  with placed as (
    select
      p.*,
      case when p.is_demo
        then p_lat + p.offset_north_km / 111.32
        else p.lat end as plat,
      case when p.is_demo
        then p_lng + p.offset_east_km / (111.32 * cos(radians(p_lat)))
        else p.lng end as plng
    from providers p
  ),
  measured as (
    select
      pl.*,
      case when pl.is_demo
        then sqrt(pl.offset_north_km ^ 2 + pl.offset_east_km ^ 2)
        else 2 * 6371 * asin(sqrt(
          sin(radians(pl.plat - p_lat) / 2) ^ 2
          + cos(radians(p_lat)) * cos(radians(pl.plat)) * sin(radians(pl.plng - p_lng) / 2) ^ 2
        )) end as dist
    from placed pl
    where pl.plat is not null and pl.plng is not null
  )
  select
    m.id, m.display_name, m.headline, m.avatar_hue, m.rating, m.review_count,
    m.years_experience, m.languages, m.responds_within_hours, m.verified,
    s.id, s.name, ps.price, round(m.dist::numeric, 1)::double precision, m.plat, m.plng
  from measured m
  join provider_services ps on ps.provider_id = m.id
  join services s on s.id = ps.service_id
  where m.dist <= p_radius_km
    and (p_service is null or ps.service_id = p_service)
  order by m.dist, m.rating desc;
$$;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.services enable row level security;
alter table public.providers enable row level security;
alter table public.provider_services enable row level security;
alter table public.reviews enable row level security;
alter table public.plans enable row level security;
alter table public.visits enable row level security;
alter table public.budgets enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.notifications enable row level security;
alter table public.activity_log enable row level security;
alter table public.assistant_conversations enable row level security;

-- Profiles: you see and edit only yourself
create policy "own profile read" on public.profiles for select to authenticated using (id = auth.uid());
create policy "own profile update" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Catalogue is public to signed-in users (services also to visitors for the landing page)
create policy "services readable" on public.services for select to anon, authenticated using (true);
create policy "providers readable" on public.providers for select to authenticated using (true);
create policy "provider services readable" on public.provider_services for select to authenticated using (true);
create policy "reviews readable" on public.reviews for select to authenticated using (true);

-- Providers manage their own listing
create policy "provider creates own listing" on public.providers for insert to authenticated
  with check (profile_id = auth.uid() and not is_demo);
create policy "provider edits own listing" on public.providers for update to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());
create policy "provider manages own services" on public.provider_services for all to authenticated
  using (exists (select 1 from public.providers p where p.id = provider_id and p.profile_id = auth.uid()))
  with check (exists (select 1 from public.providers p where p.id = provider_id and p.profile_id = auth.uid()));

-- Helper: is the signed-in user the real provider behind a listing?
create or replace function public.is_my_provider(p_provider uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from providers where id = p_provider and profile_id = auth.uid());
$$;

-- Helper: demo providers have no login, so a client may act for them on their own visits
-- (this powers the "see the provider side" view for judges).
create or replace function public.is_demo_provider(p_provider uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from providers where id = p_provider and is_demo);
$$;

-- Plans
create policy "client plans" on public.plans for all to authenticated
  using (client_id = auth.uid()) with check (client_id = auth.uid());
create policy "provider sees plans" on public.plans for select to authenticated
  using (public.is_my_provider(provider_id));

-- Visits
create policy "client visits" on public.visits for all to authenticated
  using (client_id = auth.uid()) with check (client_id = auth.uid());
create policy "provider sees visits" on public.visits for select to authenticated
  using (public.is_my_provider(provider_id));
create policy "provider answers visits" on public.visits for update to authenticated
  using (public.is_my_provider(provider_id)) with check (public.is_my_provider(provider_id));

-- Budgets, ledger, notifications, activity, assistant memory: owner only
create policy "own budgets" on public.budgets for all to authenticated
  using (client_id = auth.uid()) with check (client_id = auth.uid());
create policy "own ledger" on public.ledger_entries for all to authenticated
  using (client_id = auth.uid()) with check (client_id = auth.uid());
create policy "provider sees own ledger" on public.ledger_entries for select to authenticated
  using (public.is_my_provider(provider_id));
create policy "own notifications" on public.notifications for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own activity" on public.activity_log for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own assistant memory" on public.assistant_conversations for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- A real provider may send a notification to the client of a visit they serve
create policy "provider notifies client" on public.notifications for insert to authenticated
  with check (
    exists (select 1 from public.visits v where v.id = visit_id and v.client_id = user_id and public.is_my_provider(v.provider_id))
  );

grant execute on function public.providers_near to authenticated;
