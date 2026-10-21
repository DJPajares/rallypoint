-- No browser grants. Current roles are checked for every privileged operation.
create table app.sessions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references app.groups(id),
  slug uuid not null unique default gen_random_uuid(),
  state text not null default 'draft' check (state in ('draft','published')),
  version integer not null default 1 check (version > 0),
  details jsonb not null check (jsonb_typeof(details) = 'object'),
  -- P-03 must set this under the event lock on the first booking, including waitlist.
  -- Keep it set after withdrawals: booked terms need their own accepted edit policy.
  bookings_started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sessions_by_group on app.sessions(group_id, created_at desc);
create table app.operation_receipts (
  actor_id uuid not null references auth.users(id) on delete cascade,
  request_key uuid not null,
  action text not null,
  payload jsonb not null,
  resource_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (actor_id, request_key)
);
create table app.session_changes (
  session_id uuid not null references app.sessions(id),
  version integer not null,
  actor_id uuid not null references auth.users(id),
  changed_fields jsonb not null,
  created_at timestamptz not null default now(),
  primary key(session_id, version)
);
alter table app.sessions enable row level security;
alter table app.operation_receipts enable row level security;
alter table app.session_changes enable row level security;
revoke all on app.sessions, app.operation_receipts, app.session_changes from public, anon, authenticated;
grant select, insert, update on app.sessions to service_role;
grant select, insert on app.operation_receipts, app.session_changes to service_role;
grant insert on app.groups, app.group_roles to service_role;
-- SELECT FOR UPDATE requires UPDATE privileges, even for read-only role checks.
grant update on app.groups to service_role;

create function app.require_manager(p_actor uuid, p_group uuid) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from app.groups where id=p_group for update;
  if not exists(select 1 from app.group_roles where group_id=p_group and user_id=p_actor and role in ('owner','organizer','cohost')) then
    raise insufficient_privilege using message='group_access_denied';
  end if;
end;
$$;
create function app.session_view(s app.sessions) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('id',s.id,'groupId',s.group_id,'slug',s.slug,'state',s.state,'version',s.version,'details',s.details,'bookingsStarted',s.bookings_started_at is not null);
$$;
create function api.create_group(p_actor_id uuid,p_key uuid,p_name text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare receipt app.operation_receipts; result_id uuid; payload jsonb := jsonb_build_object('name',p_name);
begin
  if length(trim(p_name)) not between 1 and 100 then raise check_violation using message='invalid_input'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text || p_key::text,0));
  select * into receipt from app.operation_receipts where actor_id=p_actor_id and request_key=p_key;
  if found then
    if receipt.action <> 'create_group' or receipt.payload <> payload then raise sqlstate 'P0001' using message='idempotency_conflict'; end if;
    result_id := receipt.resource_id;
    perform app.require_manager(p_actor_id,result_id);
  else
    insert into app.groups(name) values(p_name) returning id into result_id;
    insert into app.group_roles(group_id,user_id,role) values(result_id,p_actor_id,'owner');
    insert into app.operation_receipts values(p_actor_id,p_key,'create_group',payload,result_id,now());
  end if;
  return (select jsonb_build_object('group',jsonb_build_object('id',g.id,'name',g.name,'role',r.role),'operationKey',p_key)
    from app.groups g join app.group_roles r on r.group_id=g.id where g.id=result_id and r.user_id=p_actor_id);
