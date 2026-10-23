-- Profiles (P-21): the name a person chooses to show and the activities they
-- play, one row per account. The account name is a copy of what Auth reports
-- (never written back to Auth). Browsers have no table access; every read and
-- write goes through the api functions below, keyed on the verified actor.
create table app.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  -- A random, public handle for the profile page; never the account id.
  profile_id uuid not null unique default gen_random_uuid(),
  display_name text check (display_name is null or char_length(display_name) between 1 and 80),
  account_name text not null check (char_length(account_name) between 1 and 80),
  activities jsonb not null default '[]' check (jsonb_typeof(activities) = 'array'),
  updated_at timestamptz not null default now()
);
alter table app.profiles enable row level security;
revoke all on app.profiles from public, anon, authenticated;
grant select, insert, update, delete on app.profiles to service_role;

-- Everyone already on a roster or in a group gets a row, so their name can link
-- to a profile. Skips ids whose account no longer exists.
insert into app.profiles(user_id, account_name)
select u.id,
  left(coalesce(
    (select p.primary_name from app.parties p where p.user_id = u.id order by p.created_at desc, p.queue_sequence desc limit 1),
    nullif(split_part(u.email, '@', 1), ''),
    'Participant'), 80)
from auth.users u
where u.id in (select user_id from app.parties union select user_id from app.group_roles)
on conflict (user_id) do nothing;

-- Placeholder: the next change makes this carry a changed name onto the
-- person's existing roster records. Until then nothing needs updating.
create function app.propagate_name(p_user uuid) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  perform p_user;
end;
$$;

-- Creates the row on first sight and keeps the account-name copy current.
create function api.ensure_my_profile(p_actor_id uuid, p_account_name text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare account text := left(coalesce(nullif(btrim(p_account_name), ''), 'Participant'), 80); result jsonb;
begin
  insert into app.profiles(user_id, account_name) values (p_actor_id, account)
    on conflict (user_id) do update set account_name = excluded.account_name
    where app.profiles.account_name is distinct from excluded.account_name;
  select jsonb_build_object('profileId', p.profile_id, 'name', coalesce(p.display_name, p.account_name))
    into result from app.profiles p where p.user_id = p_actor_id;
  return result;
end;
$$;

create function api.read_my_profile(p_actor_id uuid, p_account_name text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
begin
  perform api.ensure_my_profile(p_actor_id, p_account_name);
  return (select jsonb_build_object('profileId', p.profile_id, 'name', coalesce(p.display_name, p.account_name),
    'nameIsCustom', p.display_name is not null, 'activities', p.activities)
    from app.profiles p where p.user_id = p_actor_id);
end;
$$;

-- Replaces the whole profile. The API has already tidied it; this re-checks the
-- limits so no caller can store more. A blank name clears the override.
create function api.save_my_profile(p_actor_id uuid, p_account_name text, p_name text, p_activities jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  shown text := nullif(btrim(coalesce(p_name, '')), '');
  entry jsonb; label text; custom integer := 0; seen text[] := array[]::text[];
  presets constant text[] := array['pickleball', 'badminton', 'tennis', 'basketball'];
begin
  if p_activities is null or jsonb_typeof(p_activities) <> 'array' or jsonb_array_length(p_activities) > 10
    or (shown is not null and char_length(shown) > 80) then
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
    if char_length(label) not between 1 and 40 or lower(label) = any(seen) then
      raise check_violation using message = 'invalid_profile';
    end if;
    seen := seen || lower(label);
    if not lower(label) = any(presets) then custom := custom + 1; end if;
  end loop;
  if custom > 3 then raise check_violation using message = 'invalid_profile'; end if;

  perform pg_advisory_xact_lock(hashtextextended('profile:' || p_actor_id::text, 0));
  perform api.ensure_my_profile(p_actor_id, p_account_name);
  update app.profiles set display_name = shown, activities = p_activities, updated_at = now()
    where user_id = p_actor_id;
  perform app.propagate_name(p_actor_id);
  return api.read_my_profile(p_actor_id, p_account_name);
end;
$$;

-- The public page for one profile link. Only the page's own fields; badges and
-- the title carry no group name, and nothing here identifies the account.
create function api.read_profile(p_profile_id uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare p app.profiles; shown jsonb;
begin
  select * into p from app.profiles where profile_id = p_profile_id;
  if p.user_id is null then raise no_data_found using message = 'profile_not_found'; end if;
  shown := app.visible_title(p.user_id);
  return jsonb_build_object('profileId', p.profile_id, 'name', coalesce(p.display_name, p.account_name),
    'title', case when shown is null then null else jsonb_build_object('key', shown->'key') end,
    'badges', coalesce((select jsonb_agg(jsonb_build_object('key', e.badge, 'earnedAt', e.earned_at) order by e.earned_at, e.id)
      from app.earned_badges(p.user_id) e), '[]'::jsonb),
    'stats', jsonb_build_object('played', (select count(*) from app.badge_sessions(p.user_id)),
      'hosted', (select count(*) from app.badge_hosted(p.user_id)),
      'groups', (select count(*) from app.group_roles where user_id = p.user_id)),
    'activities', p.activities);
end;
$$;

revoke all on function app.propagate_name(uuid), api.ensure_my_profile(uuid, text), api.read_my_profile(uuid, text),
  api.save_my_profile(uuid, text, text, jsonb), api.read_profile(uuid) from public, anon, authenticated;
grant execute on function app.propagate_name(uuid), api.ensure_my_profile(uuid, text), api.read_my_profile(uuid, text),
  api.save_my_profile(uuid, text, text, jsonb), api.read_profile(uuid) to service_role;
