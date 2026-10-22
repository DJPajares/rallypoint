-- WDL-383. Payment instructions live outside the booked-locked session details,
-- so they can be corrected after bookings start. They never touch sessions,
-- parties, fee obligations or paid markers. The QR image is a private Storage
-- object; this row holds only its path, and every read rechecks entitlement.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('payment-qr','payment-qr',false,1048576,array['image/png','image/jpeg','image/webp'])
  on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create table app.payment_instructions (
  session_id uuid primary key references app.sessions(id) on delete cascade,
  -- Null after removal; the row keeps its revision and last actor/time.
  body text check(body is null or length(body) between 1 and 1000),
  image_path text,
  image_type text check(image_type in ('image/png','image/jpeg','image/webp')),
  image_bytes integer check(image_bytes between 1 and 1048576),
  revision integer not null check(revision>0),
  updated_by uuid not null references auth.users(id),
  updated_by_name text not null check(length(updated_by_name) between 1 and 80),
  updated_at timestamptz not null,
  check((image_path is null)=(image_type is null) and (image_path is null)=(image_bytes is null)),
  -- A QR always has a usable text fallback.
  check(image_path is null or body is not null),
  check(image_path is null or split_part(image_path,'/',1)=session_id::text)
);
alter table app.payment_instructions enable row level security;
revoke all on app.payment_instructions from public,anon,authenticated;
grant select,insert,update on app.payment_instructions to service_role;

create function app.payment_instructions_result(p_session uuid,p_key uuid,p_removed text) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('operationKey',p_key,'revision',coalesce(pi.revision,0),
    'paymentInstructions',case when pi.body is null then null else jsonb_build_object('text',pi.body,'hasImage',pi.image_path is not null,
      'imageType',pi.image_type,'revision',pi.revision,'updatedAt',pi.updated_at,'updatedBy',pi.updated_by_name) end,
    -- Internal to the API, which removes them before responding.
    'imagePath',pi.image_path,'removedPath',p_removed)
  from (select 1) one left join app.payment_instructions pi on pi.session_id=p_session;
$$;

-- Organizers/co-hosts at any state; otherwise the actor's own confirmed or
-- waitlisted party on a published (not draft or cancelled) session.
create function app.payment_entitled(p_actor uuid,p_session uuid) returns boolean
language sql stable security invoker set search_path='' as $$
  select exists(select 1 from app.sessions s join app.group_roles r on r.group_id=s.group_id
      where s.id=p_session and r.user_id=p_actor and r.role in ('owner','organizer','cohost'))
    or exists(select 1 from app.sessions s join app.parties p on p.session_id=s.id
      where s.id=p_session and s.state not in ('draft','cancelled') and p.user_id=p_actor and p.state in ('confirmed','waitlisted'));
$$;

create function api.update_payment_instructions(p_actor_id uuid,p_actor_name text,p_key uuid,p_session_id uuid,p_revision integer,
  p_action text,p_body text,p_image_path text,p_image_type text,p_image_bytes integer,p_image_sha256 text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s app.sessions; pi app.payment_instructions; receipt app.operation_receipts; payload jsonb; at_time timestamptz; removed text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text||p_key::text,0));
  select * into s from app.sessions where id=p_session_id;
  if not found then raise insufficient_privilege using message='group_access_denied';end if;
  -- The group lock also serializes with cancellation and role revocation.
  perform app.require_manager(p_actor_id,s.group_id);
  select * into s from app.sessions where id=p_session_id;
  -- The stored object path is new on every attempt, so the file is identified by its hash.
  payload:=jsonb_build_object('sessionId',p_session_id,'action',p_action,'revision',p_revision,'body',p_body,
    'imageType',p_image_type,'imageBytes',p_image_bytes,'imageSha256',p_image_sha256);
  select * into receipt from app.operation_receipts where actor_id=p_actor_id and request_key=p_key;
  if found then
    if receipt.action<>'payment_instructions' or receipt.payload<>payload then raise sqlstate 'P0001' using message='idempotency_conflict';end if;
    return app.payment_instructions_result(p_session_id,p_key,null);
  end if;
  if s.state='cancelled' then raise sqlstate 'P0001' using message='session_closed';end if;
  if p_action is null or p_action not in ('save','set_image','remove_image','remove')
    or p_actor_name is null or length(trim(p_actor_name)) not between 1 and 80
    or (p_action='save' and (p_body is null or length(trim(p_body)) not between 1 and 1000))
    or (p_action='set_image' and (p_image_path is null or split_part(p_image_path,'/',1)<>p_session_id::text or p_image_sha256 is null)) then
    raise check_violation using message='invalid_payment_instructions';end if;
  select * into pi from app.payment_instructions where session_id=p_session_id for update;
  if p_revision is distinct from coalesce(pi.revision,0) then raise sqlstate 'P0001' using message='stale_payment_instructions';end if;
  if p_action='set_image' and pi.body is null then raise sqlstate 'P0001' using message='instructions_required';end if;
  at_time:=clock_timestamp();
  removed:=case when p_action='save' then null else pi.image_path end;
  insert into app.payment_instructions as t(session_id,body,image_path,image_type,image_bytes,revision,updated_by,updated_by_name,updated_at)
    values(p_session_id,
      case p_action when 'save' then trim(p_body) when 'remove' then null else pi.body end,
      case p_action when 'save' then pi.image_path when 'set_image' then p_image_path end,
      case p_action when 'save' then pi.image_type when 'set_image' then p_image_type end,
      case p_action when 'save' then pi.image_bytes when 'set_image' then p_image_bytes end,
      coalesce(pi.revision,0)+1,p_actor_id,trim(p_actor_name),at_time)
    on conflict(session_id) do update set body=excluded.body,image_path=excluded.image_path,image_type=excluded.image_type,
      image_bytes=excluded.image_bytes,revision=excluded.revision,updated_by=excluded.updated_by,
      updated_by_name=excluded.updated_by_name,updated_at=excluded.updated_at;
  insert into app.operation_receipts values(p_actor_id,p_key,'payment_instructions',payload,p_session_id,at_time);
  return app.payment_instructions_result(p_session_id,p_key,removed);
