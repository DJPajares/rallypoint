-- P-39 / WDL-417: follow-ups to P-35 groups.
-- 1. Co-host candidates are people confirmed in one of the organizer's
--    sessions, plus members of groups the organizer admins. The list is built
--    from those people, not by checking every profile.
-- 2. A private group seen through its invite link shows its name and Ask to
--    join, not its member count.
-- 3. After a group turns Private, someone with a pending request and no link
--    sees only that request, so they can cancel it; cancelling shows nothing
--    more about the group.
-- 4. Deleting a draft removes its hidden hosting team.
-- 5. The session editor learns whether the viewer is the session's organizer.
-- 6. A rename and its retry report the admin role.

create or replace function app.cohost_eligible_ids(p_actor uuid) returns table(user_id uuid)
language sql stable set search_path='' as $$
  select p.user_id from app.parties p join app.sessions s on s.id = p.session_id
    join app.group_roles m on m.group_id = s.group_id
    where m.user_id = p_actor and m.role in ('owner','organizer','cohost')
      and p.state = 'confirmed' and p.user_id is not null
  union
  select r.user_id from app.group_roles r join app.groups g on g.id = r.group_id and g.kind = 'community'
    join app.group_roles a on a.group_id = g.id and a.user_id = p_actor and a.role = 'owner'
    where r.role = 'member';
$$;

create or replace function app.cohost_eligible(p_actor uuid, p_target uuid) returns boolean
language sql stable set search_path='' as $$
  select exists(select 1 from app.cohost_eligible_ids(p_actor) e where e.user_id = p_target);
$$;

create or replace function api.read_group_cohosts(p_actor_id uuid, p_group_id uuid, p_after uuid) returns jsonb
language plpgsql set search_path='' as $$
declare candidates jsonb; assigned jsonb; next_cursor uuid; revision text;
begin
  perform app.require_session_team_owner(p_actor_id, p_group_id);
  -- Older fixtures/registrants may predate profiles. Give them a stable handle
  -- using a stored display name or the neutral fallback, never contact data.
  insert into app.profiles(user_id, account_name)
    select ids.user_id, coalesce((select p.primary_name from app.parties p
      where p.user_id = ids.user_id order by p.created_at desc, p.queue_sequence desc limit 1), 'Participant')
    from (select user_id from app.group_roles where group_id = p_group_id
      union select user_id from app.cohost_eligible_ids(p_actor_id)) ids
    where not exists(select 1 from app.profiles pr where pr.user_id = ids.user_id)
    on conflict(user_id) do nothing;

  select coalesce(max(id)::text, '0') into revision from app.group_cohost_changes where group_id = p_group_id;
  select coalesce(jsonb_agg(jsonb_build_object('profileId', pr.profile_id,
    'name', coalesce(pr.display_name, pr.account_name)) order by pr.profile_id), '[]'::jsonb)
    into assigned from app.group_roles r join app.profiles pr on pr.user_id = r.user_id
    where r.group_id = p_group_id and r.role = 'cohost';

  with page as (
    select pr.profile_id, coalesce(pr.display_name, pr.account_name) as name
    from app.cohost_eligible_ids(p_actor_id) e
    join app.profiles pr on pr.user_id = e.user_id
    left join app.group_roles r on r.group_id = p_group_id and r.user_id = e.user_id
    where (p_after is null or pr.profile_id > p_after)
      and (r.role is null or r.role = 'member')
    order by pr.profile_id limit 51
  ), numbered as (select *, row_number() over(order by profile_id) as n from page)
  select coalesce(jsonb_agg(jsonb_build_object('profileId', profile_id, 'name', name)
    order by profile_id) filter(where n <= 50), '[]'::jsonb),
    case when count(*) > 50 then (array_agg(profile_id order by profile_id))[50] else null end
    into candidates, next_cursor from numbered;

  -- Removed groups retain session history and manager access. Owner role
  -- administration remains available so that access can still be revoked.
  return jsonb_build_object('group', (select jsonb_build_object('id', id, 'name', name, 'role', 'owner')
      from app.groups where id = p_group_id),
    'revision', revision, 'assigned', assigned, 'candidates', candidates, 'nextCursor', next_cursor);
