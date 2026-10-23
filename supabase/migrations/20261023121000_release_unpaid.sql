-- Release of an unpaid spot after the cutoff (PRD D-18, P-02). A host who turns
-- on "Unpaid spots can go to the waitlist after the cutoff" lets an organizer or
-- co-host give one confirmed, still-unpaid party's spot to the waitlist, from the
-- cutoff (inclusive) until the start (exclusive). The whole party is removed, its
-- unpaid fee is dropped with actor and time, a 'released' event is saved for the
-- later email, and the waitlist is promoted in strict order. Nothing is automatic.

alter table app.fee_obligations drop constraint fee_obligations_liability_state_check;
alter table app.fee_obligations add constraint fee_obligations_liability_state_check
  check(liability_state in ('due','removed_before_cutoff','waived','removed_session_cancelled','released_unpaid'));
alter table app.fee_changes drop constraint fee_changes_action_check;
alter table app.fee_changes add constraint fee_changes_action_check
  check(action in ('marked_paid','marked_unpaid','waived','waiver_undone','removed_before_cutoff','split_corrected','removed_session_cancelled','released_unpaid'));
alter table app.registration_events drop constraint registration_events_kind_check;
alter table app.registration_events add constraint registration_events_kind_check
  check(kind in ('confirmed','waitlisted','promoted','withdrawn','released'));

-- A confirmation is stamped when it happens. The old default was the transaction
-- start, which a lock wait can put before the cutoff the booking actually followed.
alter table app.registration_events alter column created_at set default clock_timestamp();

-- When the party last became confirmed: straight away, or by promotion.
create function app.party_confirmed_at(p_party uuid) returns timestamptz
language sql stable security invoker set search_path='' as $$
  select max(created_at) from app.registration_events where party_id=p_party and kind in ('confirmed','promoted');
$$;

-- Whether an organizer could release this party at p_at: a published "Pay the
-- organizer" session with the switch on, inside [cutoff, start), for a confirmed
-- party whose fee is still due, unmarked and above zero, and who was confirmed
-- before the cutoff.
create function app.party_releasable(p_party uuid,p_at timestamptz) returns boolean
language sql stable security invoker set search_path='' as $$
  select exists(
    select 1 from app.parties p
      join app.sessions s on s.id=p.session_id
      join app.fee_obligations f on f.party_id=p.id
    where p.id=p_party and p.state='confirmed' and s.state='published'
      and coalesce(s.details->>'paymentMode','organizer')='organizer'
      and coalesce((s.details->>'releaseUnpaid')::boolean,false)
      and (s.details->>'cutoffAt')::timestamptz<=p_at and p_at<(s.details->>'startsAt')::timestamptz
      and f.liability_state='due' and not f.marked_paid and f.total_minor>0
      and app.party_confirmed_at(p.id)<(s.details->>'cutoffAt')::timestamptz);
$$;

