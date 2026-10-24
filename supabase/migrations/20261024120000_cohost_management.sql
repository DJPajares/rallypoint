-- P-15: owner-managed co-hosts, chosen from this group's session registrants.
-- Role changes share the group lock with every manager mutation. No invitation,
-- ownership transfer, membership entry, registration or financial transition.
create table app.group_cohost_changes (
  id bigint generated always as identity primary key,
  group_id uuid not null references app.groups(id) on delete cascade,
  actor_id uuid not null,
  target_id uuid not null,
  before_role text check (before_role in ('member', 'cohost')),
  after_role text check (after_role in ('member', 'cohost')),
  created_at timestamptz not null default clock_timestamp(),
  check (before_role is distinct from after_role),
  check (before_role = 'cohost' or after_role = 'cohost')
);
create index group_cohost_changes_by_group on app.group_cohost_changes(group_id, id desc);
create index group_cohost_changes_by_target on app.group_cohost_changes(group_id, target_id, id desc);
alter table app.group_cohost_changes enable row level security;
revoke all on app.group_cohost_changes from public, anon, authenticated;
grant select, insert on app.group_cohost_changes to service_role;
grant usage on sequence app.group_cohost_changes_id_seq to service_role;
grant update, delete on app.group_roles to service_role;

create function app.require_group_owner(p_actor uuid, p_group uuid) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from app.groups where id = p_group for update;
  if not exists(select 1 from app.group_roles
    where group_id = p_group and user_id = p_actor and role = 'owner') then
    raise insufficient_privilege using message = 'group_owner_required';
  end if;
end;
$$;

