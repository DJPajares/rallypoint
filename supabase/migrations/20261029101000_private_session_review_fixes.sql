-- P-36 / WDL-414 review fixes.
-- 1. Seeing a private session and joining it are different. A pending request
--    lets someone see their request, never join without Accept; a withdrawn
--    or removed party lets someone see what they owe, never rejoin once
--    they're off the list.
-- 2. A replayed ask, or an old request's result read again, shows only that
--    the session is private once the person has no access.
-- 3. The Sessions tab leaves out private sessions the person can't see, such
--    as one whose request was declined before it went private.

create function app.can_join_session(p_actor uuid,p_session uuid) returns boolean
language sql stable security invoker set search_path='' as $$
  select coalesce(s.details->>'access','public')<>'private' or (p_actor is not null and (
    app.is_session_manager(p_actor,s.group_id)
    or exists(select 1 from app.session_access a where a.session_id=s.id and a.user_id=p_actor)
    or exists(select 1 from app.session_access a
      join app.groups g on g.id=a.group_id and g.kind='community' and g.archived_at is null
      join app.group_roles r on r.group_id=g.id and r.user_id=p_actor
      where a.session_id=s.id)
    or exists(select 1 from app.invites i where i.session_id=s.id and i.invitee_id=p_actor and i.state='pending')
    or exists(select 1 from app.parties p where p.session_id=s.id and p.user_id=p_actor
      and p.state in ('confirmed','waitlisted'))))
  from app.sessions s where s.id=p_session;
$$;

create or replace function app.assert_session_access(p_actor uuid,p_key uuid,p_slug uuid,p_ask boolean) returns void
language plpgsql security invoker set search_path='' as $$
declare s app.sessions;
begin
  if exists(select 1 from app.operation_receipts where actor_id=p_actor and request_key=p_key) then return; end if;
  select * into s from app.sessions where slug=p_slug;
  if not found or s.state='draft' then return; end if;
  perform 1 from app.groups where id=s.group_id for update;
  select * into s from app.sessions where id=s.id for update;
  if not app.can_view_session(p_actor,s.id)
    or (p_ask and coalesce(s.details->>'access','public')='private') then
    raise insufficient_privilege using message='session_private';
  end if;
  if not p_ask and not app.can_join_session(p_actor,s.id) then
    if exists(select 1 from app.join_requests j where j.session_id=s.id and j.user_id=p_actor and j.state='pending') then
      raise sqlstate 'P0001' using message='request_required';
    end if;
    raise insufficient_privilege using message='session_private';
  end if;
end;
$$;

-- Replaces a result's registration with the private answer when the actor
-- can no longer see the session.
create function app.hide_private_registration(p_actor uuid,p_slug uuid,p_result jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare sid uuid;
begin
  if p_result is null or not (p_result ? 'registration') or p_slug is null then return p_result; end if;
  select id into sid from app.sessions where slug=p_slug;
  if sid is null or app.can_view_session(p_actor,sid) then return p_result; end if;
  return p_result||jsonb_build_object('registration',app.private_stub(p_slug));
end;
$$;

create or replace function api.join_session(p_actor_id uuid,p_key uuid,p_slug uuid,p_version integer,p_seats integer,p_guest_name text,p_primary_name text,p_consent boolean) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
  perform app.assert_session_access(p_actor_id,p_key,p_slug,false);
  return app.hide_private_registration(p_actor_id,p_slug,
    api.join_session_before_private(p_actor_id,p_key,p_slug,p_version,p_seats,p_guest_name,p_primary_name,p_consent));
end;
$$;

create or replace function api.ask_to_join(p_actor_id uuid,p_key uuid,p_slug uuid,p_version integer,p_seats integer,p_guest_name text,p_primary_name text,p_consent boolean) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
  perform app.assert_session_access(p_actor_id,p_key,p_slug,true);
  return app.hide_private_registration(p_actor_id,p_slug,
    api.ask_to_join_before_private(p_actor_id,p_key,p_slug,p_version,p_seats,p_guest_name,p_primary_name,p_consent));
end;
$$;

alter function api.read_operation(uuid,uuid) rename to read_operation_before_private;
create function api.read_operation(p_actor_id uuid,p_key uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare slug uuid;
begin
  select (r.payload->>'slug')::uuid into slug from app.operation_receipts r
    where r.actor_id=p_actor_id and r.request_key=p_key;
  return app.hide_private_registration(p_actor_id,slug,api.read_operation_before_private(p_actor_id,p_key));
end;
$$;

alter function api.list_my_sessions(uuid) rename to list_my_sessions_before_private;
create function api.list_my_sessions(p_actor_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb; hidden integer;
begin
  result:=api.list_my_sessions_before_private(p_actor_id);
  select count(*) into hidden from jsonb_array_elements(result->'past') x
    join app.sessions s on s.slug=(x->>'slug')::uuid where not app.can_view_session(p_actor_id,s.id);
  return result||jsonb_build_object(
    'upcoming',coalesce((select jsonb_agg(x order by n) from jsonb_array_elements(result->'upcoming') with ordinality u(x,n)
      join app.sessions s on s.slug=(x->>'slug')::uuid where app.can_view_session(p_actor_id,s.id)),'[]'::jsonb),
    'past',coalesce((select jsonb_agg(x order by n) from jsonb_array_elements(result->'past') with ordinality u(x,n)
      join app.sessions s on s.slug=(x->>'slug')::uuid where app.can_view_session(p_actor_id,s.id)),'[]'::jsonb),
    'pastTotal',(result->>'pastTotal')::integer-hidden);
end;
$$;

revoke all on function app.can_join_session(uuid,uuid),app.hide_private_registration(uuid,uuid,jsonb),
  api.read_operation(uuid,uuid),api.read_operation_before_private(uuid,uuid),
  api.list_my_sessions(uuid),api.list_my_sessions_before_private(uuid)
  from public,anon,authenticated;
grant execute on function app.can_join_session(uuid,uuid),app.hide_private_registration(uuid,uuid,jsonb),
  api.read_operation(uuid,uuid),api.read_operation_before_private(uuid,uuid),
  api.list_my_sessions(uuid),api.list_my_sessions_before_private(uuid)
  to service_role;
