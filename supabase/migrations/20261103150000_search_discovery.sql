-- Search for sessions, people and clubs (D-27, owner 2026-11-03). Public
-- sessions are found by day for the next 14 days; people are found by name
-- only when their profile is public (the default, switchable to private);
-- public clubs are browsed by size. Each read returns only public data and is
-- bounded: 50 sessions a day, 20 people, 30 clubs. A host with a private
-- profile is never matched by name. Nothing here reads email.
--
-- Recovery:
--   for each of read_my_profile(uuid,text) and save_my_profile(uuid,text,text,jsonb):
--     drop function api.<name>(...); alter function app.<name>_before_discovery(...) set schema api;
--     alter function api.<name>_before_discovery(...) rename to <name>;
--   drop function api.search_sessions(uuid,timestamptz,text,text), api.search_people(uuid,text),
--     api.search_clubs(uuid,text), api.set_profile_discoverable(uuid,boolean),
--     app.host_discoverable(uuid);
--   alter table app.profiles drop column discoverable;

alter table app.profiles add column discoverable boolean not null default true;

-- A session's host can be found by name: one of its organizers has a public profile.
create function app.host_discoverable(p_group uuid) returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists (select 1 from app.group_roles r join app.profiles pr on pr.user_id = r.user_id
    where r.group_id = p_group and r.role in ('owner', 'organizer') and pr.discoverable);
$$;