create function api.read_group_cohosts(p_actor_id uuid, p_group_id uuid, p_after uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare candidates jsonb; assigned jsonb; next_cursor uuid; revision text;
begin
  perform app.require_group_owner(p_actor_id, p_group_id);
  -- Older fixtures/registrants may predate profiles. Give them a stable handle
  -- using a stored display name or the neutral fallback, never contact data.
  insert into app.profiles(user_id, account_name)
    select ids.user_id, coalesce((select p.primary_name from app.parties p
      where p.user_id = ids.user_id order by p.created_at desc, p.queue_sequence desc limit 1), 'Participant')
    from (select user_id from app.group_roles where group_id = p_group_id
      union select p.user_id from app.parties p join app.sessions s on s.id = p.session_id where s.group_id = p_group_id) ids
    where not exists(select 1 from app.profiles pr where pr.user_id = ids.user_id)
    on conflict(user_id) do nothing;

  select coalesce(max(id)::text, '0') into revision from app.group_cohost_changes where group_id = p_group_id;
  select coalesce(jsonb_agg(jsonb_build_object('profileId', pr.profile_id,
    'name', coalesce(pr.display_name, pr.account_name)) order by pr.profile_id), '[]'::jsonb)
    into assigned from app.group_roles r join app.profiles pr on pr.user_id = r.user_id
    where r.group_id = p_group_id and r.role = 'cohost';

  with page as (
    select pr.profile_id, coalesce(pr.display_name, pr.account_name) as name
    from app.profiles pr
    left join app.group_roles r on r.group_id = p_group_id and r.user_id = pr.user_id
    where (p_after is null or pr.profile_id > p_after)
      and (r.role is null or r.role = 'member')
      and exists(select 1 from app.parties p join app.sessions s on s.id = p.session_id
        where s.group_id = p_group_id and p.user_id = pr.user_id)
    order by pr.profile_id limit 51
  ), numbered as (select *, row_number() over(order by profile_id) as n from page)
  select coalesce(jsonb_agg(jsonb_build_object('profileId', profile_id, 'name', name)
    order by profile_id) filter(where n <= 50), '[]'::jsonb),
    case when count(*) > 50 then (array_agg(profile_id order by profile_id))[50] else null end
    into candidates, next_cursor from numbered;

  return jsonb_build_object('group', api.read_group_setup(p_actor_id, p_group_id),
    'revision', revision, 'assigned', assigned, 'candidates', candidates, 'nextCursor', next_cursor);
end;
$$;

create function api.update_group_cohost(p_actor_id uuid, p_key uuid, p_group_id uuid,
  p_profile_id uuid, p_action text, p_revision text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare receipt app.operation_receipts; payload jsonb; revision text; target uuid;
  prior_role text; restored_role text;
begin
  if p_key is null or p_group_id is null or p_profile_id is null
    or p_action is null or p_action not in ('add', 'remove')
    or p_revision is null or p_revision !~ '^(0|[1-9][0-9]{0,18})$' then
    raise check_violation using message = 'invalid_input';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text || p_key::text, 0));
  perform app.require_group_owner(p_actor_id, p_group_id);
  payload := jsonb_build_object('groupId', p_group_id, 'profileId', p_profile_id, 'action', p_action, 'revision', p_revision);
  select * into receipt from app.operation_receipts where actor_id = p_actor_id and request_key = p_key;
  if found then
    if receipt.action <> 'update_group_cohost' or receipt.payload <> payload then
      raise sqlstate 'P0001' using message = 'idempotency_conflict';
    end if;
    return jsonb_build_object('operationKey', p_key, 'cohosts', api.read_group_cohosts(p_actor_id, p_group_id, null));
  end if;
  select coalesce(max(id)::text, '0') into revision from app.group_cohost_changes where group_id = p_group_id;
  if revision <> p_revision then raise sqlstate 'P0001' using message = 'stale_cohosts'; end if;
  select user_id into target from app.profiles where profile_id = p_profile_id;
  if target is null then raise sqlstate 'P0001' using message = 'cohost_not_eligible'; end if;
  select role into prior_role from app.group_roles where group_id = p_group_id and user_id = target;
  if p_action = 'add' then
    if (prior_role is not null and prior_role <> 'member') or not exists(
      select 1 from app.parties p join app.sessions s on s.id = p.session_id
      where s.group_id = p_group_id and p.user_id = target) then
      raise sqlstate 'P0001' using message = 'cohost_not_eligible';
    end if;
    insert into app.group_roles(group_id, user_id, role) values(p_group_id, target, 'cohost')
      on conflict(group_id, user_id) do update set role = excluded.role;
    restored_role := 'cohost';
  else
    if prior_role is distinct from 'cohost' then raise sqlstate 'P0001' using message = 'cohost_not_eligible'; end if;
    -- Recover the membership that existed before this co-host grant. Legacy
    -- co-hosts without a recorded grant have no inferred ordinary membership.
    select before_role into restored_role from app.group_cohost_changes
      where group_id = p_group_id and target_id = target and after_role = 'cohost'
      order by id desc limit 1;
    if restored_role = 'member' then
      update app.group_roles set role = 'member' where group_id = p_group_id and user_id = target;
    else
      restored_role := null;
      delete from app.group_roles where group_id = p_group_id and user_id = target;
    end if;
  end if;
  insert into app.group_cohost_changes(group_id, actor_id, target_id, before_role, after_role)
    values(p_group_id, p_actor_id, target, prior_role, restored_role);
  insert into app.operation_receipts values(p_actor_id, p_key, 'update_group_cohost', payload, p_group_id, clock_timestamp());
  return jsonb_build_object('operationKey', p_key, 'cohosts', api.read_group_cohosts(p_actor_id, p_group_id, null));
end;
$$;

alter function api.read_operation(uuid, uuid) rename to read_operation_before_cohosts;
alter function api.read_operation_before_cohosts(uuid, uuid) set schema app;
create function api.read_operation(p_actor_id uuid, p_key uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare receipt app.operation_receipts;
begin
  select * into receipt from app.operation_receipts where actor_id = p_actor_id and request_key = p_key;
  if receipt.action = 'update_group_cohost' then
    return jsonb_build_object('operationKey', p_key,
      'cohosts', api.read_group_cohosts(p_actor_id, receipt.resource_id, null));
  end if;
  return app.read_operation_before_cohosts(p_actor_id, p_key);
end;
$$;

revoke all on function app.require_group_owner(uuid,uuid), api.read_group_cohosts(uuid,uuid,uuid),
  api.update_group_cohost(uuid,uuid,uuid,uuid,text,text), app.read_operation_before_cohosts(uuid,uuid),
  api.read_operation(uuid,uuid) from public, anon, authenticated;
grant execute on function app.require_group_owner(uuid,uuid), api.read_group_cohosts(uuid,uuid,uuid),
  api.update_group_cohost(uuid,uuid,uuid,uuid,text,text), app.read_operation_before_cohosts(uuid,uuid),
  api.read_operation(uuid,uuid) to service_role;