end;
$$;

create function api.read_payment_instructions(p_actor_id uuid,p_session_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s app.sessions;
begin
  select * into s from app.sessions where id=p_session_id;
  if not found then raise insufficient_privilege using message='group_access_denied';end if;
  perform app.require_manager(p_actor_id,s.group_id);
  return app.payment_instructions_result(p_session_id,null,null)-'operationKey'-'removedPath';
end;
$$;

create function api.read_payment_qr(p_actor_id uuid,p_slug uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s app.sessions; pi app.payment_instructions;
begin
  select * into s from app.sessions where slug=p_slug;
  if not found or not app.payment_entitled(p_actor_id,s.id) then
    raise insufficient_privilege using message='payment_instructions_unavailable';end if;
  select * into pi from app.payment_instructions where session_id=s.id and image_path is not null;
  if not found then return null;end if;
  return jsonb_build_object('path',pi.image_path,'type',pi.image_type);
end;
$$;

-- Entitled readers get the text and whether an image exists; nobody else gets the key.
alter function app.registration_view(uuid,uuid,uuid) rename to registration_view_before_payment_instructions;
create function app.registration_view(p_actor uuid,p_session uuid,p_party uuid default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb; pi app.payment_instructions;
begin
  result:=app.registration_view_before_payment_instructions(p_actor,p_session,p_party);
  if exists(select 1 from app.sessions where id=p_session and state='cancelled') or not app.payment_entitled(p_actor,p_session) then
    return result;end if;
  select * into pi from app.payment_instructions where session_id=p_session and body is not null;
  if not found then return result;end if;
  return result||jsonb_build_object('paymentInstructions',jsonb_build_object('text',pi.body,'hasImage',pi.image_path is not null,'imageRevision',pi.revision));
end;
$$;

alter function api.read_operation(uuid,uuid) rename to read_operation_before_payment_instructions;
alter function api.read_operation_before_payment_instructions(uuid,uuid) set schema app;
create function api.read_operation(p_actor_id uuid,p_key uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r app.operation_receipts; s app.sessions;
begin
  select * into r from app.operation_receipts where actor_id=p_actor_id and request_key=p_key;
  if r.action='payment_instructions' then
    select * into s from app.sessions where id=r.resource_id;
    perform app.require_manager(p_actor_id,s.group_id);
    return app.payment_instructions_result(s.id,p_key,null)-'removedPath';
  end if;
  return app.read_operation_before_payment_instructions(p_actor_id,p_key);
end;
$$;

revoke all on function app.payment_instructions_result(uuid,uuid,text),app.payment_entitled(uuid,uuid),app.registration_view(uuid,uuid,uuid),
  app.registration_view_before_payment_instructions(uuid,uuid,uuid),app.read_operation_before_payment_instructions(uuid,uuid),
  api.update_payment_instructions(uuid,text,uuid,uuid,integer,text,text,text,text,integer,text),api.read_payment_instructions(uuid,uuid),
  api.read_payment_qr(uuid,uuid),api.read_operation(uuid,uuid) from public,anon,authenticated;
grant execute on function app.payment_instructions_result(uuid,uuid,text),app.payment_entitled(uuid,uuid),app.registration_view(uuid,uuid,uuid),
  app.registration_view_before_payment_instructions(uuid,uuid,uuid),app.read_operation_before_payment_instructions(uuid,uuid),
  api.update_payment_instructions(uuid,text,uuid,uuid,integer,text,text,text,text,integer,text),api.read_payment_instructions(uuid,uuid),
  api.read_payment_qr(uuid,uuid),api.read_operation(uuid,uuid) to service_role;
