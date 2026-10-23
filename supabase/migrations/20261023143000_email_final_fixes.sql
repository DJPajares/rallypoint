-- P-06 email delivery, final review fixes (replaces functions from
-- 20261023140000, 20261023141000, 20261023141500 and 20261023142000).
--
-- 1. A job whose time is up is not waiting any more, whether or not a drain has
--    ever run: the organizer views report it as not sent (not confirmed after an
--    unknown outcome), and it no longer counts toward the 500-job ceiling.
-- 2. A job the renderer could not prepare says so (render_failed) instead of
--    being described as refused by the email service.
-- 3. A withheld payment-details update stops being reported once a later
--    payment-details email has been queued.
-- 4. While the sender circuit is open, due waiting jobs carry the limit that
--    holds them, and reminders are still created, so they exist and expire
--    visibly rather than silently not existing.
-- 5. A payment-details update is measured against the whole confirmed and
--    waitlisted audience before anyone is left out for already having one.
-- 6. The outbox advisory lock key is namespaced. It is still the last lock any
--    transaction takes.

-- (6) and (1): the namespaced key, and only live jobs count toward the ceiling.
create or replace function app.enqueue_email(p_kind text,p_session uuid,p_party uuid,p_user uuid,p_source text,p_expires timestamptz) returns void
language plpgsql security invoker set search_path='' as $$
declare at_time timestamptz; queue_full boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended('rallypoint_email_outbox',0));
  at_time:=clock_timestamp();
  queue_full:=(select count(*) from app.email_jobs where state in ('queued','sending') and expires_at>at_time)>=500;
  insert into app.email_jobs(kind,session_id,party_id,user_id,source_key,state,reason,next_attempt_at,expires_at,created_at,updated_at)
    values(p_kind,p_session,p_party,p_user,p_source,case when queue_full then 'not_sent' else 'queued' end,
      case when queue_full then 'queue_capacity' else null end,at_time,p_expires,at_time,at_time)
    on conflict (kind,source_key,user_id) do nothing;
end;
$$;

-- (5): the 50-person limit applies to the whole confirmed and waitlisted
-- audience. Only when that fits are people with an untouched queued update left
-- out, since that update already carries the link to the latest instructions.
create or replace function app.queue_instruction_email() returns trigger
language plpgsql security invoker set search_path='' as $$
declare everyone uuid[]; pending uuid[];
begin
  select coalesce(array_agg(distinct p.user_id),'{}'::uuid[]) into everyone from app.parties p
    where p.session_id=new.session_id and p.state in ('confirmed','waitlisted');
  if coalesce(array_length(everyone,1),0)<=50 then
    select coalesce(array_agg(distinct p.user_id),'{}'::uuid[]) into pending from app.parties p
      where p.session_id=new.session_id and p.state in ('confirmed','waitlisted')
        and not exists(select 1 from app.email_jobs j where j.session_id=new.session_id and j.user_id=p.user_id
          and j.kind='instructions_changed' and j.state in ('queued','sending') and j.attempts=0);
    everyone:=pending;
  end if;
  perform app.enqueue_bulk('instructions_changed',new.session_id,new.session_id::text||':'||new.revision::text,everyone,
    clock_timestamp()+interval '23 hours');
  return new;
end;
$$;

-- (2): a render failure keeps its own reason.
create or replace function api.finish_email_attempt(p_holder uuid,p_job uuid,p_outcome text,p_code text,p_provider_id text,p_retry_after_seconds integer) returns void
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
    perform app.email_end_job(j.id,case when safe_code='render_failed' then 'render_failed' else 'rejected' end);
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

-- (1) and (2): the latest job of each kind for one account in one session. A
-- waiting or in-flight job whose time is up reads as ended, not as queued.
create or replace function app.party_emails(p_session uuid,p_user uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('kind',x.kind,'status',x.status,'reason',x.reason,'attempts',x.attempts,'at',x.at)
    order by x.created_at,x.kind),'[]'::jsonb)
  from (
    select distinct on (j.kind) j.kind,j.created_at,j.attempts,j.updated_at as at,
      case
        when j.state in ('queued','sending') and j.expires_at<=now() then case when j.ambiguous then 'not_confirmed' else 'not_sent' end
        when j.state='sending' then 'queued'
        else j.state
      end as status,
      case
        when j.state in ('queued','sending') and j.expires_at<=now() then case when j.ambiguous then null else 'expired' end
        when j.state in ('queued','sending') and j.reason in ('daily_limit','monthly_limit') then j.reason
        when j.state='not_sent' and j.reason in ('superseded','expired','rejected','render_failed','attempts_exhausted','delivery_disabled',
          'queue_capacity','no_verified_email','destination_changed') then j.reason
        else null
      end as reason
    from app.email_jobs j where j.session_id=p_session and j.user_id=p_user
    order by j.kind,j.created_at desc,j.id desc
  ) x;
$$;

-- (1) and (3): withheld updates and the cancellation tally. A withheld
-- payment-details update is stale once a later payment-details job exists.
create or replace function app.session_email_summary(p_session uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object(
    'suppressed',coalesce((select jsonb_agg(jsonb_build_object('kind',s.kind,'reason',s.reason,'recipients',s.recipients,'at',s.created_at)
      order by s.created_at,s.id) from app.email_suppressions s where s.session_id=p_session
        and not (s.kind='instructions_changed' and exists(select 1 from app.email_jobs j
          where j.session_id=p_session and j.kind='instructions_changed' and j.created_at>s.created_at))),'[]'::jsonb),
    'cancellation',(select jsonb_build_object(
        'queued',count(*) filter (where j.state in ('queued','sending') and j.expires_at>now()),
        'sent',count(*) filter (where j.state='sent'),
        'notConfirmed',count(*) filter (where j.state='not_confirmed'
          or (j.state in ('queued','sending') and j.expires_at<=now() and j.ambiguous)),
        'notSent',count(*) filter (where j.state='not_sent'
          or (j.state in ('queued','sending') and j.expires_at<=now() and not j.ambiguous)))
      from app.email_jobs j where j.session_id=p_session and j.kind='cancelled' having count(*)>0));
$$;

-- (4): the claim step. While the circuit is open it still creates due reminders
-- (so they exist and expire visibly) and tells every due waiting job which limit
-- holds it, without touching when it is next due or when it expires. The lock
-- order is unchanged: sender row, job rows (skip locked), session and party key
-- share (skip locked), then the outbox advisory lock last.
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

  -- A reminder is due 24 hours before the start and may be attempted for the next
  -- 15 minutes, never later. Only a party that was confirmed by the due time gets
  -- one, and the unique key on the job makes a repeat claim add nothing. It goes
  -- through the outbox like every other email, so the 500-job ceiling applies.
  -- Every candidate row is locked before the first enqueue (see 20261023141500).
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
  if sender.circuit_until>at_time then
    update app.email_jobs set reason=sender.circuit_reason
      where id in(select id from app.email_jobs where state='queued' and next_attempt_at<=at_time
        and reason is distinct from sender.circuit_reason order by id for update skip locked);
    return jsonb_build_object('leased',true,'jobs','[]'::jsonb);
  end if;

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
