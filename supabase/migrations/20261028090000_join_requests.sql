-- P-34 / WDL-412: Ask to join. A session either lets people join directly
-- (details.joinMode missing or 'direct') or takes requests ('request') that an
-- organizer or co-host accepts or declines. A request holds no seat and no
-- queue place; accepting places the party through the same admission as a
-- join, at the back of the queue as of acceptance. Nothing here sends email
-- (owner, 2026-10-28): accepted parties are admitted with silent events.

alter table app.sessions add constraint sessions_join_mode_check check (
  not (details ? 'joinMode') or details->>'joinMode' in ('direct','request'));

-- D-14: who can join is not part of the booked terms, so a booked session may
-- switch it until start, and the switch is never a material change.
create or replace function app.assert_booked_edit(p_old app.sessions,p_details jsonb) returns void
language plpgsql security invoker set search_path='' as $$
begin
  if exists (
    select 1 from (select jsonb_object_keys(p_old.details) k union select jsonb_object_keys(p_details)) keys
    where p_old.details->k is distinct from p_details->k
      and not (k='paymentMode' and coalesce(p_old.details->>k,'organizer')=coalesce(p_details->>k,'organizer'))
      and not (k='releaseUnpaid' and coalesce(p_old.details->k,'false'::jsonb)=coalesce(p_details->k,'false'::jsonb))
      and k not in ('title','activity','instructions','capacity','startLocal','endLocal','startsAt','endsAt','location','mapsLink','cutoffLocal','cutoffAt','joinMode')
  ) or ((p_old.details->>'cutoffAt')::timestamptz is distinct from (p_details->>'cutoffAt')::timestamptz
        and (p_old.details->>'startsAt')::timestamptz is not distinct from (p_details->>'startsAt')::timestamptz)
  then raise sqlstate 'P0001' using message='booked_event_locked'; end if;
  if clock_timestamp()>=(p_old.details->>'startsAt')::timestamptz then
    raise sqlstate 'P0001' using message='session_started';
  end if;
  if (p_details->>'startsAt')::timestamptz<=clock_timestamp() then
    raise sqlstate 'P0001' using message='future_start_required';
  end if;
  if coalesce((p_details->>'capacity')::bigint,0)<(select coalesce(sum(seats),0) from app.parties where session_id=p_old.id and state='confirmed') then
    raise sqlstate 'P0001' using message='capacity_below_confirmed';
  end if;
end;
$$;

-- A silent event records the same history without queuing an email.
alter table app.registration_events add column silent boolean not null default false;
create or replace function app.queue_registration_email() returns trigger
language plpgsql security invoker set search_path='' as $$
declare mapped text; p app.parties; starts timestamptz;
begin
  if new.silent then return new; end if;
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

-- One row per ask. "Expired" is never stored: a pending request whose session
-- has started is expired. Decided rows keep who answered and when.
create table app.join_requests (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references app.sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary_name text not null check (char_length(primary_name) between 1 and 80),
  guest_name text not null default '' check (char_length(guest_name)<=80),
  seats smallint not null check (seats in (1,2)),
  consent_version integer not null,
  consent_at timestamptz not null,
  state text not null default 'pending' check (state in ('pending','accepted','declined','cancelled')),
  asked_at timestamptz not null default clock_timestamp(),
  decided_at timestamptz,
  decided_by uuid references auth.users(id) on delete set null,
  decided_by_name text,
  party_id uuid references app.parties(id) on delete set null
);
create unique index join_requests_one_pending on app.join_requests(session_id,user_id) where state='pending';
create index join_requests_pending_by_user on app.join_requests(user_id) where state='pending';
create index join_requests_by_session on app.join_requests(session_id,asked_at);
alter table app.join_requests enable row level security;
revoke all on app.join_requests from public,anon,authenticated;
grant select,insert,update on app.join_requests to service_role;

create function app.is_session_manager(p_actor uuid,p_group uuid) returns boolean
language sql stable security invoker set search_path='' as $$
  select exists(select 1 from app.group_roles where group_id=p_group and user_id=p_actor and role in ('owner','organizer','cohost'));
$$;

