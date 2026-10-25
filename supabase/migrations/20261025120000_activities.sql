-- Shared activities (D-23, WDL-409). One catalog every part of the app
-- reads: each activity's defaults for a new session, its limits per plan
-- (only `free` is read until plans exist), its self-rating descriptions and
-- its icon. A typed activity stays valid and uses the hidden `general` row.
-- Browsers have no table access; reads go through the api functions below.

create table app.activities (
  key text primary key check (key ~ '^[a-z][a-z0-9-]{1,39}$'),
  name text not null unique check (char_length(name) between 1 and 40),
  icon text not null check (icon ~ '^[a-z][a-z0-9-]{1,39}$'),
  sort_order integer not null,
  active boolean not null default true,
  -- False only for `general`: it is never offered as a choice.
  listed boolean not null default true,
  default_capacity integer not null check (default_capacity >= 1),
  default_duration_minutes integer not null check (default_duration_minutes between 5 and 1440),
  default_guests boolean not null default false,
  default_cutoff_hours integer not null check (default_cutoff_hours between 0 and 720),
  -- Null opens registration from the moment the session is set up.
  default_opens_days integer check (default_opens_days is null or default_opens_days between 1 and 365)
);

create table app.activity_limits (
  activity_key text not null references app.activities(key) on delete cascade,
  plan text not null check (plan in ('free', 'pro')),
  min_capacity integer not null check (min_capacity >= 1),
  max_capacity integer not null,
  min_duration_minutes integer not null check (min_duration_minutes >= 5),
  max_duration_minutes integer not null,
  primary key (activity_key, plan),
  check (min_capacity <= max_capacity and min_duration_minutes <= max_duration_minutes)
);

create table app.activity_levels (
  activity_key text not null references app.activities(key) on delete cascade,
  level text not null check (level in ('beginner', 'intermediate', 'advanced')),
  description text not null check (char_length(description) between 1 and 120),
  primary key (activity_key, level)
);

alter table app.activities enable row level security;
alter table app.activity_limits enable row level security;
alter table app.activity_levels enable row level security;
revoke all on app.activities, app.activity_limits, app.activity_levels from public, anon, authenticated;
grant select, insert, update, delete on app.activities, app.activity_limits, app.activity_levels to service_role;

insert into app.activities(key, name, icon, sort_order, listed, default_capacity, default_duration_minutes,
  default_guests, default_cutoff_hours, default_opens_days) values
  ('pickleball', 'Pickleball', 'pickleball', 1, true, 8, 120, true, 24, null),
  ('badminton', 'Badminton', 'badminton', 2, true, 8, 120, true, 24, null),
  ('tennis', 'Tennis', 'tennis', 3, true, 4, 90, true, 24, null),
  ('basketball', 'Basketball', 'basketball', 4, true, 10, 90, false, 24, null),
  ('general', 'Other', 'general', 99, false, 12, 120, false, 24, null);

-- Pro doubles each free spot maximum and allows sessions up to 8 hours.
insert into app.activity_limits(activity_key, plan, min_capacity, max_capacity, min_duration_minutes, max_duration_minutes)
select key, plan, min_capacity, case when plan = 'pro' then max_capacity * 2 else max_capacity end,
  min_duration_minutes, case when plan = 'pro' then 480 else max_duration_minutes end
from (values
  ('pickleball', 4, 24, 30, 240),
  ('badminton', 2, 24, 30, 240),
  ('tennis', 2, 16, 30, 240),
  ('basketball', 6, 30, 30, 240),
  ('general', 1, 200, 15, 480)
) v(key, min_capacity, max_capacity, min_duration_minutes, max_duration_minutes)
cross join (values ('free'), ('pro')) p(plan);

insert into app.activity_levels(activity_key, level, description) values
  ('pickleball', 'beginner', 'Learning the rules, serves and dinks.'),
  ('pickleball', 'intermediate', 'Comfortable in rallies and playing doubles.'),
  ('pickleball', 'advanced', 'Plays competitively with strong placement and strategy.'),
  ('badminton', 'beginner', 'Learning grips, serves and keeping a rally going.'),
  ('badminton', 'intermediate', 'Rallies well and knows doubles positions.'),
  ('badminton', 'advanced', 'Plays competitively with fast, controlled shots.'),
  ('tennis', 'beginner', 'Learning the strokes and keeping the ball in play.'),
  ('tennis', 'intermediate', 'Rallies consistently and plays full matches.'),
  ('tennis', 'advanced', 'Plays competitively with reliable serves and tactics.'),
  ('basketball', 'beginner', 'Learning to dribble, pass and shoot.'),
  ('basketball', 'intermediate', 'Plays full-court games and knows team basics.'),
  ('basketball', 'advanced', 'Plays competitively with strong skills and game sense.'),
  ('general', 'beginner', 'New to it and still learning.'),
  ('general', 'intermediate', 'Plays regularly and knows the basics well.'),
  ('general', 'advanced', 'Experienced and plays at a high level.');

