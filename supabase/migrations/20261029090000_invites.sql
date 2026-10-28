-- P-38 / WDL-415: direct invites. A group's admin, or a session's organizer
-- or co-hosts, invite someone they already know through RallyPoint. The
-- person invited joins or declines from Home. A group invite makes them a
-- member at once; a session invite lets them take the normal join (consent,
-- strict queue, waitlist when full), skipping Ask to join. No email.

create table app.invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references app.groups(id) on delete cascade,
  session_id uuid references app.sessions(id) on delete cascade,
  invitee_id uuid not null references auth.users(id) on delete cascade,
  inviter_id uuid references auth.users(id) on delete set null,
  inviter_name text not null check (char_length(inviter_name) between 1 and 100),
  state text not null default 'pending' check (state in ('pending','accepted','declined','withdrawn')),
  created_at timestamptz not null default clock_timestamp(),
  decided_at timestamptz,
  check ((group_id is null) <> (session_id is null))
);
create unique index invites_one_pending_group on app.invites(group_id,invitee_id) where state='pending' and group_id is not null;
create unique index invites_one_pending_session on app.invites(session_id,invitee_id) where state='pending' and session_id is not null;
create index invites_pending_by_invitee on app.invites(invitee_id) where state='pending';
create index invites_pending_by_inviter on app.invites(inviter_id) where state='pending';
alter table app.invites enable row level security;
revoke all on app.invites from public,anon,authenticated;
grant select,insert,update,delete on app.invites to service_role;

-- People the actor already knows: confirmed in a session the actor runs or
-- co-hosts, confirmed in a session where the actor was confirmed too, or in a
-- group with the actor. Built from those sources, never from all profiles.
create function app.known_people(p_actor uuid) returns table(user_id uuid)
language sql stable security invoker set search_path='' as $$
  select p.user_id from app.parties p join app.sessions s on s.id=p.session_id
    where p.state='confirmed' and s.state<>'cancelled'
      and exists(select 1 from app.group_roles m where m.group_id=s.group_id and m.user_id=p_actor
        and m.role in ('owner','organizer','cohost'))
  union
  select p.user_id from app.parties p join app.sessions s on s.id=p.session_id
    join app.parties o on o.session_id=s.id and o.user_id=p_actor and o.state='confirmed'
    where p.state='confirmed' and s.state<>'cancelled'
  union
  select r2.user_id from app.group_roles r1
    join app.groups g on g.id=r1.group_id and g.kind='community' and g.archived_at is null
    join app.group_roles r2 on r2.group_id=g.id
    where r1.user_id=p_actor;
$$;

-- Already in: a group member, or booked (confirmed or waitlisted) in a session.
create function app.already_in(p_kind text,p_target uuid,p_user uuid) returns boolean
language sql stable security invoker set search_path='' as $$
  select case when p_kind='group'
    then exists(select 1 from app.group_roles where group_id=p_target and user_id=p_user)
    else exists(select 1 from app.parties where session_id=p_target and user_id=p_user and state in ('confirmed','waitlisted')) end;
$$;

-- Locks the target in the order join and promotion use, and checks that the
-- actor may invite to it: the group's admin, or the session's managers.
create function app.lock_invite_target(p_actor uuid,p_kind text,p_target uuid,p_check boolean) returns void
language plpgsql security invoker set search_path='' as $$
declare s app.sessions; g app.groups;
begin
  if p_kind='group' then
    g:=app.lock_community_group(p_target);
    if p_check then perform app.require_group_admin(p_actor,g.id); end if;
  elsif p_kind='session' then
    select * into s from app.sessions where id=p_target;
    if not found then raise insufficient_privilege using message='group_access_denied'; end if;
    perform 1 from app.groups where id=s.group_id for update;
    perform 1 from app.sessions where id=s.id for update;
    if p_check and not app.is_session_manager(p_actor,s.group_id) then
      raise insufficient_privilege using message='group_access_denied'; end if;
  else
    raise check_violation using message='invalid_input';
  end if;
end;
$$;

create function app.session_open_for_invites(p_session uuid) returns boolean
language sql stable security invoker set search_path='' as $$
  select exists(select 1 from app.sessions where id=p_session and state='published'
    and clock_timestamp()<(details->>'startsAt')::timestamptz);
$$;

