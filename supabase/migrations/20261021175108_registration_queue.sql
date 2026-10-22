alter table app.sessions drop constraint sessions_state_check;
alter table app.sessions add constraint sessions_state_check check(state in ('draft','published','cancelled','completed'));
alter table app.sessions add column next_party_sequence bigint not null default 0;
create table app.parties (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references app.sessions(id),
  user_id uuid not null references auth.users(id),
  primary_name text not null check(length(primary_name) between 1 and 80),
  guest_name text not null default '' check(length(guest_name)<=80),
  seats integer not null check(seats in (1,2)),
  state text not null check(state in ('confirmed','waitlisted','withdrawn','removed')),
  queue_sequence bigint not null,
  consent_version integer not null,
  consent_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique(session_id,queue_sequence)
);
create unique index one_active_party on app.parties(session_id,user_id) where state in ('confirmed','waitlisted');
create index parties_by_actor on app.parties(user_id,session_id);
create index party_queue on app.parties(session_id,state,queue_sequence);
create table app.fee_obligations (
  party_id uuid primary key references app.parties(id),
  unit_minor bigint not null check(unit_minor>=0),
  charged_seats integer not null check(charged_seats in (1,2)),
  currency text not null check(currency in ('SGD','USD','EUR','GBP','JPY','KWD')),
  total_minor bigint generated always as (unit_minor * charged_seats) stored check(total_minor<=9007199254740991),
  created_at timestamptz not null default now()
);
create table app.registration_events (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references app.parties(id),
  kind text not null check(kind in ('confirmed','waitlisted','promoted')),
  created_at timestamptz not null default now(),
  unique(party_id,kind)
);
alter table app.parties enable row level security;
alter table app.fee_obligations enable row level security;
alter table app.registration_events enable row level security;
revoke all on app.parties,app.fee_obligations,app.registration_events from public,anon,authenticated;
grant select,insert,update on app.parties to service_role;
grant select,insert on app.fee_obligations,app.registration_events to service_role;

-- Protect future terminal lifecycle transitions and the accepted booked-edit boundary.
create function app.guard_booked_session() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if old.state in ('cancelled','completed') and (new.state<>old.state or new.details<>old.details) then
    raise sqlstate 'P0001' using message='session_closed';
  end if;
  if old.bookings_started_at is not null and (new.bookings_started_at is null or new.details<>old.details) then
    raise sqlstate 'P0001' using message='booked_event_locked';
  end if;
  return new;
end;
$$;
create trigger protect_booked_session before update on app.sessions for each row execute function app.guard_booked_session();

