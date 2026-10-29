-- P-28 / WDL-403 review fixes.
-- 1. Organizers and co-hosts can't be removed (they withdraw instead), and
--    each managed roster row says whether it can be removed right now.
-- 2. Taking back a paid mark or a waiver on a removed party drops the fee
--    again, as the removal would have; it never becomes due.
-- 3. A removal closes the person's waiting request to join that session.
-- 4. Only for the session they were removed from: its organizers can invite
--    them back, even after an earlier declined invite.

create or replace function api.remove_party(p_actor_id uuid,p_actor_name text,p_key uuid,p_slug uuid,p_party_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s app.sessions; p app.parties; receipt app.operation_receipts; payload jsonb; now_at timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text||p_key::text,0));
  select * into s from app.sessions where slug=p_slug;
  if not found then raise insufficient_privilege using message='group_access_denied'; end if;
  -- Group lock, then the session: the same order as joining and withdrawing.
  -- The current role is checked under it, so a revoked co-host is refused even on replay.
  perform app.require_manager(p_actor_id,s.group_id);
  select * into s from app.sessions where id=s.id for update;
  payload:=jsonb_build_object('slug',p_slug,'partyId',p_party_id);
  select * into receipt from app.operation_receipts where actor_id=p_actor_id and request_key=p_key;
  if found then
    if receipt.action<>'remove_party' or receipt.payload<>payload then raise sqlstate 'P0001' using message='idempotency_conflict'; end if;
    return jsonb_build_object('registration',app.registration_view(p_actor_id,s.id),'operationKey',p_key);
  end if;
  if p_actor_name is null or length(trim(p_actor_name)) not between 1 and 80 then
    raise check_violation using message='invalid_removal';
  end if;
  -- Server time after the locks: a request that waited is judged when it can act.
  now_at:=clock_timestamp();
  if s.state<>'published' or now_at>=(s.details->>'startsAt')::timestamptz then
    raise sqlstate 'P0001' using message='removal_closed'; end if;
  select * into p from app.parties where id=p_party_id and session_id=s.id for update;
  if not found then raise sqlstate 'P0001' using message='party_not_found'; end if;
  if p.state not in ('confirmed','waitlisted') then raise sqlstate 'P0001' using message='removal_not_eligible'; end if;
  -- Someone who runs the session withdraws instead; a removal would lock them out.
  if app.is_session_manager(p.user_id,s.group_id) then raise sqlstate 'P0001' using message='removal_not_allowed'; end if;
  update app.parties set state='removed' where id=p.id;
  insert into app.party_removals values(p.id,p_actor_id,trim(p_actor_name),now_at);
  -- An unpaid fee is dropped. Paid, waived and already-removed fees stay as they are.
  perform app.drop_removed_fee(p.id,p_actor_id,trim(p_actor_name),now_at);
  -- Their waiting request to join closes, so nobody can accept it later.
  update app.join_requests set state='cancelled',decided_at=now_at,decided_by=p_actor_id,decided_by_name=trim(p_actor_name)
    where session_id=s.id and user_id=p.user_id and state='pending';
  insert into app.registration_events(party_id,kind,created_at) values(p.id,'removed',now_at);
  -- Never bypasses a head party that does not fit the freed seats.
  perform app.fill_waitlist(s.id);
  insert into app.operation_receipts values(p_actor_id,p_key,'remove_party',payload,p.id,now_at);
  return jsonb_build_object('registration',app.registration_view(p_actor_id,s.id),'operationKey',p_key);
end;
$$;

-- Drops a removed party's unpaid fee or unpaid share, with who and when.
-- Does nothing to a paid or waived fee, or to one already dropped.
create function app.drop_removed_fee(p_party uuid,p_actor uuid,p_actor_name text,p_at timestamptz) returns void
language plpgsql security invoker set search_path='' as $$
begin
  with dropped as (
    update app.fee_obligations set liability_state='removed_by_organizer',removed_at=p_at,removed_by=p_actor,revision=revision+1
      where party_id=p_party and liability_state='due' and not marked_paid
      returning party_id,revision,total_minor,currency,split_run_id)
  insert into app.fee_changes(party_id,revision,action,actor_id,actor_name,created_at,previous_minor,current_minor,currency,split_run_id)
    select d.party_id,d.revision,'removed_by_organizer',p_actor,p_actor_name,p_at,d.total_minor,d.total_minor,d.currency,d.split_run_id
    from dropped d;
  with dropped as (
    update app.split_claims set eligible=false,revision=revision+1,changed_at=p_at,changed_by=p_actor
      where party_id=p_party and eligible and not waived
        and not exists(select 1 from app.fee_obligations where party_id=p_party and marked_paid)
      returning revision)
  insert into app.split_claim_changes(party_id,revision,action,actor_id,actor_name,created_at)
    select p_party,d.revision,'removed_by_organizer',p_actor,p_actor_name,p_at from dropped d;
