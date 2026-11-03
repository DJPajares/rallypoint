-- Ranked matchmaking (D-26, WDL-422). A bounded pass, run every minute by the
-- scheduler, pairs searches into proposed matches: same category, a shared
-- area (or region, once the player has widened), overlapping times when both
-- chose some, and hidden skill within 100 points (300 once a search has
-- waited a day; doubles use the team's average). The longest-waiting
-- compatible search is paired first, and people who met in the last 7 days
-- are never paired again. Only one pass runs at a time; it takes each
-- person's search lock without waiting, so it never blocks or deadlocks a
-- player's own action, and the open-seat index keeps anyone from being in
-- two matches. A pass handles at most p_limit searches and continues from a
-- stored cursor next time.
--
-- Recovery:
--   restore api.cancel_search and app.search_active from 20261103110000_ranked_search.sql, then
--   drop function api.run_matchmaking(integer), app.match_place(app.ranked_searches,app.ranked_searches),
--     app.match_window(text[],text[]), app.met_recently(uuid[],uuid[]),
--     app.search_users(app.ranked_searches), app.search_reach(app.ranked_searches),
--     app.search_band(app.ranked_searches), app.search_skill(app.ranked_searches);
--   update app.ranked_searches set state = 'cancelled', ended_at = now() where state = 'matched';
--   alter table app.ranked_searches drop column match_id, drop column matched_at, drop column wide;
--   alter table app.ranked_searches drop constraint ranked_searches_state_check, add constraint
--     ranked_searches_state_check check (state in ('waiting_partner','searching','cancelled','declined'));
--   drop table app.ranked_engine, app.ranked_match_players, app.ranked_matches;

create table app.ranked_matches (
  id uuid primary key default gen_random_uuid(),
  activity_key text not null,
  format text not null,
  state text not null default 'proposed' check (state in ('proposed', 'confirmed', 'cancelled')),
  area_key text not null references app.areas(key),
  court_id uuid references app.courts(id) on delete set null,
  time_window text,
  created_at timestamptz not null default now(),
  respond_by timestamptz not null,
  confirmed_at timestamptz,
  ended_at timestamptz,
  end_reason text check (end_reason in ('declined', 'expired')),
  foreign key (activity_key, format) references app.ranked_formats(activity_key, format)
);
create index ranked_matches_due on app.ranked_matches(respond_by) where state = 'proposed';

-- Side 1 is the side that had waited longer.
create table app.ranked_match_players (
  match_id uuid not null references app.ranked_matches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  side smallint not null check (side in (1, 2)),
  search_id uuid not null references app.ranked_searches(id) on delete cascade,
  answer text check (answer in ('accepted')),
  answered_at timestamptz,
  released_at timestamptz,
  primary key (match_id, user_id)
);
-- Nobody holds a seat in two matches at once.
create unique index ranked_match_players_open on app.ranked_match_players(user_id) where released_at is null;
create index ranked_match_players_user on app.ranked_match_players(user_id);

alter table app.ranked_searches drop constraint ranked_searches_state_check;
alter table app.ranked_searches add constraint ranked_searches_state_check
  check (state in ('waiting_partner', 'searching', 'matched', 'cancelled', 'declined'));
alter table app.ranked_searches
  add column match_id uuid references app.ranked_matches(id) on delete set null,
  add column matched_at timestamptz,
  add column wide boolean not null default false;
create index ranked_searches_queue on app.ranked_searches(started_at, id) where state = 'searching';

-- Where the last full pass stopped.
create table app.ranked_engine (
  id smallint primary key check (id = 1),
  cursor_started_at timestamptz,
  cursor_id uuid
);
insert into app.ranked_engine(id) values (1);

alter table app.ranked_matches enable row level security;
alter table app.ranked_match_players enable row level security;
alter table app.ranked_engine enable row level security;
revoke all on app.ranked_matches, app.ranked_match_players, app.ranked_engine from public, anon, authenticated;
grant select, insert, update, delete on app.ranked_matches, app.ranked_match_players, app.ranked_engine
  to service_role;

-- A matched search stays active (no new search) until its match lets go.
create or replace function app.search_active(s app.ranked_searches) returns boolean
language sql stable security invoker set search_path = '' as $$
  select (s.state in ('waiting_partner', 'searching') and s.ends_at > now()) or s.state = 'matched';
$$;

create function app.search_users(s app.ranked_searches) returns uuid[]
language sql immutable security invoker set search_path = '' as $$
  select array_remove(array[s.starter_id, s.partner_id], null);
$$;

-- The side's hidden strength: each searcher's matchmaking rating, averaged.
create function app.search_skill(s app.ranked_searches) returns double precision
language sql stable security invoker set search_path = '' as $$
  select avg(app.ranked_seed_rating(u, s.activity_key, s.format)) from unnest(app.search_users(s)) u;
$$;

create function app.search_band(s app.ranked_searches) returns integer
language sql stable security invoker set search_path = '' as $$
  select case when now() - s.started_at >= interval '1 day' then 300 else 100 end;
$$;

-- The areas a search covers: its own, or every area in their regions once widened.
create function app.search_reach(s app.ranked_searches) returns text[]
language sql stable security invoker set search_path = '' as $$
  select case when s.wide then (select array_agg(a.key order by a.sort_order) from app.areas a
      where a.region_key in (select r.region_key from app.areas r where r.key = any(s.areas)))
    else s.areas end;
$$;

-- Met in a ranked result, or a match everyone accepted, within 7 days.
create function app.met_recently(p_a uuid[], p_b uuid[]) returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists (select 1 from app.ranked_results r where r.played_at > now() - interval '7 days'
      and (r.winners || r.losers) && p_a and (r.winners || r.losers) && p_b)
    or exists (select 1 from app.ranked_matches m
      join app.ranked_match_players pa on pa.match_id = m.id and pa.user_id = any(p_a)
      join app.ranked_match_players pb on pb.match_id = m.id and pb.user_id = any(p_b)
      where m.confirmed_at > now() - interval '7 days');
$$;

-- The first time both sides allow, in the listed order; none when neither chose.
create function app.match_window(p_a text[], p_b text[]) returns text
language sql immutable security invoker set search_path = '' as $$
  select w from unnest(array['weekday-mornings', 'weekday-afternoons', 'weekday-evenings',
      'weekend-mornings', 'weekend-afternoons', 'weekend-evenings']) with ordinality o(w, n)
  where (cardinality(p_a) = 0 or w = any(p_a)) and (cardinality(p_b) = 0 or w = any(p_b))
    and cardinality(p_a) + cardinality(p_b) > 0
  order by n limit 1;
$$;

-- Where to play: a court both chose (in the longer-waiting side's order),
-- else a shared area and that side's (then the other's) first court in it.
create function app.match_place(p_first app.ranked_searches, p_second app.ranked_searches,
  out o_area text, out o_court uuid)
language plpgsql stable security invoker set search_path = '' as $$
declare reach_1 text[] := app.search_reach(p_first); reach_2 text[] := app.search_reach(p_second);
begin
  select c.area_key, c.id into o_area, o_court
  from unnest(p_first.courts) with ordinality u(id, n) join app.courts c on c.id = u.id
  where c.id = any(p_second.courts) and c.area_key = any(reach_1) and c.area_key = any(reach_2)
  order by u.n limit 1;
  if found then return; end if;
  select x.k into o_area from (
    select u.k, 1 as pri, u.n from unnest(p_first.areas) with ordinality u(k, n) where u.k = any(reach_2)
    union all
    select u.k, 2, u.n from unnest(p_second.areas) with ordinality u(k, n) where u.k = any(reach_1)
    union all
    select a.key, 3, a.sort_order from app.areas a where a.key = any(reach_1) and a.key = any(reach_2)
  ) x order by x.pri, x.n limit 1;
  select c.id into o_court from (
    select u.id, 1 as pri, u.n from unnest(p_first.courts) with ordinality u(id, n)
    union all
    select u.id, 2, u.n from unnest(p_second.courts) with ordinality u(id, n)
  ) x join app.courts c on c.id = x.id
  where c.area_key = o_area order by x.pri, x.n limit 1;
end;
$$;

-- One pass of the engine. Returns how many matches it proposed.
create function api.run_matchmaking(p_limit integer) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare e app.ranked_engine; ids uuid[]; i integer; touched integer := 0; proposed integer := 0;
  a app.ranked_searches; b app.ranked_searches; first app.ranked_searches; second app.ranked_searches;
  last_at timestamptz; last_id uuid; u uuid; locked boolean; v_area text; v_court uuid; v_match uuid;
begin
  if p_limit is null or p_limit < 1 then raise check_violation using message = 'invalid_input'; end if;
  if not pg_try_advisory_xact_lock(hashtextextended('ranked-matchmaking', 0)) then
    return jsonb_build_object('ran', false, 'proposed', 0, 'expired', 0);
  end if;
  select * into e from app.ranked_engine where id = 1 for update;
  -- After the cursor first, then from the start: everyone is reached in turn.
  select array_agg(x.id order by x.wrapped, x.started_at, x.id) into ids from (
    select s.id, s.started_at, coalesce((s.started_at, s.id) <= (e.cursor_started_at, e.cursor_id), false) as wrapped
    from app.ranked_searches s
    where s.state = 'searching' and s.started_at is not null and s.ends_at > now()
    order by 3, s.started_at, s.id limit p_limit) x;

  for i in 1 .. coalesce(cardinality(ids), 0) loop
    exit when touched >= p_limit;
    select * into a from app.ranked_searches where id = ids[i];
    last_at := a.started_at; last_id := a.id;
    continue when a.state <> 'searching' or not app.search_active(a);
    touched := touched + 1;
    select s.* into b from app.ranked_searches s
    where s.id <> a.id and s.activity_key = a.activity_key and s.format = a.format
      and s.state = 'searching' and s.started_at is not null and s.ends_at > now()
      and app.search_reach(s) && app.search_reach(a)
      and (cardinality(s.windows) = 0 or cardinality(a.windows) = 0 or s.windows && a.windows)
      and abs(app.search_skill(s) - app.search_skill(a)) <= greatest(app.search_band(s), app.search_band(a))
      and not app.met_recently(app.search_users(a), app.search_users(s))
    order by s.started_at, s.id limit 1;
    continue when not found;
    -- Never wait on a person: someone mid-action is simply tried next pass.
    locked := true;
    foreach u in array app.search_users(a) || app.search_users(b) loop
      if not pg_try_advisory_xact_lock(hashtextextended('ranked-search:' || u::text, 0)) then
        locked := false; exit;
      end if;
    end loop;
    continue when not locked;
    select * into a from app.ranked_searches where id = a.id for update;
    select * into b from app.ranked_searches where id = b.id for update;
    continue when a.state <> 'searching' or b.state <> 'searching'
      or not app.search_active(a) or not app.search_active(b);
    if (b.started_at, b.id) < (a.started_at, a.id) then first := b; second := a;
    else first := a; second := b; end if;
    select o_area, o_court into v_area, v_court from app.match_place(first, second);
    insert into app.ranked_matches(activity_key, format, area_key, court_id, time_window, respond_by)
      values (first.activity_key, first.format, v_area, v_court,
        app.match_window(first.windows, second.windows), now() + interval '48 hours')
      returning id into v_match;
    insert into app.ranked_match_players(match_id, user_id, side, search_id)
      select v_match, x, 1, first.id from unnest(app.search_users(first)) x
      union all
      select v_match, x, 2, second.id from unnest(app.search_users(second)) x;
    update app.ranked_searches set state = 'matched', match_id = v_match, matched_at = now()
      where id in (first.id, second.id);
    proposed := proposed + 1;
    touched := touched + 1;
  end loop;

  -- A full batch leaves a cursor; a short one means everyone was reached.
  if coalesce(cardinality(ids), 0) >= p_limit then
    update app.ranked_engine set cursor_started_at = last_at, cursor_id = last_id where id = 1;
  else
    update app.ranked_engine set cursor_started_at = null, cursor_id = null where id = 1;
  end if;
  return jsonb_build_object('ran', true, 'proposed', proposed, 'expired', 0);
end;
$$;

-- A matched search is settled through its match, not cancelled.
create or replace function api.cancel_search(p_actor_id uuid, p_key uuid, p_search uuid) returns jsonb
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
  if s.state = 'matched' then raise sqlstate 'P0001' using message = 'search_matched'; end if;
  if app.search_active(s) then
    update app.ranked_searches set state = 'cancelled', ended_at = now() where id = s.id;
  end if;
  insert into app.operation_receipts values (p_actor_id, p_key, 'cancel_search', payload, s.id, now());
  return jsonb_build_object('operationKey', p_key) || api.read_my_search(p_actor_id);
end;
$$;

revoke all on function app.search_users(app.ranked_searches), app.search_skill(app.ranked_searches),
  app.search_band(app.ranked_searches), app.search_reach(app.ranked_searches),
  app.met_recently(uuid[],uuid[]), app.match_window(text[],text[]),
  app.match_place(app.ranked_searches,app.ranked_searches), api.run_matchmaking(integer)
  from public, anon, authenticated;
grant execute on function app.search_users(app.ranked_searches), app.search_skill(app.ranked_searches),
  app.search_band(app.ranked_searches), app.search_reach(app.ranked_searches),
  app.met_recently(uuid[],uuid[]), app.match_window(text[],text[]),
  app.match_place(app.ranked_searches,app.ranked_searches), api.run_matchmaking(integer)
  to service_role;
