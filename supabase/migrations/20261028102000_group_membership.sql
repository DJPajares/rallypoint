-- P-35 / WDL-413: groups are member lists. A group is Public or Private.
-- People ask to join, through the admin's invite link (any group) or the
-- Join button (public groups); the admin (the group's owner) accepts or
-- declines every request. Members see who else belongs; only the admin sees
-- requests and the invite link. A private group shows nothing to someone
-- without a valid link. No email.

create table app.group_join_requests (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references app.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  state text not null default 'pending' check (state in ('pending','accepted','declined','cancelled')),
  asked_at timestamptz not null default clock_timestamp(),
  decided_at timestamptz,
  decided_by uuid references auth.users(id) on delete set null
);
create unique index group_join_requests_one_pending on app.group_join_requests(group_id,user_id) where state='pending';
create index group_join_requests_pending_by_user on app.group_join_requests(user_id) where state='pending';
create index group_join_requests_by_group on app.group_join_requests(group_id,asked_at);
alter table app.group_join_requests enable row level security;
revoke all on app.group_join_requests from public,anon,authenticated;
grant select,insert,update on app.group_join_requests to service_role;
grant delete on app.group_roles to service_role;

-- A group people can see and join, locked; hosting teams and removed groups
-- are simply not there.
create function app.lock_community_group(p_group uuid) returns app.groups
language plpgsql security invoker set search_path='' as $$
declare g app.groups;
begin
  select * into g from app.groups where id=p_group and kind='community' and archived_at is null for update;
  if not found then raise no_data_found using message='group_not_found'; end if;
  return g;
end;
$$;

create function app.deny_group() returns void
language plpgsql security invoker set search_path='' as $$
begin
  raise insufficient_privilege using message='group_access_denied';
end;
$$;
create function app.require_group_admin(p_actor uuid,p_group uuid) returns void
language sql stable security invoker set search_path='' as $$
  select case when exists(select 1 from app.group_roles where group_id=p_group and user_id=p_actor and role='owner')
    then null else app.deny_group() end;
$$;

create function api.read_group(p_actor_id uuid,p_group_id uuid,p_invite uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare g app.groups; my_role text; result jsonb; r app.group_join_requests;
begin
  select * into g from app.groups where id=p_group_id and kind='community' and archived_at is null;
  if not found then raise no_data_found using message='group_not_found'; end if;
  select role into my_role from app.group_roles where group_id=g.id and user_id=p_actor_id;
  if my_role is null and g.visibility='private' and p_invite is distinct from g.invite_token then
    return jsonb_build_object('id',g.id,'visibility','private','concealed',true);
  end if;
  select * into r from app.group_join_requests where group_id=g.id and user_id=p_actor_id
    order by asked_at desc,id desc limit 1;
  result:=jsonb_build_object('id',g.id,'name',g.name,'visibility',g.visibility,
    'viewerRole',case my_role when 'owner' then 'admin' when 'member' then 'member' end,
    'memberCount',(select count(*) from app.group_roles where group_id=g.id),
    'canAsk',my_role is null,
    'request',case when my_role is null and r.id is not null and r.state in ('pending','declined')
      then jsonb_build_object('id',r.id,'state',r.state) end);
  if my_role is not null then
    result:=result||jsonb_build_object('members',(select coalesce(jsonb_agg(jsonb_build_object(
        'profileId',p.profile_id,'name',coalesce(p.display_name,p.account_name,'Participant'),
        'title',app.visible_title(m.user_id),'role',case m.role when 'owner' then 'admin' else 'member' end)
      order by m.role<>'owner',lower(coalesce(p.display_name,p.account_name))),'[]'::jsonb)
      from app.group_roles m left join app.profiles p on p.user_id=m.user_id where m.group_id=g.id));
  end if;
  if my_role='owner' then
    result:=result||jsonb_build_object('inviteToken',g.invite_token,
      'requests',(select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'profileId',p.profile_id,
          'name',coalesce(p.display_name,p.account_name,'Participant'),'title',app.visible_title(q.user_id),
          'played',(select count(*) from app.badge_sessions(q.user_id)),
          'hosted',(select count(*) from app.badge_hosted(q.user_id)),
          'askedAt',q.asked_at) order by q.asked_at,q.id),'[]'::jsonb)
        from app.group_join_requests q left join app.profiles p on p.user_id=q.user_id
        where q.group_id=g.id and q.state='pending'));
  end if;
  return result;
