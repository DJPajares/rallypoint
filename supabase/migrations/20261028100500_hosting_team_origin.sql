-- P-35 / WDL-413: a hosting team remembers the group a session was created
-- from, when an older client created it from a group page. Provenance only:
-- it grants nobody anything, and sessions created on their own have none.
alter table app.groups add column origin_group_id uuid references app.groups(id);
alter table app.groups add constraint groups_origin_host_only check (origin_group_id is null or kind='host');

drop function api.save_new_session(uuid,uuid,text,jsonb,text,uuid);
create function api.save_new_session(p_actor_id uuid,p_key uuid,p_intent text,p_details jsonb,
  p_host_name text,p_from_session uuid,p_origin_group uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare receipt app.operation_receipts; team uuid; source uuid; origin uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text||p_key::text,0));
  select * into receipt from app.operation_receipts where actor_id=p_actor_id and request_key=p_key;
  if found then
    if receipt.action<>'save_session' then raise sqlstate 'P0001' using message='idempotency_conflict'; end if;
    return api.save_session(p_actor_id,p_key,(receipt.payload->>'groupId')::uuid,null,p_intent,null,p_details);
  end if;
  if coalesce(length(btrim(p_host_name)),0) not between 1 and 100 then raise check_violation using message='invalid_input'; end if;
  -- Recorded only for a community group the creator belongs to.
  select g.id into origin from app.groups g join app.group_roles r on r.group_id=g.id
    where g.id=p_origin_group and g.kind='community' and r.user_id=p_actor_id;
  insert into app.groups(name,kind,visibility,invite_token,origin_group_id)
    values(btrim(p_host_name),'host',null,null,origin) returning id into team;
  insert into app.group_roles(group_id,user_id,role) values(team,p_actor_id,'owner');
  if p_from_session is not null then
    select s.group_id into source from app.sessions s where s.id=p_from_session;
    if source is not null and app.is_session_manager(p_actor_id,source) then
      insert into app.group_roles(group_id,user_id,role)
        select team,r.user_id,'cohost' from app.group_roles r
        where r.group_id=source and r.role='cohost' and r.user_id<>p_actor_id
        on conflict do nothing;
    end if;
  end if;
  return api.save_session(p_actor_id,p_key,team,null,p_intent,null,p_details);
end;
$$;
revoke all on function api.save_new_session(uuid,uuid,text,jsonb,text,uuid,uuid) from public,anon,authenticated;
grant execute on function api.save_new_session(uuid,uuid,text,jsonb,text,uuid,uuid) to service_role;