create function api.invite_candidates(p_actor_id uuid,p_kind text,p_target uuid,p_query text,p_after uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare people jsonb; next_cursor uuid; q text:=nullif(btrim(coalesce(p_query,'')),'');
begin
  if q is not null and char_length(q)>40 then raise check_violation using message='invalid_input'; end if;
  perform app.lock_invite_target(p_actor_id,p_kind,p_target,true);
  with known as (select distinct k.user_id from app.known_people(p_actor_id) k where k.user_id<>p_actor_id),
  page as (
    select pr.profile_id,coalesce(pr.display_name,pr.account_name) as name,app.visible_title(pr.user_id) as title
    from known k join app.profiles pr on pr.user_id=k.user_id
    where (p_after is null or pr.profile_id>p_after)
      and (q is null or position(lower(q) in lower(coalesce(pr.display_name,pr.account_name)))>0)
      and not app.already_in(p_kind,p_target,k.user_id)
      and not exists(select 1 from app.invites i where i.invitee_id=k.user_id
        and (case when p_kind='group' then i.group_id else i.session_id end)=p_target
        and i.state in ('pending','declined'))
    order by pr.profile_id limit 51
  ), numbered as (select *,row_number() over(order by profile_id) n from page)
  select coalesce(jsonb_agg(jsonb_build_object('profileId',profile_id,'name',name,'title',title) order by profile_id)
      filter (where n<=50),'[]'::jsonb),
    case when count(*)>50 then (array_agg(profile_id order by profile_id))[50] end
    into people,next_cursor from numbered;
  return jsonb_build_object('people',people,'nextCursor',next_cursor);
end;
$$;

create function app.invite_json(p_invite uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('id',i.id,'state',i.state) from app.invites i where i.id=p_invite;
$$;

create function api.send_invite(p_actor_id uuid,p_actor_name text,p_key uuid,p_kind text,p_target uuid,p_profile_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare receipt app.operation_receipts; payload jsonb; target uuid; i app.invites;
begin
  if p_kind not in ('group','session') then raise check_violation using message='invalid_input'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text||p_key::text,0));
  -- One sender's invites run one at a time, so the cap holds.
  perform pg_advisory_xact_lock(hashtextextended('invites:'||p_actor_id::text,0));
  payload:=jsonb_build_object('kind',p_kind,'target',p_target,'profileId',p_profile_id);
  select * into receipt from app.operation_receipts where actor_id=p_actor_id and request_key=p_key;
  if found then
    if receipt.action<>'send_invite' or receipt.payload<>payload then raise sqlstate 'P0001' using message='idempotency_conflict'; end if;
    return jsonb_build_object('invite',app.invite_json(receipt.resource_id),'operationKey',p_key);
  end if;
  perform app.lock_invite_target(p_actor_id,p_kind,p_target,true);
  if p_kind='session' and not app.session_open_for_invites(p_target) then
    raise sqlstate 'P0001' using message='registration_closed'; end if;
  select user_id into target from app.profiles where profile_id=p_profile_id;
  if target is null or target=p_actor_id then raise sqlstate 'P0001' using message='not_known'; end if;
  if app.already_in(p_kind,p_target,target) then raise sqlstate 'P0001' using message='already_in'; end if;
  if exists(select 1 from app.invites where invitee_id=target and state='pending'
      and (case when p_kind='group' then group_id else session_id end)=p_target) then
    raise sqlstate 'P0001' using message='invite_exists'; end if;
  if exists(select 1 from app.invites where invitee_id=target and state='declined'
      and (case when p_kind='group' then group_id else session_id end)=p_target) then
    raise sqlstate 'P0001' using message='invite_declined'; end if;
  if not exists(select 1 from app.known_people(p_actor_id) k where k.user_id=target) then
    raise sqlstate 'P0001' using message='not_known'; end if;
  if (select count(*) from app.invites x
      left join app.groups g on g.id=x.group_id
      left join app.sessions s on s.id=x.session_id
      where x.inviter_id=p_actor_id and x.state='pending'
        and ((g.id is not null and g.archived_at is null)
          or (s.id is not null and s.state='published' and clock_timestamp()<(s.details->>'startsAt')::timestamptz)))>=20 then
    raise sqlstate 'P0001' using message='invite_limit'; end if;
  insert into app.invites(group_id,session_id,invitee_id,inviter_id,inviter_name)
    values(case when p_kind='group' then p_target end,case when p_kind='session' then p_target end,
      target,p_actor_id,left(btrim(p_actor_name),100)) returning * into i;
  insert into app.operation_receipts values(p_actor_id,p_key,'send_invite',payload,i.id,now());
  return jsonb_build_object('invite',app.invite_json(i.id),'operationKey',p_key);
end;
$$;

-- The invite, locked after its target (the same order join takes).
create function app.lock_invite(p_invite uuid) returns app.invites
language plpgsql security invoker set search_path='' as $$
declare i app.invites;
begin
  select * into i from app.invites where id=p_invite;
  if not found then raise insufficient_privilege using message='group_access_denied'; end if;
  if i.group_id is not null then
    perform 1 from app.groups where id=i.group_id for update;
  else
    perform 1 from app.groups where id=(select group_id from app.sessions where id=i.session_id) for update;
    perform 1 from app.sessions where id=i.session_id for update;
  end if;
  select * into i from app.invites where id=p_invite for update;
  return i;
end;
$$;

create function api.withdraw_invite(p_actor_id uuid,p_key uuid,p_invite_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare receipt app.operation_receipts; payload jsonb; i app.invites; allowed boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text||p_key::text,0));
  payload:=jsonb_build_object('inviteId',p_invite_id);
  select * into receipt from app.operation_receipts where actor_id=p_actor_id and request_key=p_key;
  if found then
    if receipt.action<>'withdraw_invite' or receipt.payload<>payload then raise sqlstate 'P0001' using message='idempotency_conflict'; end if;
    return jsonb_build_object('invite',app.invite_json(p_invite_id),'operationKey',p_key);
  end if;
  i:=app.lock_invite(p_invite_id);
  allowed:=i.inviter_id=p_actor_id
    or (i.group_id is not null and exists(select 1 from app.group_roles where group_id=i.group_id and user_id=p_actor_id and role='owner'))
    or (i.session_id is not null and app.is_session_manager(p_actor_id,(select group_id from app.sessions where id=i.session_id)));
  if not allowed then raise insufficient_privilege using message='group_access_denied'; end if;
  if i.state<>'pending' then raise sqlstate 'P0001' using message='invite_not_pending'; end if;
  update app.invites set state='withdrawn',decided_at=clock_timestamp() where id=i.id;
  insert into app.operation_receipts values(p_actor_id,p_key,'withdraw_invite',payload,i.id,now());
  return jsonb_build_object('invite',app.invite_json(i.id),'operationKey',p_key);