end;
$$;
create function api.save_session(p_actor_id uuid,p_key uuid,p_group_id uuid,p_session_id uuid,p_intent text,p_version integer,p_details jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare s app.sessions; receipt app.operation_receipts; payload jsonb;
  changed jsonb; published boolean;
begin
  if p_intent not in ('draft','publish','update') then raise check_violation using message='invalid_input'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text || p_key::text,0));
  perform app.require_manager(p_actor_id,p_group_id);
  payload := jsonb_build_object('groupId',p_group_id,'sessionId',p_session_id,'intent',p_intent,'version',p_version,'details',p_details);
  select * into receipt from app.operation_receipts where actor_id=p_actor_id and request_key=p_key;
  if found then
    if receipt.action <> 'save_session' or receipt.payload <> payload then raise sqlstate 'P0001' using message='idempotency_conflict'; end if;
    select * into s from app.sessions where id=receipt.resource_id;
    return jsonb_build_object('session',app.session_view(s),'operationKey',p_key);
  end if;
  if p_session_id is not null then
    select * into s from app.sessions where id=p_session_id and group_id=p_group_id for update;
    if not found then raise insufficient_privilege using message='group_access_denied'; end if;
    if p_version is distinct from s.version then raise sqlstate 'P0001' using message='stale_version'; end if;
    if s.bookings_started_at is not null and s.details <> p_details then raise sqlstate 'P0001' using message='booked_event_locked'; end if;
    if s.state='published' and p_intent <> 'update' then raise sqlstate 'P0001' using message='already_published'; end if;
    if s.state='draft' and p_intent='update' then raise check_violation using message='invalid_input'; end if;
  elsif p_intent='update' then raise check_violation using message='invalid_input';
  end if;
  published := p_intent in ('publish','update');
  if published then
    if coalesce(length(trim(p_details->>'title')),0) not between 1 and 120
      or coalesce(length(trim(p_details->>'activity')),0) not between 1 and 80
      or coalesce(length(trim(p_details->>'location')),0) not between 1 and 300
      or coalesce((p_details->>'capacity')::bigint,0) not between 1 and 2147483647
      or not coalesce((p_details->>'endsAt')::timestamptz > (p_details->>'startsAt')::timestamptz,false)
      or not coalesce((p_details->>'opensAt')::timestamptz < (p_details->>'startsAt')::timestamptz,false)
      or not coalesce((p_details->>'cutoffAt')::timestamptz between (p_details->>'opensAt')::timestamptz and (p_details->>'startsAt')::timestamptz,false)
      or coalesce(p_details->>'currency','') not in ('SGD','USD','EUR','GBP','JPY','KWD')
      or coalesce((p_details->>'feeMinor')::numeric,-1) not between 0 and 9007199254740991
      or (p_details->>'feeMinor')::numeric <> trunc((p_details->>'feeMinor')::numeric)
    then raise check_violation using message='invalid_input'; end if;
  end if;
  if p_session_id is null then
    insert into app.sessions(group_id,state,details) values(p_group_id,case when published then 'published' else 'draft' end,p_details) returning * into s;
  elsif s.details <> p_details or (p_intent='publish' and s.state='draft') then
    select coalesce(jsonb_agg(key),'[]'::jsonb) into changed from jsonb_object_keys(p_details) key where s.details->key is distinct from p_details->key;
    update app.sessions set details=p_details,state=case when published then 'published' else 'draft' end,version=version+1,updated_at=clock_timestamp() where id=s.id returning * into s;
    if p_intent='update' then insert into app.session_changes values(s.id,s.version,p_actor_id,changed,now()); end if;
  end if;
  insert into app.operation_receipts values(p_actor_id,p_key,'save_session',payload,s.id,now());
  return jsonb_build_object('session',app.session_view(s),'operationKey',p_key);
end;
$$;
create function api.list_group_sessions(p_actor_id uuid,p_group_id uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
begin
  perform app.require_manager(p_actor_id,p_group_id);
  return (select coalesce(jsonb_agg(app.session_view(s) order by s.created_at desc),'[]'::jsonb) from app.sessions s where group_id=p_group_id);
end;
$$;
create function api.read_managed_session(p_actor_id uuid,p_session_id uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare s app.sessions;
begin
  select * into s from app.sessions where id=p_session_id;
  perform app.require_manager(p_actor_id,s.group_id);
  select * into s from app.sessions where id=p_session_id;
  return app.session_view(s);
end;
$$;
create function api.read_shared_session(p_slug uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('slug',s.slug,'groupName',g.name,'version',s.version,'details',s.details)
  from app.sessions s join app.groups g on g.id=s.group_id where s.slug=p_slug and s.state='published';
$$;
create function api.read_operation(p_actor_id uuid,p_key uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare r app.operation_receipts; s app.sessions;
begin
  select * into r from app.operation_receipts where actor_id=p_actor_id and request_key=p_key;
  if not found then return null; end if;
  if r.action='save_session' then
    select * into s from app.sessions where id=r.resource_id;
    perform app.require_manager(p_actor_id,s.group_id);
    select * into s from app.sessions where id=r.resource_id;
    return jsonb_build_object('operationKey',p_key,'session',app.session_view(s));
  end if;
  perform app.require_manager(p_actor_id,r.resource_id);
  return jsonb_build_object('operationKey',p_key,'groupId',r.resource_id);
end;
$$;
revoke all on all functions in schema app from public,anon,authenticated;
grant execute on function app.require_manager(uuid,uuid),app.session_view(app.sessions) to service_role;
revoke all on function api.create_group(uuid,uuid,text),api.save_session(uuid,uuid,uuid,uuid,text,integer,jsonb),api.list_group_sessions(uuid,uuid),api.read_managed_session(uuid,uuid),api.read_shared_session(uuid),api.read_operation(uuid,uuid) from public,anon,authenticated;
grant execute on function api.create_group(uuid,uuid,text),api.save_session(uuid,uuid,uuid,uuid,text,integer,jsonb),api.list_group_sessions(uuid,uuid),api.read_managed_session(uuid,uuid),api.read_shared_session(uuid),api.read_operation(uuid,uuid) to service_role;
