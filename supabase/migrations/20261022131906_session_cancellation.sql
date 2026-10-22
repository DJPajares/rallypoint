-- WDL-384. One durable private signal, committed with state and fee changes.
create table app.session_cancellations (
  session_id uuid primary key references app.sessions(id) on delete cascade,
  previous_state text not null check(previous_state in ('draft','published')),
  actor_id uuid not null references auth.users(id),
  actor_name text not null check(length(actor_name) between 1 and 80),
  created_at timestamptz not null
);
alter table app.session_cancellations enable row level security;
revoke all on app.session_cancellations from public,anon,authenticated;
grant select,insert on app.session_cancellations to service_role;

alter table app.fee_obligations drop constraint fee_obligations_liability_state_check;
alter table app.fee_obligations add constraint fee_obligations_liability_state_check
  check(liability_state in ('due','removed_before_cutoff','waived','removed_session_cancelled'));
alter table app.fee_changes drop constraint fee_changes_action_check;
alter table app.fee_changes add constraint fee_changes_action_check
  check(action in ('marked_paid','marked_unpaid','waived','waiver_undone','removed_before_cutoff','split_corrected','removed_session_cancelled'));
alter table app.split_claim_changes drop constraint split_claim_changes_action_check;
alter table app.split_claim_changes add constraint split_claim_changes_action_check
  check(action in ('confirmed','waived','waiver_undone','removed_before_cutoff','removed_session_cancelled'));

create or replace function app.session_view(s app.sessions) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('id',s.id,'groupId',s.group_id,'slug',s.slug,'state',s.state,'version',s.version,
    'details',s.details,'bookingsStarted',s.bookings_started_at is not null) ||
    case when s.state='cancelled' then jsonb_build_object('cancelledFrom',
      (select previous_state from app.session_cancellations where session_id=s.id)) else '{}'::jsonb end;
$$;

create function api.cancel_session(p_actor_id uuid,p_actor_name text,p_key uuid,p_session_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s app.sessions; receipt app.operation_receipts; payload jsonb; at_time timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text||p_key::text,0));
  select * into s from app.sessions where id=p_session_id;
  if not found then raise insufficient_privilege using message='group_access_denied';end if;
  -- Same lock order as join, withdraw, payment and role revocation.
  perform app.require_manager(p_actor_id,s.group_id);
  select * into s from app.sessions where id=p_session_id for update;
  payload:=jsonb_build_object('sessionId',p_session_id);
  select * into receipt from app.operation_receipts where actor_id=p_actor_id and request_key=p_key;
  if found then
    if receipt.action<>'cancel_session' or receipt.payload<>payload then raise sqlstate 'P0001' using message='idempotency_conflict';end if;
    return jsonb_build_object('session',app.session_view(s),'operationKey',p_key);
  end if;
  if length(trim(p_actor_name)) not between 1 and 80 or p_actor_name is null then
    raise check_violation using message='invalid_actor';end if;
  at_time:=clock_timestamp();
  if s.state in ('draft','published') then
    insert into app.session_cancellations values(s.id,s.state,p_actor_id,trim(p_actor_name),at_time);
    update app.sessions set state='cancelled',version=version+1,updated_at=at_time where id=s.id returning * into s;
    -- Keep original allocations, payment declarations, waivers and parties.
    with removed as (
      update app.fee_obligations f set liability_state='removed_session_cancelled',removed_at=at_time,removed_by=p_actor_id,revision=f.revision+1
      from app.parties p where p.id=f.party_id and p.session_id=s.id and f.liability_state='due' and not f.marked_paid
      returning f.*)
    insert into app.fee_changes(party_id,revision,action,actor_id,actor_name,created_at,previous_minor,current_minor,currency,split_run_id)
      select party_id,revision,'removed_session_cancelled',p_actor_id,trim(p_actor_name),at_time,
        coalesce(split_total_minor,total_minor),coalesce(split_total_minor,total_minor),currency,split_run_id from removed;
    -- Pending split claims are not payable fees, but cannot become future dues.
    with removed as (
      update app.split_claims c set eligible=false,revision=c.revision+1,changed_at=at_time,changed_by=p_actor_id
      from app.parties p where p.id=c.party_id and p.session_id=s.id and c.eligible
        and not exists(select 1 from app.fee_obligations f where f.party_id=c.party_id and f.marked_paid)
      returning c.party_id,c.revision)
    insert into app.split_claim_changes(party_id,revision,action,actor_id,actor_name,created_at)
      select party_id,revision,'removed_session_cancelled',p_actor_id,trim(p_actor_name),at_time from removed;
  elsif s.state<>'cancelled' then
    raise sqlstate 'P0001' using message='session_closed';
  end if;
  insert into app.operation_receipts values(p_actor_id,p_key,'cancel_session',payload,s.id,at_time);
  return jsonb_build_object('session',app.session_view(s),'operationKey',p_key);