end;
$$;

create function api.decline_invite(p_actor_id uuid,p_key uuid,p_invite_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare receipt app.operation_receipts; payload jsonb; i app.invites;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text||p_key::text,0));
  payload:=jsonb_build_object('inviteId',p_invite_id);
  select * into receipt from app.operation_receipts where actor_id=p_actor_id and request_key=p_key;
  if found then
    if receipt.action<>'decline_invite' or receipt.payload<>payload then raise sqlstate 'P0001' using message='idempotency_conflict'; end if;
    return jsonb_build_object('invite',app.invite_json(p_invite_id),'operationKey',p_key);
  end if;
  i:=app.lock_invite(p_invite_id);
  if i.invitee_id<>p_actor_id then raise insufficient_privilege using message='group_access_denied'; end if;
  if i.state<>'pending' then raise sqlstate 'P0001' using message='invite_not_pending'; end if;
  update app.invites set state='declined',decided_at=clock_timestamp() where id=i.id;
  insert into app.operation_receipts values(p_actor_id,p_key,'decline_invite',payload,i.id,now());
  return jsonb_build_object('invite',app.invite_json(i.id),'operationKey',p_key);
end;
$$;

create function api.accept_group_invite(p_actor_id uuid,p_key uuid,p_invite_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare receipt app.operation_receipts; payload jsonb; i app.invites;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text||p_key::text,0));
  payload:=jsonb_build_object('inviteId',p_invite_id);
  select * into receipt from app.operation_receipts where actor_id=p_actor_id and request_key=p_key;
  if found then
    if receipt.action<>'accept_group_invite' or receipt.payload<>payload then raise sqlstate 'P0001' using message='idempotency_conflict'; end if;
    return jsonb_build_object('invite',app.invite_json(p_invite_id),'operationKey',p_key);
  end if;
  i:=app.lock_invite(p_invite_id);
  if i.invitee_id<>p_actor_id or i.group_id is null then raise insufficient_privilege using message='group_access_denied'; end if;
  if i.state<>'pending' then raise sqlstate 'P0001' using message='invite_not_pending'; end if;
  if not exists(select 1 from app.groups where id=i.group_id and kind='community' and archived_at is null) then
    raise sqlstate 'P0001' using message='invite_not_pending'; end if;
  insert into app.group_roles(group_id,user_id,role) values(i.group_id,p_actor_id,'member') on conflict do nothing;
  update app.invites set state='accepted',decided_at=clock_timestamp() where id=i.id;
  update app.group_join_requests set state='accepted',decided_at=clock_timestamp(),decided_by=i.inviter_id
    where group_id=i.group_id and user_id=p_actor_id and state='pending';
  insert into app.operation_receipts values(p_actor_id,p_key,'accept_group_invite',payload,i.id,now());
  return jsonb_build_object('invite',app.invite_json(i.id),'operationKey',p_key);