-- A free row's defaults fall inside its own limits, and pro never allows less.
do $$
begin
  if exists (select 1 from app.activities a join app.activity_limits l on l.activity_key = a.key and l.plan = 'free'
      where a.default_capacity not between l.min_capacity and l.max_capacity
        or a.default_duration_minutes not between l.min_duration_minutes and l.max_duration_minutes)
    or exists (select 1 from app.activity_limits f join app.activity_limits p on p.activity_key = f.activity_key
      where f.plan = 'free' and p.plan = 'pro' and (p.max_capacity < f.max_capacity or p.max_duration_minutes < f.max_duration_minutes))
    or exists (select 1 from app.activities a where (select count(*) from app.activity_levels v where v.activity_key = a.key) <> 3)
  then raise exception 'activity seed is inconsistent'; end if;
end;
$$;

-- The activity a text names, compared without case, spacing or accent
-- composition, by name or key. `general` is never named; null means typed.
create function app.activity_key_for(p_text text) returns text
language sql stable security invoker set search_path = '' as $$
  select a.key from app.activities a
  where a.key <> 'general'
    and regexp_replace(lower(normalize(btrim(coalesce(p_text, '')), nfc)), '\s+', ' ', 'g')
      in (regexp_replace(lower(normalize(a.name, nfc)), '\s+', ' ', 'g'), a.key)
  limit 1;
$$;

-- Sessions keep their typed activity text (history never changes) and gain a
-- link to the activity it names, maintained on every save.
alter table app.sessions add column activity_key text references app.activities(key);
create function app.link_session_activity() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  new.activity_key := app.activity_key_for(new.details->>'activity');
  return new;
end;
$$;
create trigger link_session_activity before insert or update of details on app.sessions
  for each row execute function app.link_session_activity();
update app.sessions set activity_key = app.activity_key_for(details->>'activity');

-- Profile activities move from a jsonb array to one row each, in order.
create table app.profile_activities (
  user_id uuid not null references app.profiles(user_id) on delete cascade,
  position smallint not null check (position between 1 and 10),
  activity_key text references app.activities(key),
  custom_name text check (custom_name is null or char_length(custom_name) between 1 and 40),
  level text check (level is null or level in ('beginner', 'intermediate', 'advanced')),
  primary key (user_id, position),
  check ((activity_key is null) <> (custom_name is null))
);
alter table app.profile_activities enable row level security;
revoke all on app.profile_activities from public, anon, authenticated;
grant select, insert, update, delete on app.profile_activities to service_role;

insert into app.profile_activities(user_id, position, activity_key, custom_name, level)
select p.user_id, e.ord, app.activity_key_for(e.v->>'name'),
  case when app.activity_key_for(e.v->>'name') is null then btrim(e.v->>'name') end,
  e.v->>'level'
from app.profiles p, jsonb_array_elements(p.activities) with ordinality e(v, ord);

-- What profiles show: the catalog spelling for a listed activity, the typed
-- name otherwise, with the level and the key (null when typed).
create function app.profile_activities_json(p_user uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('name', coalesce(a.name, pa.custom_name),
    'level', pa.level, 'key', pa.activity_key) order by pa.position), '[]'::jsonb)
  from app.profile_activities pa left join app.activities a on a.key = pa.activity_key
  where pa.user_id = p_user;
$$;