end;
$$;

-- Shared receipt handling for group writes: a replay returns the group as it
-- is now; a key reused for something else is a conflict.
create function app.group_receipt(p_actor uuid,p_key uuid,p_action text,p_payload jsonb) returns boolean
language plpgsql security invoker set search_path='' as $$
declare receipt app.operation_receipts;
begin
  select * into receipt from app.operation_receipts where actor_id=p_actor and request_key=p_key;
  if not found then return false; end if;
  if receipt.action<>p_action or receipt.payload<>p_payload then raise sqlstate 'P0001' using message='idempotency_conflict'; end if;
  return true;
end;
$$;

create function api.ask_to_join_group(p_actor_id uuid,p_key uuid,p_group_id uuid,p_invite uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare g app.groups; payload jsonb; r app.group_join_requests;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text||p_key::text,0));
  perform pg_advisory_xact_lock(hashtextextended('group_requests:'||p_actor_id::text,0));
  payload:=jsonb_build_object('groupId',p_group_id,'invite',p_invite);
  if app.group_receipt(p_actor_id,p_key,'ask_to_join_group',payload) then
    return jsonb_build_object('group',api.read_group(p_actor_id,p_group_id,p_invite),'operationKey',p_key);
  end if;
  g:=app.lock_community_group(p_group_id);
  if exists(select 1 from app.group_roles where group_id=g.id and user_id=p_actor_id) then
    raise sqlstate 'P0001' using message='already_member'; end if;
  if g.visibility='private' and p_invite is distinct from g.invite_token then
    raise sqlstate 'P0001' using message='invite_required'; end if;
  select * into r from app.group_join_requests where group_id=g.id and user_id=p_actor_id and state='pending';
  if not found then
    if exists(select 1 from app.group_join_requests where group_id=g.id and user_id=p_actor_id and state='declined'
        and decided_at>coalesce((select max(decided_at) from app.group_join_requests where group_id=g.id
          and user_id=p_actor_id and state='accepted'),'-infinity')) then
      raise sqlstate 'P0001' using message='request_declined'; end if;
    if (select count(*) from app.group_join_requests where group_id=g.id and user_id=p_actor_id and state='cancelled')>=2 then
      raise sqlstate 'P0001' using message='request_cancel_limit'; end if;
    if (select count(*) from app.group_join_requests q join app.groups o on o.id=q.group_id
        where q.user_id=p_actor_id and q.state='pending' and o.archived_at is null)>=10 then
      raise sqlstate 'P0001' using message='request_limit'; end if;
    insert into app.group_join_requests(group_id,user_id) values(g.id,p_actor_id) returning * into r;
  end if;
  insert into app.operation_receipts values(p_actor_id,p_key,'ask_to_join_group',payload,r.id,now());
  return jsonb_build_object('group',api.read_group(p_actor_id,g.id,p_invite),'operationKey',p_key);
end;
$$;

create function api.cancel_group_request(p_actor_id uuid,p_key uuid,p_group_id uuid,p_request_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare g app.groups; payload jsonb; r app.group_join_requests;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text||p_key::text,0));
  payload:=jsonb_build_object('groupId',p_group_id,'requestId',p_request_id);
  if app.group_receipt(p_actor_id,p_key,'cancel_group_request',payload) then
    return jsonb_build_object('group',api.read_group(p_actor_id,p_group_id,null),'operationKey',p_key);
  end if;
  g:=app.lock_community_group(p_group_id);
  select * into r from app.group_join_requests where id=p_request_id and group_id=g.id for update;
  if not found or r.user_id<>p_actor_id then raise insufficient_privilege using message='group_access_denied'; end if;
  if r.state<>'pending' then raise sqlstate 'P0001' using message='request_not_pending'; end if;
  update app.group_join_requests set state='cancelled',decided_at=clock_timestamp(),decided_by=p_actor_id where id=r.id;
  insert into app.operation_receipts values(p_actor_id,p_key,'cancel_group_request',payload,r.id,now());
  return jsonb_build_object('group',api.read_group(p_actor_id,g.id,g.invite_token),'operationKey',p_key);
