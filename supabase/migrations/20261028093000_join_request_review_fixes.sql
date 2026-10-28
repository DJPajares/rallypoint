-- P-34 / WDL-412 review fixes.
-- 1. A request's consent covers only the terms it was given on. Any change
--    since then other than wording or who can join (title, activity,
--    instructions, joinMode), capacity, guests or the opening time needs the
--    requester to keep the request first, so nobody is confirmed on a fee,
--    payment rule or cutoff they never saw.
-- 2. A booked person sees their booking, never a request.
-- 3. The Sessions tab also shows a request that was not accepted or expired,
--    since the session page is the only other place they learn the outcome.
-- 4. "Decline the rest" names how many requests the organizer saw; if more
--    arrived since, nothing is declined.

create or replace function app.request_needs_confirm(p_request app.join_requests) returns boolean
language sql stable security invoker set search_path='' as $$
  select exists(select 1 from app.session_changes c
    where c.session_id=p_request.session_id and c.version>p_request.consent_version
      and (c.material or exists(select 1 from jsonb_array_elements_text(c.changed_fields) k(field)
        where k.field not in ('title','activity','instructions','joinMode','capacity','guests','openLocal','opensAt'))));
$$;

create or replace function app.registration_view(p_actor uuid,p_session uuid,p_party uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb; s app.sessions; r app.join_requests; own_request jsonb; waiting jsonb;
  started boolean; occupied bigint; queued bigint;
begin
  result:=app.registration_view_before_requests(p_actor,p_session,p_party);
  select * into s from app.sessions where id=p_session;
  started:=clock_timestamp()>=(s.details->>'startsAt')::timestamptz;
  select * into r from app.join_requests where session_id=p_session and user_id=p_actor
    order by asked_at desc,id desc limit 1;
  -- A booked person sees their booking, never a request.
  if found and r.state<>'accepted' and not exists(select 1 from app.parties b
      where b.session_id=p_session and b.user_id=p_actor and b.state in ('confirmed','waitlisted')) then
    own_request:=jsonb_build_object('id',r.id,
      'state',case when r.state<>'pending' then r.state
        when s.state='cancelled' then 'session_cancelled'
        when started or s.state<>'published' then 'expired'
        else 'pending' end,
      'seats',r.seats,'guestName',r.guest_name,
      'needsConfirm',r.state='pending' and app.request_needs_confirm(r),
      'askedAt',r.asked_at,
      'cancelsLeft',greatest(0,2-(select count(*) from app.join_requests c
        where c.session_id=p_session and c.user_id=p_actor and c.state='cancelled')));
  end if;
  result:=result||jsonb_build_object('joinRequest',own_request);
  if coalesce((result->>'canManage')::boolean,false) then
    select coalesce(sum(seats),0) into occupied from app.parties where session_id=p_session and state='confirmed';
    select count(*) into queued from app.parties where session_id=p_session and state='waitlisted';
    select coalesce(jsonb_agg(x.item order by x.asked_at,x.id),'[]'::jsonb) into waiting from (
      select q.asked_at,q.id,jsonb_build_object('id',q.id,'profileId',pr.profile_id,
        'name',coalesce(pr.display_name,pr.account_name,q.primary_name),
        'title',app.visible_title(q.user_id),
        'level',(select pa.level from app.profile_activities pa
          where pa.user_id=q.user_id and pa.activity_key=s.activity_key order by pa.position limit 1),
        'played',(select count(*) from app.badge_sessions(q.user_id)),
        'hosted',(select count(*) from app.badge_hosted(q.user_id)),
        'playedInGroup',(select count(*) from app.badge_sessions(q.user_id) b where b.group_id=s.group_id),
        'seats',q.seats,'guestName',q.guest_name,'askedAt',q.asked_at,
        'needsConfirm',app.request_needs_confirm(q),
        'fitsNow',queued=0 and occupied+q.seats<=(s.details->>'capacity')::integer,
        'waitlistPosition',case when queued=0 and occupied+q.seats<=(s.details->>'capacity')::integer then null else queued+1 end
      ) as item
      from app.join_requests q left join app.profiles pr on pr.user_id=q.user_id
      where q.session_id=p_session and q.state='pending' and s.state='published' and not started
    ) x;
    result:=result||jsonb_build_object('requests',waiting);
  end if;
  return result;
end;
$$;

create or replace function api.list_my_sessions(p_actor_id uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
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
        order by q.asked_at desc, q.id desc limit 1) as request_state
    from app.sessions s join app.groups g on g.id = s.group_id
    where (exists (select 1 from app.group_roles r
        where r.group_id = s.group_id and r.user_id = p_actor_id
          and r.role in ('owner', 'organizer', 'cohost'))
      or (s.state <> 'draft' and exists (select 1 from app.parties p
        where p.session_id = s.id and p.user_id = p_actor_id
          and p.state in ('confirmed', 'waitlisted')))
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
        when m.request_state = 'declined' then 'not_accepted'
        when m.request_state = 'expired' then 'request_expired'
        else 'requested' end as status,
      (m.details->>'startsAt')::timestamptz as starts_at,
      (m.details->>'endsAt')::timestamptz as ends_at
    from mine m
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

drop function api.decline_pending_requests(uuid,text,uuid,uuid);
create function api.decline_pending_requests(p_actor_id uuid,p_actor_name text,p_key uuid,p_slug uuid,p_expected integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s app.sessions; receipt app.operation_receipts; payload jsonb; now_at timestamptz; n integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text||p_key::text,0));
  s:=app.lock_registration_session(p_slug);
  payload:=jsonb_build_object('slug',p_slug,'expected',p_expected);
  select * into receipt from app.operation_receipts where actor_id=p_actor_id and request_key=p_key;
  if found then
    if receipt.action<>'decline_pending_requests' or receipt.payload<>payload then raise sqlstate 'P0001' using message='idempotency_conflict'; end if;
    select count(*) into n from app.join_requests where session_id=s.id and state='declined'
      and decided_by=p_actor_id and decided_at=receipt.created_at;
    return jsonb_build_object('registration',app.registration_view(p_actor_id,s.id),'operationKey',p_key,'declined',n);
  end if;
  if not app.is_session_manager(p_actor_id,s.group_id) then raise insufficient_privilege using message='group_access_denied'; end if;
  now_at:=clock_timestamp();
  if s.state<>'published' or now_at>=(s.details->>'startsAt')::timestamptz then raise sqlstate 'P0001' using message='registration_closed'; end if;
  if (select count(*) from app.join_requests where session_id=s.id and state='pending') is distinct from p_expected then
    raise sqlstate 'P0001' using message='request_list_changed'; end if;
  update app.join_requests set state='declined',decided_at=now_at,decided_by=p_actor_id,decided_by_name=p_actor_name
    where session_id=s.id and state='pending';
  get diagnostics n=row_count;
  insert into app.operation_receipts values(p_actor_id,p_key,'decline_pending_requests',payload,s.id,now_at);
  return jsonb_build_object('registration',app.registration_view(p_actor_id,s.id),'operationKey',p_key,'declined',n);
end;
$$;

revoke all on function app.request_needs_confirm(app.join_requests),app.registration_view(uuid,uuid,uuid),
  api.list_my_sessions(uuid),api.decline_pending_requests(uuid,text,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function app.request_needs_confirm(app.join_requests),app.registration_view(uuid,uuid,uuid),
  api.list_my_sessions(uuid),api.decline_pending_requests(uuid,text,uuid,uuid,integer) to service_role;
