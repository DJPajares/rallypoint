-- P-36 / WDL-414: Public or Private sessions. A session's details say who can
-- see it (details.access 'public', the default when missing, or 'private').
-- A private session is seen and joined only by its managers, the people and
-- community groups on its list, people with a pending invite or request, and
-- anyone who holds or held a party in it. Everyone else gets only the fact
-- that it's private. Taking someone off the list never touches a booking.
-- Nothing here sends email (owner, 2026-10-28).

alter table app.sessions add constraint sessions_access_check check (
  not (details ? 'access') or details->>'access' in ('public','private'));
-- Ask to join is for public sessions only.
alter table app.sessions add constraint sessions_private_direct_check check (
  not (details->>'access'='private' and details->>'joinMode'='request'));

create table app.session_access (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references app.sessions(id) on delete cascade,
  group_id uuid references app.groups(id) on delete cascade,
  user_id uuid,
  added_by uuid not null,
  created_at timestamptz not null default now(),
  check ((group_id is null) <> (user_id is null))
);
create unique index session_access_group on app.session_access(session_id,group_id) where group_id is not null;
create unique index session_access_user on app.session_access(session_id,user_id) where user_id is not null;
create index session_access_by_group on app.session_access(group_id) where group_id is not null;
create index session_access_by_user on app.session_access(user_id) where user_id is not null;
alter table app.session_access enable row level security;
revoke all on app.session_access from public,anon,authenticated;
grant select,insert,delete on app.session_access to service_role;

-- The one access rule. A null actor (signed out) sees public sessions only.
create function app.can_view_session(p_actor uuid,p_session uuid) returns boolean
language sql stable security invoker set search_path='' as $$
  select coalesce(s.details->>'access','public')<>'private' or (p_actor is not null and (
    app.is_session_manager(p_actor,s.group_id)
    or exists(select 1 from app.session_access a where a.session_id=s.id and a.user_id=p_actor)
    or exists(select 1 from app.session_access a
      join app.groups g on g.id=a.group_id and g.kind='community' and g.archived_at is null
      join app.group_roles r on r.group_id=g.id and r.user_id=p_actor
      where a.session_id=s.id)
    or exists(select 1 from app.invites i where i.session_id=s.id and i.invitee_id=p_actor and i.state='pending')
    or exists(select 1 from app.parties p where p.session_id=s.id and p.user_id=p_actor)
    or exists(select 1 from app.join_requests j where j.session_id=s.id and j.user_id=p_actor and j.state='pending')))
  from app.sessions s where s.id=p_session;
$$;

create function app.private_stub(p_slug uuid) returns jsonb
language sql immutable security invoker set search_path='' as $$
  select jsonb_build_object('slug',p_slug,'private',true);
$$;

-- Share read: an optional actor decides whether a private session shows.
alter function api.read_shared_session(uuid) rename to read_shared_session_before_private;
create function api.read_shared_session(p_slug uuid,p_actor_id uuid default null) returns jsonb
language plpgsql volatile security invoker set search_path='' as $$
declare result jsonb; sid uuid;
begin
  result:=api.read_shared_session_before_private(p_slug);
  if result is null then return null; end if;
  select id into sid from app.sessions where slug=p_slug;
  if not app.can_view_session(p_actor_id,sid) then return app.private_stub(p_slug); end if;
  return result;
end;
$$;

