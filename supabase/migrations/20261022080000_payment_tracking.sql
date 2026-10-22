-- Organizer/co-host payment markers and explicit fee waivers. Both stay
-- independent of seats: nothing here reads or writes party state or the queue.
-- A marker is a manual declaration, never proof that money moved.
alter table app.fee_obligations
  drop constraint liability_removal_audit,
  drop constraint fee_obligations_liability_state_check;
alter table app.fee_obligations
  add constraint fee_obligations_liability_state_check check(liability_state in ('due','removed_before_cutoff','waived')),
  add constraint liability_removal_audit check (
    (liability_state='due' and removed_at is null and removed_by is null) or
    (liability_state<>'due' and removed_at is not null and removed_by is not null)),
  -- Nothing is owed on a removed or waived fee, so it cannot also be marked paid.
  -- Undo the marker first; a paid record is never rewritten into a waiver/refund.
  add constraint paid_requires_due check (not marked_paid or liability_state='due'),
  -- Every recorded change bumps the revision; writers must name the revision they
  -- saw, so an intervening correction is never silently overwritten.
  add column revision integer not null default 1 check (revision>0);
grant update(marked_paid,payment_marked_at,payment_marked_by,revision) on app.fee_obligations to service_role;

create table app.fee_changes (
  party_id uuid not null references app.fee_obligations(party_id),
  revision integer not null check (revision>1),
  action text not null check (action in ('marked_paid','marked_unpaid','waived','waiver_undone','removed_before_cutoff')),
  actor_id uuid not null references auth.users(id),
  -- Display name captured at the time, so organizers can see who made a change
  -- without reading the identity store.
  actor_name text not null check (length(actor_name) between 1 and 80),
  created_at timestamptz not null default now(),
  primary key (party_id,revision)
);
alter table app.fee_changes enable row level security;
revoke all on app.fee_changes from public,anon,authenticated;
grant select,insert on app.fee_changes to service_role;

create or replace function app.release_withdrawal_fee(p_party uuid,p_actor uuid,p_at timestamptz,p_cutoff timestamptz) returns void
language sql security invoker set search_path='' as $$
  with released as (
    update app.fee_obligations set liability_state='removed_before_cutoff',removed_at=p_at,removed_by=p_actor,revision=revision+1
    where party_id=p_party and liability_state='due' and not marked_paid and p_at<p_cutoff
    returning party_id,revision)
  insert into app.fee_changes(party_id,revision,action,actor_id,actor_name,created_at)
  select r.party_id,r.revision,'removed_before_cutoff',p_actor,p.primary_name,p_at
  from released r join app.parties p on p.id=r.party_id;
$$;

-- Managers see the revision to write against and the change history.
create function app.managed_fee(p_party uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select app.party_fee(f.party_id) || jsonb_build_object('revision',f.revision,'history',
    coalesce((select jsonb_agg(jsonb_build_object('action',c.action,'by',c.actor_name,'at',c.created_at) order by c.revision desc)
      from app.fee_changes c where c.party_id=f.party_id),'[]'::jsonb))
  from app.fee_obligations f where f.party_id=p_party;
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
        'fee',app.managed_fee(p.id))
      else jsonb_build_object('primaryName',p.primary_name,'guestName',p.guest_name,'seats',p.seats) end order by p.queue_sequence),'[]'::jsonb)
      into roster from app.parties p where p.session_id=p_session and (manager or p.state='confirmed');
  end if;
  return jsonb_build_object('own',own_json,'canManage',manager,'rosterAllowed',manager or coalesce(own.state='confirmed',false),
    'roster',coalesce(roster,'[]'::jsonb),'counts',app.registration_counts(p_session));
end;
$$;