create function api.release_unpaid_party(p_actor_id uuid,p_actor_name text,p_key uuid,p_slug uuid,p_party_id uuid,p_revision integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s app.sessions; f app.fee_obligations; receipt app.operation_receipts; payload jsonb; now_at timestamptz; next_revision integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text||p_key::text,0));
  select * into s from app.sessions where slug=p_slug;
  if not found then raise insufficient_privilege using message='group_access_denied'; end if;
  -- Group lock, with the current role checked under it: a revoked co-host is refused even on replay.
  perform app.require_manager(p_actor_id,s.group_id);
  select * into s from app.sessions where id=s.id for update;
  payload:=jsonb_build_object('slug',p_slug,'partyId',p_party_id,'revision',p_revision);
  select * into receipt from app.operation_receipts where actor_id=p_actor_id and request_key=p_key;
  if found then
    if receipt.action<>'release_party' or receipt.payload<>payload then raise sqlstate 'P0001' using message='idempotency_conflict'; end if;
    return jsonb_build_object('registration',app.registration_view(p_actor_id,s.id),'operationKey',p_key);
  end if;
  if p_actor_name is null or length(trim(p_actor_name)) not between 1 and 80 then
    raise check_violation using message='invalid_release';
  end if;
  if coalesce(s.details->>'paymentMode','organizer')<>'organizer' or not coalesce((s.details->>'releaseUnpaid')::boolean,false) then
    raise sqlstate 'P0001' using message='release_not_enabled';
  end if;
  -- Server time after the locks: a request that waited on a lock is judged when it can act.
  now_at:=clock_timestamp();
  if s.state<>'published' or now_at>=(s.details->>'startsAt')::timestamptz then raise sqlstate 'P0001' using message='release_closed'; end if;
  if now_at<(s.details->>'cutoffAt')::timestamptz then raise sqlstate 'P0001' using message='release_too_early'; end if;
  select f2.* into f from app.fee_obligations f2 join app.parties p on p.id=f2.party_id
    where f2.party_id=p_party_id and p.session_id=s.id for update of f2;
  if not found then raise sqlstate 'P0001' using message='fee_not_found'; end if;
  if f.revision<>p_revision then raise sqlstate 'P0001' using message='stale_payment'; end if;
  if not app.party_releasable(f.party_id,now_at) then raise sqlstate 'P0001' using message='release_not_eligible'; end if;
  update app.parties set state='removed' where id=f.party_id;
  update app.fee_obligations set liability_state='released_unpaid',removed_at=now_at,removed_by=p_actor_id,revision=revision+1
    where party_id=f.party_id returning revision into next_revision;
  insert into app.fee_changes(party_id,revision,action,actor_id,actor_name,created_at,previous_minor,current_minor,currency,split_run_id)
    values(f.party_id,next_revision,'released_unpaid',p_actor_id,trim(p_actor_name),now_at,f.total_minor,f.total_minor,f.currency,f.split_run_id);
  -- The signal the later email reads; the spot and the fee change commit or roll back with it.
  insert into app.registration_events(party_id,kind,created_at) values(f.party_id,'released',now_at);
  -- Never bypasses a head party that does not fit the freed seats.
  perform app.fill_waitlist(s.id);
  insert into app.operation_receipts values(p_actor_id,p_key,'release_party',payload,f.party_id,now_at);
  return jsonb_build_object('registration',app.registration_view(p_actor_id,s.id),'operationKey',p_key);
end;
$$;

alter function api.read_operation(uuid,uuid) rename to read_operation_before_payment_modes;
alter function api.read_operation_before_payment_modes(uuid,uuid) set schema app;
create function api.read_operation(p_actor_id uuid,p_key uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r app.operation_receipts; s app.sessions; p app.parties;
begin
  select * into r from app.operation_receipts where actor_id=p_actor_id and request_key=p_key;
  if r.action='release_party' then
    select * into p from app.parties where id=r.resource_id;
    select * into s from app.sessions where id=p.session_id;
    perform app.require_manager(p_actor_id,s.group_id);
    perform 1 from app.sessions where id=s.id for share;
    return jsonb_build_object('operationKey',p_key,'registration',app.registration_view(p_actor_id,s.id));
  end if;
  return app.read_operation_before_payment_modes(p_actor_id,p_key);
end;
$$;

-- Each managed roster row says whether it could be released right now. The read
-- reads the clock, so unlike the views it wraps it is not marked STABLE.
alter function app.registration_view(uuid,uuid,uuid) rename to registration_view_before_payment_modes;
create function app.registration_view(p_actor uuid,p_session uuid,p_party uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb; at_time timestamptz:=clock_timestamp(); rows jsonb;
begin
  result:=app.registration_view_before_payment_modes(p_actor,p_session,p_party);
  if not coalesce((result->>'canManage')::boolean,false) then return result; end if;
  select coalesce(jsonb_agg(entry||jsonb_build_object('releasable',app.party_releasable((entry->>'id')::uuid,at_time)) order by n),'[]'::jsonb)
    into rows from jsonb_array_elements(result->'roster') with ordinality a(entry,n);
  return jsonb_set(result,'{roster}',rows);
end;
$$;

revoke all on function app.party_confirmed_at(uuid),app.party_releasable(uuid,timestamptz),
  api.release_unpaid_party(uuid,text,uuid,uuid,uuid,integer),
  app.read_operation_before_payment_modes(uuid,uuid),api.read_operation(uuid,uuid),
  app.registration_view_before_payment_modes(uuid,uuid,uuid),app.registration_view(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function app.party_confirmed_at(uuid),app.party_releasable(uuid,timestamptz),
  api.release_unpaid_party(uuid,text,uuid,uuid,uuid,integer),
  app.read_operation_before_payment_modes(uuid,uuid),api.read_operation(uuid,uuid),
  app.registration_view_before_payment_modes(uuid,uuid,uuid),app.registration_view(uuid,uuid,uuid)
  to service_role;
