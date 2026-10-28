-- P-35: an accepted member always has a profile, so the admin can see their
-- name and remove them.
create or replace function api.answer_group_request(p_actor_id uuid,p_key uuid,p_group_id uuid,p_request_id uuid,p_action text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare g app.groups; payload jsonb; r app.group_join_requests;
begin
  if p_action not in ('accept','decline') then raise check_violation using message='invalid_input'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text||p_key::text,0));
  payload:=jsonb_build_object('groupId',p_group_id,'requestId',p_request_id,'action',p_action);
  if app.group_receipt(p_actor_id,p_key,'answer_group_request',payload) then
    return jsonb_build_object('group',api.read_group(p_actor_id,p_group_id,null),'operationKey',p_key);
  end if;
  g:=app.lock_community_group(p_group_id);
  perform app.require_group_admin(p_actor_id,g.id);
  select * into r from app.group_join_requests where id=p_request_id and group_id=g.id for update;
  if not found or r.state<>'pending' then raise sqlstate 'P0001' using message='request_not_pending'; end if;
  update app.group_join_requests set state=case p_action when 'accept' then 'accepted' else 'declined' end,
    decided_at=clock_timestamp(),decided_by=p_actor_id where id=r.id;
  if p_action='accept' then
    insert into app.group_roles(group_id,user_id,role) values(g.id,r.user_id,'member') on conflict do nothing;
    -- Every member has a profile, so the admin can see and remove them by it.
    -- Someone who asked before ever opening the app may have none yet; use
    -- their latest booking name, else the neutral fallback, never contact data.
    insert into app.profiles(user_id,account_name)
      values(r.user_id,coalesce((select p.primary_name from app.parties p where p.user_id=r.user_id
        order by p.created_at desc,p.queue_sequence desc limit 1),'Participant'))
      on conflict(user_id) do nothing;
  end if;
  insert into app.operation_receipts values(p_actor_id,p_key,'answer_group_request',payload,r.id,now());
  return jsonb_build_object('group',api.read_group(p_actor_id,g.id,null),'operationKey',p_key);
end;
$$;
