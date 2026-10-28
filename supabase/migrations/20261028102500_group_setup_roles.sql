-- P-35: the group setup screen speaks of an admin and members, and only for
-- groups people join (never a session's hosting team).
create or replace function api.read_group_setup(p_actor_id uuid, p_group_id uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare result jsonb;
begin
  select jsonb_build_object('id', g.id, 'name', g.name, 'visibility', g.visibility,
      'role', case r.role when 'owner' then 'admin' else 'member' end) into result
  from app.groups g join app.group_roles r on r.group_id = g.id
  where g.id = p_group_id and r.user_id = p_actor_id and g.archived_at is null
    and g.kind = 'community' and r.role = 'owner';
  if result is null then raise insufficient_privilege using message = 'group_access_denied'; end if;
  return result;
end;
$$;
