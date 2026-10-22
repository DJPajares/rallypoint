-- Financial liability and manual payment declarations are independent of seats.
-- Keep the original allocation even when a pre-cutoff unpaid obligation ends.
alter table app.parties add column withdrawn_at timestamptz;
alter table app.fee_obligations
  add column liability_state text not null default 'due' check(liability_state in ('due','removed_before_cutoff')),
  add column removed_at timestamptz,
  add column removed_by uuid references auth.users(id),
  add column marked_paid boolean not null default false,
  add column payment_marked_at timestamptz,
  add column payment_marked_by uuid references auth.users(id),
  add constraint liability_removal_audit check (
    (liability_state='due' and removed_at is null and removed_by is null) or
    (liability_state='removed_before_cutoff' and removed_at is not null and removed_by is not null)),
  add constraint payment_marker_audit check (
    (payment_marked_at is null)=(payment_marked_by is null) and
    (not marked_paid or payment_marked_at is not null));
-- P-05 owns marker corrections/waivers and their write operations. P-04 has no
-- grants to change marker columns, no payment endpoint and no refund operation.
grant update(liability_state,removed_at,removed_by) on app.fee_obligations to service_role;
alter table app.registration_events drop constraint registration_events_kind_check;
alter table app.registration_events add constraint registration_events_kind_check
  check(kind in ('confirmed','waitlisted','promoted','withdrawn'));

-- Caller holds group then session lock and passes its post-lock server instant.
-- A separate financial transition makes the exact-cutoff policy reproducible
-- without accepting a browser-supplied clock or changing live clock functions.
create function app.release_withdrawal_fee(p_party uuid,p_actor uuid,p_at timestamptz,p_cutoff timestamptz) returns void
language sql security invoker set search_path='' as $$
  update app.fee_obligations set liability_state='removed_before_cutoff',removed_at=p_at,removed_by=p_actor
  where party_id=p_party and liability_state='due' and not marked_paid and p_at<p_cutoff;
$$;
create function app.party_fee(p_party uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('unitMinor',unit_minor,'chargedSeats',charged_seats,'currency',currency,
    'totalMinor',total_minor,'liabilityState',liability_state,'removedAt',removed_at,'markedPaid',marked_paid)
  from app.fee_obligations where party_id=p_party;
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
        'fee',app.party_fee(p.id))
      else jsonb_build_object('primaryName',p.primary_name,'guestName',p.guest_name,'seats',p.seats) end order by p.queue_sequence),'[]'::jsonb)
      into roster from app.parties p where p.session_id=p_session and (manager or p.state='confirmed');
  end if;
  return jsonb_build_object('own',own_json,'canManage',manager,'rosterAllowed',manager or coalesce(own.state='confirmed',false),
    'roster',coalesce(roster,'[]'::jsonb),'counts',app.registration_counts(p_session));
end;
$$;
create function api.withdraw_party(p_actor_id uuid,p_key uuid,p_slug uuid,p_party_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s app.sessions; p app.parties; receipt app.operation_receipts; payload jsonb; now_at timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text||p_key::text,0));
  select * into s from app.sessions where slug=p_slug;
  if not found then raise insufficient_privilege using message='session_unavailable'; end if;
  perform 1 from app.groups where id=s.group_id for update;
  select * into s from app.sessions where slug=p_slug for update;
  payload:=jsonb_build_object('slug',p_slug,'partyId',p_party_id);
  select * into receipt from app.operation_receipts where actor_id=p_actor_id and request_key=p_key;
  if found then
    if receipt.action<>'withdraw_party' or receipt.payload<>payload then raise sqlstate 'P0001' using message='idempotency_conflict'; end if;
    return jsonb_build_object('registration',app.registration_view(p_actor_id,s.id,receipt.resource_id),'operationKey',p_key);
  end if;
  select * into p from app.parties where id=p_party_id and session_id=s.id and user_id=p_actor_id;
  if not found or s.state='draft' then raise insufficient_privilege using message='session_unavailable'; end if;
  now_at:=clock_timestamp();
  if s.state<>'published' or now_at>=(s.details->>'startsAt')::timestamptz then raise sqlstate 'P0001' using message='withdrawal_closed'; end if;
  if p.state in ('confirmed','waitlisted') then
    update app.parties set state='withdrawn',withdrawn_at=now_at where id=p.id;
    perform app.release_withdrawal_fee(p.id,p_actor_id,now_at,(s.details->>'cutoffAt')::timestamptz);
    insert into app.registration_events(party_id,kind,created_at) values(p.id,'withdrawn',now_at);
    -- Withdrawn/removed parties are no longer candidates. Never bypass a head
    -- party; fees/promotions/signals either all commit or all roll back.
    perform app.fill_waitlist(s.id);
  end if;
  insert into app.operation_receipts values(p_actor_id,p_key,'withdraw_party',payload,p.id,now_at);
  return jsonb_build_object('registration',app.registration_view(p_actor_id,s.id,p.id),'operationKey',p_key);
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
revoke all on function app.release_withdrawal_fee(uuid,uuid,timestamptz,timestamptz),app.party_fee(uuid),api.withdraw_party(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function app.release_withdrawal_fee(uuid,uuid,timestamptz,timestamptz),app.party_fee(uuid),api.withdraw_party(uuid,uuid,uuid,uuid) to service_role;
