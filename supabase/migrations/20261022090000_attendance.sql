-- Organizer/co-host attendance per confirmed seat (1 = primary, 2 = guest).
-- A missing row means unrecorded; nothing ever becomes a no-show by itself.
-- Attendance never reads or writes seats, the queue or fee/payment records.
create table app.seat_attendance (
  party_id uuid not null references app.parties(id),
  seat smallint not null check (seat in (1,2)),
  state text not null check (state in ('unrecorded','checked_in','no_show')),
  -- Writers name the revision they saw (0 when unrecorded and never changed).
  revision integer not null check (revision>0),
  changed_at timestamptz not null,
  changed_by uuid not null references auth.users(id),
  primary key (party_id,seat)
);
create table app.attendance_changes (
  party_id uuid not null,
  seat smallint not null,
  revision integer not null,
  state text not null check (state in ('unrecorded','checked_in','no_show')),
  actor_id uuid not null references auth.users(id),
  -- Display name captured at the time; managers only.
  actor_name text not null check (length(actor_name) between 1 and 80),
  created_at timestamptz not null,
  primary key (party_id,seat,revision),
  foreign key (party_id,seat) references app.seat_attendance(party_id,seat)
);
alter table app.seat_attendance enable row level security;
alter table app.attendance_changes enable row level security;
revoke all on app.seat_attendance,app.attendance_changes from public,anon,authenticated;
grant select,insert,update on app.seat_attendance to service_role;
grant select,insert on app.attendance_changes to service_role;

-- Managers only: each seat of a confirmed party with its state and last change.
create function app.managed_attendance(p_party uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('seat',n.seat,'state',coalesce(a.state,'unrecorded'),'revision',coalesce(a.revision,0),
    'by',c.actor_name,'at',a.changed_at) order by n.seat),'[]'::jsonb)
  from app.parties p cross join lateral generate_series(1,p.seats) n(seat)
  left join app.seat_attendance a on a.party_id=p.id and a.seat=n.seat
  left join app.attendance_changes c on c.party_id=a.party_id and c.seat=a.seat and c.revision=a.revision
  where p.id=p_party and p.state='confirmed';
