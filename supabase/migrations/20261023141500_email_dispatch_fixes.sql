-- P-06 email delivery, step 3 fixes (replaces functions from 20261023141000).
--
-- 1. Correction to the earlier header: reminder creation does touch session and
--    party rows, because inserting an email job checks its foreign keys with a
--    FOR KEY SHARE lock on them. A join, withdrawal, release or cancellation
--    holds the session row FOR UPDATE and then waits on the outbox advisory
--    lock, which app.enqueue_email takes before that insert, so the claim could
--    deadlock with it. The reminder step now locks every candidate session and
--    party row FOR KEY SHARE SKIP LOCKED before it makes its first enqueue, and
--    enqueues only for rows it actually holds. A row that is busy is skipped and
--    a later claim inside the 15-minute window picks it up. Lock order is thus:
--    sender row, job rows (skip locked), session/party key share (skip locked),
--    then the outbox advisory lock last.
-- 2. Jobs that are no longer true are ended in the settle step, for every queued
--    job, so they stop holding capacity and cannot use up one of the five slots,
--    open circuit or not.
-- 3. Settling comes before reminder creation, so expired jobs free capacity first.
-- 4. A sending job whose holder vanished keeps its retry spacing.

create or replace function app.email_settle_jobs(at_time timestamptz) returns void
language plpgsql security invoker set search_path='' as $$
begin
  -- A sending job whose holder never came back: back in line (spaced as a retry
  -- would be), or ended if it can no longer be attempted. One that had begun an
  -- attempt is treated as unknown, because the request may have left.
  update app.email_jobs j set
    ambiguous=j.ambiguous or coalesce(j.reason='attempting',false),
    state=case when j.expires_at<=at_time or j.attempts>=3
      then case when j.ambiguous or coalesce(j.reason='attempting',false) then 'not_confirmed' else 'not_sent' end else 'queued' end,
    reason=case when j.expires_at<=at_time then 'expired' when j.attempts>=3 then 'attempts_exhausted' else null end,
    payload=case when j.expires_at<=at_time or j.attempts>=3 then null else j.payload end,
    next_attempt_at=case when j.expires_at<=at_time or j.attempts>=3 then j.next_attempt_at
      else greatest(j.next_attempt_at,at_time+case j.attempts when 1 then interval '1 minute' when 2 then interval '5 minutes' else interval '0 seconds' end) end,
    lease_until=null,updated_at=clock_timestamp()
  where j.id in(select id from app.email_jobs where state='sending' and lease_until<at_time order by id for update skip locked);
  update app.email_jobs j set state=case when j.ambiguous then 'not_confirmed' else 'not_sent' end,
    reason='expired',payload=null,lease_until=null,updated_at=clock_timestamp()
  where j.id in(select id from app.email_jobs where state='queued' and expires_at<=at_time order by id for update skip locked);
  -- A waiting email that is no longer true: its session was cancelled (only the
  -- cancellation email survives that), or its party is no longer in the state the
  -- email describes, or a reminder's session is no longer published. Plain reads of
  -- session and party rows; only the job rows are locked.
  update app.email_jobs j set state=case when j.ambiguous then 'not_confirmed' else 'not_sent' end,
    reason='superseded',payload=null,lease_until=null,updated_at=clock_timestamp()
  where j.id in(
    select e.id from app.email_jobs e
      join app.sessions s on s.id=e.session_id
      left join app.parties p on p.id=e.party_id
    where e.state='queued' and (
      (s.state='cancelled' and e.kind<>'cancelled')
      or (e.kind in ('joined_confirmed','promoted','reminder') and (p.id is null or p.state<>'confirmed'))
      or (e.kind='joined_waitlisted' and (p.id is null or p.state<>'waitlisted'))
      or (e.kind='released' and (p.id is null or p.state<>'removed'
        or not exists(select 1 from app.fee_obligations f where f.party_id=e.party_id and f.liability_state='released_unpaid')))
      or (e.kind='reminder' and s.state<>'published'))
    order by e.id for update of e skip locked);
end;
$$;

create or replace function api.claim_email_jobs(p_holder uuid,p_limit integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  sender app.email_sender; at_time timestamptz; s app.sessions; p app.parties; r app.email_jobs; ses record; own record;
  out jsonb:='[]'::jsonb; stale boolean; fee_released boolean;
  sess_ids uuid[]:=array[]::uuid[]; sess_due timestamptz[]:=array[]::timestamptz[];
  party_ids uuid[]:=array[]::uuid[]; party_users uuid[]:=array[]::uuid[]; party_sessions uuid[]:=array[]::uuid[];
  at_idx integer;
begin
  if not app.email_take_lease(p_holder) then return jsonb_build_object('leased',false,'jobs','[]'::jsonb); end if;
  select * into sender from app.email_sender where id=1;
  at_time:=clock_timestamp();
  -- Expired and no-longer-true jobs leave the active states first, circuit or not.
  perform app.email_settle_jobs(at_time);
  if sender.circuit_until>at_time then
    return jsonb_build_object('leased',true,'jobs','[]'::jsonb);
  end if;

  -- A reminder is due 24 hours before the start and may be attempted for the next
  -- 15 minutes, never later. Only a party that was confirmed by the due time gets
  -- one, and the unique key on the job makes a repeat claim add nothing. It goes
  -- through the outbox like every other email, so the 500-job ceiling applies.
  -- Every candidate row is locked before the first enqueue (see the header).
  for ses in select x.id,(x.details->>'startsAt')::timestamptz as starts from app.sessions x
    where x.state='published'
      and (x.details->>'startsAt')::timestamptz>at_time+interval '24 hours'-interval '15 minutes'
      and (x.details->>'startsAt')::timestamptz<=at_time+interval '24 hours'
    for key share of x skip locked loop
    sess_ids:=sess_ids||ses.id;
    sess_due:=sess_due||(ses.starts-interval '24 hours');
  end loop;
  if coalesce(array_length(sess_ids,1),0)>0 then
    for own in select q.id,q.user_id,q.session_id from app.parties q
      where q.session_id=any(sess_ids) and q.state='confirmed'
        and app.party_confirmed_at(q.id)<=sess_due[array_position(sess_ids,q.session_id)]
      for key share of q skip locked loop
      party_ids:=party_ids||own.id;
      party_users:=party_users||own.user_id;
      party_sessions:=party_sessions||own.session_id;
    end loop;
    for k in 1..coalesce(array_length(party_ids,1),0) loop
      at_idx:=array_position(sess_ids,party_sessions[k]);
      perform app.enqueue_email('reminder',party_sessions[k],party_ids[k],party_users[k],party_sessions[k]::text,
        sess_due[at_idx]+interval '15 minutes');
    end loop;
  end if;

  at_time:=clock_timestamp();
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