alter function api.read_registration(uuid,uuid) rename to read_registration_before_private;
create function api.read_registration(p_actor_id uuid,p_slug uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s app.sessions;
begin
  select * into s from app.sessions where slug=p_slug;
  if found and s.state<>'draft' and not app.can_view_session(p_actor_id,s.id) then
    return app.private_stub(p_slug);
  end if;
  return api.read_registration_before_private(p_actor_id,p_slug);
end;
$$;

-- Locks the session the way join and ask do (group, then session), then
-- refuses an actor without access. A retried request key is left to the
-- wrapped function, which answers it from its receipt.
create function app.assert_session_access(p_actor uuid,p_key uuid,p_slug uuid,p_ask boolean) returns void
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
end;
$$;

alter function api.join_session(uuid,uuid,uuid,integer,integer,text,text,boolean) rename to join_session_before_private;
create function api.join_session(p_actor_id uuid,p_key uuid,p_slug uuid,p_version integer,p_seats integer,p_guest_name text,p_primary_name text,p_consent boolean) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
  perform app.assert_session_access(p_actor_id,p_key,p_slug,false);
  return api.join_session_before_private(p_actor_id,p_key,p_slug,p_version,p_seats,p_guest_name,p_primary_name,p_consent);
end;
$$;

alter function api.ask_to_join(uuid,uuid,uuid,integer,integer,text,text,boolean) rename to ask_to_join_before_private;
create function api.ask_to_join(p_actor_id uuid,p_key uuid,p_slug uuid,p_version integer,p_seats integer,p_guest_name text,p_primary_name text,p_consent boolean) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
  perform app.assert_session_access(p_actor_id,p_key,p_slug,true);
  return api.ask_to_join_before_private(p_actor_id,p_key,p_slug,p_version,p_seats,p_guest_name,p_primary_name,p_consent);
end;
$$;

-- D-14: who can see a session is not part of the booked terms, and changing
-- it never needs a requester to keep their request.
create or replace function app.assert_booked_edit(p_old app.sessions,p_details jsonb) returns void
language plpgsql security invoker set search_path='' as $$
begin
  if exists (
    select 1 from (select jsonb_object_keys(p_old.details) k union select jsonb_object_keys(p_details)) keys
    where p_old.details->k is distinct from p_details->k
      and not (k='paymentMode' and coalesce(p_old.details->>k,'organizer')=coalesce(p_details->>k,'organizer'))
      and not (k='releaseUnpaid' and coalesce(p_old.details->k,'false'::jsonb)=coalesce(p_details->k,'false'::jsonb))
      and k not in ('title','activity','instructions','capacity','startLocal','endLocal','startsAt','endsAt','location','mapsLink','cutoffLocal','cutoffAt','joinMode','access')
  ) or ((p_old.details->>'cutoffAt')::timestamptz is distinct from (p_details->>'cutoffAt')::timestamptz
        and (p_old.details->>'startsAt')::timestamptz is not distinct from (p_details->>'startsAt')::timestamptz)
  then raise sqlstate 'P0001' using message='booked_event_locked'; end if;
  if clock_timestamp()>=(p_old.details->>'startsAt')::timestamptz then
    raise sqlstate 'P0001' using message='session_started';
  end if;
  if (p_details->>'startsAt')::timestamptz<=clock_timestamp() then
    raise sqlstate 'P0001' using message='future_start_required';
  end if;
  if coalesce((p_details->>'capacity')::bigint,0)<(select coalesce(sum(seats),0) from app.parties where session_id=p_old.id and state='confirmed') then
    raise sqlstate 'P0001' using message='capacity_below_confirmed';
  end if;
end;
$$;

create or replace function app.request_needs_confirm(p_request app.join_requests) returns boolean
language sql stable security invoker set search_path='' as $$
  select exists(select 1 from app.session_changes c
    where c.session_id=p_request.session_id and c.version>p_request.consent_version
      and (c.material or exists(select 1 from jsonb_array_elements_text(c.changed_fields) k(field)
        where k.field not in ('title','activity','instructions','joinMode','access','capacity','guests','openLocal','opensAt'))));
$$;

-- Replaces a session's list. New entries must be the saver's own community
-- groups or people they know; entries already on the list stay, so one
-- manager's save never fails over another manager's pick.
create function app.apply_session_access(p_actor uuid,p_session uuid,p_access jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare wanted_groups uuid[]; wanted_people uuid[]; wanted_users uuid[];
begin
  if jsonb_typeof(p_access)<>'object' or jsonb_typeof(coalesce(p_access->'groups','[]'))<>'array'
    or jsonb_typeof(coalesce(p_access->'people','[]'))<>'array' then
    raise check_violation using message='invalid_input'; end if;
  begin
    select coalesce(array_agg(distinct x::uuid),'{}') into wanted_groups from jsonb_array_elements_text(coalesce(p_access->'groups','[]')) x;
    select coalesce(array_agg(distinct x::uuid),'{}') into wanted_people from jsonb_array_elements_text(coalesce(p_access->'people','[]')) x;
  exception when invalid_text_representation then
    raise check_violation using message='invalid_input';
  end;
  if cardinality(wanted_groups)>20 or cardinality(wanted_people)>100 then
    raise check_violation using message='access_limit'; end if;
  if exists(select 1 from unnest(wanted_groups) w(id)
    where not exists(select 1 from app.session_access a where a.session_id=p_session and a.group_id=w.id)
      and not exists(select 1 from app.groups g join app.group_roles r on r.group_id=g.id and r.user_id=p_actor
        where g.id=w.id and g.kind='community' and g.archived_at is null)) then
    raise check_violation using message='access_group_invalid'; end if;
  select coalesce(array_agg(pr.user_id),'{}') into wanted_users from app.profiles pr where pr.profile_id=any(wanted_people);
  if cardinality(wanted_users)<>cardinality(wanted_people) or exists(select 1 from unnest(wanted_users) w(id)
    where not exists(select 1 from app.session_access a where a.session_id=p_session and a.user_id=w.id)
      and (w.id=p_actor or not exists(select 1 from app.known_people(p_actor) k where k.user_id=w.id))) then
    raise check_violation using message='access_person_invalid'; end if;
  delete from app.session_access where session_id=p_session
    and ((group_id is not null and group_id<>all(wanted_groups)) or (user_id is not null and user_id<>all(wanted_users)));
  insert into app.session_access(session_id,group_id,added_by)
    select p_session,w.id,p_actor from unnest(wanted_groups) w(id) on conflict do nothing;
  insert into app.session_access(session_id,user_id,added_by)
    select p_session,w.id,p_actor from unnest(wanted_users) w(id) on conflict do nothing;
end;
$$;

create function app.session_access_json(p_session uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object(
    'groups',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name) order by g.name,g.id)
      from app.session_access a join app.groups g on g.id=a.group_id where a.session_id=p_session),'[]'::jsonb),
    'people',coalesce((select jsonb_agg(jsonb_build_object('profileId',pr.profile_id,'name',coalesce(pr.display_name,pr.account_name))
        order by coalesce(pr.display_name,pr.account_name),pr.profile_id)
      from app.session_access a join app.profiles pr on pr.user_id=a.user_id where a.session_id=p_session),'[]'::jsonb));
