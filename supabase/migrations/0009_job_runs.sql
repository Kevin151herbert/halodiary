-- A record of each scheduler run (Render cron), readable only by the server.
create table public.job_runs (
  id bigint generated always as identity primary key,
  job text not null,
  ran_at timestamptz not null default now(),
  result jsonb not null default '{}'
);
create index job_runs_job on public.job_runs (job, ran_at desc);
alter table public.job_runs enable row level security;