$$;
create or replace function app.registration_view(p_actor uuid,p_session uuid,p_party uuid default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare own app.parties; manager boolean; roster jsonb; own_json jsonb;
begin
  select * into own from app.parties where session_id=p_session and user_id=p_actor
    and (p_party is null or id=p_party) order by (state in ('confirmed','waitlisted')) desc,queue_sequence desc limit 1;
  select exists(select 1 from app.group_roles r join app.sessions s on s.group_id=r.group_id
    where s.id=p_session and r.user_id=p_actor and r.role in ('owner','organizer','cohost')) into manager;
  if own.id is not null then
    own_json:=jsonb_build_object('id',own.id,'state',own.state,'seats',own.seats,'primaryName',own.primary_name,'guestName',own.guest_name,
      'consentVersion',own.consent_version,'withdrawnAt',own.withdrawn_at,'queuePosition',case when own.state='waitlisted' then
        (select count(*)+1 from app.parties where session_id=p_session and state='waitlisted' and queue_sequence<own.queue_sequence) else null end,
      'fee',app.party_fee(own.id));
  end if;
  if manager or own.state='confirmed' then
    select coalesce(jsonb_agg(
      case when manager then jsonb_build_object('id',p.id,'primaryName',p.primary_name,'guestName',p.guest_name,'seats',p.seats,'state',p.state,
        'fee',app.managed_fee(p.id),'attendance',app.managed_attendance(p.id))
      else jsonb_build_object('primaryName',p.primary_name,'guestName',p.guest_name,'seats',p.seats) end order by p.queue_sequence),'[]'::jsonb)
      into roster from app.parties p where p.session_id=p_session and (manager or p.state='confirmed');
  end if;
  return jsonb_build_object('own',own_json,'canManage',manager,'rosterAllowed',manager or coalesce(own.state='confirmed',false),
    'roster',coalesce(roster,'[]'::jsonb),'counts',app.registration_counts(p_session));
end;
$$;

create function api.record_attendance(p_actor_id uuid,p_actor_name text,p_key uuid,p_slug uuid,p_party_id uuid,p_seat integer,p_state text,p_revision integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s app.sessions; p app.parties; a app.seat_attendance; receipt app.operation_receipts; payload jsonb; now_at timestamptz; next_revision integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text||p_key::text,0));
  select * into s from app.sessions where slug=p_slug;
  if not found then raise insufficient_privilege using message='group_access_denied'; end if;
  -- Current role checked under the group lock; a revoked co-host is refused even on replay.
  perform app.require_manager(p_actor_id,s.group_id);
  select * into s from app.sessions where id=s.id for update;
  payload:=jsonb_build_object('slug',p_slug,'partyId',p_party_id,'seat',p_seat,'state',p_state,'revision',p_revision);
  select * into receipt from app.operation_receipts where actor_id=p_actor_id and request_key=p_key;
  if found then
    if receipt.action<>'record_attendance' or receipt.payload<>payload then raise sqlstate 'P0001' using message='idempotency_conflict'; end if;
    return jsonb_build_object('registration',app.registration_view(p_actor_id,s.id),'operationKey',p_key);
  end if;
  if p_state not in ('unrecorded','checked_in','no_show') or length(trim(p_actor_name)) not between 1 and 80 then
    raise check_violation using message='invalid_attendance';
  end if;
  -- Lock the party so a withdrawal cannot cross this write.
  select * into p from app.parties where id=p_party_id and session_id=s.id for update;
  if not found or p_seat not between 1 and p.seats then raise sqlstate 'P0001' using message='seat_not_found'; end if;
  if p.state<>'confirmed' or s.state not in ('published','completed') then raise sqlstate 'P0001' using message='attendance_not_eligible'; end if;
  select * into a from app.seat_attendance where party_id=p.id and seat=p_seat for update;
  if coalesce(a.revision,0)<>p_revision then raise sqlstate 'P0001' using message='stale_attendance'; end if;
  if coalesce(a.state,'unrecorded')=p_state then raise sqlstate 'P0001' using message='attendance_unchanged'; end if;
  now_at:=clock_timestamp();
  if p_state='no_show' and now_at<(s.details->>'endsAt')::timestamptz then raise sqlstate 'P0001' using message='no_show_too_early'; end if;
  insert into app.seat_attendance(party_id,seat,state,revision,changed_at,changed_by) values(p.id,p_seat,p_state,1,now_at,p_actor_id)
    on conflict (party_id,seat) do update set state=excluded.state,revision=app.seat_attendance.revision+1,changed_at=now_at,changed_by=p_actor_id
    returning revision into next_revision;
  insert into app.attendance_changes values(p.id,p_seat,next_revision,p_state,p_actor_id,trim(p_actor_name),now_at);
  insert into app.operation_receipts values(p_actor_id,p_key,'record_attendance',payload,p.id,now_at);
  return jsonb_build_object('registration',app.registration_view(p_actor_id,s.id),'operationKey',p_key);
end;
$$;

create or replace function api.read_operation(p_actor_id uuid,p_key uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r app.operation_receipts; s app.sessions; p app.parties;
begin
  select * into r from app.operation_receipts where actor_id=p_actor_id and request_key=p_key;
  if not found then return null; end if;
  if r.action in ('join_session','withdraw_party') then
    select * into p from app.parties where id=r.resource_id and user_id=p_actor_id;
    select * into s from app.sessions where id=p.session_id;
    perform 1 from app.groups where id=s.group_id for share;
    perform 1 from app.sessions where id=s.id for share;
    return jsonb_build_object('operationKey',p_key,'registration',app.registration_view(p_actor_id,s.id,p.id));
  elsif r.action in ('update_payment','record_attendance') then
    select * into p from app.parties where id=r.resource_id;
    select * into s from app.sessions where id=p.session_id;
    perform app.require_manager(p_actor_id,s.group_id);
    perform 1 from app.sessions where id=s.id for share;
    return jsonb_build_object('operationKey',p_key,'registration',app.registration_view(p_actor_id,s.id));
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
revoke all on function app.managed_attendance(uuid),api.record_attendance(uuid,text,uuid,uuid,uuid,integer,text,integer) from public,anon,authenticated;
grant execute on function app.managed_attendance(uuid),api.record_attendance(uuid,text,uuid,uuid,uuid,integer,text,integer) to service_role;
