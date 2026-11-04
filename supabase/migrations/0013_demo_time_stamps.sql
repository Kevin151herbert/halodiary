-- Money lines, activity and notifications are stamped in the account's own timeline. When a judge skips
-- ahead with the demo clock, a charge for Friday's visit then reads as made on Friday, not today.
create or replace function private.stamp_demo_time()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid;
  hrs integer;
begin
  -- A row that already carries its own time (for example a visit's charge, stamped when the visit ended) keeps it.
  if new.created_at is not null and abs(extract(epoch from (new.created_at - now()))) > 5 then
    return new;
  end if;
  -- Read the owner through jsonb: a direct new.user_id on a ledger row fails, since that table has no such column.
  if tg_table_name = 'ledger_entries' then
    owner := (to_jsonb(new) ->> 'client_id')::uuid;
  else
    owner := (to_jsonb(new) ->> 'user_id')::uuid;
  end if;
  select p.clock_offset_hours into hrs from public.profiles p where p.id = owner;
  if coalesce(hrs, 0) <> 0 then
    new.created_at := now() + make_interval(hours => hrs);
  end if;
  return new;
end;
$$;
revoke execute on function private.stamp_demo_time() from public, anon, authenticated;

drop trigger if exists ledger_demo_time on public.ledger_entries;
create trigger ledger_demo_time before insert on public.ledger_entries for each row execute function private.stamp_demo_time();
drop trigger if exists activity_demo_time on public.activity_log;
create trigger activity_demo_time before insert on public.activity_log for each row execute function private.stamp_demo_time();
drop trigger if exists notifications_demo_time on public.notifications;
create trigger notifications_demo_time before insert on public.notifications for each row execute function private.stamp_demo_time();