$$;

alter function api.save_new_session(uuid,uuid,text,jsonb,text,uuid,uuid) rename to save_new_session_before_private;
create function api.save_new_session(p_actor_id uuid,p_key uuid,p_intent text,p_details jsonb,
  p_host_name text,p_from_session uuid,p_origin_group uuid default null,p_access jsonb default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb; sid uuid; source app.sessions;
begin
  result:=api.save_new_session_before_private(p_actor_id,p_key,p_intent,p_details,p_host_name,p_from_session,p_origin_group);
  sid:=(result->'session'->>'id')::uuid;
  perform 1 from app.sessions where id=sid for update;
  if p_access is not null then
    perform app.apply_session_access(p_actor_id,sid,p_access);
  elsif p_from_session is not null and not exists(select 1 from app.session_access where session_id=sid) then
    -- Run again copies the list as it is; only a manager of the source can.
    select * into source from app.sessions where id=p_from_session;
    if found and app.is_session_manager(p_actor_id,source.group_id) then
      insert into app.session_access(session_id,group_id,user_id,added_by)
        select sid,a.group_id,a.user_id,a.added_by from app.session_access a where a.session_id=source.id;
    end if;
  end if;
  return result;
end;
$$;

alter function api.update_session(uuid,uuid,uuid,text,integer,jsonb) rename to update_session_before_private;
create function api.update_session(p_actor_id uuid,p_key uuid,p_session_id uuid,p_intent text,
  p_version integer,p_details jsonb,p_access jsonb default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
  result:=api.update_session_before_private(p_actor_id,p_key,p_session_id,p_intent,p_version,p_details);
  if p_access is not null then
    perform 1 from app.sessions where id=p_session_id for update;
    perform app.apply_session_access(p_actor_id,p_session_id,p_access);
  end if;
  return result;
end;
$$;

-- Managers read the list with the session they edit.
alter function api.read_managed_session(uuid,uuid) rename to read_managed_session_before_private;
create function api.read_managed_session(p_actor_id uuid,p_session_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
  return api.read_managed_session_before_private(p_actor_id,p_session_id)
    ||jsonb_build_object('access',app.session_access_json(p_session_id));
end;
$$;

-- What the organizer can add: their own community groups and people they know.
create function api.session_access_options(p_actor_id uuid,p_query text) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare q text:=nullif(btrim(coalesce(p_query,'')),'');
begin
  if q is not null and char_length(q)>40 then raise check_violation using message='invalid_input'; end if;
  return jsonb_build_object(
    'groups',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name) order by g.name,g.id)
      from app.groups g join app.group_roles r on r.group_id=g.id and r.user_id=p_actor_id
      where g.kind='community' and g.archived_at is null
        and (q is null or position(lower(q) in lower(g.name))>0)),'[]'::jsonb),
    'people',coalesce((select jsonb_agg(x.j order by x.name,x.profile_id) from (
      select pr.profile_id,coalesce(pr.display_name,pr.account_name) name,
        jsonb_build_object('profileId',pr.profile_id,'name',coalesce(pr.display_name,pr.account_name),'title',app.visible_title(pr.user_id)) j
      from (select distinct k.user_id from app.known_people(p_actor_id) k where k.user_id<>p_actor_id) k
      join app.profiles pr on pr.user_id=k.user_id
      where q is null or position(lower(q) in lower(coalesce(pr.display_name,pr.account_name)))>0
      order by 2,1 limit 50) x),'[]'::jsonb));
