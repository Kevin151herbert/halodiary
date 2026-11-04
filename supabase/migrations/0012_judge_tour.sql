-- The guided 90-second judge tour: when it started and whether the visitor closed it.
alter table public.profiles add column if not exists tour_started_at timestamptz;
alter table public.profiles add column if not exists tour_dismissed_at timestamptz;
