-- "I've sent it" (PRD D-18, P-03). In a "Pay the organizer" session a booked
-- player can say they have sent payment, with an optional reference, and take it
-- back until an organizer marks the fee paid. It is a hint for organizers, not a
-- payment: it never touches the party, its place in the line or its fee, and only
-- that player and the session's organizers and co-hosts can read it.

create table app.payment_notes (
  party_id uuid primary key references app.parties(id),
  reference text check(reference is null or length(reference) between 1 and 60),
  sent_at timestamptz not null
);
alter table app.payment_notes enable row level security;
revoke all on app.payment_notes from public,anon,authenticated;
grant select,insert,delete on app.payment_notes to service_role;

-- The note as the views show it; null when there is none, or when the party is no
-- longer booked (a withdrawn or removed party has nothing left to say).
create function app.party_payment_note(p_party uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('reference',n.reference,'sentAt',n.sent_at)
  from app.payment_notes n join app.parties p on p.id=n.party_id
  where n.party_id=p_party and p.state in ('confirmed','waitlisted');
$$;

create function api.update_payment_note(p_actor_id uuid,p_key uuid,p_slug uuid,p_party_id uuid,p_action text,p_reference text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s app.sessions; p app.parties; receipt app.operation_receipts; payload jsonb; now_at timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text||p_key::text,0));
  select * into s from app.sessions where slug=p_slug;
  if not found then raise insufficient_privilege using message='session_unavailable'; end if;
  -- Same lock order as join, withdraw, payment and release: group, then session.
  perform 1 from app.groups where id=s.group_id for update;
  select * into s from app.sessions where slug=p_slug for update;
  payload:=jsonb_build_object('slug',p_slug,'partyId',p_party_id,'action',p_action,'reference',p_reference);
  select * into receipt from app.operation_receipts where actor_id=p_actor_id and request_key=p_key;
  if found then
    if receipt.action<>'payment_note' or receipt.payload<>payload then raise sqlstate 'P0001' using message='idempotency_conflict'; end if;
    return jsonb_build_object('registration',app.registration_view(p_actor_id,s.id,receipt.resource_id),'operationKey',p_key);
  end if;
  -- Only the primary who booked the party: no organizer, co-host or guest speaks for them.
  select * into p from app.parties where id=p_party_id and session_id=s.id and user_id=p_actor_id;
  if not found or s.state='draft' then raise insufficient_privilege using message='session_unavailable'; end if;
  if p_action not in ('mark','undo') or (p_reference is not null and length(p_reference) not between 1 and 60) then
    raise check_violation using message='invalid_payment_note';
  end if;
  if s.state<>'published' or coalesce(s.details->>'paymentMode','organizer')<>'organizer' or p.state not in ('confirmed','waitlisted') then
    raise sqlstate 'P0001' using message='note_not_allowed';
  end if;
  -- Payment updates take the same session lock, so the paid mark cannot change while this runs.
  if exists(select 1 from app.fee_obligations where party_id=p.id and marked_paid) then
    raise sqlstate 'P0001' using message='note_already_paid';
  end if;
  -- Server time after the locks. Marking again replaces the note; undo with none is a no-op.
  now_at:=clock_timestamp();
  delete from app.payment_notes where party_id=p.id;
  if p_action='mark' then insert into app.payment_notes(party_id,reference,sent_at) values(p.id,p_reference,now_at); end if;
  insert into app.operation_receipts values(p_actor_id,p_key,'payment_note',payload,p.id,now_at);
  return jsonb_build_object('registration',app.registration_view(p_actor_id,s.id,p.id),'operationKey',p_key);
end;
$$;

-- A recovered request reads as the party's owner, like join and withdraw.
alter function api.read_operation(uuid,uuid) rename to read_operation_before_payment_notes;
alter function api.read_operation_before_payment_notes(uuid,uuid) set schema app;
create function api.read_operation(p_actor_id uuid,p_key uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r app.operation_receipts; s app.sessions; p app.parties;
begin
  select * into r from app.operation_receipts where actor_id=p_actor_id and request_key=p_key;
  if r.action='payment_note' then
    select * into p from app.parties where id=r.resource_id and user_id=p_actor_id;
    select * into s from app.sessions where id=p.session_id;
    perform 1 from app.groups where id=s.group_id for share;
    perform 1 from app.sessions where id=s.id for share;
    return jsonb_build_object('operationKey',p_key,'registration',app.registration_view(p_actor_id,s.id,p.id));
  end if;
  return app.read_operation_before_payment_notes(p_actor_id,p_key);
end;
$$;

-- The player sees their own note; organizers and co-hosts see one per roster row.
-- Nobody else gets the key at all, so a confirmed participant's roster is unchanged.
-- Like the view it wraps, this is not marked STABLE.
alter function app.registration_view(uuid,uuid,uuid) rename to registration_view_before_payment_notes;
create function app.registration_view(p_actor uuid,p_session uuid,p_party uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb; rows jsonb;
begin
  result:=app.registration_view_before_payment_notes(p_actor,p_session,p_party);
  if jsonb_typeof(result->'own')='object' then
    result:=jsonb_set(result,'{own}',(result->'own')||jsonb_build_object('paymentNote',app.party_payment_note((result->'own'->>'id')::uuid)));
  end if;
  if not coalesce((result->>'canManage')::boolean,false) then return result; end if;
  select coalesce(jsonb_agg(entry||jsonb_build_object('paymentNote',app.party_payment_note((entry->>'id')::uuid)) order by n),'[]'::jsonb)
    into rows from jsonb_array_elements(result->'roster') with ordinality a(entry,n);
  return jsonb_set(result,'{roster}',rows);
end;
$$;

revoke all on function app.party_payment_note(uuid),api.update_payment_note(uuid,uuid,uuid,uuid,text,text),
  app.read_operation_before_payment_notes(uuid,uuid),api.read_operation(uuid,uuid),
  app.registration_view_before_payment_notes(uuid,uuid,uuid),app.registration_view(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function app.party_payment_note(uuid),api.update_payment_note(uuid,uuid,uuid,uuid,text,text),
  app.read_operation_before_payment_notes(uuid,uuid),api.read_operation(uuid,uuid),
  app.registration_view_before_payment_notes(uuid,uuid,uuid),app.registration_view(uuid,uuid,uuid)
  to service_role;