end;
$$;

revoke all on function app.can_view_session(uuid,uuid),app.private_stub(uuid),
  api.read_shared_session(uuid,uuid),api.read_shared_session_before_private(uuid),
  api.read_registration(uuid,uuid),api.read_registration_before_private(uuid,uuid),
  app.assert_session_access(uuid,uuid,uuid,boolean),
  api.join_session(uuid,uuid,uuid,integer,integer,text,text,boolean),
  api.join_session_before_private(uuid,uuid,uuid,integer,integer,text,text,boolean),
  api.ask_to_join(uuid,uuid,uuid,integer,integer,text,text,boolean),
  api.ask_to_join_before_private(uuid,uuid,uuid,integer,integer,text,text,boolean),
  app.apply_session_access(uuid,uuid,jsonb),app.session_access_json(uuid),
  api.save_new_session(uuid,uuid,text,jsonb,text,uuid,uuid,jsonb),
  api.save_new_session_before_private(uuid,uuid,text,jsonb,text,uuid,uuid),
  api.update_session(uuid,uuid,uuid,text,integer,jsonb,jsonb),
  api.update_session_before_private(uuid,uuid,uuid,text,integer,jsonb),
  api.read_managed_session(uuid,uuid),api.read_managed_session_before_private(uuid,uuid),
  api.session_access_options(uuid,text)
  from public,anon,authenticated;
grant execute on function app.can_view_session(uuid,uuid),app.private_stub(uuid),
  api.read_shared_session(uuid,uuid),api.read_shared_session_before_private(uuid),
  api.read_registration(uuid,uuid),api.read_registration_before_private(uuid,uuid),
  app.assert_session_access(uuid,uuid,uuid,boolean),
  api.join_session(uuid,uuid,uuid,integer,integer,text,text,boolean),
  api.join_session_before_private(uuid,uuid,uuid,integer,integer,text,text,boolean),
  api.ask_to_join(uuid,uuid,uuid,integer,integer,text,text,boolean),
  api.ask_to_join_before_private(uuid,uuid,uuid,integer,integer,text,text,boolean),
  app.apply_session_access(uuid,uuid,jsonb),app.session_access_json(uuid),
  api.save_new_session(uuid,uuid,text,jsonb,text,uuid,uuid,jsonb),
  api.save_new_session_before_private(uuid,uuid,text,jsonb,text,uuid,uuid),
  api.update_session(uuid,uuid,uuid,text,integer,jsonb,jsonb),
  api.update_session_before_private(uuid,uuid,uuid,text,integer,jsonb),
  api.read_managed_session(uuid,uuid),api.read_managed_session_before_private(uuid,uuid),
  api.session_access_options(uuid,text)
  to service_role;