end;
$$;

create function api.answer_group_request(p_actor_id uuid,p_key uuid,p_group_id uuid,p_request_id uuid,p_action text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare g app.groups; payload jsonb; r app.group_join_requests;
begin
  if p_action not in ('accept','decline') then raise check_violation using message='invalid_input'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text||p_key::text,0));
  payload:=jsonb_build_object('groupId',p_group_id,'requestId',p_request_id,'action',p_action);
  if app.group_receipt(p_actor_id,p_key,'answer_group_request',payload) then
    return jsonb_build_object('group',api.read_group(p_actor_id,p_group_id,null),'operationKey',p_key);
  end if;
  g:=app.lock_community_group(p_group_id);
  perform app.require_group_admin(p_actor_id,g.id);
  select * into r from app.group_join_requests where id=p_request_id and group_id=g.id for update;
  if not found or r.state<>'pending' then raise sqlstate 'P0001' using message='request_not_pending'; end if;
  update app.group_join_requests set state=case p_action when 'accept' then 'accepted' else 'declined' end,
    decided_at=clock_timestamp(),decided_by=p_actor_id where id=r.id;
  if p_action='accept' then
    insert into app.group_roles(group_id,user_id,role) values(g.id,r.user_id,'member') on conflict do nothing;
  end if;
  insert into app.operation_receipts values(p_actor_id,p_key,'answer_group_request',payload,r.id,now());
  return jsonb_build_object('group',api.read_group(p_actor_id,g.id,null),'operationKey',p_key);
end;
$$;

create function api.remove_group_member(p_actor_id uuid,p_key uuid,p_group_id uuid,p_profile_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare g app.groups; payload jsonb; target uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text||p_key::text,0));
  payload:=jsonb_build_object('groupId',p_group_id,'profileId',p_profile_id);
  if app.group_receipt(p_actor_id,p_key,'remove_group_member',payload) then
    return jsonb_build_object('group',api.read_group(p_actor_id,p_group_id,null),'operationKey',p_key);
  end if;
  g:=app.lock_community_group(p_group_id);
  perform app.require_group_admin(p_actor_id,g.id);
  select user_id into target from app.profiles where profile_id=p_profile_id;
  if target is null or not exists(select 1 from app.group_roles where group_id=g.id and user_id=target and role='member') then
    raise sqlstate 'P0001' using message='not_a_member'; end if;
  delete from app.group_roles where group_id=g.id and user_id=target;
  insert into app.operation_receipts values(p_actor_id,p_key,'remove_group_member',payload,g.id,now());
  return jsonb_build_object('group',api.read_group(p_actor_id,g.id,null),'operationKey',p_key);
end;
$$;

create function api.leave_group(p_actor_id uuid,p_key uuid,p_group_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare g app.groups; payload jsonb; my_role text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text||p_key::text,0));
  payload:=jsonb_build_object('groupId',p_group_id);
  if app.group_receipt(p_actor_id,p_key,'leave_group',payload) then
    return jsonb_build_object('left',true,'operationKey',p_key);
  end if;
  g:=app.lock_community_group(p_group_id);
  select role into my_role from app.group_roles where group_id=g.id and user_id=p_actor_id;
  if my_role='owner' then raise sqlstate 'P0001' using message='admin_cannot_leave'; end if;
  if my_role is null then raise sqlstate 'P0001' using message='not_a_member'; end if;
  delete from app.group_roles where group_id=g.id and user_id=p_actor_id;
  insert into app.operation_receipts values(p_actor_id,p_key,'leave_group',payload,g.id,now());
  return jsonb_build_object('left',true,'operationKey',p_key);
end;
$$;

