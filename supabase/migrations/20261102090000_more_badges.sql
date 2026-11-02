-- Four more badges (WDL-407), on P-19's engine and levels: Explorer
-- (different organizers you played for), All-Rounder (sessions outside your
-- most-played activity), Crew (people checked in with you at 3+ sessions) and
-- Open Door (different people checked in at sessions you ran). Like the first
-- six they are derived on every read from your own checked-in seat at
-- non-cancelled sessions (app.badge_sessions) and the check-ins you recorded
-- (app.badge_hosted), so corrections and cancellations recalculate them both
-- ways. Guests have no account and never count toward these four.
--
-- The six P-19 badges, their levels, seen markers and titles are unchanged.
--
-- Recovery: restore app.badge_thresholds and app.badge_items from
-- 20261025090000_badge_levels.sql and api.read_my_badges and api.read_profile
-- from 20261028103000_hosting_counts.sql, then
--   delete from app.badge_views where badge_id ~ '^(explorer|all-rounder|crew|open-door):[1-5]$';
--   delete from app.user_titles where badge_id in ('explorer','all-rounder','crew','open-door');

-- What each level needs. Mirrors badgeCatalog in packages/domain/src/badges.ts.
create or replace function app.badge_thresholds() returns table(badge text,level integer,target integer)
language sql immutable security invoker set search_path='' as $$
  values ('rally',1,1),('rally',2,10),('rally',3,25),('rally',4,50),('rally',5,100),
    ('steady',1,2),('steady',2,3),('steady',3,6),('steady',4,12),('steady',5,24),
    ('explorer',1,2),('explorer',2,3),('explorer',3,5),('explorer',4,8),('explorer',5,12),
    ('all-rounder',1,1),('all-rounder',2,5),('all-rounder',3,10),('all-rounder',4,25),('all-rounder',5,50),
    ('new-faces',1,5),('new-faces',2,10),('new-faces',3,25),('new-faces',4,50),('new-faces',5,100),
    ('crew',1,1),('crew',2,3),('crew',3,5),('crew',4,10),('crew',5,20),
    ('plus-one',1,1),('plus-one',2,3),('plus-one',3,5),('plus-one',4,10),('plus-one',5,20),
    ('host',1,1),('host',2,5),('host',3,10),('host',4,25),('host',5,50),
    ('full-house',1,1),('full-house',2,3),('full-house',3,10),('full-house',4,25),('full-house',5,50),
    ('open-door',1,10),('open-door',2,25),('open-door',3,50),('open-door',4,100),('open-door',5,200);
$$;

-- Every counted thing, numbered in the order it happened. The first six are
-- as in 20261025090000_badge_levels.sql. The new four count distinct
-- organizers, sessions or people, so retries and second bookings never count
-- twice.
create or replace function app.badge_items(p_user uuid) returns table(badge text,n bigint,at timestamptz)
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
  ),
  -- Explorer: each session's organizer is the owner of its hosting team.
  organizers as (
    select r.user_id,min(p.at) at from played p
    join app.group_roles r on r.group_id=p.group_id and r.role='owner'
    where r.user_id<>p_user group by r.user_id
  ),
  -- All-Rounder: after each session, everything played minus the most-played
  -- activity so far. That never goes down as you play, and rises by at most
  -- one per session, so the session where it first reaches n is item n.
  -- "Other" and sessions without an activity are left out.
  activity_runs as (
    select p.session_id,p.at,
      row_number() over (order by p.at,p.session_id) total,
      row_number() over (partition by s.activity_key order by p.at,p.session_id) in_activity
    from played p join app.sessions s on s.id=p.session_id
    where s.activity_key is not null and s.activity_key<>'general'
  ), beyond_main as (
    select x.at,x.total-max(x.in_activity) over (order by x.total) n from activity_runs x
  ),
  -- Crew: another account checked in at the same session, once per session;
  -- they join your crew at the third.
  together as (
    select o.user_id,m.session_id,min(greatest(m.at,oa.changed_at)) at
    from played m
    join app.parties o on o.session_id=m.session_id and o.user_id<>p_user and o.state='confirmed'
    join app.seat_attendance oa on oa.party_id=o.id and oa.seat=1 and oa.state='checked_in'
    group by o.user_id,m.session_id
  ), crew as (
    select user_id,at from (
      select user_id,at,row_number() over (partition by user_id order by at,session_id) k from together
    ) t where k=3
  ),
  -- Open Door: other accounts checked in at sessions you ran, once per person.
  welcomed as (
    select p.user_id,min(greatest(h.at,a.changed_at)) at from ran h
    join app.parties p on p.session_id=h.session_id and p.user_id<>p_user and p.state='confirmed'
    join app.seat_attendance a on a.party_id=p.id and a.seat=1 and a.state='checked_in'
    group by p.user_id
  )
  select 'rally',row_number() over (order by at,session_id),at from played
  union all select 'steady',row_number() over (order by month),at from months
  union all select 'explorer',row_number() over (order by at,user_id),at from organizers
  union all select 'all-rounder',n,min(at) from beyond_main where n>0 group by n
  union all select 'new-faces',row_number() over (order by m.at,m.user_id),m.at from app.badge_met(p_user) m
  union all select 'crew',row_number() over (order by at,user_id),at from crew
  union all select 'plus-one',row_number() over (order by at,session_id),at from guests
  union all select 'host',row_number() over (order by at,session_id),at from ran
  union all select 'full-house',row_number() over (order by at,session_id),at from ran where full_house
  union all select 'open-door',row_number() over (order by at,user_id),at from welcomed;
