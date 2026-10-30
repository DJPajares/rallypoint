-- P-27 / WDL-402: a booked player drops their +1, or adds one later (RP-07,
-- owner 2026-10-30). Dropping frees only the guest's place: the booker keeps
-- their place or queue position and the waitlist fills in strict order. The
-- guest's unpaid fee goes before the cutoff (or after a material change) and
-- stays after it; a paid marker never changes. In a split session the guest's
-- share stays once the cutoff passes, so the guest can't be dropped then.
-- Adding needs a confirmed booking, a free place and nobody waiting, so no
-- waiting party is ever skipped; the fee applies with fresh consent. No email.

alter table app.fee_changes drop constraint fee_changes_action_check;
alter table app.fee_changes add constraint fee_changes_action_check
  check(action in ('marked_paid','marked_unpaid','waived','waiver_undone','removed_before_cutoff','split_corrected',
    'removed_session_cancelled','released_unpaid','removed_after_change','removed_by_organizer','guest_dropped','guest_added'));

-- The backend can't change what a fee charges for. This one path can, and
-- only for a due, unpaid, fixed fee, between one and two seats.
create function app.set_guest_fee_seats(p_party uuid,p_seats integer) returns integer
language plpgsql security definer set search_path='' as $$
declare next_revision integer;
begin
  if p_seats not in (1,2) then raise check_violation using message='invalid_guest_change'; end if;
  update app.fee_obligations set charged_seats=p_seats,revision=revision+1
    where party_id=p_party and liability_state='due' and not marked_paid and mode<>'split'
    returning revision into next_revision;
  if next_revision is null then raise sqlstate 'P0001' using message='guest_fee_settled'; end if;
  return next_revision;
end;
$$;
revoke all on function app.set_guest_fee_seats(uuid,integer) from public,anon,authenticated;
grant execute on function app.set_guest_fee_seats(uuid,integer) to service_role;

create function api.change_guest(p_actor_id uuid,p_key uuid,p_slug uuid,p_party_id uuid,p_action text,
  p_guest_name text,p_version integer,p_consent boolean) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s app.sessions; p app.parties; f app.fee_obligations; receipt app.operation_receipts; payload jsonb;
  now_at timestamptz; occupied bigint; tracked boolean; split boolean; next_revision integer;