-- Public sessions from p_from (the viewer's local midnight) for 14 days, each
-- with the viewer's day it falls on; one already under way counts as today.
create function api.search_sessions(p_actor_id uuid, p_from timestamptz, p_time_zone text, p_query text)
returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare q text := nullif(lower(btrim(coalesce(p_query, ''))), '');
begin
  if p_actor_id is null then raise insufficient_privilege; end if;
  if p_from is null or p_from < now() - interval '2 days' or p_from > now() + interval '2 days'
    or p_time_zone is null or not exists (select 1 from pg_catalog.pg_timezone_names where name = p_time_zone)
    or (q is not null and char_length(q) not between 2 and 40) then
    raise check_violation using message = 'invalid_input';
  end if;
  return jsonb_build_object('sessions', coalesce((select jsonb_agg(x.j order by x.starts, x.slug) from (
    select y.slug, y.starts, y.j, row_number() over (partition by y.j->>'day' order by y.starts, y.slug) as n
    from (
      select s.slug, (s.details->>'startsAt')::timestamptz as starts,
        jsonb_build_object(
          'slug', s.slug,
          'title', s.details->>'title',
          'activity', s.details->>'activity',
          'startsAt', s.details->>'startsAt',
          'endsAt', s.details->>'endsAt',
          'timeZone', s.details->>'timeZone',
          'location', s.details->>'location',
          'hostName', g.name,
          'capacity', (s.details->>'capacity')::integer,
          'takenSeats', coalesce((app.registration_counts(s.id)->>'confirmedSeats')::integer, 0),
          'joinMode', coalesce(s.details->>'joinMode', 'direct'),
          'currency', s.details->>'currency',
          'feeMinor', (s.details->>'feeMinor')::bigint,
          'totalMinor', (s.details->>'totalMinor')::bigint,
          'feeMode', coalesce(s.details->>'feeMode', 'fixed'),
          'paymentMode', coalesce(s.details->>'paymentMode', 'organizer'),
          'day', to_char(greatest((s.details->>'startsAt')::timestamptz, p_from) at time zone p_time_zone, 'YYYY-MM-DD'),
          'happeningNow', (s.details->>'startsAt')::timestamptz <= now()) as j
      from app.sessions s join app.groups g on g.id = s.group_id
      where s.state = 'published' and coalesce(s.details->>'access', 'public') <> 'private'
        and (s.details->>'endsAt')::timestamptz > now()
        and (s.details->>'startsAt')::timestamptz < p_from + interval '14 days'
        and (q is null
          or position(q in lower(coalesce(s.details->>'title', ''))) > 0
          or position(q in lower(coalesce(s.details->>'location', ''))) > 0
          or position(q in lower(coalesce(s.details->>'activity', ''))) > 0
          or (position(q in lower(g.name)) > 0 and app.host_discoverable(g.id)))
    ) y
  ) x where x.n <= 50), '[]'::jsonb));
end;
$$;

-- People with a public profile, by the name they show; never browsed.
create function api.search_people(p_actor_id uuid, p_query text) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare q text := lower(btrim(coalesce(p_query, '')));
begin
  if p_actor_id is null then raise insufficient_privilege; end if;
  if char_length(q) not between 2 and 40 then raise check_violation using message = 'invalid_input'; end if;
  return jsonb_build_object('people', coalesce((select jsonb_agg(jsonb_build_object(
      'profileId', x.profile_id, 'name', x.name,
      'activities', (select coalesce(jsonb_agg(jsonb_build_object('name', coalesce(pa.custom_name, a.name),
          'level', pa.level) order by pa.position), '[]'::jsonb)
        from app.profile_activities pa left join app.activities a on a.key = pa.activity_key
        where pa.user_id = x.user_id),
      'ranks', app.visible_ranks(x.user_id)) order by x.n)
    from (
      select pr.profile_id, pr.user_id, coalesce(pr.display_name, pr.account_name) as name,
        row_number() over (order by left(lower(coalesce(pr.display_name, pr.account_name)), char_length(q)) <> q,
          lower(coalesce(pr.display_name, pr.account_name)), pr.profile_id) as n
      from app.profiles pr
      where pr.discoverable and pr.user_id <> p_actor_id
        and position(q in lower(coalesce(pr.display_name, pr.account_name, ''))) > 0
      order by n limit 20) x), '[]'::jsonb));
end;
$$;

-- Clubs: public groups by size when browsing; by name when searching, where a
-- private group you're not in shows its name only (as P-37 already allows).
create function api.search_clubs(p_actor_id uuid, p_query text) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare q text := nullif(lower(btrim(coalesce(p_query, ''))), '');
begin
  if p_actor_id is null then raise insufficient_privilege; end if;
  if q is not null and char_length(q) not between 2 and 40 then
    raise check_violation using message = 'invalid_input';
  end if;
  return jsonb_build_object('clubs', coalesce((select jsonb_agg(x.j order by x.n) from (
    select row_number() over (order by
        case when q is null then 0 else (left(lower(g.name), char_length(q)) <> q)::int end,
        (select count(*) from app.group_roles m where m.group_id = g.id) desc, lower(g.name), g.id) as n,
      case when g.visibility = 'public' or r.role is not null then jsonb_build_object(
          'id', g.id, 'name', g.name, 'visibility', g.visibility,
          'members', (select count(*) from app.group_roles m where m.group_id = g.id),
          'viewerRole', case r.role when 'owner' then 'admin' when 'member' then 'member' end)
        else jsonb_build_object('name', g.name, 'visibility', g.visibility) end as j
    from app.groups g
    left join app.group_roles r on r.group_id = g.id and r.user_id = p_actor_id
    where g.kind = 'community' and g.archived_at is null
      and (case when q is null then g.visibility = 'public' else position(q in lower(g.name)) > 0 end)
    order by 1 limit 30) x), '[]'::jsonb));
end;
$$;

create function api.set_profile_discoverable(p_actor_id uuid, p_discoverable boolean) returns jsonb
language plpgsql security invoker set search_path = '' as $$
begin
  if p_actor_id is null then raise insufficient_privilege; end if;
  if p_discoverable is null then raise check_violation using message = 'invalid_input'; end if;
  update app.profiles set discoverable = p_discoverable, updated_at = now() where user_id = p_actor_id;
  if not found then raise sqlstate 'P0001' using message = 'profile_not_found'; end if;
  return jsonb_build_object('discoverable', p_discoverable);
end;
$$;

-- The owner's own profile reads carry the setting.
alter function api.read_my_profile(uuid,text) rename to read_my_profile_before_discovery;
alter function api.read_my_profile_before_discovery(uuid,text) set schema app;
create function api.read_my_profile(p_actor_id uuid, p_account_name text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare result jsonb := app.read_my_profile_before_discovery(p_actor_id, p_account_name);
begin
  return result || jsonb_build_object('discoverable',
    coalesce((select discoverable from app.profiles where user_id = p_actor_id), true));
end;
$$;
alter function api.save_my_profile(uuid,text,text,jsonb) rename to save_my_profile_before_discovery;
alter function api.save_my_profile_before_discovery(uuid,text,text,jsonb) set schema app;
create function api.save_my_profile(p_actor_id uuid, p_account_name text, p_name text, p_activities jsonb)
returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare result jsonb := app.save_my_profile_before_discovery(p_actor_id, p_account_name, p_name, p_activities);
begin
  return result || jsonb_build_object('discoverable',
    coalesce((select discoverable from app.profiles where user_id = p_actor_id), true));
end;
$$;

revoke all on function app.host_discoverable(uuid), api.search_sessions(uuid,timestamptz,text,text),
  api.search_people(uuid,text), api.search_clubs(uuid,text), api.set_profile_discoverable(uuid,boolean),
  api.read_my_profile(uuid,text), api.save_my_profile(uuid,text,text,jsonb)
  from public, anon, authenticated;
grant execute on function app.host_discoverable(uuid), api.search_sessions(uuid,timestamptz,text,text),
  api.search_people(uuid,text), api.search_clubs(uuid,text), api.set_profile_discoverable(uuid,boolean),
  api.read_my_profile(uuid,text), api.save_my_profile(uuid,text,text,jsonb)
  to service_role;