$$;

-- All ten badges in catalog order; otherwise as in 20261028103000_hosting_counts.sql.
create or replace function api.read_my_badges(p_actor_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare items jsonb; reached jsonb;
  catalog constant text[] := array['rally','steady','explorer','all-rounder','new-faces','crew','plus-one','host','full-house','open-door'];
begin
  select coalesce(jsonb_object_agg(c.badge,c.n),'{}'::jsonb) into items
    from (select i.badge,max(i.n) n from app.badge_items(p_actor_id) i group by i.badge) c;
  select coalesce(jsonb_object_agg(r.badge,r.levels),'{}'::jsonb) into reached
    from (select l.badge,jsonb_agg(jsonb_build_object('level',l.level,'earnedAt',l.earned_at,
      'seen',exists(select 1 from app.badge_views v where v.user_id=p_actor_id and v.badge_id=l.badge||':'||l.level)) order by l.level) levels
      from app.badge_levels(p_actor_id) l group by l.badge) r;
  return jsonb_build_object(
    'badges',(select jsonb_agg(jsonb_build_object('key',k,'current',coalesce((items->>k)::integer,0),'levels',coalesce(reached->k,'[]'::jsonb)) order by o)
      from unnest(catalog) with ordinality u(k,o)),
    'title',app.visible_title(p_actor_id),
    'stats',jsonb_build_object('played',(select count(*) from app.badge_sessions(p_actor_id)),
      'hosted',(select count(*) from app.badge_hosted(p_actor_id)),
      'groups',(select count(*) from app.group_roles gr join app.groups gg on gg.id=gr.group_id where gr.user_id=p_actor_id and gg.kind='community')));
end;
$$;

-- The public page: each started badge once at its level, in catalog order.
-- No dates, counts, organizers, activities or people.
create or replace function api.read_profile(p_profile_id uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare p app.profiles;
  catalog constant text[] := array['rally','steady','explorer','all-rounder','new-faces','crew','plus-one','host','full-house','open-door'];
begin
  select * into p from app.profiles where profile_id = p_profile_id;
  if p.user_id is null then raise no_data_found using message = 'profile_not_found'; end if;
  return jsonb_build_object('profileId', p.profile_id, 'name', coalesce(p.display_name, p.account_name),
    'title', app.visible_title(p.user_id),
    'badges', coalesce((select jsonb_agg(jsonb_build_object('key', b.badge, 'level', b.level) order by array_position(catalog, b.badge))
      from (select l.badge, max(l.level) level from app.badge_levels(p.user_id) l group by l.badge) b), '[]'::jsonb),
    'stats', jsonb_build_object('played', (select count(*) from app.badge_sessions(p.user_id)),
      'hosted', (select count(*) from app.badge_hosted(p.user_id)),
      'groups', (select count(*) from app.group_roles gr join app.groups gg on gg.id=gr.group_id where gr.user_id=p.user_id and gg.kind='community')),
    'activities', app.profile_activities_json(p.user_id));
end;
$$;

revoke all on function app.badge_thresholds(),app.badge_items(uuid),api.read_my_badges(uuid),api.read_profile(uuid)
  from public,anon,authenticated;
grant execute on function app.badge_thresholds(),app.badge_items(uuid),api.read_my_badges(uuid),api.read_profile(uuid)
  to service_role;

-- Release day: levels people already have on the four new badges count as
-- seen, so nobody gets a pile of sheets for history. Seen markers on the first
-- six badges are left exactly as they are.
insert into app.badge_views(user_id,badge_id)
  select u.id,l.badge||':'||l.level from auth.users u cross join lateral app.badge_levels(u.id) l
  where l.badge in ('explorer','all-rounder','crew','open-door')
  on conflict do nothing;