-- The request's consent no longer covers the terms: a material change (D-14)
-- landed after they asked or last confirmed.
create function app.request_needs_confirm(p_request app.join_requests) returns boolean
language sql stable security invoker set search_path='' as $$
  select exists(select 1 from app.session_changes c
    where c.session_id=p_request.session_id and c.material and c.version>p_request.consent_version);
$$;

-- Group, then session, both for update: the same order join and promotion use.
create function app.lock_registration_session(p_slug uuid) returns app.sessions
language plpgsql security invoker set search_path='' as $$
declare s app.sessions;
begin
  select * into s from app.sessions where slug=p_slug;
  if not found then raise insufficient_privilege using message='session_unavailable'; end if;
  perform 1 from app.groups where id=s.group_id for update;
  select * into s from app.sessions where slug=p_slug for update;
  if s.state='draft' then raise insufficient_privilege using message='session_unavailable'; end if;
  return s;
end;
$$;

-- Places one party: promote whoever already fits, then confirm this party only
-- if nobody waits and it fits whole, otherwise queue it at the back. The
-- caller holds the session lock and has checked the window, terms and size.
create function app.admit_party(p_session uuid,p_user uuid,p_primary_name text,p_guest_name text,
  p_seats integer,p_consent_version integer,p_silent boolean) returns app.parties
language plpgsql security invoker set search_path='' as $$
declare s app.sessions; p app.parties; occupied bigint; result_state text;
begin
  perform app.fill_waitlist(p_session);
  select * into s from app.sessions where id=p_session;
  -- Recheck time immediately before accepting this new party, after queue work.
  if clock_timestamp()>=(s.details->>'startsAt')::timestamptz then raise sqlstate 'P0001' using message='registration_closed'; end if;
  select coalesce(sum(seats),0) into occupied from app.parties where session_id=s.id and state='confirmed';
  result_state:=case when not exists(select 1 from app.parties where session_id=s.id and state='waitlisted')
    and occupied+p_seats<=(s.details->>'capacity')::integer then 'confirmed' else 'waitlisted' end;
  update app.sessions set next_party_sequence=next_party_sequence+1,bookings_started_at=coalesce(bookings_started_at,clock_timestamp()) where id=s.id returning * into s;
  insert into app.parties(session_id,user_id,primary_name,guest_name,seats,state,queue_sequence,consent_version,consent_at)
    values(s.id,p_user,p_primary_name,case when p_seats=2 then p_guest_name else '' end,p_seats,result_state,s.next_party_sequence,p_consent_version,clock_timestamp()) returning * into p;
  if result_state='confirmed' then
    perform app.confirm_party_fee(p.id);
  end if;
  insert into app.registration_events(party_id,kind,silent) values(p.id,result_state,p_silent);
  return p;
end;
$$;

-- Same contract as before, plus: a request session refuses a direct join from
-- anyone but its own organizers and co-hosts.
create or replace function api.join_session(p_actor_id uuid,p_key uuid,p_slug uuid,p_version integer,p_seats integer,p_guest_name text,p_primary_name text,p_consent boolean) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s app.sessions; p app.parties; receipt app.operation_receipts; payload jsonb; now_at timestamptz;
begin
  if p_seats not in (1,2) or p_consent is distinct from true or length(p_guest_name)>80 or length(p_primary_name) not between 1 and 80 then
    raise check_violation using message='invalid_registration'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text||p_key::text,0));
  select * into s from app.sessions where slug=p_slug;
  if not found then raise insufficient_privilege using message='session_unavailable'; end if;
  perform 1 from app.groups where id=s.group_id for update;
  select * into s from app.sessions where slug=p_slug for update;
  payload:=jsonb_build_object('slug',p_slug,'version',p_version,'seats',p_seats,'guestName',p_guest_name,'consent',p_consent);
  select * into receipt from app.operation_receipts where actor_id=p_actor_id and request_key=p_key;
  if found then
    if receipt.action<>'join_session' or receipt.payload<>payload then raise sqlstate 'P0001' using message='idempotency_conflict'; end if;
    return jsonb_build_object('registration',app.registration_view(p_actor_id,s.id,receipt.resource_id),'operationKey',p_key);
  end if;
  if s.state='draft' then raise insufficient_privilege using message='session_unavailable'; end if;
  select * into p from app.parties where session_id=s.id and user_id=p_actor_id and state in ('confirmed','waitlisted');
  if found then
    insert into app.operation_receipts values(p_actor_id,p_key,'join_session',payload,p.id,now());
    return jsonb_build_object('registration',app.registration_view(p_actor_id,s.id,p.id),'operationKey',p_key);
  end if;
  if coalesce(s.details->>'joinMode','direct')='request' and not app.is_session_manager(p_actor_id,s.group_id) then
    raise sqlstate 'P0001' using message='request_required'; end if;
  now_at:=clock_timestamp();
  if s.state<>'published' or now_at>=(s.details->>'startsAt')::timestamptz then raise sqlstate 'P0001' using message='registration_closed'; end if;
  if now_at<(s.details->>'opensAt')::timestamptz then raise sqlstate 'P0001' using message='registration_not_open'; end if;
  if p_version is distinct from s.version then raise sqlstate 'P0001' using message='stale_terms'; end if;
  if p_seats=2 and not (s.details->>'guests')::boolean then raise check_violation using message='guest_disabled'; end if;
  if p_seats>(s.details->>'capacity')::integer then raise check_violation using message='party_too_large'; end if;
  if (s.details->>'feeMinor')::numeric*p_seats>9007199254740991 then raise check_violation using message='fee_out_of_range'; end if;
  p:=app.admit_party(s.id,p_actor_id,p_primary_name,p_guest_name,p_seats,s.version,false);
  insert into app.operation_receipts values(p_actor_id,p_key,'join_session',payload,p.id,now());
  return jsonb_build_object('registration',app.registration_view(p_actor_id,s.id,p.id),'operationKey',p_key);
