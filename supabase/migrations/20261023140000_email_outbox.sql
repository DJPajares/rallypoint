-- P-06 email delivery, step 1: a durable outbox. Each existing signal (a join,
-- a promotion, a release, a cancellation, a changed set of payment instructions)
-- leaves one private job per recipient in the same transaction that wrote the
-- signal. Nothing is sent here; a later task reads the queue. A job holds no
-- address, body or participant data: the recipient is an account id, and the
-- frozen payload stays empty until the first attempt.
--
-- Queueing must never undo or block a seat, fee, release or cancellation, so an
-- overflow (more than 50 recipients, or 500 jobs already waiting) becomes
-- evidence rather than an error.

create table app.email_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check(kind in ('joined_confirmed','joined_waitlisted','promoted','released','cancelled','instructions_changed','reminder')),
  session_id uuid not null references app.sessions(id) on delete cascade,
  party_id uuid references app.parties(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  source_key text not null,
  state text not null default 'queued' check(state in ('queued','sending','sent','not_confirmed','not_sent')),
  reason text,
  attempts smallint not null default 0 check(attempts between 0 and 3),
  ambiguous boolean not null default false,
  next_attempt_at timestamptz not null,
  expires_at timestamptz not null,
  lease_until timestamptz,
  payload jsonb,
  provider_id text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(kind,source_key,user_id)
);
create index email_jobs_due on app.email_jobs(state,next_attempt_at);
create index email_jobs_by_session on app.email_jobs(session_id);
create index email_jobs_by_party on app.email_jobs(party_id) where party_id is not null;
create index email_jobs_by_user on app.email_jobs(user_id);

-- Session-level evidence that a whole update was withheld because it would
-- reach too many people. It names a count, never the people.
create table app.email_suppressions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references app.sessions(id) on delete cascade,
  kind text not null,
  source_key text not null,
  reason text not null check(reason in ('audience_limit')),
  recipients integer not null,
  created_at timestamptz not null default clock_timestamp()
);
create index email_suppressions_by_session on app.email_suppressions(session_id);

alter table app.email_jobs enable row level security;
alter table app.email_suppressions enable row level security;
revoke all on app.email_jobs,app.email_suppressions from public,anon,authenticated;
grant select,insert,update on app.email_jobs to service_role;
grant select,insert on app.email_suppressions to service_role;

-- One job for one person and one signal. A repeat of the same signal adds
-- nothing. The 501st waiting job is recorded as not sent, with its reason, and
-- is never replayed. The advisory lock is taken last in every transaction that
-- uses it, so it only orders the count against concurrent inserts.
create function app.enqueue_email(p_kind text,p_session uuid,p_party uuid,p_user uuid,p_source text,p_expires timestamptz) returns void
language plpgsql security invoker set search_path='' as $$
declare at_time timestamptz; queue_full boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended('email_outbox',0));
  at_time:=clock_timestamp();
  queue_full:=(select count(*) from app.email_jobs where state in ('queued','sending'))>=500;
  insert into app.email_jobs(kind,session_id,party_id,user_id,source_key,state,reason,next_attempt_at,expires_at,created_at,updated_at)
    values(p_kind,p_session,p_party,p_user,p_source,case when queue_full then 'not_sent' else 'queued' end,
      case when queue_full then 'queue_capacity' else null end,at_time,p_expires,at_time,at_time)
    on conflict (kind,source_key,user_id) do nothing;
end;
$$;

-- A session-wide update reaches at most 50 distinct people. Above that the
-- whole update is withheld: one piece of evidence, no jobs, never "the first 50".
create function app.enqueue_bulk(p_kind text,p_session uuid,p_source text,p_users uuid[],p_expires timestamptz) returns void
language plpgsql security invoker set search_path='' as $$
declare recipients uuid[]; total integer; one uuid;
begin
  select coalesce(array_agg(distinct u),'{}'::uuid[]) into recipients from unnest(p_users) u where u is not null;
  total:=coalesce(array_length(recipients,1),0);
  if total=0 then return; end if;
  if total>50 then
    insert into app.email_suppressions(session_id,kind,source_key,reason,recipients,created_at)
      values(p_session,p_kind,p_source,'audience_limit',total,clock_timestamp());
    return;
  end if;
  foreach one in array recipients loop
    perform app.enqueue_email(p_kind,p_session,null,one,p_source,p_expires);
  end loop;
