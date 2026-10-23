-- P-06 email delivery, step 3: deciding what may be attempted. One sender holds a
-- short lease on the queue, so only one provider request is ever in flight. The
-- functions here lease due jobs, recheck that each email is still true, keep the
-- daily and monthly attempt budget, open a circuit when the provider's quota is
-- spent, freeze each payload on its first attempt, schedule retries and expiry,
-- and create the 24-hour reminders. They never call a provider.
--
-- Lock order: the sender row first, then job rows (skip locked). The outbox
-- advisory lock, taken inside app.enqueue_email, is always the last lock a
-- transaction takes. These functions never lock a group or a session row.

create table app.email_sender (
  id smallint primary key check(id=1),
  holder uuid,
  lease_until timestamptz,
  circuit_until timestamptz,
  circuit_reason text,
  last_request_at timestamptz
);
insert into app.email_sender(id) values(1);

-- Attempts made in one UTC day ('d:YYYY-MM-DD') or one UTC month ('m:YYYY-MM'),
-- debited before each attempt and never refunded.
create table app.email_budget (
  period text primary key check(period ~ '^(d:\d{4}-\d{2}-\d{2}|m:\d{4}-\d{2})$'),
  attempts integer not null check(attempts>=0)
);

alter table app.email_sender enable row level security;
alter table app.email_budget enable row level security;
revoke all on app.email_sender,app.email_budget from public,anon,authenticated;
grant select,update on app.email_sender to service_role;
grant select,insert,update on app.email_budget to service_role;

