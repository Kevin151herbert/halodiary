-- Sample clients also book a few one-off visits, so the provider calendar shows a realistic month.

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
  j integer;
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
    for d in select generate_series(current_date - (case when i = 0 then 35 else 0 end), current_date + 45, interval '1 day')::date loop
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
  -- One-off bookings from the regular client on a few days, so the month view shows quiet,
  -- busy and overbooked days.
  select ps.service_id, ps.price into svc from public.provider_services ps where ps.provider_id = prov.id order by ps.service_id limit 1;
  for d, k in select current_date + o, n from unnest(array[3, 6, 9, 13, 17, 20], array[2, 3, 6, 4, 5, 7]) as x(o, n) loop
    for j in 1..k loop
      insert into public.visits (plan_id, client_id, provider_id, service_id, scheduled_at, duration_minutes, price, status)
      values (null, (select id from private.sample_clients where ord = 0), prov.id, svc.service_id,
        ((d + time '08:00') at time zone tz) + (j - 1) * interval '100 minutes', 60, svc.price, 'scheduled');
    end loop;
  end loop;
  return i;
end;
$$;
