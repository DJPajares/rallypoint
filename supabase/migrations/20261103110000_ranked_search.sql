-- Ranked searches (D-26, WDL-421). A player searches for a ranked pickleball
-- match: a format, 1 to 3 areas, and optionally up to 5 courts in those
-- areas and some broad times. Singles starts searching at once. Doubles
-- waits for the partner: someone the starter was checked in with at a
-- session (a direct invite), or whoever opens the starter's link first. An
-- invite waits 48 hours; a search looks for 7 days. Both lapse on read, with
-- no scheduled job. One active search per person, as starter or partner.
-- Matching (WDL-422) adds the "no new search while in a match" rule.
--
-- Recovery:
--   drop function api.read_operation(uuid,uuid);
--   alter function app.read_operation_before_ranked_search(uuid,uuid) set schema api;
--   alter function api.read_operation_before_ranked_search(uuid,uuid) rename to read_operation;
--   drop function api.read_my_search(uuid), api.ranked_partners(uuid),
--     api.start_search(uuid,uuid,text,text[],uuid[],text[],uuid,boolean),
--     api.read_search_invite(uuid,uuid), api.answer_search_invite(uuid,uuid,uuid,boolean),
--     api.cancel_search(uuid,uuid,uuid), api.restart_search(uuid,uuid,uuid),
--     app.search_view(app.ranked_searches,uuid), app.search_active(app.ranked_searches),
--     app.active_search_of(uuid), app.lock_searchers(uuid[]), app.search_person(uuid),
--     app.search_areas_json(text[]), app.search_receipt(uuid,uuid,text,jsonb);
--   drop table app.ranked_searches;

create table app.ranked_searches (
  id uuid primary key default gen_random_uuid(),
  activity_key text not null default 'pickleball',
  format text not null,
  starter_id uuid not null references auth.users(id) on delete cascade,
  -- The invited or accepted partner; null for an unused link invite.
  partner_id uuid references auth.users(id) on delete cascade,
  invite_token uuid unique,
  invite_by_link boolean not null default false,
  state text not null check (state in ('waiting_partner', 'searching', 'cancelled', 'declined')),
  areas text[] not null check (cardinality(areas) between 1 and 3),
  courts uuid[] not null default '{}' check (cardinality(courts) <= 5),
  windows text[] not null default '{}',
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ends_at timestamptz not null,
  ended_at timestamptz,
  restarted_from uuid references app.ranked_searches(id) on delete set null,
  foreign key (activity_key, format) references app.ranked_formats(activity_key, format),
  check (partner_id is null or partner_id <> starter_id)
);
create index ranked_searches_starter on app.ranked_searches(starter_id, created_at desc);
create index ranked_searches_partner on app.ranked_searches(partner_id, created_at desc);

alter table app.ranked_searches enable row level security;
revoke all on app.ranked_searches from public, anon, authenticated;
grant select, insert, update, delete on app.ranked_searches to service_role;

-- Still waiting or searching, and not yet lapsed.
create function app.search_active(s app.ranked_searches) returns boolean
language sql stable security invoker set search_path = '' as $$
  select s.state in ('waiting_partner', 'searching') and s.ends_at > now();
$$;

-- The one active search someone is in, as starter or accepted partner.
create function app.active_search_of(p_user uuid) returns uuid
language sql stable security invoker set search_path = '' as $$
  select s.id from app.ranked_searches s
  where (s.starter_id = p_user or (s.partner_id = p_user and s.started_at is not null))
    and app.search_active(s)
  limit 1;
$$;

-- Serialise searches per person, in a fixed order so two people never deadlock.
create function app.lock_searchers(p_users uuid[]) returns void
language sql security invoker set search_path = '' as $$
  select pg_advisory_xact_lock(hashtextextended('ranked-search:' || u::text, 0))
  from (select distinct u from unnest(p_users) u where u is not null order by u) x;
$$;

create function app.search_person(p_user uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select case when p_user is null then null else coalesce(
    (select jsonb_build_object('profileId', pr.profile_id, 'name', coalesce(pr.display_name, pr.account_name))
      from app.profiles pr where pr.user_id = p_user),
    jsonb_build_object('profileId', null, 'name', 'Player')) end;
$$;

create function app.search_areas_json(p_areas text[]) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', a.key, 'label', coalesce(a.everyday_name, a.name)) order by u.n), '[]'::jsonb)
  from unnest(p_areas) with ordinality u(k, n) join app.areas a on a.key = u.k;
$$;

-- A search as one of its searchers sees it.
create function app.search_view(s app.ranked_searches, p_actor uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'id', s.id, 'format', s.format,
    'state', case when app.search_active(s) then s.state else 'ended' end,
    'endReason', case when app.search_active(s) then null
      when s.state in ('cancelled', 'declined') then s.state else 'expired' end,
    'endsAt', s.ends_at,
    'role', case when s.starter_id = p_actor then 'starter' else 'partner' end,
    'areas', app.search_areas_json(s.areas),
    'courts', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by u.n)
      from unnest(s.courts) with ordinality u(id, n) join app.courts c on c.id = u.id), '[]'::jsonb),
    'windows', to_jsonb(s.windows),
    'partner', app.search_person(case when s.starter_id = p_actor then s.partner_id else s.starter_id end),
    'inviteToken', case when s.starter_id = p_actor and s.state = 'waiting_partner' and app.search_active(s)
      then s.invite_token end);