end;
$$;

create function api.ask_to_join(p_actor_id uuid,p_key uuid,p_slug uuid,p_version integer,p_seats integer,p_guest_name text,p_primary_name text,p_consent boolean) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s app.sessions; p app.parties; r app.join_requests; receipt app.operation_receipts; payload jsonb; now_at timestamptz;
begin
  if p_seats not in (1,2) or p_consent is distinct from true or length(p_guest_name)>80 or length(p_primary_name) not between 1 and 80 then
    raise check_violation using message='invalid_registration'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text||p_key::text,0));
  -- One person's asks run one at a time, so the pending limit holds.
  perform pg_advisory_xact_lock(hashtextextended('join_requests:'||p_actor_id::text,0));
  s:=app.lock_registration_session(p_slug);
  payload:=jsonb_build_object('slug',p_slug,'version',p_version,'seats',p_seats,'guestName',p_guest_name,'consent',p_consent);
  select * into receipt from app.operation_receipts where actor_id=p_actor_id and request_key=p_key;
  if found then
    if receipt.action<>'ask_to_join' or receipt.payload<>payload then raise sqlstate 'P0001' using message='idempotency_conflict'; end if;
    return jsonb_build_object('registration',app.registration_view(p_actor_id,s.id),'operationKey',p_key);
  end if;
  select * into p from app.parties where session_id=s.id and user_id=p_actor_id and state in ('confirmed','waitlisted');
  if found then
    insert into app.operation_receipts values(p_actor_id,p_key,'ask_to_join',payload,p.id,now());
    return jsonb_build_object('registration',app.registration_view(p_actor_id,s.id,p.id),'operationKey',p_key);
  end if;
  select * into r from app.join_requests where session_id=s.id and user_id=p_actor_id and state='pending';
  if found then
    insert into app.operation_receipts values(p_actor_id,p_key,'ask_to_join',payload,r.id,now());
    return jsonb_build_object('registration',app.registration_view(p_actor_id,s.id),'operationKey',p_key);
  end if;
  if coalesce(s.details->>'joinMode','direct')<>'request' or app.is_session_manager(p_actor_id,s.group_id) then
    raise sqlstate 'P0001' using message='request_not_needed'; end if;
  now_at:=clock_timestamp();
  if s.state<>'published' or now_at>=(s.details->>'startsAt')::timestamptz then raise sqlstate 'P0001' using message='registration_closed'; end if;
  if now_at<(s.details->>'opensAt')::timestamptz then raise sqlstate 'P0001' using message='registration_not_open'; end if;
  if p_version is distinct from s.version then raise sqlstate 'P0001' using message='stale_terms'; end if;
  if p_seats=2 and not (s.details->>'guests')::boolean then raise check_violation using message='guest_disabled'; end if;
  if p_seats>(s.details->>'capacity')::integer then raise check_violation using message='party_too_large'; end if;
  if (s.details->>'feeMinor')::numeric*p_seats>9007199254740991 then raise check_violation using message='fee_out_of_range'; end if;
  if exists(select 1 from app.join_requests where session_id=s.id and user_id=p_actor_id and state='declined') then
    raise sqlstate 'P0001' using message='request_declined'; end if;
  if (select count(*) from app.join_requests where session_id=s.id and user_id=p_actor_id and state='cancelled')>=2 then
    raise sqlstate 'P0001' using message='request_cancel_limit'; end if;
  if (select count(*) from app.join_requests j join app.sessions o on o.id=j.session_id
      where j.user_id=p_actor_id and j.state='pending' and o.state='published'
        and (o.details->>'startsAt')::timestamptz>now_at)>=10 then
    raise sqlstate 'P0001' using message='request_limit'; end if;
  insert into app.join_requests(session_id,user_id,primary_name,guest_name,seats,consent_version,consent_at,asked_at)
    values(s.id,p_actor_id,p_primary_name,case when p_seats=2 then p_guest_name else '' end,p_seats,s.version,now_at,now_at)
    returning * into r;
  insert into app.operation_receipts values(p_actor_id,p_key,'ask_to_join',payload,r.id,now());
  return jsonb_build_object('registration',app.registration_view(p_actor_id,s.id),'operationKey',p_key);
