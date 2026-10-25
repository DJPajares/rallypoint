-- Badges with shared levels (P-19, PRD D-16). Six badges, five levels each,
-- derived on every read from the same records as before: your own checked-in
-- seat at non-cancelled sessions, your checked-in guests, the check-ins you
-- recorded, and who else was checked in with you. Corrections and cancellations
-- recalculate levels both ways; nothing here is ever awarded directly.
-- Seen markers are stored as `key:level` in app.badge_views.
--
-- Titles keep naming the old badges until WDL-405: app.earned_badges,
-- app.visible_title and api.set_my_title are unchanged and serve titles only.
--
-- Recovery: restore api.read_my_badges and api.mark_badges_seen (and
-- app.badge_progress) from 20261022170000_badges.sql and api.read_profile from
-- 20261024100000_profile_fixes.sql, drop the functions created here, then
--   delete from app.badge_views where badge_id ~ '^[a-z-]+:[1-5]$';
-- Old seen markers and chosen titles are never touched by this migration.

-- A session's own zone, or UTC when it is not one Postgres knows.
create function app.badge_zone(p_zone text) returns text
language plpgsql stable security invoker set search_path='' as $$
begin
  perform now() at time zone p_zone;
  return p_zone;
exception when others then
  return 'UTC';
end;
$$;

-- What each level needs. Mirrors badgeCatalog in packages/domain/src/badges.ts.
create function app.badge_thresholds() returns table(badge text,level integer,target integer)
language sql immutable security invoker set search_path='' as $$
  values ('rally',1,1),('rally',2,10),('rally',3,25),('rally',4,50),('rally',5,100),
    ('steady',1,2),('steady',2,3),('steady',3,6),('steady',4,12),('steady',5,24),
    ('new-faces',1,5),('new-faces',2,10),('new-faces',3,25),('new-faces',4,50),('new-faces',5,100),
    ('plus-one',1,1),('plus-one',2,3),('plus-one',3,5),('plus-one',4,10),('plus-one',5,20),
    ('host',1,1),('host',2,5),('host',3,10),('host',4,25),('host',5,50),
    ('full-house',1,1),('full-house',2,3),('full-house',3,10),('full-house',4,25),('full-house',5,50);
$$;

-- Every counted thing, numbered in the order it happened. Counting is by
-- distinct session, month or person, so retries and second bookings never
-- count twice. Guests have no account and add only to Plus One.
create function app.badge_items(p_user uuid) returns table(badge text,n bigint,at timestamptz)
language sql stable security invoker set search_path='' as $$
  with played as (select * from app.badge_sessions(p_user)),
  ran as (select * from app.badge_hosted(p_user)),
  months as (
    select to_char((s.details->>'startsAt')::timestamptz at time zone app.badge_zone(s.details->>'timeZone'),'YYYY-MM') as month,min(p.at) at
    from played p join app.sessions s on s.id=p.session_id group by 1
  ), guests as (
    select p.session_id,min(a.changed_at) at from app.parties p
    join app.seat_attendance a on a.party_id=p.id and a.seat=2 and a.state='checked_in'
    join app.sessions s on s.id=p.session_id
    where p.user_id=p_user and p.state='confirmed' and s.state<>'cancelled'
    group by p.session_id
  )
  select 'rally',row_number() over (order by at,session_id),at from played
  union all select 'steady',row_number() over (order by month),at from months
  union all select 'new-faces',row_number() over (order by m.at,m.user_id),m.at from app.badge_met(p_user) m
  union all select 'plus-one',row_number() over (order by at,session_id),at from guests
  union all select 'host',row_number() over (order by at,session_id),at from ran
  union all select 'full-house',row_number() over (order by at,session_id),at from ran where full_house;
$$;

-- Each level reached: the item that crossed the threshold says when.
create function app.badge_levels(p_user uuid) returns table(badge text,level integer,earned_at timestamptz)
language sql stable security invoker set search_path='' as $$
  select i.badge,t.level,i.at from app.badge_items(p_user) i
  join app.badge_thresholds() t on t.badge=i.badge and t.target=i.n;
$$;

drop function app.badge_progress(uuid);

