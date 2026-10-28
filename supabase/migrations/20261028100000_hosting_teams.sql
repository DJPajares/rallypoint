-- P-35 / WDL-413: sessions stand alone; groups become member lists.
-- Every session now points at its own hidden hosting team (a group of kind
-- 'host') holding exactly the people who run it, so every existing manager
-- check keeps working and now means "manages this session". Groups people
-- see and join are kind 'community', each Public or Private with an invite
-- token. Nothing here is shown as a "team" anywhere.

alter table app.groups
  add column kind text not null default 'community' check (kind in ('community','host')),
  add column visibility text check (visibility in ('public','private')),
  add column invite_token uuid;

-- Who manages each session today, to prove the move changes nobody's access.
create temp table managers_before on commit drop as
  select s.id session_id, r.user_id, r.role
  from app.sessions s join app.group_roles r on r.group_id=s.group_id
  where r.role in ('owner','organizer','cohost');

do $$
declare s record; team uuid;
begin
  for s in select x.id, x.group_id, g.name, g.archived_at
      from app.sessions x join app.groups g on g.id=x.group_id loop
    insert into app.groups(name,kind,archived_at) values(s.name,'host',s.archived_at) returning id into team;
    insert into app.group_roles(group_id,user_id,role)
      select team,r.user_id,r.role from app.group_roles r
      where r.group_id=s.group_id and r.role in ('owner','organizer','cohost');
    update app.sessions set group_id=team where id=s.id;
  end loop;
end;
$$;

update app.groups set visibility='private',invite_token=gen_random_uuid() where kind='community';
update app.group_roles r set role='member' from app.groups g
  where g.id=r.group_id and g.kind='community' and r.role in ('organizer','cohost');

alter table app.groups add constraint groups_kind_fields_check check (
  (kind='host' and visibility is null and invite_token is null)
  or (kind='community' and visibility is not null and invite_token is not null));
alter table app.groups alter column visibility set default 'public';
alter table app.groups alter column invite_token set default gen_random_uuid();
-- A host row states its kind explicitly; the defaults above suit community rows.
create unique index groups_invite_token on app.groups(invite_token) where invite_token is not null;

do $$
begin
  if exists (
    (select session_id,user_id,role from managers_before
     except
     select s.id,r.user_id,r.role from app.sessions s join app.group_roles r on r.group_id=s.group_id
       where r.role in ('owner','organizer','cohost'))
    union all
    (select s.id,r.user_id,r.role from app.sessions s join app.group_roles r on r.group_id=s.group_id
       where r.role in ('owner','organizer','cohost')
     except
     select session_id,user_id,role from managers_before)
  ) then
    raise exception 'manager_set_changed';
  end if;
end;
$$;

-- A new session gets a fresh hosting team with its creator as organizer.
-- A replayed key reuses the team its first save recorded, so a retry never
-- makes a second one. Run again copies the source's co-hosts (never its
-- registrations, payments or attendance) when the creator manages it.
create function api.save_new_session(p_actor_id uuid,p_key uuid,p_intent text,p_details jsonb,
  p_host_name text,p_from_session uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare receipt app.operation_receipts; team uuid; source uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text||p_key::text,0));
  select * into receipt from app.operation_receipts where actor_id=p_actor_id and request_key=p_key;
  if found then
    if receipt.action<>'save_session' then raise sqlstate 'P0001' using message='idempotency_conflict'; end if;
    return api.save_session(p_actor_id,p_key,(receipt.payload->>'groupId')::uuid,null,p_intent,null,p_details);
  end if;
  if coalesce(length(btrim(p_host_name)),0) not between 1 and 100 then raise check_violation using message='invalid_input'; end if;
  insert into app.groups(name,kind,visibility,invite_token) values(btrim(p_host_name),'host',null,null) returning id into team;
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

-- Saving an existing session uses its own team, whatever group a client sends.
create function api.update_session(p_actor_id uuid,p_key uuid,p_session_id uuid,p_intent text,
  p_version integer,p_details jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare team uuid;
begin
  select group_id into team from app.sessions where id=p_session_id;
  if team is null then raise insufficient_privilege using message='group_access_denied'; end if;
  return api.save_session(p_actor_id,p_key,team,p_session_id,p_intent,p_version,p_details);
end;
$$;

revoke all on function api.save_new_session(uuid,uuid,text,jsonb,text,uuid),
  api.update_session(uuid,uuid,uuid,text,integer,jsonb) from public,anon,authenticated;
grant execute on function api.save_new_session(uuid,uuid,text,jsonb,text,uuid),
  api.update_session(uuid,uuid,uuid,text,integer,jsonb) to service_role;