end;
$$;

-- Marking a removed party unpaid, or undoing its waiver, leaves nothing due.
alter function api.update_payment(uuid,text,uuid,uuid,uuid,text,integer) rename to update_payment_before_removals;
alter function api.update_payment_before_removals(uuid,text,uuid,uuid,uuid,text,integer) set schema app;
create function api.update_payment(p_actor_id uuid,p_actor_name text,p_key uuid,p_slug uuid,p_party_id uuid,p_action text,p_revision integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb; s uuid;
begin
  -- The inner write takes the locks and checks the role; this runs under them.
  result:=app.update_payment_before_removals(p_actor_id,p_actor_name,p_key,p_slug,p_party_id,p_action,p_revision);
  if p_action in ('mark_unpaid','undo_waiver') and exists(select 1 from app.party_removals where party_id=p_party_id) then
    perform app.drop_removed_fee(p_party_id,p_actor_id,trim(p_actor_name),clock_timestamp());
    select session_id into s from app.parties where id=p_party_id;
    result:=result||jsonb_build_object('registration',app.registration_view(p_actor_id,s));
  end if;
  return result;
end;
$$;

-- Each managed roster row says whether it can be removed right now.
alter function app.registration_view(uuid,uuid,uuid) rename to registration_view_before_removable;
create function app.registration_view(p_actor uuid,p_session uuid,p_party uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb; rows jsonb; s app.sessions; open_now boolean;
begin
  result:=app.registration_view_before_removable(p_actor,p_session,p_party);
  if not coalesce((result->>'canManage')::boolean,false) then return result; end if;
  select * into s from app.sessions where id=p_session;
  open_now:=s.state='published' and clock_timestamp()<(s.details->>'startsAt')::timestamptz;
  select coalesce(jsonb_agg(entry||jsonb_build_object('removable',open_now and exists(
      select 1 from app.parties p where p.id=(entry->>'id')::uuid and p.state in ('confirmed','waitlisted')
        and not app.is_session_manager(p.user_id,s.group_id))) order by n),'[]'::jsonb)
    into rows from jsonb_array_elements(result->'roster') with ordinality a(entry,n);
  return jsonb_set(result,'{roster}',rows);
end;
$$;

-- Back to the previous definition: removal reaches only the one session, below.
create or replace function app.known_people(p_actor uuid) returns table(user_id uuid)
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

create or replace function api.send_invite(p_actor_id uuid,p_actor_name text,p_key uuid,p_kind text,p_target uuid,p_profile_id uuid) returns jsonb
language plpgsql set search_path='' as $$
declare receipt app.operation_receipts; payload jsonb; target uuid; i app.invites; removed boolean;
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
  -- P-28: the organizers can always invite back someone they removed from this session.
  removed:=p_kind='session' and app.removed_from_session(target,p_target);
  if not removed and exists(select 1 from app.invites where invitee_id=target and state='declined'
      and (case when p_kind='group' then group_id else session_id end)=p_target) then
    raise sqlstate 'P0001' using message='invite_declined'; end if;
  if not removed and not exists(select 1 from app.known_people(p_actor_id) k where k.user_id=target) then
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

revoke all on function app.drop_removed_fee(uuid,uuid,text,timestamptz),
  app.update_payment_before_removals(uuid,text,uuid,uuid,uuid,text,integer),api.update_payment(uuid,text,uuid,uuid,uuid,text,integer),
  app.registration_view_before_removable(uuid,uuid,uuid),app.registration_view(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function app.drop_removed_fee(uuid,uuid,text,timestamptz),
  app.update_payment_before_removals(uuid,text,uuid,uuid,uuid,text,integer),api.update_payment(uuid,text,uuid,uuid,uuid,text,integer),
  app.registration_view_before_removable(uuid,uuid,uuid),app.registration_view(uuid,uuid,uuid)
  to service_role;