end;
$$;

-- The requester's own pending request, locked; anyone else's is not theirs.
create function app.own_pending_request(p_actor uuid,p_session uuid,p_request uuid) returns app.join_requests
language plpgsql security invoker set search_path='' as $$
declare r app.join_requests;
begin
  select * into r from app.join_requests where id=p_request and session_id=p_session for update;
  if not found or r.user_id<>p_actor then raise insufficient_privilege using message='session_unavailable'; end if;
  if r.state<>'pending' then raise sqlstate 'P0001' using message='request_not_pending'; end if;
  return r;
end;
$$;

create function api.cancel_join_request(p_actor_id uuid,p_key uuid,p_slug uuid,p_request_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s app.sessions; r app.join_requests; receipt app.operation_receipts; payload jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text||p_key::text,0));
  s:=app.lock_registration_session(p_slug);
  payload:=jsonb_build_object('slug',p_slug,'requestId',p_request_id);
  select * into receipt from app.operation_receipts where actor_id=p_actor_id and request_key=p_key;
  if found then
    if receipt.action<>'cancel_join_request' or receipt.payload<>payload then raise sqlstate 'P0001' using message='idempotency_conflict'; end if;
    return jsonb_build_object('registration',app.registration_view(p_actor_id,s.id),'operationKey',p_key);
  end if;
  r:=app.own_pending_request(p_actor_id,s.id,p_request_id);
  update app.join_requests set state='cancelled',decided_at=clock_timestamp(),decided_by=p_actor_id where id=r.id;
  insert into app.operation_receipts values(p_actor_id,p_key,'cancel_join_request',payload,r.id,now());
  return jsonb_build_object('registration',app.registration_view(p_actor_id,s.id),'operationKey',p_key);
end;
$$;

-- "Keep my request": consent to the current terms after a material change.
-- The request keeps its place in the list (its original asked-at time).
create function api.keep_join_request(p_actor_id uuid,p_key uuid,p_slug uuid,p_request_id uuid,p_version integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s app.sessions; r app.join_requests; receipt app.operation_receipts; payload jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text||p_key::text,0));
  s:=app.lock_registration_session(p_slug);
  payload:=jsonb_build_object('slug',p_slug,'requestId',p_request_id,'version',p_version);
  select * into receipt from app.operation_receipts where actor_id=p_actor_id and request_key=p_key;
  if found then
    if receipt.action<>'keep_join_request' or receipt.payload<>payload then raise sqlstate 'P0001' using message='idempotency_conflict'; end if;
    return jsonb_build_object('registration',app.registration_view(p_actor_id,s.id),'operationKey',p_key);
  end if;
  r:=app.own_pending_request(p_actor_id,s.id,p_request_id);
  if s.state<>'published' or clock_timestamp()>=(s.details->>'startsAt')::timestamptz then raise sqlstate 'P0001' using message='registration_closed'; end if;
  if p_version is distinct from s.version then raise sqlstate 'P0001' using message='stale_terms'; end if;
  update app.join_requests set consent_version=s.version,consent_at=clock_timestamp() where id=r.id;
  insert into app.operation_receipts values(p_actor_id,p_key,'keep_join_request',payload,r.id,now());
  return jsonb_build_object('registration',app.registration_view(p_actor_id,s.id),'operationKey',p_key);