create function app.registration_counts(p_session uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('confirmedSeats',coalesce(sum(seats) filter(where state='confirmed'),0),
    'waitingParties',count(*) filter(where state='waitlisted')) from app.parties where session_id=p_session;
$$;
-- Caller holds group then session lock. All queue/fee transitions use this boundary.
create function app.fill_waitlist(p_session uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare s app.sessions; head app.parties; occupied bigint;
begin
  select * into s from app.sessions where id=p_session;
  perform 1 from app.groups where id=s.group_id for update;
  select * into s from app.sessions where id=p_session for update;
  if s.state<>'published' or clock_timestamp()>=(s.details->>'startsAt')::timestamptz then return; end if;
  select coalesce(sum(seats),0) into occupied from app.parties where session_id=p_session and state='confirmed';
  loop
    select * into head from app.parties where session_id=p_session and state='waitlisted' order by queue_sequence limit 1;
    exit when not found or occupied+head.seats>(s.details->>'capacity')::integer;
    exit when clock_timestamp()>=(s.details->>'startsAt')::timestamptz;
    update app.parties set state='confirmed' where id=head.id;
    insert into app.fee_obligations(party_id,unit_minor,charged_seats,currency) values(head.id,(s.details->>'feeMinor')::bigint,head.seats,s.details->>'currency');
    insert into app.registration_events(party_id,kind) values(head.id,'promoted');
    occupied:=occupied+head.seats;
  end loop;
end;
$$;
create function app.registration_view(p_actor uuid,p_session uuid,p_party uuid default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare own app.parties; manager boolean; roster jsonb; own_json jsonb;
begin
  select * into own from app.parties where session_id=p_session and user_id=p_actor
    and (p_party is null or id=p_party) order by (state in ('confirmed','waitlisted')) desc,queue_sequence desc limit 1;
  select exists(select 1 from app.group_roles r join app.sessions s on s.group_id=r.group_id
    where s.id=p_session and r.user_id=p_actor and r.role in ('owner','organizer','cohost')) into manager;
  if own.id is not null then
    own_json:=jsonb_build_object('id',own.id,'state',own.state,'seats',own.seats,'primaryName',own.primary_name,'guestName',own.guest_name,
      'consentVersion',own.consent_version,'queuePosition',case when own.state='waitlisted' then
        (select count(*)+1 from app.parties where session_id=p_session and state='waitlisted' and queue_sequence<own.queue_sequence) else null end,
      'fee',(select jsonb_build_object('unitMinor',unit_minor,'chargedSeats',charged_seats,'currency',currency,'totalMinor',total_minor) from app.fee_obligations where party_id=own.id));
  end if;
  if manager or own.state='confirmed' then
    select coalesce(jsonb_agg(
      case when manager then jsonb_build_object('id',p.id,'primaryName',p.primary_name,'guestName',p.guest_name,'seats',p.seats,'state',p.state,
        'fee',(select jsonb_build_object('currency',currency,'totalMinor',total_minor) from app.fee_obligations where party_id=p.id))
      else jsonb_build_object('primaryName',p.primary_name,'guestName',p.guest_name,'seats',p.seats) end order by p.queue_sequence),'[]'::jsonb)
      into roster from app.parties p where p.session_id=p_session and (manager or p.state='confirmed');
  end if;
  return jsonb_build_object('own',own_json,'canManage',manager,'rosterAllowed',manager or coalesce(own.state='confirmed',false),
    'roster',coalesce(roster,'[]'::jsonb),'counts',app.registration_counts(p_session));
end;
$$;
create function api.join_session(p_actor_id uuid,p_key uuid,p_slug uuid,p_version integer,p_seats integer,p_guest_name text,p_primary_name text,p_consent boolean) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s app.sessions; p app.parties; receipt app.operation_receipts; payload jsonb; occupied bigint; result_state text; now_at timestamptz;
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
  now_at:=clock_timestamp();
  if s.state<>'published' or now_at>=(s.details->>'startsAt')::timestamptz then raise sqlstate 'P0001' using message='registration_closed'; end if;
  if now_at<(s.details->>'opensAt')::timestamptz then raise sqlstate 'P0001' using message='registration_not_open'; end if;
  if p_version is distinct from s.version then raise sqlstate 'P0001' using message='stale_terms'; end if;
  if p_seats=2 and not (s.details->>'guests')::boolean then raise check_violation using message='guest_disabled'; end if;
  if p_seats>(s.details->>'capacity')::integer then raise check_violation using message='party_too_large'; end if;
  if (s.details->>'feeMinor')::numeric*p_seats>9007199254740991 then raise check_violation using message='fee_out_of_range'; end if;
  perform app.fill_waitlist(s.id);
  -- Recheck time immediately before accepting this new party, after queue work.
  if clock_timestamp()>=(s.details->>'startsAt')::timestamptz then raise sqlstate 'P0001' using message='registration_closed'; end if;
  select coalesce(sum(seats),0) into occupied from app.parties where session_id=s.id and state='confirmed';
  result_state:=case when not exists(select 1 from app.parties where session_id=s.id and state='waitlisted')
    and occupied+p_seats<=(s.details->>'capacity')::integer then 'confirmed' else 'waitlisted' end;
  update app.sessions set next_party_sequence=next_party_sequence+1,bookings_started_at=coalesce(bookings_started_at,clock_timestamp()) where id=s.id returning * into s;
  insert into app.parties(session_id,user_id,primary_name,guest_name,seats,state,queue_sequence,consent_version,consent_at)
    values(s.id,p_actor_id,p_primary_name,case when p_seats=2 then p_guest_name else '' end,p_seats,result_state,s.next_party_sequence,s.version,clock_timestamp()) returning * into p;
  if result_state='confirmed' then
    insert into app.fee_obligations(party_id,unit_minor,charged_seats,currency) values(p.id,(s.details->>'feeMinor')::bigint,p.seats,s.details->>'currency');
  end if;
  insert into app.registration_events(party_id,kind) values(p.id,result_state);
  insert into app.operation_receipts values(p_actor_id,p_key,'join_session',payload,p.id,now());
  return jsonb_build_object('registration',app.registration_view(p_actor_id,s.id,p.id),'operationKey',p_key);
end;
$$;
create function api.read_registration(p_actor_id uuid,p_slug uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s app.sessions;
begin
  select * into s from app.sessions where slug=p_slug;
  if not found then raise insufficient_privilege using message='session_unavailable'; end if;
  perform 1 from app.groups where id=s.group_id for share;
  select * into s from app.sessions where slug=p_slug for share;
  if s.state='draft' then raise insufficient_privilege using message='session_unavailable'; end if;
  return app.registration_view(p_actor_id,s.id);
end;
$$;
create or replace function api.read_shared_session(p_slug uuid) returns jsonb
language sql volatile security invoker set search_path='' as $$
  select jsonb_build_object('slug',s.slug,'groupName',g.name,'version',s.version,'state',s.state,'details',s.details,
    'counts',app.registration_counts(s.id),'registrationWindow',case when s.state<>'published' or clock_timestamp()>=(s.details->>'startsAt')::timestamptz then 'closed'
      when clock_timestamp()<(s.details->>'opensAt')::timestamptz then 'not_open' else 'open' end)
  from app.sessions s join app.groups g on g.id=s.group_id where s.slug=p_slug and s.state in ('published','completed','cancelled');
$$;
create or replace function api.read_operation(p_actor_id uuid,p_key uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r app.operation_receipts; s app.sessions; p app.parties;
begin
  select * into r from app.operation_receipts where actor_id=p_actor_id and request_key=p_key;
  if not found then return null; end if;
  if r.action='join_session' then
    select * into p from app.parties where id=r.resource_id and user_id=p_actor_id;
    select * into s from app.sessions where id=p.session_id;
    perform 1 from app.groups where id=s.group_id for share;
    perform 1 from app.sessions where id=s.id for share;
    return jsonb_build_object('operationKey',p_key,'registration',app.registration_view(p_actor_id,s.id,p.id));
  elsif r.action='save_session' then
    select * into s from app.sessions where id=r.resource_id;
    perform app.require_manager(p_actor_id,s.group_id);
    select * into s from app.sessions where id=r.resource_id;
    return jsonb_build_object('operationKey',p_key,'session',app.session_view(s));
  end if;
  perform app.require_manager(p_actor_id,r.resource_id);
  return jsonb_build_object('operationKey',p_key,'groupId',r.resource_id);
end;
$$;
revoke all on all functions in schema app from public,anon,authenticated;
grant execute on function app.guard_booked_session(),app.registration_counts(uuid),app.fill_waitlist(uuid),app.registration_view(uuid,uuid,uuid) to service_role;
revoke all on function api.join_session(uuid,uuid,uuid,integer,integer,text,text,boolean),api.read_registration(uuid,uuid) from public,anon,authenticated;
grant execute on function api.join_session(uuid,uuid,uuid,integer,integer,text,text,boolean),api.read_registration(uuid,uuid) to service_role;

-- Terminal sessions cannot be republished through the existing save operation.
create or replace function api.save_session(p_actor_id uuid,p_key uuid,p_group_id uuid,p_session_id uuid,p_intent text,p_version integer,p_details jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare s app.sessions; receipt app.operation_receipts; payload jsonb;
  changed jsonb; published boolean;
begin
  if p_intent not in ('draft','publish','update') then raise check_violation using message='invalid_input'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text || p_key::text,0));
  perform app.require_manager(p_actor_id,p_group_id);
  payload := jsonb_build_object('groupId',p_group_id,'sessionId',p_session_id,'intent',p_intent,'version',p_version,'details',p_details);
  select * into receipt from app.operation_receipts where actor_id=p_actor_id and request_key=p_key;
  if found then
    if receipt.action <> 'save_session' or receipt.payload <> payload then raise sqlstate 'P0001' using message='idempotency_conflict'; end if;
    select * into s from app.sessions where id=receipt.resource_id;
    return jsonb_build_object('session',app.session_view(s),'operationKey',p_key);
  end if;
  if p_session_id is not null then
    select * into s from app.sessions where id=p_session_id and group_id=p_group_id for update;
    if not found then raise insufficient_privilege using message='group_access_denied'; end if;
    if s.state in ('cancelled','completed') then raise sqlstate 'P0001' using message='session_closed'; end if;
    if p_version is distinct from s.version then raise sqlstate 'P0001' using message='stale_version'; end if;
    if s.bookings_started_at is not null and s.details <> p_details then raise sqlstate 'P0001' using message='booked_event_locked'; end if;
    if s.state='published' and p_intent <> 'update' then raise sqlstate 'P0001' using message='already_published'; end if;
    if s.state='draft' and p_intent='update' then raise check_violation using message='invalid_input'; end if;
  elsif p_intent='update' then raise check_violation using message='invalid_input';
  end if;
  published := p_intent in ('publish','update');
  if published then
    if coalesce(length(trim(p_details->>'title')),0) not between 1 and 120
      or coalesce(length(trim(p_details->>'activity')),0) not between 1 and 80
      or coalesce(length(trim(p_details->>'location')),0) not between 1 and 300
      or coalesce((p_details->>'capacity')::bigint,0) not between 1 and 2147483647
      or not coalesce((p_details->>'endsAt')::timestamptz > (p_details->>'startsAt')::timestamptz,false)
      or not coalesce((p_details->>'opensAt')::timestamptz < (p_details->>'startsAt')::timestamptz,false)
      or not coalesce((p_details->>'cutoffAt')::timestamptz between (p_details->>'opensAt')::timestamptz and (p_details->>'startsAt')::timestamptz,false)
      or coalesce(p_details->>'currency','') not in ('SGD','USD','EUR','GBP','JPY','KWD')
      or coalesce((p_details->>'feeMinor')::numeric,-1) not between 0 and 9007199254740991
      or (p_details->>'feeMinor')::numeric <> trunc((p_details->>'feeMinor')::numeric)
    then raise check_violation using message='invalid_input'; end if;
  end if;
  if p_session_id is null then
    insert into app.sessions(group_id,state,details) values(p_group_id,case when published then 'published' else 'draft' end,p_details) returning * into s;
  elsif s.details <> p_details or (p_intent='publish' and s.state='draft') then
    select coalesce(jsonb_agg(key),'[]'::jsonb) into changed from jsonb_object_keys(p_details) key where s.details->key is distinct from p_details->key;
    update app.sessions set details=p_details,state=case when published then 'published' else 'draft' end,version=version+1,updated_at=clock_timestamp() where id=s.id returning * into s;
    if p_intent='update' then insert into app.session_changes values(s.id,s.version,p_actor_id,changed,now()); end if;
  end if;
  insert into app.operation_receipts values(p_actor_id,p_key,'save_session',payload,s.id,now());
  return jsonb_build_object('session',app.session_view(s),'operationKey',p_key);
end;
$$;
