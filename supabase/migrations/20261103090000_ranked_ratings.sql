-- Ranked ratings (D-26, WDL-420). Each player has a hidden Glicko-2 rating
-- per category, a category being an activity and one of its formats
-- (pickleball singles and doubles to start). A confirmed result moves
-- everyone in it once: app.apply_ranked_result is keyed by the result's id,
-- so a retry changes nothing. Results are final once applied; nothing here
-- replays history. Self-rated levels and badges are not read or changed,
-- except that a self-rated level picks an unplayed player's matchmaking
-- seed. The numbers never leave the database: reads expose rank names only.
--
-- Recovery: restore api.read_profile and api.read_my_badges from
-- 20261102090000_more_badges.sql and app.registration_view_before_split from
-- 20261024091000_one_name.sql, then
--   drop function app.apply_ranked_result(uuid,text,text,uuid[],uuid[],timestamptz),
--     app.glicko2_step(double precision,double precision,double precision,double precision,double precision,double precision,double precision),
--     app.glicko2_f(double precision,double precision,double precision,double precision,double precision,double precision),
--     app.ranked_display(double precision), app.ranked_rank(double precision,integer),
--     app.visible_ranks(uuid,text), app.ranked_seed_rating(uuid,text,text);
--   drop table app.ranked_results, app.ranked_ratings, app.ranked_formats;

-- The formats an activity can be ranked in. Each activity lists its own.
create table app.ranked_formats (
  activity_key text not null references app.activities(key) on delete cascade,
  format text not null check (format ~ '^[a-z][a-z-]{1,19}$'),
  name text not null check (char_length(name) between 1 and 30),
  team_size smallint not null check (team_size between 1 and 4),
  sort_order integer not null,
  primary key (activity_key, format)
);
insert into app.ranked_formats(activity_key, format, name, team_size, sort_order) values
  ('pickleball', 'singles', 'Singles', 1, 1),
  ('pickleball', 'doubles', 'Doubles', 2, 2);

-- One row per player per category, on Glicko-2's internal scale
-- (display rating = 173.7178 * mu + 1500).
create table app.ranked_ratings (
  user_id uuid not null references auth.users(id) on delete cascade,
  activity_key text not null,
  format text not null,
  mu double precision not null default 0,
  phi double precision not null default 350 / 173.7178 check (phi > 0),
  sigma double precision not null default 0.06 check (sigma > 0),
  matches integer not null default 0 check (matches >= 0),
  last_played_at timestamptz,
  primary key (user_id, activity_key, format),
  foreign key (activity_key, format) references app.ranked_formats(activity_key, format) on delete cascade
);

-- Every result applied, once. The id is the caller's (later: the match).
create table app.ranked_results (
  result_id uuid primary key,
  activity_key text not null,
  format text not null,
  winners uuid[] not null,
  losers uuid[] not null,
  played_at timestamptz not null,
  applied_at timestamptz not null default now(),
  foreign key (activity_key, format) references app.ranked_formats(activity_key, format)
);

alter table app.ranked_formats enable row level security;
alter table app.ranked_ratings enable row level security;
alter table app.ranked_results enable row level security;
revoke all on app.ranked_formats, app.ranked_ratings, app.ranked_results from public, anon, authenticated;
grant select, insert, update, delete on app.ranked_formats, app.ranked_ratings, app.ranked_results to service_role;

create function app.ranked_display(p_mu double precision) returns double precision
language sql immutable security invoker set search_path = '' as $$
  select 173.7178 * p_mu + 1500;
$$;

-- One Glicko-2 rating period against one (possibly composite) opponent
-- (Glickman, "Example of the Glicko-2 system", 2013), with tau = 0.5.
-- p_team_mu is the player's side's strength, which for singles is p_mu.
create function app.glicko2_step(p_mu double precision, p_phi double precision, p_sigma double precision,
  p_team_mu double precision, p_opp_mu double precision, p_opp_phi double precision, p_score double precision,
  out mu double precision, out phi double precision, out sigma double precision)
