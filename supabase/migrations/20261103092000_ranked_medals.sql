-- Medals and stars replace the five ranks (D-26 as amended 2026-11-03, with
-- Dota 2's ranking as inspiration only). The Glicko-2 rating stays as the
-- hidden skill that matchmaking reads. A second hidden number, the standing,
-- is what players climb: nothing after 5 calibration matches, then placed
-- from the skill no higher than Challenger 5, then about 25 a match, leaning
-- up to 10 toward the skill, never below 0 and never decaying. People see
-- only a medal and its stars; the owner alone also sees calibration
-- progress. No number leaves the database, not even to its owner.
--
-- Recovery: restore app.apply_ranked_result from 20261103090000_ranked_ratings.sql
-- and app.visible_ranks, app.ranked_rank and api.read_my_badges from
-- 20261103091000_ranked_reads.sql, then
--   drop function app.ranked_target(double precision),
--     app.ranked_next_standing(integer,integer,double precision,double precision,boolean),
--     app.ranked_medal(integer), app.my_ranks(uuid);
--   alter table app.ranked_ratings drop column standing;

alter table app.ranked_ratings add column standing integer check (standing >= 0);

-- Where the skill says someone belongs on the standing scale.
create function app.ranked_target(p_mu double precision) returns integer
language sql immutable security invoker set search_path = '' as $$
  select greatest(0, round(2.5 * (app.ranked_display(p_mu) - 1000)))::integer;
$$;

-- The standing after a match. Null while calibrating; at the fifth match,
-- placed from the new skill but no higher than 1,499 (Challenger 5); after
-- that 25 either way plus up to 10 toward where the skill before the match
-- pointed.
create function app.ranked_next_standing(p_standing integer, p_matches integer,
  p_mu_before double precision, p_mu_after double precision, p_won boolean) returns integer
language sql immutable security invoker set search_path = '' as $$
  select case
    when p_matches < 5 then null
    when p_standing is null then least(app.ranked_target(p_mu_after), 1499)
    else greatest(0, p_standing + case when p_won then 25 else -25 end
      + greatest(-10, least(10, round((app.ranked_target(p_mu_before) - p_standing)::numeric / 20)::integer)))
  end;
$$;

-- Rookie, Contender, Challenger, Veteran and Elite are 500 each with a star
-- every 100; Master, from 2,500, has no stars.
create function app.ranked_medal(p_standing integer) returns jsonb
language sql immutable security invoker set search_path = '' as $$
  select case when p_standing >= 2500 then jsonb_build_object('medal', 'Master', 'stars', null)
    else jsonb_build_object(
      'medal', (array['Rookie', 'Contender', 'Challenger', 'Veteran', 'Elite'])[p_standing / 500 + 1],
      'stars', p_standing % 500 / 100 + 1) end;
$$;

update app.ranked_ratings set standing = least(app.ranked_target(mu), 1499) where matches >= 5;

create or replace function app.apply_ranked_result(p_result_id uuid, p_activity text, p_format text,
  p_winners uuid[], p_losers uuid[], p_played_at timestamptz) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare
  size smallint;
  everyone uuid[] := coalesce(p_winners, '{}') || coalesce(p_losers, '{}');
  start_phi constant double precision := 350 / 173.7178;
  r record;
  w_mu double precision; w_phi double precision; l_mu double precision; l_phi double precision;
  step record;
begin
  select team_size into size from app.ranked_formats where activity_key = p_activity and format = p_format;
  if size is null then
    raise exception using message = 'ranked_invalid_result', detail = 'unknown category';
  end if;
  if p_result_id is null or p_played_at is null
    or cardinality(p_winners) is distinct from size::integer or cardinality(p_losers) is distinct from size::integer
    or (select count(distinct u) from unnest(everyone) u where u is not null) <> 2 * size
    or (select count(*) from auth.users where id = any(everyone)) <> 2 * size then
    raise exception using message = 'ranked_invalid_result', detail = 'teams must be distinct accounts of the format''s size';
  end if;

  insert into app.ranked_results(result_id, activity_key, format, winners, losers, played_at)
    values (p_result_id, p_activity, p_format, p_winners, p_losers, p_played_at)
    on conflict (result_id) do nothing;
  if not found then return false; end if;

  -- Rows in id order, so two results sharing a player queue rather than deadlock.
  insert into app.ranked_ratings(user_id, activity_key, format)
    select u, p_activity, p_format from unnest(everyone) u order by u
    on conflict do nothing;
  create temporary table if not exists ranked_step(user_id uuid primary key, won boolean,
    mu double precision, phi double precision, sigma double precision, matches integer, standing integer) on commit drop;
  truncate ranked_step;
  for r in select * from app.ranked_ratings
      where activity_key = p_activity and format = p_format and user_id = any(everyone)
      order by user_id for update loop
    insert into ranked_step values (r.user_id, r.user_id = any(p_winners), r.mu,
      least(sqrt(r.phi ^ 2 + greatest(0, floor(extract(epoch from p_played_at - coalesce(r.last_played_at, p_played_at)) / 604800)) * r.sigma ^ 2), start_phi),
      r.sigma, r.matches, r.standing);
  end loop;

  select avg(mu), sqrt(avg(phi ^ 2)) into w_mu, w_phi from ranked_step where won;
  select avg(mu), sqrt(avg(phi ^ 2)) into l_mu, l_phi from ranked_step where not won;
  for r in select * from ranked_step loop
    step := app.glicko2_step(r.mu, r.phi, r.sigma,
      case when r.won then w_mu else l_mu end,
      case when r.won then l_mu else w_mu end,
      case when r.won then l_phi else w_phi end,
      case when r.won then 1 else 0 end);
    update app.ranked_ratings set mu = step.mu, phi = step.phi, sigma = step.sigma,
      matches = matches + 1, standing = app.ranked_next_standing(r.standing, r.matches + 1, r.mu, step.mu, r.won), last_played_at = greatest(coalesce(last_played_at, p_played_at), p_played_at)
      where user_id = r.user_id and activity_key = p_activity and format = p_format;
  end loop;
  return true;
end;
$$;

-- A person's calibrated categories, catalog order: activity, format, medal, stars.
create or replace function app.visible_ranks(p_user uuid, p_activity text default null) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('activity', r.activity_key, 'format', r.format)
      || app.ranked_medal(r.standing) order by a.sort_order, f.sort_order), '[]'::jsonb)
  from app.ranked_ratings r
  join app.ranked_formats f on f.activity_key = r.activity_key and f.format = r.format
  join app.activities a on a.key = r.activity_key
  where r.user_id = p_user and r.standing is not null
    and (p_activity is null or r.activity_key = p_activity);
