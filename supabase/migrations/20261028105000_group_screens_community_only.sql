-- P-35 review: a session's hidden hosting team is never a group, so it can't
-- be renamed or removed through the group screens.

create or replace function api.rename_group(p_actor_id uuid, p_key uuid, p_group_id uuid, p_name text) returns jsonb
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
    or not exists(select 1 from app.group_roles where group_id=p_group_id and user_id=p_actor_id and role='owner')
    or g.kind<>'community' then
    raise insufficient_privilege using message='group_access_denied';
  end if;
  update app.groups set name=p_name where id=p_group_id;
  insert into app.operation_receipts values(p_actor_id,p_key,'rename_group',payload,p_group_id,now());
  return jsonb_build_object('group',jsonb_build_object('id',p_group_id,'name',p_name,'role','owner'));
end;
$$;

create or replace function api.archive_group(p_actor_id uuid, p_key uuid, p_group_id uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare receipt app.operation_receipts; g app.groups; payload jsonb;
begin
  payload := jsonb_build_object('groupId',p_group_id);
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text || p_key::text,0));
  select * into receipt from app.operation_receipts where actor_id=p_actor_id and request_key=p_key;
  -- On purpose: a replay returns the stored result before re-checking the role or archive state.
  if found then
    if receipt.action <> 'archive_group' or receipt.payload <> payload then raise sqlstate 'P0001' using message='idempotency_conflict'; end if;
    return jsonb_build_object('archived',true);
  end if;
  select * into g from app.groups where id=p_group_id for update;
  if not found or g.archived_at is not null
    or not exists(select 1 from app.group_roles where group_id=p_group_id and user_id=p_actor_id and role='owner')
    or g.kind<>'community' then
    raise insufficient_privilege using message='group_access_denied';
  end if;
  -- Booked or not: an upcoming or in-progress published session still has a live join link.
  if exists(select 1 from app.sessions s where s.group_id=p_group_id and s.state='published'
    and coalesce((s.details->>'endsAt')::timestamptz > now() or (s.details->>'startsAt')::timestamptz > now(), false)) then
    raise sqlstate 'P0001' using message='group_has_upcoming';
  end if;
  update app.groups set archived_at=now() where id=p_group_id;
  insert into app.operation_receipts values(p_actor_id,p_key,'archive_group',payload,p_group_id,now());
  return jsonb_build_object('archived',true);
end;
$$;