language plpgsql immutable security invoker set search_path = '' as $$
declare
  tau constant double precision := 0.5;
  eps constant double precision := 0.000001;
  g double precision := 1 / sqrt(1 + 3 * p_opp_phi ^ 2 / pi() ^ 2);
  e double precision := 1 / (1 + exp(-g * (p_team_mu - p_opp_mu)));
  v double precision := 1 / (g ^ 2 * e * (1 - e));
  delta double precision := v * g * (p_score - e);
  a double precision := ln(p_sigma ^ 2);
  x_a double precision; x_b double precision; x_c double precision;
  f_a double precision; f_b double precision; f_c double precision;
  k integer := 1;
  phi_star double precision;
begin
  x_a := a;
  if delta ^ 2 > p_phi ^ 2 + v then
    x_b := ln(delta ^ 2 - p_phi ^ 2 - v);
  else
    while app.glicko2_f(a - k * tau, delta, p_phi, v, a, tau) < 0 loop
      k := k + 1;
    end loop;
    x_b := a - k * tau;
  end if;
  f_a := app.glicko2_f(x_a, delta, p_phi, v, a, tau);
  f_b := app.glicko2_f(x_b, delta, p_phi, v, a, tau);
  while abs(x_b - x_a) > eps loop
    x_c := x_a + (x_a - x_b) * f_a / (f_b - f_a);
    f_c := app.glicko2_f(x_c, delta, p_phi, v, a, tau);
    if f_c * f_b <= 0 then
      x_a := x_b; f_a := f_b;
    else
      f_a := f_a / 2;
    end if;
    x_b := x_c; f_b := f_c;
  end loop;
  sigma := exp(x_a / 2);
  phi_star := sqrt(p_phi ^ 2 + sigma ^ 2);
  phi := 1 / sqrt(1 / phi_star ^ 2 + 1 / v);
  mu := p_mu + phi ^ 2 * g * (p_score - e);
end;
$$;

-- The function the volatility iteration finds the root of.
create function app.glicko2_f(p_x double precision, p_delta double precision, p_phi double precision,
  p_v double precision, p_a double precision, p_tau double precision) returns double precision
language sql immutable security invoker set search_path = '' as $$
  select exp(p_x) * (p_delta ^ 2 - p_phi ^ 2 - p_v - exp(p_x)) / (2 * (p_phi ^ 2 + p_v + exp(p_x)) ^ 2)
    - (p_x - p_a) / p_tau ^ 2;
$$;

-- Apply one confirmed result. True when applied, false when this result id
-- was already applied. Anything malformed raises ranked_invalid_result and
-- changes nothing. Doubles: each side's strength is the mean of its players,
-- the opponent's spread is the root mean square of theirs, and every player
-- moves from their own deviation and volatility. Before a match, a full
-- week without playing widens a player's deviation by one rating period, up
-- to the starting 350, so someone returning moves faster.
create function app.apply_ranked_result(p_result_id uuid, p_activity text, p_format text,
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
    mu double precision, phi double precision, sigma double precision) on commit drop;
  truncate ranked_step;
  for r in select * from app.ranked_ratings
      where activity_key = p_activity and format = p_format and user_id = any(everyone)
      order by user_id for update loop
    insert into ranked_step values (r.user_id, r.user_id = any(p_winners), r.mu,
      least(sqrt(r.phi ^ 2 + greatest(0, floor(extract(epoch from p_played_at - coalesce(r.last_played_at, p_played_at)) / 604800)) * r.sigma ^ 2), start_phi),
      r.sigma);
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
      matches = matches + 1, last_played_at = greatest(coalesce(last_played_at, p_played_at), p_played_at)
      where user_id = r.user_id and activity_key = p_activity and format = p_format;
  end loop;
  return true;
end;
$$;

revoke all on function app.ranked_display(double precision),
  app.glicko2_step(double precision,double precision,double precision,double precision,double precision,double precision,double precision),
  app.glicko2_f(double precision,double precision,double precision,double precision,double precision,double precision),
  app.apply_ranked_result(uuid,text,text,uuid[],uuid[],timestamptz)
  from public, anon, authenticated;
grant execute on function app.ranked_display(double precision),
  app.glicko2_step(double precision,double precision,double precision,double precision,double precision,double precision,double precision),
  app.glicko2_f(double precision,double precision,double precision,double precision,double precision,double precision),
  app.apply_ranked_result(uuid,text,text,uuid[],uuid[],timestamptz)
  to service_role;