create function api.update_payment(p_actor_id uuid,p_actor_name text,p_key uuid,p_slug uuid,p_party_id uuid,p_action text,p_revision integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s app.sessions; f app.fee_obligations; receipt app.operation_receipts; payload jsonb; now_at timestamptz; next_revision integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text||p_key::text,0));
  select * into s from app.sessions where slug=p_slug;
  if not found then raise insufficient_privilege using message='group_access_denied'; end if;
  -- Current role checked under the group lock; a revoked co-host is refused even on replay.
  perform app.require_manager(p_actor_id,s.group_id);
  select * into s from app.sessions where id=s.id for update;
  payload:=jsonb_build_object('slug',p_slug,'partyId',p_party_id,'action',p_action,'revision',p_revision);
  select * into receipt from app.operation_receipts where actor_id=p_actor_id and request_key=p_key;
  if found then
    if receipt.action<>'update_payment' or receipt.payload<>payload then raise sqlstate 'P0001' using message='idempotency_conflict'; end if;
    return jsonb_build_object('registration',app.registration_view(p_actor_id,s.id),'operationKey',p_key);
  end if;
  if p_action not in ('mark_paid','mark_unpaid','waive','undo_waiver') or length(trim(p_actor_name)) not between 1 and 80 then
    raise check_violation using message='invalid_payment_action';
  end if;
  select f2.* into f from app.fee_obligations f2 join app.parties p on p.id=f2.party_id
    where f2.party_id=p_party_id and p.session_id=s.id for update of f2;
  if not found then raise sqlstate 'P0001' using message='fee_not_found'; end if;
  if f.revision<>p_revision then raise sqlstate 'P0001' using message='stale_payment'; end if;
  now_at:=clock_timestamp();
  if p_action='mark_paid' and f.liability_state='due' and not f.marked_paid then
    update app.fee_obligations set marked_paid=true,payment_marked_at=now_at,payment_marked_by=p_actor_id,revision=revision+1
      where party_id=f.party_id returning revision into next_revision;
  elsif p_action='mark_unpaid' and f.marked_paid then
    update app.fee_obligations set marked_paid=false,payment_marked_at=now_at,payment_marked_by=p_actor_id,revision=revision+1
      where party_id=f.party_id returning revision into next_revision;
  elsif p_action='waive' and f.liability_state='due' and not f.marked_paid then
    update app.fee_obligations set liability_state='waived',removed_at=now_at,removed_by=p_actor_id,revision=revision+1
      where party_id=f.party_id returning revision into next_revision;
  elsif p_action='undo_waiver' and f.liability_state='waived' then
    update app.fee_obligations set liability_state='due',removed_at=null,removed_by=null,revision=revision+1
      where party_id=f.party_id returning revision into next_revision;
  else
    raise sqlstate 'P0001' using message='payment_transition_invalid';
  end if;
  insert into app.fee_changes(party_id,revision,action,actor_id,actor_name,created_at)
    values(f.party_id,next_revision,case p_action when 'mark_paid' then 'marked_paid' when 'mark_unpaid' then 'marked_unpaid'
      when 'waive' then 'waived' else 'waiver_undone' end,p_actor_id,trim(p_actor_name),now_at);
  insert into app.operation_receipts values(p_actor_id,p_key,'update_payment',payload,f.party_id,now_at);
  return jsonb_build_object('registration',app.registration_view(p_actor_id,s.id),'operationKey',p_key);
end;
$$;

-- The signed-in person's own obligations across sessions. No other party's data.
create function api.list_my_dues(p_actor_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(d.item order by d.owing desc,d.starts_at desc),'[]'::jsonb) from (
    select jsonb_build_object('partyId',p.id,'partyState',p.state,'seats',p.seats,'fee',app.party_fee(p.id),
      'session',jsonb_build_object('slug',s.slug,'state',s.state,'title',s.details->>'title','startsAt',s.details->>'startsAt',
        'timeZone',s.details->>'timeZone')) item,
      (f.liability_state='due' and not f.marked_paid) owing,(s.details->>'startsAt')::timestamptz starts_at
    from app.fee_obligations f join app.parties p on p.id=f.party_id join app.sessions s on s.id=p.session_id
    where p.user_id=p_actor_id
    order by owing desc,starts_at desc limit 200) d;
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
  elsif r.action='update_payment' then
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
revoke all on function app.managed_fee(uuid),api.update_payment(uuid,text,uuid,uuid,uuid,text,integer),api.list_my_dues(uuid) from public,anon,authenticated;
grant execute on function app.managed_fee(uuid),api.update_payment(uuid,text,uuid,uuid,uuid,text,integer),api.list_my_dues(uuid) to service_role;