-- Takes the single sender lease for p_holder when it is free, expired or already
-- p_holder's, and reports whether the caller now holds it.
create function app.email_take_lease(p_holder uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare sender app.email_sender; at_time timestamptz;
begin
  select * into sender from app.email_sender where id=1 for update;
  at_time:=clock_timestamp();
  if sender.holder is not null and sender.holder<>p_holder and sender.lease_until>=at_time then return false; end if;
  update app.email_sender set holder=p_holder,lease_until=at_time+interval '2 minutes' where id=1;
  return true;
end;
$$;

-- Ends a job that will not be attempted again. A job that ever had an unknown
-- outcome can only end as "not confirmed"; the payload (address and body) goes.
create function app.email_end_job(p_job uuid,p_reason text) returns void
language sql security invoker set search_path='' as $$
  update app.email_jobs set state=case when ambiguous then 'not_confirmed' else 'not_sent' end,
    reason=p_reason,payload=null,lease_until=null,updated_at=clock_timestamp()
  where id=p_job;
$$;

-- Puts a job back in line until p_next, keeping its expiry exactly as it was.
create function app.email_defer_job(p_job uuid,p_next timestamptz,p_reason text) returns void
language sql security invoker set search_path='' as $$
  update app.email_jobs set state='queued',reason=p_reason,next_attempt_at=p_next,lease_until=null,updated_at=clock_timestamp()
  where id=p_job;
$$;

-- Moves the sender circuit out to the end of the UTC day or month and says why.
create function app.email_open_circuit(p_monthly boolean,at_time timestamptz) returns timestamptz
language plpgsql security invoker set search_path='' as $$
declare ends timestamptz;
begin
  ends:=case when p_monthly then (date_trunc('month',at_time at time zone 'utc')+interval '1 month') at time zone 'utc'
    else (date_trunc('day',at_time at time zone 'utc')+interval '1 day') at time zone 'utc' end;
  update app.email_sender set circuit_until=ends,circuit_reason=case when p_monthly then 'monthly_limit' else 'daily_limit' end where id=1;
  return ends;
end;
$$;

-- Frees capacity: jobs whose time is up end as not sent (or not confirmed after
-- an unknown outcome), and a sending job whose holder never came back returns to
-- the line, or ends if it can no longer be attempted. A job that had begun an
-- attempt is treated as unknown, because the request may have left. Row locks
-- here are skip locked, so this is safe to run after the outbox advisory lock.
create function app.email_settle_jobs(at_time timestamptz) returns void
language plpgsql security invoker set search_path='' as $$
begin
  update app.email_jobs j set
    ambiguous=j.ambiguous or coalesce(j.reason='attempting',false),
    state=case when j.expires_at<=at_time or j.attempts>=3
      then case when j.ambiguous or coalesce(j.reason='attempting',false) then 'not_confirmed' else 'not_sent' end else 'queued' end,
    reason=case when j.expires_at<=at_time then 'expired' when j.attempts>=3 then 'attempts_exhausted' else null end,
    payload=case when j.expires_at<=at_time or j.attempts>=3 then null else j.payload end,
    lease_until=null,updated_at=clock_timestamp()
  where j.id in(select id from app.email_jobs where state='sending' and lease_until<at_time order by id for update skip locked);
  update app.email_jobs j set state=case when j.ambiguous then 'not_confirmed' else 'not_sent' end,
    reason='expired',payload=null,lease_until=null,updated_at=clock_timestamp()
  where j.id in(select id from app.email_jobs where state='queued' and expires_at<=at_time order by id for update skip locked);
end;
$$;

create function api.claim_email_jobs(p_holder uuid,p_limit integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  sender app.email_sender; at_time timestamptz; s app.sessions; p app.parties; r app.email_jobs; ses record; due timestamptz;
  own record; out jsonb:='[]'::jsonb; stale boolean; fee_released boolean;
begin
  if not app.email_take_lease(p_holder) then return jsonb_build_object('leased',false,'jobs','[]'::jsonb); end if;
  select * into sender from app.email_sender where id=1;
  at_time:=clock_timestamp();
  if sender.circuit_until>at_time then
    perform app.email_settle_jobs(at_time);
    return jsonb_build_object('leased',true,'jobs','[]'::jsonb);
  end if;

  -- A reminder is due 24 hours before the start and may be attempted for the next
  -- 15 minutes, never later. Only a party that was confirmed by the due time gets
  -- one, and the unique key on the job makes a repeat claim add nothing. It goes
  -- through the outbox like every other email, so the 500-job ceiling applies.
  for ses in select id,(details->>'startsAt')::timestamptz as starts from app.sessions
    where state='published'
      and (details->>'startsAt')::timestamptz>at_time+interval '24 hours'-interval '15 minutes'
      and (details->>'startsAt')::timestamptz<=at_time+interval '24 hours' loop
    due:=ses.starts-interval '24 hours';
    for own in select id,user_id from app.parties where session_id=ses.id and state='confirmed' and app.party_confirmed_at(id)<=due loop
      perform app.enqueue_email('reminder',ses.id,own.id,own.user_id,ses.id::text,due+interval '15 minutes');
    end loop;
  end loop;

  at_time:=clock_timestamp();
  perform app.email_settle_jobs(at_time);

  for r in select * from app.email_jobs where state='queued' and next_attempt_at<=at_time and expires_at>at_time
    order by next_attempt_at,id limit greatest(0,least(coalesce(p_limit,0),5)) for update skip locked loop
    select * into s from app.sessions where id=r.session_id;
    p:=null;
    if r.party_id is not null then select * into p from app.parties where id=r.party_id; end if;
    stale:=s.id is null or (s.state='cancelled' and r.kind<>'cancelled');
    if not stale then
      if r.kind in ('joined_confirmed','promoted','reminder') then stale:=p.id is null or p.state<>'confirmed';
      elsif r.kind='joined_waitlisted' then stale:=p.id is null or p.state<>'waitlisted';
      elsif r.kind='released' then
        select exists(select 1 from app.fee_obligations where party_id=r.party_id and liability_state='released_unpaid') into fee_released;
        stale:=p.id is null or p.state<>'removed' or not fee_released;
      end if;
      if r.kind='reminder' and s.state<>'published' then stale:=true; end if;
    end if;
    if stale then
      perform app.email_end_job(r.id,'superseded');
      continue;
    end if;
    -- The primary's name and place in line come from the job's party, or the
    -- account's latest party in this session for session-wide updates.
    if p.id is null then
      select * into p from app.parties where session_id=r.session_id and user_id=r.user_id order by queue_sequence desc limit 1;
    end if;
    update app.email_jobs set state='sending',reason=null,lease_until=clock_timestamp()+interval '2 minutes',updated_at=clock_timestamp()
      where id=r.id;
    out:=out||jsonb_build_array(jsonb_build_object(
      'id',r.id,'kind',r.kind,'attempts',r.attempts,'ambiguous',r.ambiguous,'userId',r.user_id,
      'idempotencyKey','rallypoint-email-'||r.id,'payload',r.payload,
      'context',jsonb_build_object('title',s.details->>'title','startsAt',s.details->>'startsAt','timeZone',s.details->>'timeZone',
        'slug',s.slug,'firstName',nullif(split_part(btrim(coalesce(p.primary_name,'')),' ',1),''),
        'queuePosition',case when p.state='waitlisted' then
          (select count(*)+1 from app.parties where session_id=p.session_id and state='waitlisted' and queue_sequence<p.queue_sequence) else null end,
        'cutoffAt',s.details->>'cutoffAt')));
  end loop;
  return jsonb_build_object('leased',true,'jobs',out);
end;
$$;

create function api.begin_email_attempt(p_holder uuid,p_job uuid,p_payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  sender app.email_sender; j app.email_jobs; at_time timestamptz; day_key text; month_key text; day_used integer; month_used integer;
  ends timestamptz; wait_ms integer; frozen jsonb;
begin
  select * into sender from app.email_sender where id=1 for update;
  at_time:=clock_timestamp();
  if sender.holder is distinct from p_holder or sender.lease_until<=at_time then
    return jsonb_build_object('go',false,'payload',null,'waitMs',0,'reason','lease_lost');
  end if;
  select * into j from app.email_jobs where id=p_job and state='sending' for update;
  if not found or j.lease_until<=at_time then
    return jsonb_build_object('go',false,'payload',null,'waitMs',0,'reason','lease_lost');
  end if;
  if j.expires_at<=at_time then
    perform app.email_end_job(j.id,'expired');
    return jsonb_build_object('go',false,'payload',null,'waitMs',0,'reason','expired');
  end if;
  if j.attempts>=3 then
    perform app.email_end_job(j.id,'attempts_exhausted');
    return jsonb_build_object('go',false,'payload',null,'waitMs',0,'reason','attempts_exhausted');
  end if;
  if j.payload is null and (p_payload is null or jsonb_typeof(p_payload)<>'object') then
    raise check_violation using message='invalid_payload';
  end if;
  -- A changed address suppresses the old job; the frozen payload is never edited.
  if j.payload is not null and p_payload->>'to' is distinct from j.payload->>'to' then
    perform app.email_end_job(j.id,'destination_changed');
    return jsonb_build_object('go',false,'payload',null,'waitMs',0,'reason','destination_changed');
  end if;
  -- A circuit opened earlier in this run, or by another provider answer, stands.
  if sender.circuit_until>at_time then
    perform app.email_defer_job(j.id,sender.circuit_until,sender.circuit_reason);
    return jsonb_build_object('go',false,'payload',null,'waitMs',0,'reason',sender.circuit_reason);
  end if;
  day_key:='d:'||to_char(at_time at time zone 'utc','YYYY-MM-DD');
  month_key:='m:'||to_char(at_time at time zone 'utc','YYYY-MM');
  select coalesce((select attempts from app.email_budget where period=day_key),0) into day_used;
  select coalesce((select attempts from app.email_budget where period=month_key),0) into month_used;
  if day_used>=50 or month_used>=1500 then
    ends:=app.email_open_circuit(month_used>=1500,at_time);
    perform app.email_defer_job(j.id,ends,case when month_used>=1500 then 'monthly_limit' else 'daily_limit' end);
    return jsonb_build_object('go',false,'payload',null,'waitMs',0,'reason',case when month_used>=1500 then 'monthly_limit' else 'daily_limit' end);
  end if;
  -- Debit first and never refund: the request may leave even if we never hear back.
  insert into app.email_budget(period,attempts) values(day_key,1) on conflict (period) do update set attempts=app.email_budget.attempts+1;
  insert into app.email_budget(period,attempts) values(month_key,1) on conflict (period) do update set attempts=app.email_budget.attempts+1;
  frozen:=coalesce(j.payload,p_payload);
  update app.email_jobs set payload=frozen,attempts=attempts+1,reason='attempting',updated_at=clock_timestamp() where id=j.id;
  wait_ms:=case when sender.last_request_at is null then 0
    else greatest(0,1000-floor(extract(epoch from at_time-sender.last_request_at)*1000)::integer) end;
  update app.email_sender set last_request_at=at_time+make_interval(secs=>wait_ms/1000.0) where id=1;
  return jsonb_build_object('go',true,'payload',frozen,'waitMs',wait_ms,'reason',null);
end;
$$;

create function api.finish_email_attempt(p_holder uuid,p_job uuid,p_outcome text,p_code text,p_provider_id text,p_retry_after_seconds integer) returns void
language plpgsql security invoker set search_path='' as $$
declare
  sender app.email_sender; j app.email_jobs; at_time timestamptz; safe_code text; delay interval; next_at timestamptz; ends timestamptz;
  unknown boolean;
begin
  if p_outcome is null or p_outcome not in ('accepted','transient','ambiguous','permanent','quota','recipient_missing') then
    raise check_violation using message='invalid_outcome';
  end if;
  select * into sender from app.email_sender where id=1 for update;
  if sender.holder is distinct from p_holder then return; end if;
  select * into j from app.email_jobs where id=p_job and state='sending' for update;
  if not found then return; end if;
  at_time:=clock_timestamp();
  safe_code:=case when p_code ~ '^[a-z0-9_]{1,40}$' then p_code else null end;
  unknown:=j.ambiguous or p_outcome='ambiguous';

  if p_outcome='accepted' then
    update app.email_jobs set state='sent',reason=null,provider_id=left(p_provider_id,100),payload=null,lease_until=null,updated_at=clock_timestamp()
      where id=j.id;
  elsif p_outcome in ('transient','ambiguous') then
    update app.email_jobs set ambiguous=unknown,updated_at=clock_timestamp() where id=j.id;
    if j.attempts>=3 then
      perform app.email_end_job(j.id,'attempts_exhausted');
    else
      delay:=case when j.attempts<=1 then interval '1 minute' else interval '5 minutes' end;
      if coalesce(p_retry_after_seconds,0)>0 then
        delay:=greatest(delay,make_interval(secs=>least(p_retry_after_seconds,604800)));
      end if;
      next_at:=at_time+delay;
      if next_at<j.expires_at then
        perform app.email_defer_job(j.id,next_at,safe_code);
      else
        perform app.email_end_job(j.id,'expired');
      end if;
    end if;
  elsif p_outcome='permanent' then
    perform app.email_end_job(j.id,'rejected');
  elsif p_outcome='quota' then
    ends:=app.email_open_circuit(safe_code='monthly_quota',at_time);
    if j.attempts>=3 then
      perform app.email_end_job(j.id,'attempts_exhausted');
    else
      perform app.email_defer_job(j.id,ends,case when safe_code='monthly_quota' then 'monthly_limit' else 'daily_limit' end);
    end if;
  else
    perform app.email_end_job(j.id,'no_verified_email');
  end if;
end;
$$;

create function api.release_email_sender(p_holder uuid) returns void
language sql security invoker set search_path='' as $$
  update app.email_sender set holder=null,lease_until=null where id=1 and holder=p_holder;
$$;

-- Delivery is switched off: everything already due ends as not sent with that
-- reason, so the organizer is not told something is waiting that never will be.
create function api.disable_due_emails(p_holder uuid) returns integer
language plpgsql security invoker set search_path='' as $$
declare total integer; at_time timestamptz;
begin
  if not app.email_take_lease(p_holder) then return 0; end if;
  at_time:=clock_timestamp();
  with due as (
    select id from app.email_jobs where state='queued' and next_attempt_at<=at_time order by id for update skip locked
  ), ended as (
    update app.email_jobs j set state=case when j.ambiguous then 'not_confirmed' else 'not_sent' end,
      reason='delivery_disabled',payload=null,lease_until=null,updated_at=clock_timestamp()
    where j.id in(select id from due) returning 1)
  select count(*) into total from ended;
  return total;
end;
$$;

revoke all on function app.email_take_lease(uuid),app.email_end_job(uuid,text),app.email_defer_job(uuid,timestamptz,text),
  app.email_open_circuit(boolean,timestamptz),app.email_settle_jobs(timestamptz),
  api.claim_email_jobs(uuid,integer),api.begin_email_attempt(uuid,uuid,jsonb),
  api.finish_email_attempt(uuid,uuid,text,text,text,integer),api.release_email_sender(uuid),api.disable_due_emails(uuid)
  from public,anon,authenticated;
grant execute on function app.email_take_lease(uuid),app.email_end_job(uuid,text),app.email_defer_job(uuid,timestamptz,text),
  app.email_open_circuit(boolean,timestamptz),app.email_settle_jobs(timestamptz),
  api.claim_email_jobs(uuid,integer),api.begin_email_attempt(uuid,uuid,jsonb),
  api.finish_email_attempt(uuid,uuid,text,text,text,integer),api.release_email_sender(uuid),api.disable_due_emails(uuid)
  to service_role;