end;
$$;

-- A manager's lock on one pending request in an open session.
create function app.answerable_request(p_actor uuid,p_session app.sessions,p_request uuid) returns app.join_requests
language plpgsql security invoker set search_path='' as $$
declare r app.join_requests;
begin
  if not app.is_session_manager(p_actor,p_session.group_id) then raise insufficient_privilege using message='group_access_denied'; end if;
  select * into r from app.join_requests where id=p_request and session_id=p_session.id for update;
  if not found or r.state<>'pending' then raise sqlstate 'P0001' using message='request_not_pending'; end if;
  if p_session.state<>'published' or clock_timestamp()>=(p_session.details->>'startsAt')::timestamptz then
    raise sqlstate 'P0001' using message='registration_closed'; end if;
  return r;
end;
$$;

-- What Accept did, for the organizer's confirmation line.
create function app.accepted_result(p_request uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('name',r.primary_name,'state',p.state,
    'queuePosition',case when p.state='waitlisted' then (select count(*) from app.parties w
      where w.session_id=p.session_id and w.state='waitlisted' and w.queue_sequence<=p.queue_sequence) end)
  from app.join_requests r left join app.parties p on p.id=r.party_id where r.id=p_request;
$$;

create function api.accept_join_request(p_actor_id uuid,p_actor_name text,p_key uuid,p_slug uuid,p_request_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s app.sessions; r app.join_requests; p app.parties; receipt app.operation_receipts; payload jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text||p_key::text,0));
  s:=app.lock_registration_session(p_slug);
  payload:=jsonb_build_object('slug',p_slug,'requestId',p_request_id);
  select * into receipt from app.operation_receipts where actor_id=p_actor_id and request_key=p_key;
  if found then
    if receipt.action<>'accept_join_request' or receipt.payload<>payload then raise sqlstate 'P0001' using message='idempotency_conflict'; end if;
    return jsonb_build_object('registration',app.registration_view(p_actor_id,s.id),'operationKey',p_key,
      'accepted',app.accepted_result(p_request_id));
  end if;
  r:=app.answerable_request(p_actor_id,s,p_request_id);
  if app.request_needs_confirm(r) then raise sqlstate 'P0001' using message='request_needs_confirm'; end if;
  select * into p from app.parties where session_id=s.id and user_id=r.user_id and state in ('confirmed','waitlisted');
  if not found then
    if r.seats=2 and not (s.details->>'guests')::boolean then raise check_violation using message='guest_disabled'; end if;
    if r.seats>(s.details->>'capacity')::integer then raise check_violation using message='party_too_large'; end if;
    p:=app.admit_party(s.id,r.user_id,r.primary_name,r.guest_name,r.seats,r.consent_version,true);
  end if;
  update app.join_requests set state='accepted',decided_at=clock_timestamp(),decided_by=p_actor_id,
    decided_by_name=p_actor_name,party_id=p.id where id=r.id;
  insert into app.operation_receipts values(p_actor_id,p_key,'accept_join_request',payload,r.id,now());
  return jsonb_build_object('registration',app.registration_view(p_actor_id,s.id),'operationKey',p_key,
    'accepted',app.accepted_result(r.id));
end;
$$;

