-- A group owner can rename their group or remove it. Removing archives it:
-- nothing is deleted, the group just stops being listed and stops taking new
-- sessions. It is refused while any upcoming published session exists, because
-- that session's link would stay joinable otherwise.
alter table app.groups add column archived_at timestamptz;

create or replace function app.require_manager(p_actor uuid, p_group uuid) returns void
language plpgsql security invoker set search_path = '' as $$
declare archived timestamptz;
begin
  select archived_at into archived from app.groups where id=p_group for update;
  if archived is not null or not exists(select 1 from app.group_roles where group_id=p_group and user_id=p_actor and role in ('owner','organizer','cohost')) then
    raise insufficient_privilege using message='group_access_denied';
  end if;
end;
$$;

create or replace function api.list_my_groups(p_actor_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'role', r.role) order by g.name), '[]'::jsonb)
  from app.groups g join app.group_roles r on r.group_id = g.id
  where r.user_id = p_actor_id and g.archived_at is null;
$$;
create or replace function api.read_group_setup(p_actor_id uuid, p_group_id uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare result jsonb;
begin
  select jsonb_build_object('id', g.id, 'name', g.name, 'role', r.role) into result
  from app.groups g join app.group_roles r on r.group_id = g.id
  where g.id = p_group_id and r.user_id = p_actor_id and g.archived_at is null
    and r.role in ('owner', 'organizer', 'cohost');
  if result is null then raise insufficient_privilege using message = 'group_access_denied'; end if;
  return result;
end;
$$;

-- Owner only. A retry with the same key returns the same answer, even after the
-- group has since been removed.
create function api.rename_group(p_actor_id uuid, p_key uuid, p_group_id uuid, p_name text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare receipt app.operation_receipts; g app.groups; payload jsonb;
begin
  p_name := trim(p_name);
  if length(p_name) not between 1 and 100 then raise check_violation using message='invalid_input'; end if;
  payload := jsonb_build_object('groupId',p_group_id,'name',p_name);
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text || p_key::text,0));
  select * into receipt from app.operation_receipts where actor_id=p_actor_id and request_key=p_key;
  if found then
    if receipt.action <> 'rename_group' or receipt.payload <> payload then raise sqlstate 'P0001' using message='idempotency_conflict'; end if;
    return jsonb_build_object('group',jsonb_build_object('id',p_group_id,'name',p_name,'role','owner'));
  end if;
  select * into g from app.groups where id=p_group_id for update;
  if not found or g.archived_at is not null
    or not exists(select 1 from app.group_roles where group_id=p_group_id and user_id=p_actor_id and role='owner') then
    raise insufficient_privilege using message='group_access_denied';
  end if;
  update app.groups set name=p_name where id=p_group_id;
  insert into app.operation_receipts values(p_actor_id,p_key,'rename_group',payload,p_group_id,now());
  return jsonb_build_object('group',jsonb_build_object('id',p_group_id,'name',p_name,'role','owner'));
end;
$$;

create function api.archive_group(p_actor_id uuid, p_key uuid, p_group_id uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare receipt app.operation_receipts; g app.groups; payload jsonb;
begin
  payload := jsonb_build_object('groupId',p_group_id);
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text || p_key::text,0));
  select * into receipt from app.operation_receipts where actor_id=p_actor_id and request_key=p_key;
  if found then
    if receipt.action <> 'archive_group' or receipt.payload <> payload then raise sqlstate 'P0001' using message='idempotency_conflict'; end if;
    return jsonb_build_object('archived',true);
  end if;
  select * into g from app.groups where id=p_group_id for update;
  if not found or g.archived_at is not null
    or not exists(select 1 from app.group_roles where group_id=p_group_id and user_id=p_actor_id and role='owner') then
    raise insufficient_privilege using message='group_access_denied';
  end if;
  -- Booked or not: an upcoming published session still has a live join link.
  if exists(select 1 from app.sessions s where s.group_id=p_group_id and s.state='published'
    and coalesce((s.details->>'startsAt')::timestamptz > now(), false)) then
    raise sqlstate 'P0001' using message='group_has_upcoming';
  end if;
  update app.groups set archived_at=now() where id=p_group_id;
  insert into app.operation_receipts values(p_actor_id,p_key,'archive_group',payload,p_group_id,now());
  return jsonb_build_object('archived',true);