create or replace function api.read_my_profile(p_actor_id uuid, p_account_name text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
begin
  perform api.ensure_my_profile(p_actor_id, p_account_name);
  return (select jsonb_build_object('profileId', p.profile_id, 'name', coalesce(p.display_name, p.account_name),
    'nameIsCustom', p.display_name is not null, 'activities', app.profile_activities_json(p.user_id))
    from app.profiles p where p.user_id = p_actor_id);
end;
$$;

-- Same checks as before; an activity is "your own" when the catalog doesn't
-- name it, and the rows replace the old jsonb array.
create or replace function api.save_my_profile(p_actor_id uuid, p_account_name text, p_name text, p_activities jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  shown text := nullif(btrim(regexp_replace(coalesce(p_name, ''),
    '[­؀-؅؜۝܏࣢᠎​-‏‪-‮⁠-⁤⁦-⁯﻿￹-￻\U000110bd\U000110cd\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]',
    '', 'g')), '');
  entry jsonb; label text; custom integer := 0; seen text[] := array[]::text[]; same text;
begin
  if p_activities is null or jsonb_typeof(p_activities) <> 'array' or jsonb_array_length(p_activities) > 10
    or (shown is not null and char_length(shown) > 80)
    or coalesce(p_name, '') ~ '[\u0001-\u001f\u007f-\u009f]'
    or (shown is not null and shown !~ '[[:alnum:]]') then
    raise check_violation using message = 'invalid_profile';
  end if;
  for entry in select * from jsonb_array_elements(p_activities) loop
    if jsonb_typeof(entry) <> 'object' or jsonb_typeof(entry->'name') <> 'string'
      or (select count(*) from jsonb_object_keys(entry)) <> 2
      or not (entry ? 'level')
      or jsonb_typeof(entry->'level') not in ('string', 'null')
      or (jsonb_typeof(entry->'level') = 'string' and entry->>'level' not in ('beginner', 'intermediate', 'advanced')) then
      raise check_violation using message = 'invalid_profile';
    end if;
    label := btrim(entry->>'name');
    same := regexp_replace(lower(normalize(label, nfc)), '\s+', ' ', 'g');
    if char_length(label) not between 1 and 40 or same = any(seen) then
      raise check_violation using message = 'invalid_profile';
    end if;
    seen := seen || same;
    if app.activity_key_for(label) is null then custom := custom + 1; end if;
  end loop;
  if custom > 3 then raise check_violation using message = 'invalid_profile'; end if;

  perform pg_advisory_xact_lock(hashtextextended('profile:' || p_actor_id::text, 0));
  perform api.ensure_my_profile(p_actor_id, p_account_name);
  update app.profiles set display_name = shown, updated_at = now()
    where user_id = p_actor_id;
  -- One row per activity, in the order given: a listed one by key (shown in
  -- its catalog spelling), anything else by the name typed.
  delete from app.profile_activities where user_id = p_actor_id;
  insert into app.profile_activities(user_id, position, activity_key, custom_name, level)
  select p_actor_id, e.ord, app.activity_key_for(e.v->>'name'),
    case when app.activity_key_for(e.v->>'name') is null then btrim(e.v->>'name') end,
    e.v->>'level'
  from jsonb_array_elements(p_activities) with ordinality e(v, ord);
  perform app.propagate_name(p_actor_id);
  return api.read_my_profile(p_actor_id, p_account_name);
end;
$$;

-- The public page, unchanged except that activities come from their rows.
create or replace function api.read_profile(p_profile_id uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare p app.profiles;
  catalog constant text[] := array['rally','steady','new-faces','plus-one','host','full-house'];
begin
  select * into p from app.profiles where profile_id = p_profile_id;
  if p.user_id is null then raise no_data_found using message = 'profile_not_found'; end if;
  return jsonb_build_object('profileId', p.profile_id, 'name', coalesce(p.display_name, p.account_name),
    'title', app.visible_title(p.user_id),
    'badges', coalesce((select jsonb_agg(jsonb_build_object('key', b.badge, 'level', b.level) order by array_position(catalog, b.badge))
      from (select l.badge, max(l.level) level from app.badge_levels(p.user_id) l group by l.badge) b), '[]'::jsonb),
    'stats', jsonb_build_object('played', (select count(*) from app.badge_sessions(p.user_id)),
      'hosted', (select count(*) from app.badge_hosted(p.user_id)),
      'groups', (select count(*) from app.group_roles where user_id = p.user_id)),
    'activities', app.profile_activities_json(p.user_id));
end;
$$;

alter table app.profiles drop column activities;

-- The catalog for every screen: active activities in order, then `general`,
-- each with its defaults, its free-plan limits and its level descriptions.
create function api.read_activities() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'key', a.key, 'name', a.name, 'icon', a.icon, 'sortOrder', a.sort_order, 'listed', a.listed,
    'defaults', jsonb_build_object('capacity', a.default_capacity, 'durationMinutes', a.default_duration_minutes,
      'guests', a.default_guests, 'cutoffHours', a.default_cutoff_hours, 'opensDays', a.default_opens_days),
    'limits', jsonb_build_object('minCapacity', l.min_capacity, 'maxCapacity', l.max_capacity,
      'minDurationMinutes', l.min_duration_minutes, 'maxDurationMinutes', l.max_duration_minutes),
    'levels', (select jsonb_object_agg(v.level, v.description) from app.activity_levels v where v.activity_key = a.key))
    order by a.listed desc, a.sort_order), '[]'::jsonb)
  from app.activities a join app.activity_limits l on l.activity_key = a.key and l.plan = 'free'
  where a.active or a.key = 'general';