begin
  if p_action not in ('drop','add') or (p_action='add' and (p_consent is distinct from true
      or coalesce(length(p_guest_name),0)>80)) then
    raise check_violation using message='invalid_guest_change'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text||p_key::text,0));
  select * into s from app.sessions where slug=p_slug;
  if not found then raise insufficient_privilege using message='session_unavailable'; end if;
  -- Group, then session: the same order as joining, withdrawing and promotion.
  perform 1 from app.groups where id=s.group_id for update;
  select * into s from app.sessions where id=s.id for update;
  payload:=jsonb_build_object('slug',p_slug,'partyId',p_party_id,'action',p_action,
    'guestName',case when p_action='add' then coalesce(btrim(p_guest_name),'') end,
    'version',case when p_action='add' then p_version end);
  select * into receipt from app.operation_receipts where actor_id=p_actor_id and request_key=p_key;
  if found then
    if receipt.action<>'change_guest' or receipt.payload<>payload then raise sqlstate 'P0001' using message='idempotency_conflict'; end if;
    return jsonb_build_object('registration',app.registration_view(p_actor_id,s.id,receipt.resource_id),'operationKey',p_key);
  end if;
  -- Only the booker changes their own party.
  select * into p from app.parties where id=p_party_id and session_id=s.id and user_id=p_actor_id for update;
  if not found or s.state='draft' then raise insufficient_privilege using message='session_unavailable'; end if;
  now_at:=clock_timestamp();
  if s.state<>'published' or now_at>=(s.details->>'startsAt')::timestamptz or p.state not in ('confirmed','waitlisted') then
    raise sqlstate 'P0001' using message='guest_change_closed'; end if;
  tracked:=coalesce(s.details->>'paymentMode','organizer')='organizer';
  split:=tracked and coalesce(s.details->>'feeMode','fixed')='split';
  select * into f from app.fee_obligations where party_id=p.id for update;

  if p_action='drop' then
    if p.seats<>2 then raise sqlstate 'P0001' using message='no_guest'; end if;
    if exists(select 1 from app.seat_attendance where party_id=p.id and seat=2 and state='checked_in') then
      raise sqlstate 'P0001' using message='guest_checked_in'; end if;
    -- A split share is fixed once final, and stays after the cutoff.
    if split and p.state='confirmed' and (f.party_id is not null
        or (now_at>=(s.details->>'cutoffAt')::timestamptz and not app.party_affected_by_change(p.id))) then
      raise sqlstate 'P0001' using message='guest_share_stays'; end if;
    update app.parties set seats=1,guest_name='' where id=p.id;
    -- The guest's unpaid fee goes before the cutoff, or after a material change.
    if f.party_id is not null and f.mode<>'split' and f.liability_state='due' and not f.marked_paid and f.charged_seats=2
        and (now_at<(s.details->>'cutoffAt')::timestamptz or app.party_affected_by_change(p.id)) then
      next_revision:=app.set_guest_fee_seats(p.id,1);
      insert into app.fee_changes(party_id,revision,action,actor_id,actor_name,created_at,previous_minor,current_minor,currency)
        values(p.id,next_revision,'guest_dropped',p_actor_id,p.primary_name,now_at,f.total_minor,f.unit_minor,f.currency);
    end if;
    -- The freed place goes to the head of the queue, never past it.
    perform app.fill_waitlist(s.id);
  else
    if not coalesce((s.details->>'guests')::boolean,false) then raise check_violation using message='guest_disabled'; end if;
    if p.seats=2 then raise sqlstate 'P0001' using message='guest_exists'; end if;
    if p_version is distinct from s.version then raise sqlstate 'P0001' using message='stale_terms'; end if;
    select coalesce(sum(seats),0) into occupied from app.parties where session_id=s.id and state='confirmed';
    if p.state<>'confirmed' or exists(select 1 from app.parties where session_id=s.id and state='waitlisted')
        or occupied+1>(s.details->>'capacity')::integer then
      raise sqlstate 'P0001' using message='guest_no_place'; end if;
    if (s.details->>'feeMinor')::numeric*2>9007199254740991 then raise check_violation using message='fee_out_of_range'; end if;
    -- A fee already marked paid, waived or final can't take a second seat here.
    if f.party_id is not null and (f.mode='split' or f.liability_state<>'due' or f.marked_paid) then
      raise sqlstate 'P0001' using message='guest_fee_settled'; end if;
    update app.parties set seats=2,guest_name=btrim(coalesce(p_guest_name,'')),consent_version=s.version,consent_at=now_at where id=p.id;
    if f.party_id is not null then
      next_revision:=app.set_guest_fee_seats(p.id,2);
      insert into app.fee_changes(party_id,revision,action,actor_id,actor_name,created_at,previous_minor,current_minor,currency)
        values(p.id,next_revision,'guest_added',p_actor_id,p.primary_name,now_at,f.total_minor,f.unit_minor*2,f.currency);
    end if;
  end if;
  insert into app.operation_receipts values(p_actor_id,p_key,'change_guest',payload,p.id,now_at);
  return jsonb_build_object('registration',app.registration_view(p_actor_id,s.id,p.id),'operationKey',p_key);
end;
$$;

-- Recovery by key answers with the booker's own registration.
alter function api.read_operation(uuid,uuid) rename to read_operation_before_guest_changes;
alter function api.read_operation_before_guest_changes(uuid,uuid) set schema app;
create function api.read_operation(p_actor_id uuid,p_key uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r app.operation_receipts; p app.parties;
begin
  select * into r from app.operation_receipts where actor_id=p_actor_id and request_key=p_key;
  if r.action='change_guest' then
    select * into p from app.parties where id=r.resource_id and user_id=p_actor_id;
    if not found then return null; end if;
    perform 1 from app.sessions where id=p.session_id for share;
    return jsonb_build_object('operationKey',p_key,'registration',app.registration_view(p_actor_id,p.session_id,p.id));
  end if;
  return app.read_operation_before_guest_changes(p_actor_id,p_key);
end;
$$;

revoke all on function api.change_guest(uuid,uuid,uuid,uuid,text,text,integer,boolean),
  app.read_operation_before_guest_changes(uuid,uuid),api.read_operation(uuid,uuid)
  from public,anon,authenticated;
grant execute on function api.change_guest(uuid,uuid,uuid,uuid,text,text,integer,boolean),
  app.read_operation_before_guest_changes(uuid,uuid),api.read_operation(uuid,uuid)
  to service_role;
