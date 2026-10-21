-- Foundation only. No public role-assignment or group-creation policy is implied.
create schema if not exists app;
create schema if not exists api;
revoke all on schema app from public, anon, authenticated;
revoke all on schema api from public, anon, authenticated;
grant usage on schema app, api to service_role;

create table app.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 100),
  created_at timestamptz not null default now()
);
create table app.group_roles (
  group_id uuid not null references app.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'organizer', 'cohost', 'member')),
  primary key (group_id, user_id)
);
create index group_roles_by_user on app.group_roles(user_id, group_id);
alter table app.groups enable row level security;
alter table app.group_roles enable row level security;
-- No browser policies or raw write grants. The Worker checks the identity first.
revoke all on all tables in schema app from public, anon, authenticated;
grant select on app.groups, app.group_roles to service_role;
alter default privileges in schema api revoke execute on functions from public, anon, authenticated;

create function api.list_my_groups(p_actor_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'role', r.role) order by g.name), '[]'::jsonb)
  from app.groups g join app.group_roles r on r.group_id = g.id
  where r.user_id = p_actor_id;
$$;
create function api.read_group_setup(p_actor_id uuid, p_group_id uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare result jsonb;
begin
  select jsonb_build_object('id', g.id, 'name', g.name, 'role', r.role) into result
  from app.groups g join app.group_roles r on r.group_id = g.id
  where g.id = p_group_id and r.user_id = p_actor_id
    and r.role in ('owner', 'organizer', 'cohost');
  if result is null then raise insufficient_privilege using message = 'group_access_denied'; end if;
  return result;
end;
$$;
revoke all on function api.list_my_groups(uuid) from public, anon, authenticated;
revoke all on function api.read_group_setup(uuid, uuid) from public, anon, authenticated;
grant execute on function api.list_my_groups(uuid), api.read_group_setup(uuid, uuid) to service_role;