$$;

-- Your latest search (active or ended), and direct invites waiting on you.
create function api.read_my_search(p_actor_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'search', (select app.search_view(s, p_actor_id) from app.ranked_searches s
      where s.starter_id = p_actor_id or (s.partner_id = p_actor_id and s.started_at is not null)
      order by app.search_active(s) desc, s.created_at desc limit 1),
    'invites', coalesce((select jsonb_agg(jsonb_build_object('token', s.invite_token,
        'starterName', app.search_person(s.starter_id)->>'name', 'format', s.format,
        'areas', app.search_areas_json(s.areas), 'endsAt', s.ends_at) order by s.created_at)
      from app.ranked_searches s
      where s.partner_id = p_actor_id and s.state = 'waiting_partner' and app.search_active(s)), '[]'::jsonb));
$$;

-- People you can pick as a doubles partner: checked in with you at a session.
create function api.ranked_partners(p_actor_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('people', coalesce(jsonb_agg(jsonb_build_object('profileId', x.profile_id, 'name', x.name)
      order by lower(x.name)), '[]'::jsonb))
  from (select pr.profile_id, coalesce(pr.display_name, pr.account_name) as name
    from app.badge_met(p_actor_id) m join app.profiles pr on pr.user_id = m.user_id
    order by lower(coalesce(pr.display_name, pr.account_name)) limit 200) x;
$$;

-- Shared checks and idempotency for the writes below.
create function app.search_receipt(p_actor uuid, p_key uuid, p_action text, p_payload jsonb) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare r app.operation_receipts;
begin
  if p_key is null then raise check_violation using message = 'invalid_input'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text || p_key::text, 0));
  select * into r from app.operation_receipts where actor_id = p_actor and request_key = p_key;
  if not found then return null; end if;
  if r.action <> p_action or r.payload <> p_payload then
    raise sqlstate 'P0001' using message = 'idempotency_conflict';
  end if;
  return r.resource_id;
end;
$$;

create function api.start_search(p_actor_id uuid, p_key uuid, p_format text, p_areas text[], p_courts uuid[],
  p_windows text[], p_partner_profile uuid, p_by_link boolean) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare payload jsonb; done uuid; partner uuid; result_id uuid;
  v_courts uuid[] := coalesce(p_courts, '{}'); v_windows text[] := coalesce(p_windows, '{}');
begin
  if p_actor_id is null then raise insufficient_privilege; end if;
  payload := jsonb_build_object('format', p_format, 'areas', p_areas, 'courts', v_courts, 'windows', v_windows,
    'partner', p_partner_profile, 'link', coalesce(p_by_link, false));
  done := app.search_receipt(p_actor_id, p_key, 'start_search', payload);
  if done is not null then
    return jsonb_build_object('operationKey', p_key) || api.read_my_search(p_actor_id);
  end if;
  if not exists (select 1 from app.ranked_formats where activity_key = 'pickleball' and format = p_format)
    or cardinality(p_areas) not between 1 and 3
    or (select count(distinct a) from unnest(p_areas) a) <> cardinality(p_areas)
    or (select count(*) from app.areas where key = any(p_areas)) <> cardinality(p_areas)
    or cardinality(v_courts) > 5
    or (select count(distinct c) from unnest(v_courts) c) <> cardinality(v_courts)
    or (select count(*) from app.courts c where c.id = any(v_courts) and c.area_key = any(p_areas)) <> cardinality(v_courts)
    or (select count(distinct w) from unnest(v_windows) w) <> cardinality(v_windows)
    or exists (select 1 from unnest(v_windows) w where w not in ('weekday-mornings', 'weekday-afternoons',
      'weekday-evenings', 'weekend-mornings', 'weekend-afternoons', 'weekend-evenings'))
    or (p_format = 'singles' and (p_partner_profile is not null or coalesce(p_by_link, false)))
    or (p_format = 'doubles' and (p_partner_profile is null) = (not coalesce(p_by_link, false))) then
    raise check_violation using message = 'invalid_input';
  end if;
  if p_partner_profile is not null then
    select pr.user_id into partner from app.profiles pr where pr.profile_id = p_partner_profile;
    if partner is null or partner = p_actor_id
      or not exists (select 1 from app.badge_met(p_actor_id) m where m.user_id = partner) then
      raise sqlstate 'P0001' using message = 'not_known';
    end if;
  end if;
  perform app.lock_searchers(array[p_actor_id]);
  if app.active_search_of(p_actor_id) is not null then
    raise sqlstate 'P0001' using message = 'search_active';
  end if;
  insert into app.ranked_searches(format, starter_id, partner_id, invite_token, invite_by_link, state,
      areas, courts, windows, started_at, ends_at)
    values (p_format, p_actor_id, partner,
      case when p_format = 'doubles' then gen_random_uuid() end, coalesce(p_by_link, false),
      case when p_format = 'doubles' then 'waiting_partner' else 'searching' end,
      p_areas, v_courts, v_windows,
      case when p_format = 'singles' then now() end,
      now() + case when p_format = 'doubles' then interval '48 hours' else interval '7 days' end)
    returning id into result_id;
  insert into app.operation_receipts values (p_actor_id, p_key, 'start_search', payload, result_id, now());
  return jsonb_build_object('operationKey', p_key) || api.read_my_search(p_actor_id);