$$;

drop function app.ranked_rank(double precision, integer);

-- What the owner sees: their medals, and how far through calibration they
-- are anywhere they have started, as matches played of 5.
create function app.my_ranks(p_user uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(case when r.standing is null
      then jsonb_build_object('activity', r.activity_key, 'format', r.format, 'calibrating', r.matches)
      else jsonb_build_object('activity', r.activity_key, 'format', r.format) || app.ranked_medal(r.standing) end
    order by a.sort_order, f.sort_order), '[]'::jsonb)
  from app.ranked_ratings r
  join app.ranked_formats f on f.activity_key = r.activity_key and f.format = r.format
  join app.activities a on a.key = r.activity_key
  where r.user_id = p_user and r.matches > 0;
$$;

-- The owner's badges read, as in 20261103091000_ranked_reads.sql with the
-- owner's view of ranks.
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
    'ranks',app.my_ranks(p_actor_id),
    'stats',jsonb_build_object('played',(select count(*) from app.badge_sessions(p_actor_id)),
      'hosted',(select count(*) from app.badge_hosted(p_actor_id)),
      'groups',(select count(*) from app.group_roles gr join app.groups gg on gg.id=gr.group_id where gr.user_id=p_actor_id and gg.kind='community')));
end;
$$;

revoke all on function app.ranked_target(double precision),
  app.ranked_next_standing(integer,integer,double precision,double precision,boolean),
  app.ranked_medal(integer), app.my_ranks(uuid), app.visible_ranks(uuid,text),
  app.apply_ranked_result(uuid,text,text,uuid[],uuid[],timestamptz), api.read_my_badges(uuid)
  from public, anon, authenticated;
grant execute on function app.ranked_target(double precision),
  app.ranked_next_standing(integer,integer,double precision,double precision,boolean),
  app.ranked_medal(integer), app.my_ranks(uuid), app.visible_ranks(uuid,text),
  app.apply_ranked_result(uuid,text,text,uuid[],uuid[],timestamptz), api.read_my_badges(uuid)
  to service_role;
