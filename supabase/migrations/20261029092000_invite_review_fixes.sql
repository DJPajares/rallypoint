-- P-38 review fixes.
-- 1. However someone gets in (an accepted Ask to join request, an accepted
--    group request), a waiting invite to the same session or group is
--    settled as accepted, so it never lingers on Home or counts toward the
--    sender's cap.
-- 2. Only the path an invite opens (joining an Ask to join session) is
--    silent; joining a Join directly session keeps its usual join email.

create or replace function api.accept_join_request(p_actor_id uuid,p_actor_name text,p_key uuid,p_slug uuid,p_request_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s app.sessions; r app.join_requests; p app.parties; receipt app.operation_receipts; payload jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text||p_key::text,0));
  s:=app.lock_registration_session(p_slug);
  payload:=jsonb_build_object('slug',p_slug,'requestId',p_request_id);
  select * into receipt from app.operation_receipts where actor_id=p_actor_id and request_key=p_key;
  if found then
    if receipt.action<>'accept_join_request' or receipt.payload<>payload then raise sqlstate 'P0001' using message='idempotency_conflict'; end if;
    return jsonb_build_object('registration',app.registration_view(p_actor_id,s.id),'operationKey',p_key,
      'accepted',app.accepted_result(p_request_id));
  end if;
  r:=app.answerable_request(p_actor_id,s,p_request_id);
  if app.request_needs_confirm(r) then raise sqlstate 'P0001' using message='request_needs_confirm'; end if;
  select * into p from app.parties where session_id=s.id and user_id=r.user_id and state in ('confirmed','waitlisted');
  if not found then
    if r.seats=2 and not (s.details->>'guests')::boolean then raise check_violation using message='guest_disabled'; end if;
    if r.seats>(s.details->>'capacity')::integer then raise check_violation using message='party_too_large'; end if;
    p:=app.admit_party(s.id,r.user_id,r.primary_name,r.guest_name,r.seats,r.consent_version,true);
  end if;
  update app.join_requests set state='accepted',decided_at=clock_timestamp(),decided_by=p_actor_id,
    decided_by_name=p_actor_name,party_id=p.id where id=r.id;
  update app.invites set state='accepted',decided_at=clock_timestamp()
    where session_id=s.id and invitee_id=r.user_id and state='pending';
  insert into app.operation_receipts values(p_actor_id,p_key,'accept_join_request',payload,r.id,now());
  return jsonb_build_object('registration',app.registration_view(p_actor_id,s.id),'operationKey',p_key,
    'accepted',app.accepted_result(r.id));
end;
$$;

create or replace function api.answer_group_request(p_actor_id uuid,p_key uuid,p_group_id uuid,p_request_id uuid,p_action text) returns jsonb
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
    update app.invites set state='accepted',decided_at=clock_timestamp()
      where group_id=g.id and invitee_id=r.user_id and state='pending';
    -- Every member has a profile, so the admin can see and remove them by it.
    -- Someone who asked before ever opening the app may have none yet; use
    -- their latest booking name, else the neutral fallback, never contact data.
    insert into app.profiles(user_id,account_name)
      values(r.user_id,coalesce((select p.primary_name from app.parties p where p.user_id=r.user_id
        order by p.created_at desc,p.queue_sequence desc limit 1),'Participant'))
      on conflict(user_id) do nothing;
  end if;
  insert into app.operation_receipts values(p_actor_id,p_key,'answer_group_request',payload,r.id,now());
  return jsonb_build_object('group',api.read_group(p_actor_id,g.id,null),'operationKey',p_key);
end;
$$;

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
  p:=app.admit_party(s.id,p_actor_id,p_primary_name,p_guest_name,p_seats,s.version,
    invited and coalesce(s.details->>'joinMode','direct')='request');
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
