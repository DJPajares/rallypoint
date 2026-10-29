-- P-28 / WDL-403: an organizer or co-host removes someone from an upcoming
-- session (D-07, owner 2026-10-29). The whole party leaves, its places go to
-- the waitlist in strict order, and who removed them and when is kept. An
-- unpaid fee or share is dropped; a paid marker stays exactly as it was. No
-- email. The person can't rejoin that session from its link; an invite from
-- the session's organizers lets them back in.

create table app.party_removals (
  party_id uuid primary key references app.parties(id) on delete cascade,
  removed_by uuid references auth.users(id) on delete set null,
  removed_by_name text not null check (char_length(removed_by_name) between 1 and 80),
  removed_at timestamptz not null
);
alter table app.party_removals enable row level security;
revoke all on app.party_removals from public,anon,authenticated;
grant select,insert on app.party_removals to service_role;

alter table app.fee_obligations drop constraint fee_obligations_liability_state_check;
alter table app.fee_obligations add constraint fee_obligations_liability_state_check
  check(liability_state in ('due','removed_before_cutoff','waived','removed_session_cancelled','released_unpaid',
    'removed_after_change','removed_by_organizer'));
alter table app.fee_changes drop constraint fee_changes_action_check;
alter table app.fee_changes add constraint fee_changes_action_check
  check(action in ('marked_paid','marked_unpaid','waived','waiver_undone','removed_before_cutoff','split_corrected',
    'removed_session_cancelled','released_unpaid','removed_after_change','removed_by_organizer'));
alter table app.split_claim_changes drop constraint split_claim_changes_action_check;
alter table app.split_claim_changes add constraint split_claim_changes_action_check
  check(action in ('confirmed','waived','waiver_undone','removed_before_cutoff','removed_session_cancelled',
    'removed_after_change','removed_by_organizer'));
-- 'removed' maps to no email kind, so nothing is queued for it.
alter table app.registration_events drop constraint registration_events_kind_check;
alter table app.registration_events add constraint registration_events_kind_check
  check(kind in ('confirmed','waitlisted','promoted','withdrawn','released','removed'));

-- Whether this person's latest booking in the session was removed by its
-- organizers, with no invite waiting that lets them back.
create function app.removed_from_session(p_actor uuid,p_session uuid) returns boolean
language sql stable security invoker set search_path='' as $$
  select exists(select 1 from app.parties p join app.party_removals r on r.party_id=p.id
      where p.session_id=p_session and p.user_id=p_actor
        and not exists(select 1 from app.parties n where n.session_id=p_session and n.user_id=p_actor
          and n.queue_sequence>p.queue_sequence))
    and not exists(select 1 from app.invites i where i.session_id=p_session and i.invitee_id=p_actor and i.state='pending');
$$;

create function api.remove_party(p_actor_id uuid,p_actor_name text,p_key uuid,p_slug uuid,p_party_id uuid) returns jsonb
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
  update app.parties set state='removed' where id=p.id;
  insert into app.party_removals values(p.id,p_actor_id,trim(p_actor_name),now_at);
  -- An unpaid fee is dropped. Paid, waived and already-removed fees stay as they are.
  with dropped as (
    update app.fee_obligations set liability_state='removed_by_organizer',removed_at=now_at,removed_by=p_actor_id,revision=revision+1
      where party_id=p.id and liability_state='due' and not marked_paid
      returning party_id,revision,total_minor,currency,split_run_id)
  insert into app.fee_changes(party_id,revision,action,actor_id,actor_name,created_at,previous_minor,current_minor,currency,split_run_id)
    select d.party_id,d.revision,'removed_by_organizer',p_actor_id,trim(p_actor_name),now_at,d.total_minor,d.total_minor,d.currency,d.split_run_id
    from dropped d;
  -- Before a split is final: an unpaid share no longer counts.
  with dropped as (
    update app.split_claims set eligible=false,revision=revision+1,changed_at=now_at,changed_by=p_actor_id
      where party_id=p.id and eligible
        and not exists(select 1 from app.fee_obligations where party_id=p.id and marked_paid)
      returning revision)
  insert into app.split_claim_changes(party_id,revision,action,actor_id,actor_name,created_at)
    select p.id,d.revision,'removed_by_organizer',p_actor_id,trim(p_actor_name),now_at from dropped d;
  insert into app.registration_events(party_id,kind,created_at) values(p.id,'removed',now_at);
  -- Never bypasses a head party that does not fit the freed seats.
  perform app.fill_waitlist(s.id);
  insert into app.operation_receipts values(p_actor_id,p_key,'remove_party',payload,p.id,now_at);
  return jsonb_build_object('registration',app.registration_view(p_actor_id,s.id),'operationKey',p_key);
end;
$$;