end;
$$;

create or replace function app.read_group_before_invites(p_actor_id uuid, p_group_id uuid, p_invite uuid) returns jsonb
language plpgsql stable set search_path='' as $$
declare g app.groups; my_role text; result jsonb; r app.group_join_requests;
begin
  select * into g from app.groups where id=p_group_id and kind='community' and archived_at is null;
  if not found then raise no_data_found using message='group_not_found'; end if;
  select role into my_role from app.group_roles where group_id=g.id and user_id=p_actor_id;
  select * into r from app.group_join_requests where group_id=g.id and user_id=p_actor_id
    order by asked_at desc,id desc limit 1;
  if my_role is null and g.visibility='private' and p_invite is distinct from g.invite_token then
    -- A pending request stays visible, so it can still be cancelled.
    return jsonb_build_object('id',g.id,'visibility','private','concealed',true)
      ||case when r.state='pending' then jsonb_build_object('request',jsonb_build_object('id',r.id,'state',r.state))
        else '{}'::jsonb end;
  end if;
  result:=jsonb_build_object('id',g.id,'name',g.name,'visibility',g.visibility,
    'viewerRole',case my_role when 'owner' then 'admin' when 'member' then 'member' end,
    'canAsk',my_role is null,
    'request',case when my_role is null and r.id is not null and r.state in ('pending','declined')
      then jsonb_build_object('id',r.id,'state',r.state) end);
  if my_role is not null or g.visibility='public' then
    result:=result||jsonb_build_object('memberCount',(select count(*) from app.group_roles where group_id=g.id));
  end if;
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

create or replace function api.cancel_group_request(p_actor_id uuid, p_key uuid, p_group_id uuid, p_request_id uuid) returns jsonb
language plpgsql set search_path='' as $$
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
  -- The answer shows what the requester can see without the link.
  return jsonb_build_object('group',api.read_group(p_actor_id,g.id,null),'operationKey',p_key);
end;
$$;

-- Removes a hosting team once its last session is gone. Only host teams, and
-- only empty ones; the backend can't delete groups itself.
create function app.delete_empty_host_team(p_group uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  delete from app.groups g where g.id = p_group and g.kind = 'host'
    and not exists(select 1 from app.sessions s where s.group_id = g.id);
end;
$$;
revoke all on function app.delete_empty_host_team(uuid) from public,anon,authenticated;
grant execute on function app.delete_empty_host_team(uuid) to service_role;

create or replace function app.delete_draft_before_cohost_recovery(p_actor_id uuid, p_key uuid, p_session_id uuid) returns jsonb
language plpgsql set search_path='' as $$
declare s app.sessions; receipt app.operation_receipts;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text || p_key::text, 0));
  select * into receipt from app.operation_receipts where actor_id = p_actor_id and request_key = p_key;
  if found then
    if receipt.action <> 'delete_draft' or receipt.payload->>'sessionId' <> p_session_id::text then
      raise sqlstate 'P0001' using message = 'idempotency_conflict'; end if;
    return jsonb_build_object('deleted', true, 'groupId', receipt.payload->>'groupId');
  end if;
  select * into s from app.sessions where id = p_session_id;
  if not found then raise insufficient_privilege using message = 'session_unavailable'; end if;
  -- Same lock order as publishing: group row, then session row. A publish that
  -- got there first leaves a non-draft here; a delete that did leaves nothing
  -- for the publish to find.
  perform app.require_manager(p_actor_id, s.group_id);
  select * into s from app.sessions where id = p_session_id for update;
  if not found then raise insufficient_privilege using message = 'session_unavailable'; end if;
  if s.state <> 'draft' then raise sqlstate 'P0001' using message = 'not_a_draft'; end if;
  perform app.delete_draft_rows(s.id);
  perform app.delete_empty_host_team(s.group_id);
  insert into app.operation_receipts values(p_actor_id, p_key, 'delete_draft',
    jsonb_build_object('sessionId', s.id, 'groupId', s.group_id), s.id, clock_timestamp());
  return jsonb_build_object('deleted', true, 'groupId', s.group_id);
