-- An organizer can delete a session that is still a draft, with the payment
-- instructions saved on it. Published, completed and cancelled sessions are
-- history and are never deleted. A draft has no bookings, fees, splits or
-- emails, so those tables are untouched (their foreign keys would refuse).
-- The function is security invoker, so the backend role needs delete on exactly
-- the tables it clears and nothing else.
grant delete on app.sessions, app.session_changes, app.payment_instructions,
  app.payment_instruction_notices, app.operation_receipts to service_role;

create function api.delete_draft(p_actor_id uuid, p_key uuid, p_session_id uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare s app.sessions; receipt app.operation_receipts;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text || p_key::text, 0));
  select * into receipt from app.operation_receipts where actor_id = p_actor_id and request_key = p_key;
  if found then
    if receipt.action <> 'delete_draft' or receipt.payload->>'sessionId' <> p_session_id::text then
      raise sqlstate 'P0001' using message = 'idempotency_conflict'; end if;
    return jsonb_build_object('deleted', true, 'groupId', receipt.payload->>'groupId');
  end if;
  select * into s from app.sessions where id = p_session_id;
  if not found then raise insufficient_privilege using message = 'session_unavailable'; end if;
  -- Same lock order as publishing: group row, then session row. A publish that
  -- got there first leaves a non-draft here; a delete that did leaves nothing
  -- for the publish to find.
  perform app.require_manager(p_actor_id, s.group_id);
  select * into s from app.sessions where id = p_session_id for update;
  if not found then raise insufficient_privilege using message = 'session_unavailable'; end if;
  if s.state <> 'draft' then raise sqlstate 'P0001' using message = 'not_a_draft'; end if;
  delete from app.payment_instruction_notices where session_id = s.id;
  delete from app.payment_instructions where session_id = s.id;
  delete from app.session_changes where session_id = s.id;
  delete from app.operation_receipts where resource_id = s.id;
  delete from app.sessions where id = s.id;
  insert into app.operation_receipts values(p_actor_id, p_key, 'delete_draft',
    jsonb_build_object('sessionId', s.id, 'groupId', s.group_id), s.id, clock_timestamp());
  return jsonb_build_object('deleted', true, 'groupId', s.group_id);
end;
$$;
revoke all on function api.delete_draft(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function api.delete_draft(uuid,uuid,uuid) to service_role;

-- Recovery after an interrupted delete: the receipt says it committed.
alter function api.read_operation(uuid,uuid) rename to read_operation_before_delete_draft;
alter function api.read_operation_before_delete_draft(uuid,uuid) set schema app;
create function api.read_operation(p_actor_id uuid, p_key uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare r app.operation_receipts;
begin
  select * into r from app.operation_receipts where actor_id = p_actor_id and request_key = p_key;
  if r.action = 'delete_draft' then
    return jsonb_build_object('operationKey', p_key, 'deleted', true, 'groupId', r.payload->>'groupId');
  end if;
  return app.read_operation_before_delete_draft(p_actor_id, p_key);
end;
$$;
revoke all on function api.read_operation(uuid,uuid) from public, anon, authenticated;
grant execute on function api.read_operation(uuid,uuid) to service_role;