create function api.set_group_visibility(p_actor_id uuid,p_key uuid,p_group_id uuid,p_visibility text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare g app.groups; payload jsonb;
begin
  if p_visibility not in ('public','private') then raise check_violation using message='invalid_input'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text||p_key::text,0));
  payload:=jsonb_build_object('groupId',p_group_id,'visibility',p_visibility);
  if app.group_receipt(p_actor_id,p_key,'set_group_visibility',payload) then
    return jsonb_build_object('group',api.read_group(p_actor_id,p_group_id,null),'operationKey',p_key);
  end if;
  g:=app.lock_community_group(p_group_id);
  perform app.require_group_admin(p_actor_id,g.id);
  update app.groups set visibility=p_visibility where id=g.id;
  insert into app.operation_receipts values(p_actor_id,p_key,'set_group_visibility',payload,g.id,now());
  return jsonb_build_object('group',api.read_group(p_actor_id,g.id,null),'operationKey',p_key);
end;
$$;

-- Starting a group asks Public or Private; the creator is its admin.
drop function api.create_group(uuid,uuid,text);
create function api.create_group(p_actor_id uuid,p_key uuid,p_name text,p_visibility text default 'public') returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare receipt app.operation_receipts; result_id uuid; payload jsonb := jsonb_build_object('name',p_name,'visibility',p_visibility);
begin
  if length(trim(p_name)) not between 1 and 100 or p_visibility not in ('public','private') then
    raise check_violation using message='invalid_input'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text || p_key::text,0));
  select * into receipt from app.operation_receipts where actor_id=p_actor_id and request_key=p_key;
  if found then
    if receipt.action <> 'create_group' or receipt.payload <> payload then raise sqlstate 'P0001' using message='idempotency_conflict'; end if;
    result_id := receipt.resource_id;
    perform app.require_group_admin(p_actor_id,result_id);
  else
    insert into app.groups(name,visibility) values(p_name,p_visibility) returning id into result_id;
    insert into app.group_roles(group_id,user_id,role) values(result_id,p_actor_id,'owner');
    insert into app.operation_receipts values(p_actor_id,p_key,'create_group',payload,result_id,now());
  end if;
  return (select jsonb_build_object('group',jsonb_build_object('id',g.id,'name',g.name,'role','admin','visibility',g.visibility),'operationKey',p_key)
    from app.groups g where g.id=result_id);
end;
$$;

-- Your groups: the ones people join, never a session's hosting team.
create or replace function api.list_my_groups(p_actor_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name,
      'role', case r.role when 'owner' then 'admin' else 'member' end, 'visibility', g.visibility)
    order by g.name), '[]'::jsonb)
  from app.groups g join app.group_roles r on r.group_id = g.id
  where r.user_id = p_actor_id and g.archived_at is null and g.kind = 'community';
$$;

revoke all on function app.lock_community_group(uuid),app.require_group_admin(uuid,uuid),app.deny_group(),
  app.group_receipt(uuid,uuid,text,jsonb),api.read_group(uuid,uuid,uuid),
  api.ask_to_join_group(uuid,uuid,uuid,uuid),api.cancel_group_request(uuid,uuid,uuid,uuid),
  api.answer_group_request(uuid,uuid,uuid,uuid,text),api.remove_group_member(uuid,uuid,uuid,uuid),
  api.leave_group(uuid,uuid,uuid),api.set_group_visibility(uuid,uuid,uuid,text),
  api.create_group(uuid,uuid,text,text),api.list_my_groups(uuid) from public,anon,authenticated;
grant execute on function app.lock_community_group(uuid),app.require_group_admin(uuid,uuid),app.deny_group(),
  app.group_receipt(uuid,uuid,text,jsonb),api.read_group(uuid,uuid,uuid),
  api.ask_to_join_group(uuid,uuid,uuid,uuid),api.cancel_group_request(uuid,uuid,uuid,uuid),
  api.answer_group_request(uuid,uuid,uuid,uuid,text),api.remove_group_member(uuid,uuid,uuid,uuid),
  api.leave_group(uuid,uuid,uuid),api.set_group_visibility(uuid,uuid,uuid,text),
  api.create_group(uuid,uuid,text,text),api.list_my_groups(uuid) to service_role;