end;
$$;

create function api.list_my_invites(p_actor_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(x.item order by x.created_at desc),'[]'::jsonb) from (
    select i.created_at,jsonb_build_object('id',i.id,'kind',case when i.group_id is not null then 'group' else 'session' end,
      'inviterName',i.inviter_name,'sentAt',i.created_at,
      'group',case when g.id is not null then jsonb_build_object('id',g.id,'name',g.name) end,
      'session',case when s.id is not null then jsonb_build_object('slug',s.slug,'title',s.details->>'title',
        'startsAt',s.details->>'startsAt','timeZone',s.details->>'timeZone') end) as item
    from app.invites i
    left join app.groups g on g.id=i.group_id and g.kind='community' and g.archived_at is null
    left join app.sessions s on s.id=i.session_id and s.state='published' and clock_timestamp()<(s.details->>'startsAt')::timestamptz
    where i.invitee_id=p_actor_id and i.state='pending' and (g.id is not null or s.id is not null)
  ) x;
$$;

-- Join, with invites: a pending invite counts as the organizer's approval on
-- an Ask to join session. Joining through it accepts the invite (and any
-- request the person had waiting) in the same transaction, and queues no
-- email. Everything else is unchanged.
create or replace function api.join_session(p_actor_id uuid,p_key uuid,p_slug uuid,p_version integer,p_seats integer,p_guest_name text,p_primary_name text,p_consent boolean) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s app.sessions; p app.parties; receipt app.operation_receipts; payload jsonb; now_at timestamptz; invited boolean;
begin
  if p_seats not in (1,2) or p_consent is distinct from true or length(p_guest_name)>80 or length(p_primary_name) not between 1 and 80 then
    raise check_violation using message='invalid_registration'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text||p_key::text,0));
  select * into s from app.sessions where slug=p_slug;
  if not found then raise insufficient_privilege using message='session_unavailable'; end if;
  perform 1 from app.groups where id=s.group_id for update;
  select * into s from app.sessions where slug=p_slug for update;
  payload:=jsonb_build_object('slug',p_slug,'version',p_version,'seats',p_seats,'guestName',p_guest_name,'consent',p_consent);
  select * into receipt from app.operation_receipts where actor_id=p_actor_id and request_key=p_key;
  if found then
    if receipt.action<>'join_session' or receipt.payload<>payload then raise sqlstate 'P0001' using message='idempotency_conflict'; end if;
    return jsonb_build_object('registration',app.registration_view(p_actor_id,s.id,receipt.resource_id),'operationKey',p_key);
  end if;
  if s.state='draft' then raise insufficient_privilege using message='session_unavailable'; end if;
  select * into p from app.parties where session_id=s.id and user_id=p_actor_id and state in ('confirmed','waitlisted');
  if found then
    insert into app.operation_receipts values(p_actor_id,p_key,'join_session',payload,p.id,now());
    return jsonb_build_object('registration',app.registration_view(p_actor_id,s.id,p.id),'operationKey',p_key);
  end if;
  invited:=exists(select 1 from app.invites where session_id=s.id and invitee_id=p_actor_id and state='pending');
  if coalesce(s.details->>'joinMode','direct')='request' and not app.is_session_manager(p_actor_id,s.group_id) and not invited then
    raise sqlstate 'P0001' using message='request_required'; end if;
  now_at:=clock_timestamp();
  if s.state<>'published' or now_at>=(s.details->>'startsAt')::timestamptz then raise sqlstate 'P0001' using message='registration_closed'; end if;
  if now_at<(s.details->>'opensAt')::timestamptz then raise sqlstate 'P0001' using message='registration_not_open'; end if;
  if p_version is distinct from s.version then raise sqlstate 'P0001' using message='stale_terms'; end if;
  if p_seats=2 and not (s.details->>'guests')::boolean then raise check_violation using message='guest_disabled'; end if;
  if p_seats>(s.details->>'capacity')::integer then raise check_violation using message='party_too_large'; end if;
  if (s.details->>'feeMinor')::numeric*p_seats>9007199254740991 then raise check_violation using message='fee_out_of_range'; end if;
  p:=app.admit_party(s.id,p_actor_id,p_primary_name,p_guest_name,p_seats,s.version,invited);
  if invited then
    update app.invites set state='accepted',decided_at=clock_timestamp()
      where session_id=s.id and invitee_id=p_actor_id and state='pending';
    update app.join_requests set state='accepted',decided_at=clock_timestamp(),party_id=p.id
      where session_id=s.id and user_id=p_actor_id and state='pending';
  end if;
  insert into app.operation_receipts values(p_actor_id,p_key,'join_session',payload,p.id,now());
  return jsonb_build_object('registration',app.registration_view(p_actor_id,s.id,p.id),'operationKey',p_key);