-- All six badges in catalog order with their count and levels; the old badges
-- you may show as a title; your title; the profile stats.
create or replace function api.read_my_badges(p_actor_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare items jsonb; reached jsonb; titles jsonb; title jsonb;
  catalog constant text[] := array['rally','steady','new-faces','plus-one','host','full-house'];
begin
  select coalesce(jsonb_object_agg(c.badge,c.n),'{}'::jsonb) into items
    from (select i.badge,max(i.n) n from app.badge_items(p_actor_id) i group by i.badge) c;
  select coalesce(jsonb_object_agg(r.badge,r.levels),'{}'::jsonb) into reached
    from (select l.badge,jsonb_agg(jsonb_build_object('level',l.level,'earnedAt',l.earned_at,
      'seen',exists(select 1 from app.badge_views v where v.user_id=p_actor_id and v.badge_id=l.badge||':'||l.level)) order by l.level) levels
      from app.badge_levels(p_actor_id) l group by l.badge) r;
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'key',e.badge,'groupId',e.group_id,'groupName',e.group_name) order by e.earned_at,e.id),'[]'::jsonb)
    into titles from app.earned_badges(p_actor_id) e;
  select jsonb_build_object('id',t.badge_id,'key',x->'key','groupName',x->'groupName') into title
    from app.user_titles t cross join jsonb_array_elements(titles) x where t.user_id=p_actor_id and x->>'id'=t.badge_id;
  return jsonb_build_object(
    'badges',(select jsonb_agg(jsonb_build_object('key',k,'current',coalesce((items->>k)::integer,0),'levels',coalesce(reached->k,'[]'::jsonb)) order by o)
      from unnest(catalog) with ordinality u(k,o)),
    'titles',titles,
    'title',title,
    'stats',jsonb_build_object('played',(select count(*) from app.badge_sessions(p_actor_id)),
      'hosted',(select count(*) from app.badge_hosted(p_actor_id)),
      'groups',(select count(*) from app.group_roles where user_id=p_actor_id)));
end;
$$;

-- Records only levels that are reached right now; anything else is ignored.
create or replace function api.mark_badges_seen(p_actor_id uuid,p_ids text[]) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
  if coalesce(cardinality(p_ids),0) not between 1 and 50 then raise check_violation using message='invalid_badges'; end if;
  insert into app.badge_views(user_id,badge_id)
    select p_actor_id,l.badge||':'||l.level from app.badge_levels(p_actor_id) l where l.badge||':'||l.level=any(p_ids)
    on conflict do nothing;
  return api.read_my_badges(p_actor_id);
end;
$$;

-- The public page: each started badge once at its level, in catalog order.
-- No dates, counts, groups or people.
create or replace function api.read_profile(p_profile_id uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare p app.profiles; shown jsonb;
  catalog constant text[] := array['rally','steady','new-faces','plus-one','host','full-house'];
begin
  select * into p from app.profiles where profile_id = p_profile_id;
  if p.user_id is null then raise no_data_found using message = 'profile_not_found'; end if;
  shown := app.visible_title(p.user_id);
  return jsonb_build_object('profileId', p.profile_id, 'name', coalesce(p.display_name, p.account_name),
    'title', case when shown is null then null else jsonb_build_object('key', shown->'key') end,
    'badges', coalesce((select jsonb_agg(jsonb_build_object('key', b.badge, 'level', b.level) order by array_position(catalog, b.badge))
      from (select l.badge, max(l.level) level from app.badge_levels(p.user_id) l group by l.badge) b), '[]'::jsonb),
    'stats', jsonb_build_object('played', (select count(*) from app.badge_sessions(p.user_id)),
      'hosted', (select count(*) from app.badge_hosted(p.user_id)),
      'groups', (select count(*) from app.group_roles where user_id = p.user_id)),
    'activities', p.activities);
end;
$$;

revoke all on function app.badge_zone(text),app.badge_thresholds(),app.badge_items(uuid),app.badge_levels(uuid),
  api.read_my_badges(uuid),api.mark_badges_seen(uuid,text[]),api.read_profile(uuid) from public,anon,authenticated;
grant execute on function app.badge_zone(text),app.badge_thresholds(),app.badge_items(uuid),app.badge_levels(uuid),
  api.read_my_badges(uuid),api.mark_badges_seen(uuid,text[]),api.read_profile(uuid) to service_role;

-- Release day: everything people already have counts as seen, so nobody gets
-- a pile of sheets for history. They find their levels on their profile.
insert into app.badge_views(user_id,badge_id)
  select u.id,l.badge||':'||l.level from auth.users u cross join lateral app.badge_levels(u.id) l
  on conflict do nothing;
