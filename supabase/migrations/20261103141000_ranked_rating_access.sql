-- The rating engine runs for the app now (WDL-425), whose database role
-- can't read auth.users. Each player must still be a real account: the
-- ratings table's key to auth.users refuses anyone else, and the whole
-- result with them. Only that one check changes.
--
-- Recovery: restore app.apply_ranked_result from 20261103092000_ranked_medals.sql.

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
    or (select count(distinct u) from unnest(everyone) u where u is not null) <> 2 * size then
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
