-- Listings created by one-click guest providers (judges trying the provider side) stay out of other people's
-- searches, so every visitor sees the curated demo marketplace. The guest still sees their own listing.
alter table public.providers add column if not exists listed boolean not null default true;

create or replace function private.unlist_guest_provider()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from auth.users u where u.id = new.profile_id and u.email like 'judge-%@halodiary.app') then
    new.listed := false;
  end if;
  return new;
end;
$$;
revoke execute on function private.unlist_guest_provider() from public, anon, authenticated;

drop trigger if exists providers_unlist_guest on public.providers;
create trigger providers_unlist_guest before insert on public.providers
  for each row execute function private.unlist_guest_provider();

update public.providers p set listed = false
where not p.is_demo and exists (select 1 from auth.users u where u.id = p.profile_id and u.email like 'judge-%@halodiary.app');

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
    where p.listed or p.profile_id = (select auth.uid())
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