create function api.decline_join_request(p_actor_id uuid,p_actor_name text,p_key uuid,p_slug uuid,p_request_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s app.sessions; r app.join_requests; receipt app.operation_receipts; payload jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text||p_key::text,0));
  s:=app.lock_registration_session(p_slug);
  payload:=jsonb_build_object('slug',p_slug,'requestId',p_request_id);
  select * into receipt from app.operation_receipts where actor_id=p_actor_id and request_key=p_key;
  if found then
    if receipt.action<>'decline_join_request' or receipt.payload<>payload then raise sqlstate 'P0001' using message='idempotency_conflict'; end if;
    return jsonb_build_object('registration',app.registration_view(p_actor_id,s.id),'operationKey',p_key);
  end if;
  r:=app.answerable_request(p_actor_id,s,p_request_id);
  update app.join_requests set state='declined',decided_at=clock_timestamp(),decided_by=p_actor_id,decided_by_name=p_actor_name where id=r.id;
  insert into app.operation_receipts values(p_actor_id,p_key,'decline_join_request',payload,r.id,now());
  return jsonb_build_object('registration',app.registration_view(p_actor_id,s.id),'operationKey',p_key);
end;
$$;

-- "Decline the rest": every request still waiting, in one decision. A replay
-- reports the same count from the rows this decision stamped.
create function api.decline_pending_requests(p_actor_id uuid,p_actor_name text,p_key uuid,p_slug uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s app.sessions; receipt app.operation_receipts; payload jsonb; now_at timestamptz; n integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text||p_key::text,0));
  s:=app.lock_registration_session(p_slug);
  payload:=jsonb_build_object('slug',p_slug);
  select * into receipt from app.operation_receipts where actor_id=p_actor_id and request_key=p_key;
  if found then
    if receipt.action<>'decline_pending_requests' or receipt.payload<>payload then raise sqlstate 'P0001' using message='idempotency_conflict'; end if;
    select count(*) into n from app.join_requests where session_id=s.id and state='declined'
      and decided_by=p_actor_id and decided_at=receipt.created_at;
    return jsonb_build_object('registration',app.registration_view(p_actor_id,s.id),'operationKey',p_key,'declined',n);
  end if;
  if not app.is_session_manager(p_actor_id,s.group_id) then raise insufficient_privilege using message='group_access_denied'; end if;
  now_at:=clock_timestamp();
  if s.state<>'published' or now_at>=(s.details->>'startsAt')::timestamptz then raise sqlstate 'P0001' using message='registration_closed'; end if;
  update app.join_requests set state='declined',decided_at=now_at,decided_by=p_actor_id,decided_by_name=p_actor_name
    where session_id=s.id and state='pending';
  get diagnostics n=row_count;
  insert into app.operation_receipts values(p_actor_id,p_key,'decline_pending_requests',payload,s.id,now_at);
  return jsonb_build_object('registration',app.registration_view(p_actor_id,s.id),'operationKey',p_key,'declined',n);
end;
$$;

revoke all on function app.is_session_manager(uuid,uuid),app.request_needs_confirm(app.join_requests),
  app.lock_registration_session(uuid),app.admit_party(uuid,uuid,text,text,integer,integer,boolean),
  app.own_pending_request(uuid,uuid,uuid),app.answerable_request(uuid,app.sessions,uuid),app.accepted_result(uuid),
  api.join_session(uuid,uuid,uuid,integer,integer,text,text,boolean),
  api.ask_to_join(uuid,uuid,uuid,integer,integer,text,text,boolean),api.cancel_join_request(uuid,uuid,uuid,uuid),
  api.keep_join_request(uuid,uuid,uuid,uuid,integer),api.accept_join_request(uuid,text,uuid,uuid,uuid),
  api.decline_join_request(uuid,text,uuid,uuid,uuid),api.decline_pending_requests(uuid,text,uuid,uuid)
  from public,anon,authenticated;
grant execute on function app.is_session_manager(uuid,uuid),app.request_needs_confirm(app.join_requests),
  app.lock_registration_session(uuid),app.admit_party(uuid,uuid,text,text,integer,integer,boolean),
  app.own_pending_request(uuid,uuid,uuid),app.answerable_request(uuid,app.sessions,uuid),app.accepted_result(uuid),
  api.join_session(uuid,uuid,uuid,integer,integer,text,text,boolean),
  api.ask_to_join(uuid,uuid,uuid,integer,integer,text,text,boolean),api.cancel_join_request(uuid,uuid,uuid,uuid),
  api.keep_join_request(uuid,uuid,uuid,uuid,integer),api.accept_join_request(uuid,text,uuid,uuid,uuid),
  api.decline_join_request(uuid,text,uuid,uuid,uuid),api.decline_pending_requests(uuid,text,uuid,uuid)
  to service_role;