end;
$$;

-- A correction must never revive an unpaid debt on a cancelled session.
-- Existing payment/split writers already hold the group/session locks.
create function app.guard_cancelled_fee() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if not new.marked_paid and new.liability_state='due' and exists(
    select 1 from app.parties p join app.sessions s on s.id=p.session_id where p.id=new.party_id and s.state='cancelled') then
    raise sqlstate 'P0001' using message='payment_transition_invalid';end if;
  return new;
end;
$$;
create trigger protect_cancelled_fee before insert or update on app.fee_obligations
  for each row execute function app.guard_cancelled_fee();

-- Keep the existing split/attendance/payment receipt dispatch intact.
alter function api.read_operation(uuid,uuid) rename to read_operation_before_cancellation;
alter function api.read_operation_before_cancellation(uuid,uuid) set schema app;
create function api.read_operation(p_actor_id uuid,p_key uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r app.operation_receipts;s app.sessions;
begin
  select * into r from app.operation_receipts where actor_id=p_actor_id and request_key=p_key;
  if r.action='cancel_session' then
    select * into s from app.sessions where id=r.resource_id;
    perform app.require_manager(p_actor_id,s.group_id);
    select * into s from app.sessions where id=r.resource_id for share;
    return jsonb_build_object('operationKey',p_key,'session',app.session_view(s));
  end if;
  return app.read_operation_before_cancellation(p_actor_id,p_key);
end;
$$;

-- The booked-details trigger protects writes, including terminal state changes.
-- Refuse same-details/no-op saves too, without breaking committed save recovery.
alter function api.save_session(uuid,uuid,uuid,uuid,text,integer,jsonb) rename to save_session_before_cancellation;
alter function api.save_session_before_cancellation(uuid,uuid,uuid,uuid,text,integer,jsonb) set schema app;
create function api.save_session(p_actor_id uuid,p_key uuid,p_group_id uuid,p_session_id uuid,p_intent text,p_version integer,p_details jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s app.sessions;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text||p_key::text,0));
  perform app.require_manager(p_actor_id,p_group_id);
  if p_session_id is not null then
    select * into s from app.sessions where id=p_session_id and group_id=p_group_id for update;
    if s.state in ('cancelled','completed') and not exists(
      select 1 from app.operation_receipts where actor_id=p_actor_id and request_key=p_key) then
      raise sqlstate 'P0001' using message='session_closed';end if;
  end if;
  return app.save_session_before_cancellation(p_actor_id,p_key,p_group_id,p_session_id,p_intent,p_version,p_details);
end;
$$;

create or replace function api.read_shared_session(p_slug uuid) returns jsonb
language sql volatile security invoker set search_path='' as $$
  select jsonb_build_object('slug',s.slug,'groupName',g.name,'version',s.version,'state',s.state,'details',s.details,
    'counts',app.registration_counts(s.id),'registrationWindow',case when s.state<>'published' or clock_timestamp()>=(s.details->>'startsAt')::timestamptz then 'closed'
      when clock_timestamp()<(s.details->>'opensAt')::timestamptz then 'not_open' else 'open' end)||case when coalesce(s.details->>'feeMode','fixed')='split' then jsonb_build_object('split',app.split_summary(s.id)) else '{}'::jsonb end
  from app.sessions s join app.groups g on g.id=s.group_id where s.slug=p_slug and
    (s.state in ('published','completed') or (s.state='cancelled' and exists(
      select 1 from app.session_cancellations c where c.session_id=s.id and c.previous_state='published')));
$$;

revoke all on function api.cancel_session(uuid,text,uuid,uuid),app.guard_cancelled_fee(),api.read_operation(uuid,uuid),api.save_session(uuid,uuid,uuid,uuid,text,integer,jsonb) from public,anon,authenticated;
grant execute on function api.cancel_session(uuid,text,uuid,uuid),app.guard_cancelled_fee(),api.read_operation(uuid,uuid),api.save_session(uuid,uuid,uuid,uuid,text,integer,jsonb) to service_role;
