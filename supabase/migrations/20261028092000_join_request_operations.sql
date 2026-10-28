-- P-34 / WDL-412: "Check result" for an ask, cancel, keep, accept or decline
-- whose answer was lost. Receipts belong to their actor, so a key only ever
-- reads back its own action; answering actions recheck the manager role.
alter function api.read_operation(uuid,uuid) rename to read_operation_before_join_requests;
alter function api.read_operation_before_join_requests(uuid,uuid) set schema app;
create function api.read_operation(p_actor_id uuid, p_key uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare receipt app.operation_receipts; s app.sessions; n integer;
begin
  select * into receipt from app.operation_receipts where actor_id = p_actor_id and request_key = p_key;
  if not found or receipt.action not in ('ask_to_join','cancel_join_request','keep_join_request',
      'accept_join_request','decline_join_request','decline_pending_requests') then
    return app.read_operation_before_join_requests(p_actor_id, p_key);
  end if;
  select * into s from app.sessions where slug = (receipt.payload->>'slug')::uuid;
  if receipt.action in ('accept_join_request','decline_join_request','decline_pending_requests')
    and not app.is_session_manager(p_actor_id, s.group_id) then
    raise insufficient_privilege using message = 'group_access_denied';
  end if;
  if receipt.action = 'accept_join_request' then
    return jsonb_build_object('operationKey', p_key, 'registration', app.registration_view(p_actor_id, s.id),
      'accepted', app.accepted_result(receipt.resource_id));
  elsif receipt.action = 'decline_pending_requests' then
    select count(*) into n from app.join_requests where session_id = s.id and state = 'declined'
      and decided_by = p_actor_id and decided_at = receipt.created_at;
    return jsonb_build_object('operationKey', p_key, 'registration', app.registration_view(p_actor_id, s.id),
      'declined', n);
  end if;
  return jsonb_build_object('operationKey', p_key, 'registration', app.registration_view(p_actor_id, s.id));
end;
$$;

revoke all on function app.read_operation_before_join_requests(uuid,uuid), api.read_operation(uuid,uuid)
  from public, anon, authenticated;
grant execute on function app.read_operation_before_join_requests(uuid,uuid), api.read_operation(uuid,uuid)
  to service_role;