end;
$$;

-- Join, promotion and release: the party's primary account, once. The email
-- stops being useful at the session start or after 23 hours, whichever is first.
create function app.queue_registration_email() returns trigger
language plpgsql security invoker set search_path='' as $$
declare mapped text; p app.parties; starts timestamptz;
begin
  mapped:=case new.kind when 'confirmed' then 'joined_confirmed' when 'waitlisted' then 'joined_waitlisted'
    when 'promoted' then 'promoted' when 'released' then 'released' else null end;
  if mapped is null then return new; end if;
  select * into p from app.parties where id=new.party_id;
  if not found then return new; end if;
  select (details->>'startsAt')::timestamptz into starts from app.sessions where id=p.session_id;
  perform app.enqueue_email(mapped,p.session_id,p.id,p.user_id,new.id::text,
    least(coalesce(starts,'infinity'::timestamptz),clock_timestamp()+interval '23 hours'));
  return new;
end;
$$;
create trigger queue_registration_email after insert on app.registration_events
  for each row execute function app.queue_registration_email();

-- Cancellation records its signal before it removes unpaid fees, so this runs
-- at commit, when every fee and claim removal is already visible. Everyone
-- confirmed or waitlisted is told, and so is anyone whose unpaid fee or claim
-- this cancellation ended, once per account. A draft was never seen by anyone.
create function app.queue_cancellation_email() returns trigger
language plpgsql security invoker set search_path='' as $$
declare audience uuid[];
begin
  if new.previous_state='draft' then return null; end if;
  select coalesce(array_agg(distinct x.user_id),'{}'::uuid[]) into audience from (
    select p.user_id from app.parties p where p.session_id=new.session_id and p.state in ('confirmed','waitlisted')
    union
    select p.user_id from app.parties p join app.fee_changes c on c.party_id=p.id
      where p.session_id=new.session_id and c.action='removed_session_cancelled' and c.created_at=new.created_at
    union
    select p.user_id from app.parties p join app.split_claim_changes c on c.party_id=p.id
      where p.session_id=new.session_id and c.action='removed_session_cancelled' and c.created_at=new.created_at
  ) x;
  perform app.enqueue_bulk('cancelled',new.session_id,new.session_id::text,audience,clock_timestamp()+interval '23 hours');
  return null;
end;
$$;
create constraint trigger queue_cancellation_email after insert on app.session_cancellations
  deferrable initially deferred for each row execute function app.queue_cancellation_email();

-- Changed payment instructions: confirmed and waitlisted primaries. A person
-- who already has an untouched queued update for this session gets no second
-- one; that one carries the link to the latest instructions.
create function app.queue_instruction_email() returns trigger
language plpgsql security invoker set search_path='' as $$
declare audience uuid[];
begin
  select coalesce(array_agg(distinct p.user_id),'{}'::uuid[]) into audience from app.parties p
    where p.session_id=new.session_id and p.state in ('confirmed','waitlisted')
      and not exists(select 1 from app.email_jobs j where j.session_id=new.session_id and j.user_id=p.user_id
        and j.kind='instructions_changed' and j.state='queued' and j.attempts=0);
  perform app.enqueue_bulk('instructions_changed',new.session_id,new.session_id::text||':'||new.revision::text,audience,
    clock_timestamp()+interval '23 hours');
  return new;
end;
$$;
create trigger queue_instruction_email after insert on app.payment_instruction_notices
  for each row execute function app.queue_instruction_email();

revoke all on function app.enqueue_email(text,uuid,uuid,uuid,text,timestamptz) from public,anon,authenticated;
revoke all on function app.enqueue_bulk(text,uuid,text,uuid[],timestamptz) from public,anon,authenticated;
revoke all on function app.queue_registration_email() from public,anon,authenticated;
revoke all on function app.queue_cancellation_email() from public,anon,authenticated;
revoke all on function app.queue_instruction_email() from public,anon,authenticated;
grant execute on function app.enqueue_email(text,uuid,uuid,uuid,text,timestamptz) to service_role;
grant execute on function app.enqueue_bulk(text,uuid,text,uuid[],timestamptz) to service_role;
grant execute on function app.queue_registration_email() to service_role;
grant execute on function app.queue_cancellation_email() to service_role;
grant execute on function app.queue_instruction_email() to service_role;
