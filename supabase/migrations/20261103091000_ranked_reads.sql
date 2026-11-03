-- Ranks people can see (D-26, WDL-420). A category shows its rank from the
-- fifth applied match on; until then it shows nothing, never "Unranked".
-- Reads carry rank names only: no rating, deviation, volatility or count.
-- The public profile and the owner's badges read show every ranked
-- category; a session roster shows only the session's own activity, and
-- nothing for a session without a catalog activity.
--
-- Recovery: restore api.read_profile and api.read_my_badges from
-- 20261102090000_more_badges.sql and app.registration_view_before_split from
-- 20261024091000_one_name.sql, then
--   drop function app.ranked_rank(double precision,integer),
--     app.visible_ranks(uuid,text), app.ranked_seed_rating(uuid,text,text);

-- Bronze below 1400, Silver from 1400, Gold from 1550, Platinum from 1700,
-- Diamond from 1850 (display scale), once five matches are in.
create function app.ranked_rank(p_mu double precision, p_matches integer) returns text
language sql immutable security invoker set search_path = '' as $$
  select case when p_matches < 5 then null else
    case when r < 1400 then 'Bronze' when r < 1550 then 'Silver' when r < 1700 then 'Gold'
      when r < 1850 then 'Platinum' else 'Diamond' end end
  from (select round(app.ranked_display(p_mu)::numeric, 6) r) d;
$$;

-- A person's ranked categories, catalog order: activity, format, rank name.
create function app.visible_ranks(p_user uuid, p_activity text default null) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('activity', x.activity_key, 'format', x.format, 'rank', x.rank)
    order by x.activity_order, x.format_order), '[]'::jsonb)
  from (select r.activity_key, r.format, app.ranked_rank(r.mu, r.matches) rank,
      a.sort_order activity_order, f.sort_order format_order
    from app.ranked_ratings r
    join app.ranked_formats f on f.activity_key = r.activity_key and f.format = r.format
    join app.activities a on a.key = r.activity_key
    where r.user_id = p_user and (p_activity is null or r.activity_key = p_activity)) x
  where x.rank is not null;
$$;

-- Where matchmaking starts someone (display scale). After a first match it
-- is their rating; before it, their self-rated level for the activity picks
-- a starting band. The self-rating never becomes their rating.
create function app.ranked_seed_rating(p_user uuid, p_activity text, p_format text) returns double precision
language sql stable security invoker set search_path = '' as $$
  select coalesce(
    (select app.ranked_display(mu) from app.ranked_ratings
      where user_id = p_user and activity_key = p_activity and format = p_format and matches > 0),
    (select case min(level) filter (where level is not null)
        when 'beginner' then 1325 when 'advanced' then 1775 else 1550 end
      from app.profile_activities where user_id = p_user and activity_key = p_activity),
    1550);
$$;

revoke all on function app.ranked_rank(double precision,integer), app.visible_ranks(uuid,text),
  app.ranked_seed_rating(uuid,text,text) from public, anon, authenticated;
grant execute on function app.ranked_rank(double precision,integer), app.visible_ranks(uuid,text),
  app.ranked_seed_rating(uuid,text,text) to service_role;

-- The owner's badges read, as in 20261102090000_more_badges.sql plus ranks.
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
    'ranks',app.visible_ranks(p_actor_id),
    'stats',jsonb_build_object('played',(select count(*) from app.badge_sessions(p_actor_id)),
      'hosted',(select count(*) from app.badge_hosted(p_actor_id)),
      'groups',(select count(*) from app.group_roles gr join app.groups gg on gg.id=gr.group_id where gr.user_id=p_actor_id and gg.kind='community')));
end;
$$;

-- The public page, as in 20261102090000_more_badges.sql plus ranks.
create or replace function api.read_profile(p_profile_id uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare p app.profiles;
  catalog constant text[] := array['rally','steady','explorer','all-rounder','new-faces','crew','plus-one','host','full-house','open-door'];
begin
  select * into p from app.profiles where profile_id = p_profile_id;
  if p.user_id is null then raise no_data_found using message = 'profile_not_found'; end if;
  return jsonb_build_object('profileId', p.profile_id, 'name', coalesce(p.display_name, p.account_name),
    'title', app.visible_title(p.user_id),
    'ranks', app.visible_ranks(p.user_id),
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

-- Roster entries carry ranks for the session's activity; otherwise as in
-- 20261024091000_one_name.sql.
create or replace function app.registration_view_before_split(p_actor uuid,p_session uuid,p_party uuid default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare own app.parties; manager boolean; roster jsonb; own_json jsonb; activity text;
begin
  select activity_key into activity from app.sessions where id=p_session;
  select * into own from app.parties where session_id=p_session and user_id=p_actor
    and (p_party is null or id=p_party) order by (state in ('confirmed','waitlisted')) desc,queue_sequence desc limit 1;
  select exists(select 1 from app.group_roles r join app.sessions s on s.group_id=r.group_id
    where s.id=p_session and r.user_id=p_actor and r.role in ('owner','organizer','cohost')) into manager;
  if own.id is not null then
    own_json:=jsonb_build_object('id',own.id,'state',own.state,'seats',own.seats,'primaryName',own.primary_name,'guestName',own.guest_name,
      'consentVersion',own.consent_version,'withdrawnAt',own.withdrawn_at,'queuePosition',case when own.state='waitlisted' then
        (select count(*)+1 from app.parties where session_id=p_session and state='waitlisted' and queue_sequence<own.queue_sequence) else null end,
      'fee',app.party_fee(own.id));
  end if;
  if manager or own.state='confirmed' then
    select coalesce(jsonb_agg(
      case when manager then jsonb_build_object('id',p.id,'primaryName',p.primary_name,'guestName',p.guest_name,'seats',p.seats,'state',p.state,
        'fee',app.managed_fee(p.id),'attendance',app.managed_attendance(p.id),'title',app.visible_title(p.user_id),
        'ranks',case when activity is null then '[]'::jsonb else app.visible_ranks(p.user_id,activity) end,
        'profileId',(select pr.profile_id from app.profiles pr where pr.user_id=p.user_id))
      else jsonb_build_object('primaryName',p.primary_name,'guestName',p.guest_name,'seats',p.seats,'title',app.visible_title(p.user_id),
        'ranks',case when activity is null then '[]'::jsonb else app.visible_ranks(p.user_id,activity) end,
        'profileId',(select pr.profile_id from app.profiles pr where pr.user_id=p.user_id)) end order by p.queue_sequence),'[]'::jsonb)
      into roster from app.parties p where p.session_id=p_session and (manager or p.state='confirmed');
  end if;
  return jsonb_build_object('own',own_json,'canManage',manager,'rosterAllowed',manager or coalesce(own.state='confirmed',false),
    'roster',coalesce(roster,'[]'::jsonb),'counts',app.registration_counts(p_session));
end;
$$;