end;
$$;
revoke all on function api.rename_group(uuid,uuid,uuid,text),api.archive_group(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function api.rename_group(uuid,uuid,uuid,text),api.archive_group(uuid,uuid,uuid) to service_role;

-- A draft in a removed group would sit in Coming up with nowhere to go. Leave it
-- out; the draft itself is kept.
create or replace function api.list_my_sessions(p_actor_id uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare result jsonb;
begin
  with mine as (
    select s.id, s.slug, s.state, s.details, g.name as group_name,
      exists (select 1 from app.group_roles r
        where r.group_id = s.group_id and r.user_id = p_actor_id
          and r.role in ('owner', 'organizer', 'cohost')) as manages,
      (select p.state from app.parties p
        where p.session_id = s.id and p.user_id = p_actor_id
          and p.state in ('confirmed', 'waitlisted')
        order by p.queue_sequence desc limit 1) as party_state,
      (select p.queue_sequence from app.parties p
        where p.session_id = s.id and p.user_id = p_actor_id
          and p.state in ('confirmed', 'waitlisted')
        order by p.queue_sequence desc limit 1) as party_sequence
    from app.sessions s join app.groups g on g.id = s.group_id
    where (exists (select 1 from app.group_roles r
        where r.group_id = s.group_id and r.user_id = p_actor_id
          and r.role in ('owner', 'organizer', 'cohost'))
      or (s.state <> 'draft' and exists (select 1 from app.parties p
        where p.session_id = s.id and p.user_id = p_actor_id
          and p.state in ('confirmed', 'waitlisted'))))
      and not exists (select 1 from app.session_cancellations c
        where c.session_id = s.id and c.previous_state = 'draft')
      and not (s.state = 'draft' and g.archived_at is not null)
  ), shaped as (
    select m.*,
      case when m.state = 'cancelled' then 'cancelled'
        when m.state = 'draft' then 'draft'
        when m.manages then 'organizing'
        when m.party_state = 'confirmed' then 'in'
        else 'waitlisted' end as status,
      (m.details->>'startsAt')::timestamptz as starts_at,
      (m.details->>'endsAt')::timestamptz as ends_at
    from mine m
  ), rows_ as (
    select x.*,
      case when x.state = 'draft' then false
        when x.state = 'cancelled' then coalesce(x.starts_at <= now(), false)
        else coalesce(x.ends_at <= now(), false) end as over,
      jsonb_build_object(
        'id', case when x.state = 'draft' then x.id else null end,
        'slug', x.slug,
        'title', x.details->>'title',
        'groupName', x.group_name,
        'startLocal', coalesce(x.details->>'startLocal', ''),
        'startsAt', x.details->>'startsAt',
        'endsAt', x.details->>'endsAt',
        'timeZone', x.details->>'timeZone',
        'state', x.state,
        'status', x.status,
        'waitPosition', case when x.status = 'waitlisted' then
          (select count(*) + 1 from app.parties w
            where w.session_id = x.id and w.state = 'waitlisted'
              and w.queue_sequence < x.party_sequence) else null end
      ) as item
    from shaped x
  )
  select jsonb_build_object(
    'upcoming', coalesce((select jsonb_agg(u.item order by u.starts_at asc nulls last, u.item->>'title') from (
      select item, starts_at from rows_ where not over
      order by starts_at asc nulls last, item->>'title' limit 100) u), '[]'::jsonb),
    'past', coalesce((select jsonb_agg(q.item order by q.starts_at desc) from (
      select item, starts_at from rows_ where over
      order by starts_at desc limit 20) q), '[]'::jsonb),
    'pastTotal', (select count(*) from rows_ where over)
  ) into result;
  return result;
end;
$$;
revoke all on function api.list_my_sessions(uuid) from public, anon, authenticated;
grant execute on function api.list_my_sessions(uuid) to service_role;