end;
$$;

-- What the session page knows about invites: the viewer's own waiting invite,
-- and for its managers, everyone invited and how it went.
alter function app.registration_view(uuid,uuid,uuid) rename to registration_view_before_invites;
create function app.registration_view(p_actor uuid,p_session uuid,p_party uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb; mine jsonb;
begin
  result:=app.registration_view_before_invites(p_actor,p_session,p_party);
  select jsonb_build_object('id',i.id,'inviterName',i.inviter_name) into mine
    from app.invites i where i.session_id=p_session and i.invitee_id=p_actor and i.state='pending'
      and app.session_open_for_invites(p_session) limit 1;
  result:=result||jsonb_build_object('invite',mine);
  if coalesce((result->>'canManage')::boolean,false) then
    result:=result||jsonb_build_object('invites',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,
        'name',coalesce(pr.display_name,pr.account_name,'Participant'),'state',i.state,'sentAt',i.created_at)
        order by i.created_at desc),'[]'::jsonb)
      from app.invites i left join app.profiles pr on pr.user_id=i.invitee_id where i.session_id=p_session));
  end if;
  return result;
end;
$$;

-- The group page: its admin also sees everyone invited and how it went.
alter function api.read_group(uuid,uuid,uuid) rename to read_group_before_invites;
alter function api.read_group_before_invites(uuid,uuid,uuid) set schema app;
create function api.read_group(p_actor_id uuid,p_group_id uuid,p_invite uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
  result:=app.read_group_before_invites(p_actor_id,p_group_id,p_invite);
  if result->>'viewerRole'='admin' then
    result:=result||jsonb_build_object('invites',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,
        'name',coalesce(pr.display_name,pr.account_name,'Participant'),'state',i.state,'sentAt',i.created_at)
        order by i.created_at desc),'[]'::jsonb)
      from app.invites i left join app.profiles pr on pr.user_id=i.invitee_id where i.group_id=p_group_id));
  end if;
  return result;
end;
$$;

revoke all on function app.known_people(uuid),app.already_in(text,uuid,uuid),app.lock_invite_target(uuid,text,uuid,boolean),
  app.session_open_for_invites(uuid),api.invite_candidates(uuid,text,uuid,text,uuid),app.invite_json(uuid),
  api.send_invite(uuid,text,uuid,text,uuid,uuid),app.lock_invite(uuid),api.withdraw_invite(uuid,uuid,uuid),
  api.decline_invite(uuid,uuid,uuid),api.accept_group_invite(uuid,uuid,uuid),api.list_my_invites(uuid),
  api.join_session(uuid,uuid,uuid,integer,integer,text,text,boolean),
  app.registration_view_before_invites(uuid,uuid,uuid),app.registration_view(uuid,uuid,uuid),
  app.read_group_before_invites(uuid,uuid,uuid),api.read_group(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function app.known_people(uuid),app.already_in(text,uuid,uuid),app.lock_invite_target(uuid,text,uuid,boolean),
  app.session_open_for_invites(uuid),api.invite_candidates(uuid,text,uuid,text,uuid),app.invite_json(uuid),
  api.send_invite(uuid,text,uuid,text,uuid,uuid),app.lock_invite(uuid),api.withdraw_invite(uuid,uuid,uuid),
  api.decline_invite(uuid,uuid,uuid),api.accept_group_invite(uuid,uuid,uuid),api.list_my_invites(uuid),
  api.join_session(uuid,uuid,uuid,integer,integer,text,text,boolean),
  app.registration_view_before_invites(uuid,uuid,uuid),app.registration_view(uuid,uuid,uuid),
  app.read_group_before_invites(uuid,uuid,uuid),api.read_group(uuid,uuid,uuid) to service_role;