end;
$$;

-- What a doubles invite shows the person invited, or whoever opened the link.
create function api.read_search_invite(p_actor_id uuid, p_token uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('invite', jsonb_build_object('token', s.invite_token,
      'starterName', app.search_person(s.starter_id)->>'name', 'format', s.format,
      'areas', app.search_areas_json(s.areas), 'endsAt', s.ends_at,
      'open', s.state = 'waiting_partner' and app.search_active(s),
      'own', s.starter_id = p_actor_id))
  from app.ranked_searches s
  where p_actor_id is not null and s.invite_token = p_token
    and (s.invite_by_link or s.partner_id = p_actor_id or s.starter_id = p_actor_id);
$$;

-- Accept or decline a doubles invite. Accepting starts the 7-day search and
-- counts as the partner's one search; a link invite can only be accepted.
create function api.answer_search_invite(p_actor_id uuid, p_key uuid, p_token uuid, p_accept boolean)
returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare s app.ranked_searches; payload jsonb := jsonb_build_object('token', p_token, 'accept', p_accept);
begin
  if p_actor_id is null then raise insufficient_privilege; end if;
  if app.search_receipt(p_actor_id, p_key, 'answer_search_invite', payload) is not null then
    return jsonb_build_object('operationKey', p_key) || api.read_my_search(p_actor_id);
  end if;
  select * into s from app.ranked_searches where invite_token = p_token;
  if not found or not (s.invite_by_link or s.partner_id = p_actor_id or s.starter_id = p_actor_id) then
    raise sqlstate 'P0001' using message = 'invite_not_found';
  end if;
  if s.starter_id = p_actor_id then raise sqlstate 'P0001' using message = 'own_invite'; end if;
  perform app.lock_searchers(array[p_actor_id, s.starter_id]);
  select * into s from app.ranked_searches where id = s.id for update;
  if s.state <> 'waiting_partner' or not app.search_active(s) then
    raise sqlstate 'P0001' using message = 'invite_closed';
  end if;
  if p_accept then
    if app.active_search_of(p_actor_id) is not null then
      raise sqlstate 'P0001' using message = 'search_active';
    end if;
    update app.ranked_searches set partner_id = p_actor_id, state = 'searching', started_at = now(),
      ends_at = now() + interval '7 days' where id = s.id;
  elsif not s.invite_by_link then
    update app.ranked_searches set state = 'declined', ended_at = now() where id = s.id;
  end if;
  insert into app.operation_receipts values (p_actor_id, p_key, 'answer_search_invite', payload, s.id, now());
  return jsonb_build_object('operationKey', p_key) || api.read_my_search(p_actor_id);
end;
$$;

-- Either searcher can cancel; it ends for both. Cancelling an ended search
-- leaves it as it was.
create function api.cancel_search(p_actor_id uuid, p_key uuid, p_search uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare s app.ranked_searches; payload jsonb := jsonb_build_object('search', p_search);
begin
  if p_actor_id is null then raise insufficient_privilege; end if;
  if app.search_receipt(p_actor_id, p_key, 'cancel_search', payload) is not null then
    return jsonb_build_object('operationKey', p_key) || api.read_my_search(p_actor_id);
  end if;
  select * into s from app.ranked_searches where id = p_search
    and (starter_id = p_actor_id or (partner_id = p_actor_id and started_at is not null)) for update;
  if not found then raise sqlstate 'P0001' using message = 'search_not_found'; end if;
  if app.search_active(s) then
    update app.ranked_searches set state = 'cancelled', ended_at = now() where id = s.id;
  end if;
  insert into app.operation_receipts values (p_actor_id, p_key, 'cancel_search', payload, s.id, now());
  return jsonb_build_object('operationKey', p_key) || api.read_my_search(p_actor_id);
end;
$$;

-- Search again with the same choices. In doubles the one restarting invites
-- the same partner directly (or makes a new link if there was none), and the
-- partner accepts again.
create function api.restart_search(p_actor_id uuid, p_key uuid, p_search uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare s app.ranked_searches; payload jsonb := jsonb_build_object('search', p_search);
  other uuid; result_id uuid;
begin
  if p_actor_id is null then raise insufficient_privilege; end if;
  if app.search_receipt(p_actor_id, p_key, 'restart_search', payload) is not null then
    return jsonb_build_object('operationKey', p_key) || api.read_my_search(p_actor_id);
  end if;
  select * into s from app.ranked_searches where id = p_search
    and (starter_id = p_actor_id or (partner_id = p_actor_id and started_at is not null));
  if not found then raise sqlstate 'P0001' using message = 'search_not_found'; end if;
  perform app.lock_searchers(array[p_actor_id]);
  if app.active_search_of(p_actor_id) is not null then
    raise sqlstate 'P0001' using message = 'search_active';
  end if;
  other := case when s.starter_id = p_actor_id then s.partner_id else s.starter_id end;
  insert into app.ranked_searches(format, starter_id, partner_id, invite_token, invite_by_link, state,
      areas, courts, windows, started_at, ends_at, restarted_from)
    values (s.format, p_actor_id, case when s.format = 'doubles' then other end,
      case when s.format = 'doubles' then gen_random_uuid() end,
      s.format = 'doubles' and other is null,
      case when s.format = 'doubles' then 'waiting_partner' else 'searching' end,
      s.areas, array(select c from unnest(s.courts) c where exists (select 1 from app.courts where id = c)),
      s.windows, case when s.format = 'singles' then now() end,
      now() + case when s.format = 'doubles' then interval '48 hours' else interval '7 days' end, s.id)
    returning id into result_id;
  insert into app.operation_receipts values (p_actor_id, p_key, 'restart_search', payload, result_id, now());
  return jsonb_build_object('operationKey', p_key) || api.read_my_search(p_actor_id);
end;
$$;

-- Recovery by key answers with the person's current search.
alter function api.read_operation(uuid,uuid) rename to read_operation_before_ranked_search;
alter function api.read_operation_before_ranked_search(uuid,uuid) set schema app;
create function api.read_operation(p_actor_id uuid,p_key uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r app.operation_receipts;
begin
  select * into r from app.operation_receipts where actor_id=p_actor_id and request_key=p_key;
  if r.action in ('start_search','answer_search_invite','cancel_search','restart_search') then
    return jsonb_build_object('operationKey',p_key) || api.read_my_search(p_actor_id);
  end if;
  return app.read_operation_before_ranked_search(p_actor_id,p_key);
end;
$$;

revoke all on function app.search_active(app.ranked_searches), app.active_search_of(uuid),
  app.lock_searchers(uuid[]), app.search_person(uuid), app.search_areas_json(text[]),
  app.search_view(app.ranked_searches,uuid), app.search_receipt(uuid,uuid,text,jsonb),
  api.read_my_search(uuid), api.ranked_partners(uuid),
  api.start_search(uuid,uuid,text,text[],uuid[],text[],uuid,boolean),
  api.read_search_invite(uuid,uuid), api.answer_search_invite(uuid,uuid,uuid,boolean),
  api.cancel_search(uuid,uuid,uuid), api.restart_search(uuid,uuid,uuid),
  app.read_operation_before_ranked_search(uuid,uuid), api.read_operation(uuid,uuid)
  from public, anon, authenticated;
grant execute on function app.search_active(app.ranked_searches), app.active_search_of(uuid),
  app.lock_searchers(uuid[]), app.search_person(uuid), app.search_areas_json(text[]),
  app.search_view(app.ranked_searches,uuid), app.search_receipt(uuid,uuid,text,jsonb),
  api.read_my_search(uuid), api.ranked_partners(uuid),
  api.start_search(uuid,uuid,text,text[],uuid[],text[],uuid,boolean),
  api.read_search_invite(uuid,uuid), api.answer_search_invite(uuid,uuid,uuid,boolean),
  api.cancel_search(uuid,uuid,uuid), api.restart_search(uuid,uuid,uuid),
  app.read_operation_before_ranked_search(uuid,uuid), api.read_operation(uuid,uuid)
  to service_role;