-- Recovery by key: a removal answers with the roster, for a current manager only.
alter function api.read_operation(uuid,uuid) rename to read_operation_before_removals;
alter function api.read_operation_before_removals(uuid,uuid) set schema app;
create function api.read_operation(p_actor_id uuid,p_key uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r app.operation_receipts; s app.sessions;
begin
  select * into r from app.operation_receipts where actor_id=p_actor_id and request_key=p_key;
  if r.action='remove_party' then
    select s2.* into s from app.sessions s2 join app.parties p on p.session_id=s2.id where p.id=r.resource_id;
    perform app.require_manager(p_actor_id,s.group_id);
    perform 1 from app.sessions where id=s.id for share;
    return jsonb_build_object('operationKey',p_key,'registration',app.registration_view(p_actor_id,s.id));
  end if;
  return app.read_operation_before_removals(p_actor_id,p_key);
end;
$$;

-- Managers see who removed each removed party and when; the person removed
-- sees that the organizers removed them.
alter function app.registration_view(uuid,uuid,uuid) rename to registration_view_before_removals;
create function app.registration_view(p_actor uuid,p_session uuid,p_party uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb; rows jsonb;
begin
  result:=app.registration_view_before_removals(p_actor,p_session,p_party);
  if coalesce((result->>'canManage')::boolean,false) then
    select coalesce(jsonb_agg(entry||coalesce((select jsonb_build_object('removal',
        jsonb_build_object('by',r.removed_by_name,'at',r.removed_at))
      from app.party_removals r where r.party_id=(entry->>'id')::uuid),'{}'::jsonb) order by n),'[]'::jsonb)
      into rows from jsonb_array_elements(result->'roster') with ordinality a(entry,n);
    result:=jsonb_set(result,'{roster}',rows);
  end if;
  if result->'own' is not null and jsonb_typeof(result->'own')='object' then
    result:=jsonb_set(result,'{own,removedByOrganizer}',
      to_jsonb(exists(select 1 from app.party_removals r where r.party_id=(result->'own'->>'id')::uuid)));
  end if;
  return result;
end;
$$;

-- Joining or asking again is refused after a removal, unless the organizers
-- invited them back. A retried earlier request still answers as before.
create or replace function api.join_session(p_actor_id uuid,p_key uuid,p_slug uuid,p_version integer,p_seats integer,
  p_guest_name text,p_primary_name text,p_consent boolean) returns jsonb
language plpgsql set search_path='' as $$
begin
  perform app.assert_session_access(p_actor_id,p_key,p_slug,false);
  perform app.assert_not_removed(p_actor_id,p_key,p_slug);
  return app.hide_private_registration(p_actor_id,p_slug,
    api.join_session_before_private(p_actor_id,p_key,p_slug,p_version,p_seats,p_guest_name,p_primary_name,p_consent));
end;
$$;
create or replace function api.ask_to_join(p_actor_id uuid,p_key uuid,p_slug uuid,p_version integer,p_seats integer,
  p_guest_name text,p_primary_name text,p_consent boolean) returns jsonb
language plpgsql set search_path='' as $$
begin
  perform app.assert_session_access(p_actor_id,p_key,p_slug,true);
  perform app.assert_not_removed(p_actor_id,p_key,p_slug);
  return app.hide_private_registration(p_actor_id,p_slug,
    api.ask_to_join_before_private(p_actor_id,p_key,p_slug,p_version,p_seats,p_guest_name,p_primary_name,p_consent));
end;
$$;
create function app.assert_not_removed(p_actor uuid,p_key uuid,p_slug uuid) returns void
language plpgsql stable security invoker set search_path='' as $$
begin
  if exists(select 1 from app.operation_receipts where actor_id=p_actor and request_key=p_key) then return; end if;
  if app.removed_from_session(p_actor,(select id from app.sessions where slug=p_slug)) then
    raise sqlstate 'P0001' using message='removed_from_session';
  end if;
end;
$$;

-- Someone removed from a session the actor runs can be invited back to it.
create or replace function app.known_people(p_actor uuid) returns table(user_id uuid)
language sql stable security invoker set search_path='' as $$
  select p.user_id from app.parties p join app.sessions s on s.id=p.session_id
    where (p.state='confirmed' or exists(select 1 from app.party_removals r where r.party_id=p.id))
      and s.state<>'cancelled'
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

-- The Sessions tab keeps a session someone was removed from, marked removed.
create or replace function api.list_my_sessions_before_private(p_actor_id uuid) returns jsonb
language plpgsql stable set search_path='' as $$
declare result jsonb;
begin
  with mine as (
    select s.id, s.slug, s.state, s.details, g.name as group_name,
      exists (select 1 from app.group_roles r
        where r.group_id = s.group_id and r.user_id = p_actor_id
          and r.role in ('owner', 'organizer', 'cohost')) as manages,
      (select p.state from app.parties p
        where p.session_id = s.id and p.user_id = p_actor_id
          and p.state in ('confirmed', 'waitlisted')
        order by p.queue_sequence desc limit 1) as party_state,
      (select p.queue_sequence from app.parties p
        where p.session_id = s.id and p.user_id = p_actor_id
          and p.state in ('confirmed', 'waitlisted')
        order by p.queue_sequence desc limit 1) as party_sequence,
      (select case when q.state = 'pending' and (s.state <> 'published'
          or (s.details->>'startsAt')::timestamptz <= now()) then 'expired' else q.state end
        from app.join_requests q where q.session_id = s.id and q.user_id = p_actor_id
        order by q.asked_at desc, q.id desc limit 1) as request_state,
      app.removed_from_session(p_actor_id, s.id) as removed
    from app.sessions s join app.groups g on g.id = s.group_id
    where (exists (select 1 from app.group_roles r
        where r.group_id = s.group_id and r.user_id = p_actor_id
          and r.role in ('owner', 'organizer', 'cohost'))
      or (s.state <> 'draft' and exists (select 1 from app.parties p
        where p.session_id = s.id and p.user_id = p_actor_id
          and (p.state in ('confirmed', 'waitlisted')
            or exists (select 1 from app.party_removals x where x.party_id = p.id))))
      or (s.state <> 'draft' and exists (select 1 from app.join_requests q
          where q.session_id = s.id and q.user_id = p_actor_id and q.state in ('pending','declined'))))
      and not exists (select 1 from app.session_cancellations c
        where c.session_id = s.id and c.previous_state = 'draft')
      and not (s.state = 'draft' and g.archived_at is not null)
  ), shaped as (
    select m.*,
      case when m.state = 'cancelled' then 'cancelled'
        when m.state = 'draft' then 'draft'
        when m.manages then 'organizing'
        when m.party_state = 'confirmed' then 'in'
        when m.party_state = 'waitlisted' then 'waitlisted'
        when m.removed then 'removed'
        when m.request_state = 'declined' then 'not_accepted'
        when m.request_state = 'expired' then 'request_expired'
        else 'requested' end as status,
      (m.details->>'startsAt')::timestamptz as starts_at,
      (m.details->>'endsAt')::timestamptz as ends_at
    from mine m
    -- Removed, then invited back but not rejoined: their invite shows on Home.
    where m.manages or m.party_state is not null or m.removed or m.request_state is not null
  ), rows_ as (
    select x.*,
      case when x.state = 'draft' then false
        when x.state = 'cancelled' then coalesce(x.starts_at <= now(), false)
        else coalesce(x.ends_at <= now(), false) end as over,
      jsonb_build_object(
        'id', case when x.state = 'draft' then x.id else null end,
        'slug', x.slug,
        'title', x.details->>'title',
        'groupName', x.group_name,
        'startLocal', coalesce(x.details->>'startLocal', ''),
        'startsAt', x.details->>'startsAt',
        'endsAt', x.details->>'endsAt',
        'timeZone', x.details->>'timeZone',
        'state', x.state,
        'status', x.status,
        'waitPosition', case when x.status = 'waitlisted' then
          (select count(*) + 1 from app.parties w
            where w.session_id = x.id and w.state = 'waitlisted'
              and w.queue_sequence < x.party_sequence) else null end
      ) || case when x.status = 'organizing' and x.state = 'published'
          and coalesce(x.starts_at > now(), false) then
        jsonb_build_object('requestCount', (select count(*) from app.join_requests q
          where q.session_id = x.id and q.state = 'pending'))
        else '{}'::jsonb end as item
    from shaped x
  )
  select jsonb_build_object(
    'upcoming', coalesce((select jsonb_agg(u.item order by u.starts_at asc nulls last, u.item->>'title') from (
      select item, starts_at from rows_ where not over
      order by starts_at asc nulls last, item->>'title' limit 100) u), '[]'::jsonb),
    'past', coalesce((select jsonb_agg(q.item order by q.starts_at desc) from (
      select item, starts_at from rows_ where over
      order by starts_at desc limit 20) q), '[]'::jsonb),
    'pastTotal', (select count(*) from rows_ where over)
  ) into result;
  return result;
end;
$$;

revoke all on function app.removed_from_session(uuid,uuid),api.remove_party(uuid,text,uuid,uuid,uuid),
  app.read_operation_before_removals(uuid,uuid),api.read_operation(uuid,uuid),
  app.registration_view_before_removals(uuid,uuid,uuid),app.registration_view(uuid,uuid,uuid),
  app.assert_not_removed(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function app.removed_from_session(uuid,uuid),api.remove_party(uuid,text,uuid,uuid,uuid),
  app.read_operation_before_removals(uuid,uuid),api.read_operation(uuid,uuid),
  app.registration_view_before_removals(uuid,uuid,uuid),app.registration_view(uuid,uuid,uuid),
  app.assert_not_removed(uuid,uuid,uuid)
  to service_role;
