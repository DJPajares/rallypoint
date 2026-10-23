-- P-16 / D-14. Existing rows remain non-material; no historical fees change.
alter table app.session_changes add column material boolean not null default false;
create index material_session_changes on app.session_changes(session_id,version desc) where material;

-- Private durable handoff to P-06; no delivery worker or reminder is changed.
-- Recipients are the active parties at save time, not later joiners.
create table app.session_change_signals (
  session_id uuid not null,
  version integer not null,
  actor_id uuid not null references auth.users(id),
  changes jsonb not null,
  previous jsonb not null,
  party_ids uuid[] not null,
  created_at timestamptz not null,
  primary key(session_id,version),
  foreign key(session_id,version) references app.session_changes(session_id,version) on delete cascade
);
alter table app.session_change_signals enable row level security;
revoke all on app.session_change_signals from public,anon,authenticated;
grant select,insert on app.session_change_signals to service_role;

create function app.assert_booked_edit(p_old app.sessions,p_details jsonb) returns void
language plpgsql security invoker set search_path='' as $$
begin
  if exists (
    select 1 from (select jsonb_object_keys(p_old.details) k union select jsonb_object_keys(p_details)) keys
    where p_old.details->k is distinct from p_details->k
      and not (k='paymentMode' and coalesce(p_old.details->>k,'organizer')=coalesce(p_details->>k,'organizer'))
      and not (k='releaseUnpaid' and coalesce(p_old.details->k,'false'::jsonb)=coalesce(p_details->k,'false'::jsonb))
      and k not in ('title','activity','instructions','capacity','startLocal','endLocal','startsAt','endsAt','location','cutoffLocal','cutoffAt')
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

create or replace function app.guard_booked_session() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if old.state in ('cancelled','completed') and (new.state<>old.state or new.details<>old.details) then
    raise sqlstate 'P0001' using message='session_closed';
  end if;
  if old.bookings_started_at is not null then
    if new.bookings_started_at is distinct from old.bookings_started_at then
      raise sqlstate 'P0001' using message='booked_event_locked';
    end if;
    if new.details is distinct from old.details then perform app.assert_booked_edit(old,new.details); end if;
  end if;
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION app.save_session_before_cancellation(p_actor_id uuid, p_key uuid, p_group_id uuid, p_session_id uuid, p_intent text, p_version integer, p_details jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare s app.sessions; receipt app.operation_receipts; payload jsonb;
  changed jsonb; published boolean; previous_details jsonb; material_change boolean; at_time timestamptz;
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
    if s.state='published' and clock_timestamp()>=(s.details->>'startsAt')::timestamptz then raise sqlstate 'P0001' using message='session_started'; end if;
    if s.bookings_started_at is not null then perform app.assert_booked_edit(s,p_details); end if;
    if s.state='published' and (p_details->>'startsAt')::timestamptz<=clock_timestamp() then raise sqlstate 'P0001' using message='future_start_required'; end if;
    if s.state='published' and p_intent <> 'update' then raise sqlstate 'P0001' using message='already_published'; end if;
    if s.state='draft' and p_intent='update' then raise check_violation using message='invalid_input'; end if;
  elsif p_intent='update' then raise check_violation using message='invalid_input';
  end if;
  published := p_intent in ('publish','update');
  if published then
    if coalesce(p_details->>'feeMode','fixed') not in ('fixed','split') or coalesce(length(trim(p_details->>'title')),0) not between 1 and 120
      or coalesce(length(trim(p_details->>'activity')),0) not between 1 and 80
      or coalesce(length(trim(p_details->>'location')),0) not between 1 and 300
      or coalesce((p_details->>'capacity')::bigint,0) not between 1 and 2147483647
      or not coalesce((p_details->>'endsAt')::timestamptz > (p_details->>'startsAt')::timestamptz,false)
      or not coalesce((p_details->>'opensAt')::timestamptz < (p_details->>'startsAt')::timestamptz,false)
      or not coalesce((p_details->>'cutoffAt')::timestamptz between (p_details->>'opensAt')::timestamptz and (p_details->>'startsAt')::timestamptz,false)
      or coalesce(p_details->>'currency','') not in ('PHP','SGD','USD','EUR','GBP','JPY','KWD')
      or coalesce(p_details->>'paymentMode','organizer') not in ('untracked','organizer')
      or coalesce(jsonb_typeof(p_details->'releaseUnpaid'),'boolean')<>'boolean'
      or (coalesce(p_details->>'paymentMode','organizer')='untracked' and (p_details ? 'feeMode' or p_details ? 'feeMinor' or p_details ? 'totalMinor'
        or coalesce((p_details->>'releaseUnpaid')::boolean,false)))
      or (coalesce(p_details->>'paymentMode','organizer')='organizer' and (
        coalesce((p_details->>(case when p_details->>'feeMode'='split' then 'totalMinor' else 'feeMinor' end))::numeric,-1) not between 0 and 9007199254740991
        or (p_details->>(case when p_details->>'feeMode'='split' then 'totalMinor' else 'feeMinor' end))::numeric <> trunc((p_details->>(case when p_details->>'feeMode'='split' then 'totalMinor' else 'feeMinor' end))::numeric)
        or (coalesce((p_details->>'releaseUnpaid')::boolean,false)
          and (p_details->>'feeMode'='split' or coalesce((p_details->>'feeMinor')::numeric,0)<=0))))
      or (p_details->'releaseUnpaid'='true'::jsonb
        and (p_details->>'cutoffAt')::timestamptz >= (p_details->>'startsAt')::timestamptz)
    then raise check_violation using message='invalid_input'; end if;
  end if;
  if p_session_id is null then
    insert into app.sessions(group_id,state,details) values(p_group_id,case when published then 'published' else 'draft' end,p_details) returning * into s;
  elsif s.details <> p_details or (p_intent='publish' and s.state='draft') then
    previous_details := s.details;
    at_time := clock_timestamp();
    material_change := (s.details->>'startsAt')::timestamptz is distinct from (p_details->>'startsAt')::timestamptz
      or (s.details->>'endsAt')::timestamptz is distinct from (p_details->>'endsAt')::timestamptz
      or s.details->>'location' is distinct from p_details->>'location';
    select coalesce(jsonb_agg(k order by k),'[]'::jsonb) into changed
      from (select jsonb_object_keys(p_details) k union select jsonb_object_keys(s.details)) keys
      where s.details->k is distinct from p_details->k;
    update app.sessions set details=p_details,state=case when published then 'published' else 'draft' end,version=version+1,updated_at=clock_timestamp() where id=s.id returning * into s;
    if p_intent='update' then
      insert into app.session_changes(session_id,version,actor_id,changed_fields,created_at,material)
        values(s.id,s.version,p_actor_id,changed,at_time,material_change);
      if material_change then
        insert into app.session_change_signals(session_id,version,actor_id,changes,previous,party_ids,created_at)
        values(s.id,s.version,p_actor_id,
          (select coalesce(jsonb_object_agg(k,p_details->k),'{}'::jsonb) from unnest(array['startsAt','endsAt','location']) k
            where case when k='location' then previous_details->>k is distinct from p_details->>k
              else (previous_details->>k)::timestamptz is distinct from (p_details->>k)::timestamptz end),
          jsonb_build_object('startsAt',previous_details->'startsAt','endsAt',previous_details->'endsAt','location',previous_details->'location'),
          array(select id from app.parties where session_id=s.id and state in ('confirmed','waitlisted') order by queue_sequence),at_time);
      end if;
      if (p_details->>'capacity')::bigint > (previous_details->>'capacity')::bigint then perform app.fill_waitlist(s.id); end if;
    end if;
  end if;
  insert into app.operation_receipts values(p_actor_id,p_key,'save_session',payload,s.id,now());
  return jsonb_build_object('session',app.session_view(s),'operationKey',p_key);
end;
$function$;

revoke all on function app.save_session_before_cancellation(uuid,uuid,uuid,uuid,text,integer,jsonb)
  from public,anon,authenticated;
grant execute on function app.save_session_before_cancellation(uuid,uuid,uuid,uuid,text,integer,jsonb)
  to service_role;

alter table app.fee_obligations drop constraint fee_obligations_liability_state_check;
alter table app.fee_obligations add constraint fee_obligations_liability_state_check
  check(liability_state in ('due','removed_before_cutoff','waived','removed_session_cancelled','released_unpaid','removed_after_change'));
alter table app.fee_changes drop constraint fee_changes_action_check;
alter table app.fee_changes add constraint fee_changes_action_check
  check(action in ('marked_paid','marked_unpaid','waived','waiver_undone','removed_before_cutoff','split_corrected','removed_session_cancelled','released_unpaid','removed_after_change'));
alter table app.split_claim_changes drop constraint split_claim_changes_action_check;
alter table app.split_claim_changes add constraint split_claim_changes_action_check
  check(action in ('confirmed','waived','waiver_undone','removed_before_cutoff','removed_session_cancelled','removed_after_change'));

create function app.party_affected_by_change(p_party uuid) returns boolean
language sql stable security invoker set search_path='' as $$
  select exists(select 1 from app.parties p join app.session_changes c on c.session_id=p.session_id
    where p.id=p_party and c.material and c.version>p.consent_version);
$$;

alter function app.release_withdrawal_fee(uuid,uuid,timestamptz,timestamptz) rename to release_withdrawal_fee_before_booked_edits;
create function app.release_withdrawal_fee(p_party uuid,p_actor uuid,p_at timestamptz,p_cutoff timestamptz) returns void
language plpgsql security invoker set search_path='' as $$
begin
  if not app.party_affected_by_change(p_party) then
    perform app.release_withdrawal_fee_before_booked_edits(p_party,p_actor,p_at,p_cutoff);
    return;
  end if;
  with released as (
    update app.fee_obligations set liability_state='removed_after_change',removed_at=p_at,removed_by=p_actor,revision=revision+1
    where party_id=p_party and liability_state='due' and not marked_paid
    returning party_id,revision)
  insert into app.fee_changes(party_id,revision,action,actor_id,actor_name,created_at)
    select r.party_id,r.revision,'removed_after_change',p_actor,p.primary_name,p_at
    from released r join app.parties p on p.id=r.party_id;
  with removed as (
    update app.split_claims set eligible=false,revision=revision+1,changed_at=p_at,changed_by=p_actor
    where party_id=p_party and eligible
      and not exists(select 1 from app.fee_obligations where party_id=p_party and marked_paid)
    returning revision)
  insert into app.split_claim_changes(party_id,revision,action,actor_id,actor_name,created_at)
    select p_party,r.revision,'removed_after_change',p_actor,p.primary_name,p_at
    from removed r join app.parties p on p.id=p_party;
end;
$$;

alter function app.registration_view(uuid,uuid,uuid) rename to registration_view_before_booked_edits;
create function app.registration_view(p_actor uuid,p_session uuid,p_party uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
  result := app.registration_view_before_booked_edits(p_actor,p_session,p_party);
  if result->'own' is not null and result->'own'<>'null'::jsonb then
    result := jsonb_set(result,'{own,freeWithdrawalAfterChange}',to_jsonb(
      result->'own'->>'state' in ('confirmed','waitlisted')
      and exists(select 1 from app.sessions where id=p_session and state='published' and clock_timestamp()<(details->>'startsAt')::timestamptz)
      and app.party_affected_by_change((result->'own'->>'id')::uuid)));
  end if;
  return result;
end;
$$;
revoke all on function app.assert_booked_edit(app.sessions,jsonb),app.party_affected_by_change(uuid),app.release_withdrawal_fee(uuid,uuid,timestamptz,timestamptz),app.registration_view(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function app.assert_booked_edit(app.sessions,jsonb),app.party_affected_by_change(uuid),app.release_withdrawal_fee(uuid,uuid,timestamptz,timestamptz),app.registration_view(uuid,uuid,uuid) to service_role;
