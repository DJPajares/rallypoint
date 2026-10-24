-- Deleting a draft must not give the backend role table-wide DELETE: history
-- tables stay append-only for service_role (see propagate_name). Take back the
-- grants the first delete_draft migration added (no older migration granted
-- DELETE on any of these five tables) and do the deleting in one narrow
-- function instead.
revoke delete on app.sessions, app.session_changes, app.payment_instructions,
  app.payment_instruction_notices, app.operation_receipts from service_role;

-- Runs as the table owner. It can only remove one session that is a draft, plus
-- that draft's own payment notices, payment instructions, change rows and
-- request receipts; it refuses (and deletes nothing) for any other state.
-- Callable only through api.delete_draft (execute is granted to service_role
-- alone) and it takes the session id, never a filter.
create function app.delete_draft_rows(p_session uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare gone uuid;
begin
  -- Confirm the parent is a draft first; the children are only touched after.
  perform 1 from app.sessions where id = p_session and state = 'draft' for update;
  if not found then raise sqlstate 'P0001' using message = 'not_a_draft'; end if;
  delete from app.payment_instruction_notices where session_id = p_session;
  delete from app.payment_instructions where session_id = p_session;
  delete from app.session_changes where session_id = p_session;
  delete from app.operation_receipts where resource_id = p_session;
  delete from app.sessions where id = p_session and state = 'draft' returning id into gone;
  if gone is null then raise sqlstate 'P0001' using message = 'not_a_draft'; end if;
end;
$$;
revoke all on function app.delete_draft_rows(uuid) from public, anon, authenticated;
grant execute on function app.delete_draft_rows(uuid) to service_role;

create or replace function api.delete_draft(p_actor_id uuid, p_key uuid, p_session_id uuid) returns jsonb
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
  perform app.delete_draft_rows(s.id);
  insert into app.operation_receipts values(p_actor_id, p_key, 'delete_draft',
    jsonb_build_object('sessionId', s.id, 'groupId', s.group_id), s.id, clock_timestamp());
  return jsonb_build_object('deleted', true, 'groupId', s.group_id);
end;
$$;