end;
$$;

-- A retried delete still checks the deleter manages the team, unless the
-- delete removed the team; then there is nothing left to manage or reveal.
create or replace function app.require_draft_receipt_manager(p_actor uuid, p_group uuid) returns void
language plpgsql set search_path='' as $$
begin
  if exists(select 1 from app.groups where id = p_group) then
    perform app.require_manager(p_actor, p_group);
  end if;
end;
$$;
revoke all on function app.require_draft_receipt_manager(uuid,uuid) from public,anon,authenticated;
grant execute on function app.require_draft_receipt_manager(uuid,uuid) to service_role;

create or replace function api.delete_draft(p_actor_id uuid, p_key uuid, p_session_id uuid) returns jsonb
language plpgsql set search_path='' as $$
declare receipt app.operation_receipts;
begin
  -- Preserve actor/key -> group lock order, including simultaneous replays.
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text || p_key::text, 0));
  select * into receipt from app.operation_receipts where actor_id = p_actor_id and request_key = p_key;
  if receipt.action = 'delete_draft' then
    perform app.require_draft_receipt_manager(p_actor_id, (receipt.payload->>'groupId')::uuid);
  end if;
  return app.delete_draft_before_cohost_recovery(p_actor_id, p_key, p_session_id);
end;
$$;

create or replace function app.read_operation_before_join_requests(p_actor_id uuid, p_key uuid) returns jsonb
language plpgsql set search_path='' as $$
declare receipt app.operation_receipts;
begin
  select * into receipt from app.operation_receipts where actor_id = p_actor_id and request_key = p_key;
  if receipt.action = 'delete_draft' then
    perform app.require_draft_receipt_manager(p_actor_id, (receipt.payload->>'groupId')::uuid);
  end if;
  return app.read_operation_before_cohost_recovery(p_actor_id, p_key);
end;
$$;

create or replace function api.read_managed_session(p_actor_id uuid, p_session_id uuid) returns jsonb
language plpgsql set search_path='' as $$
begin
  return api.read_managed_session_before_private(p_actor_id,p_session_id)
    ||jsonb_build_object('access',app.session_access_json(p_session_id),
      -- Co-hosts are managed by the session's organizer only.
      'canManageCohosts',exists(select 1 from app.sessions s join app.group_roles r on r.group_id=s.group_id
        where s.id=p_session_id and r.user_id=p_actor_id and r.role='owner'));
end;
$$;

create or replace function api.rename_group(p_actor_id uuid, p_key uuid, p_group_id uuid, p_name text) returns jsonb
language plpgsql set search_path='' as $$
declare receipt app.operation_receipts; g app.groups; payload jsonb;
begin
  p_name := trim(p_name);
  if length(p_name) not between 1 and 100 then raise check_violation using message='invalid_input'; end if;
  payload := jsonb_build_object('groupId',p_group_id,'name',p_name);
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text || p_key::text,0));
  select * into receipt from app.operation_receipts where actor_id=p_actor_id and request_key=p_key;
  if found then
    if receipt.action <> 'rename_group' or receipt.payload <> payload then raise sqlstate 'P0001' using message='idempotency_conflict'; end if;
    return jsonb_build_object('group',jsonb_build_object('id',p_group_id,'name',p_name,'role','admin'));
  end if;
  select * into g from app.groups where id=p_group_id for update;
  if not found or g.archived_at is not null
    or not exists(select 1 from app.group_roles where group_id=p_group_id and user_id=p_actor_id and role='owner')
    or g.kind<>'community' then
    raise insufficient_privilege using message='group_access_denied';
  end if;
  update app.groups set name=p_name where id=p_group_id;
  insert into app.operation_receipts values(p_actor_id,p_key,'rename_group',payload,p_group_id,now());
  return jsonb_build_object('group',jsonb_build_object('id',p_group_id,'name',p_name,'role','admin'));
end;
$$;

revoke all on function app.cohost_eligible_ids(uuid) from public,anon,authenticated;
grant execute on function app.cohost_eligible_ids(uuid) to service_role;
