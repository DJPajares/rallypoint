-- P-15 review: even an already-deleted draft's management receipt must recheck
-- current access. The receipt retains its group because the draft row is gone.
-- Keep the prior deletion implementation and its narrow definer cleanup intact.
alter function api.delete_draft(uuid,uuid,uuid) rename to delete_draft_before_cohost_recovery;
alter function api.delete_draft_before_cohost_recovery(uuid,uuid,uuid) set schema app;
create function api.delete_draft(p_actor_id uuid, p_key uuid, p_session_id uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare receipt app.operation_receipts;
begin
  -- Preserve actor/key -> group lock order, including simultaneous replays.
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text || p_key::text, 0));
  select * into receipt from app.operation_receipts where actor_id = p_actor_id and request_key = p_key;
  if receipt.action = 'delete_draft' then
    perform app.require_manager(p_actor_id, (receipt.payload->>'groupId')::uuid);
  end if;
  return app.delete_draft_before_cohost_recovery(p_actor_id, p_key, p_session_id);
end;
$$;

alter function api.read_operation(uuid,uuid) rename to read_operation_before_cohost_recovery;
alter function api.read_operation_before_cohost_recovery(uuid,uuid) set schema app;
create function api.read_operation(p_actor_id uuid, p_key uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare receipt app.operation_receipts;
begin
  select * into receipt from app.operation_receipts where actor_id = p_actor_id and request_key = p_key;
  if receipt.action = 'delete_draft' then
    perform app.require_manager(p_actor_id, (receipt.payload->>'groupId')::uuid);
  end if;
  return app.read_operation_before_cohost_recovery(p_actor_id, p_key);
end;
$$;

revoke all on function app.delete_draft_before_cohost_recovery(uuid,uuid,uuid),
  api.delete_draft(uuid,uuid,uuid), app.read_operation_before_cohost_recovery(uuid,uuid),
  api.read_operation(uuid,uuid) from public, anon, authenticated;
grant execute on function app.delete_draft_before_cohost_recovery(uuid,uuid,uuid),
  api.delete_draft(uuid,uuid,uuid), app.read_operation_before_cohost_recovery(uuid,uuid),
  api.read_operation(uuid,uuid) to service_role;
