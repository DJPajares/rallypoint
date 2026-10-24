-- Removing a group must only stop new sessions. Every other management path
-- (settling fees, attendance, reading records, cancelling) keeps working on a
-- removed group's past sessions, so the archived refusal moves out of the shared
-- require_manager (restored to its original body) and into save_session alone.
create or replace function app.require_manager(p_actor uuid, p_group uuid) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from app.groups where id=p_group for update;
  if not exists(select 1 from app.group_roles where group_id=p_group and user_id=p_actor and role in ('owner','organizer','cohost')) then
    raise insufficient_privilege using message='group_access_denied';
  end if;
end;
$$;

create or replace function api.save_session(p_actor_id uuid,p_key uuid,p_group_id uuid,p_session_id uuid,p_intent text,p_version integer,p_details jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s app.sessions;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text||p_key::text,0));
  perform app.require_manager(p_actor_id,p_group_id);
  if (select archived_at from app.groups where id=p_group_id) is not null then
    raise insufficient_privilege using message='group_access_denied';
  end if;
  if p_session_id is not null then
    select * into s from app.sessions where id=p_session_id and group_id=p_group_id for update;
    if s.state in ('cancelled','completed') and not exists(
      select 1 from app.operation_receipts where actor_id=p_actor_id and request_key=p_key) then
      raise sqlstate 'P0001' using message='session_closed';end if;
  end if;
  return app.save_session_before_cancellation(p_actor_id,p_key,p_group_id,p_session_id,p_intent,p_version,p_details);
end;
$$;

-- A session that has started but not ended still has a live page, so it blocks
-- removal too.
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
    or not exists(select 1 from app.group_roles where group_id=p_group_id and user_id=p_actor_id and role='owner') then
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