$$;

-- A published session's spots and length stay inside its activity's free-plan
-- limits. Only what changes against the stored published details is checked,
-- so an older session stays editable (moving it keeps its length); a new session or a draft being published
-- (no previous) is checked in full. Changing the activity rechecks spots.
create function app.assert_activity_limits(p_previous jsonb, p_next jsonb) returns void
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_key text := coalesce(app.activity_key_for(p_next->>'activity'), 'general');
  l app.activity_limits; spots_changed boolean; length_changed boolean; minutes numeric;
begin
  select * into l from app.activity_limits where activity_key = v_key and plan = 'free';
  if not found then return; end if;
  if p_previous is null then
    spots_changed := true; length_changed := true;
  else
    spots_changed := coalesce(app.activity_key_for(p_previous->>'activity'), 'general') <> v_key
      or (p_previous->>'capacity')::bigint is distinct from (p_next->>'capacity')::bigint;
    -- Length, not position: moving a session keeps an older length valid.
    length_changed := ((p_previous->>'endsAt')::timestamptz - (p_previous->>'startsAt')::timestamptz)
      is distinct from ((p_next->>'endsAt')::timestamptz - (p_next->>'startsAt')::timestamptz);
  end if;
  if spots_changed and (p_next->>'capacity')::bigint not between l.min_capacity and l.max_capacity then
    raise sqlstate 'P0001' using message = 'activity_capacity_limit';
  end if;
  minutes := extract(epoch from ((p_next->>'endsAt')::timestamptz - (p_next->>'startsAt')::timestamptz)) / 60;
  if length_changed and minutes is not null
    and minutes not between l.min_duration_minutes and l.max_duration_minutes then
    raise sqlstate 'P0001' using message = 'activity_duration_limit';
  end if;
end;
$$;

-- The save wrapper now also checks the activity limits against the locked
-- row as it was before this save, and only for a request not already
-- committed (a replay returns its original result). It runs after the save's
-- own checks, so their messages keep priority; a refusal here rolls the whole
-- save back. Everything else is unchanged.
create or replace function api.save_session(p_actor_id uuid,p_key uuid,p_group_id uuid,p_session_id uuid,p_intent text,p_version integer,p_details jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s app.sessions; committed boolean; previous jsonb; result jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text||p_key::text,0));
  perform app.require_manager(p_actor_id,p_group_id);
  if (select archived_at from app.groups where id=p_group_id) is not null then
    raise insufficient_privilege using message='group_removed';
  end if;
  committed := exists(select 1 from app.operation_receipts where actor_id=p_actor_id and request_key=p_key);
  if p_session_id is not null then
    select * into s from app.sessions where id=p_session_id and group_id=p_group_id for update;
    if s.state in ('cancelled','completed') and not committed then
      raise sqlstate 'P0001' using message='session_closed';end if;
  end if;
  previous := case when s.state='published' then s.details end;
  result := app.save_session_before_cancellation(p_actor_id,p_key,p_group_id,p_session_id,p_intent,p_version,p_details);
  if p_intent in ('publish','update') and not committed then
    perform app.assert_activity_limits(previous, p_details);
  end if;
  return result;
end;
$$;

revoke all on function app.activity_key_for(text), app.link_session_activity(), app.profile_activities_json(uuid),
  app.assert_activity_limits(jsonb, jsonb), api.read_activities()
  from public, anon, authenticated;
grant execute on function app.activity_key_for(text), app.link_session_activity(), app.profile_activities_json(uuid),
  app.assert_activity_limits(jsonb, jsonb), api.read_activities()
  to service_role;
