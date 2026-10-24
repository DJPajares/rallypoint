-- Profile fixes (P-21 review): the public page returns only what it shows,
-- names are tidied the same way in the browser and the database, activities
-- compare without case, spacing or accent-composition differences, and every
-- existing account name is refreshed from sign-in details once so the same
-- person never shows under two names.

-- Badges on the public page: each badge once, as a key only (no dates, no
-- per-group entries), in key order.
create or replace function api.read_profile(p_profile_id uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare p app.profiles; shown jsonb;
begin
  select * into p from app.profiles where profile_id = p_profile_id;
  if p.user_id is null then raise no_data_found using message = 'profile_not_found'; end if;
  shown := app.visible_title(p.user_id);
  return jsonb_build_object('profileId', p.profile_id, 'name', coalesce(p.display_name, p.account_name),
    'title', case when shown is null then null else jsonb_build_object('key', shown->'key') end,
    'badges', coalesce((select jsonb_agg(jsonb_build_object('key', d.badge) order by d.badge)
      from (select distinct e.badge from app.earned_badges(p.user_id) e) d), '[]'::jsonb),
    'stats', jsonb_build_object('played', (select count(*) from app.badge_sessions(p.user_id)),
      'hosted', (select count(*) from app.badge_hosted(p.user_id)),
      'groups', (select count(*) from app.group_roles where user_id = p.user_id)),
    'activities', p.activities);
end;
$$;

-- Same checks as before, plus: a name may not contain control characters,
-- invisible format characters (zero-width, direction overrides) are removed,
-- and a name needs at least one letter or digit. Activities compare after
-- Unicode composition, lower-casing and collapsing runs of spaces.
create or replace function api.save_my_profile(p_actor_id uuid, p_account_name text, p_name text, p_activities jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  shown text := nullif(btrim(regexp_replace(coalesce(p_name, ''),
    '[­؀-؅؜۝܏࣢᠎​-‏‪-‮⁠-⁤⁦-⁯﻿￹-￻\U000110bd\U000110cd\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]',
    '', 'g')), '');
  entry jsonb; label text; custom integer := 0; seen text[] := array[]::text[]; same text;
  presets constant text[] := array['pickleball', 'badminton', 'tennis', 'basketball'];
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
    if not same = any(presets) then custom := custom + 1; end if;
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

-- One-time refresh. Rows made by the first migration took the name on the
-- person's latest booking (or an email prefix), which can be older than the
-- name Auth reports now. Use the Auth name where there is one, then carry every
-- person's current name onto their stored records.
update app.profiles p
set account_name = left(btrim(u.raw_user_meta_data->>'full_name'), 80)
from auth.users u
where u.id = p.user_id
  and nullif(btrim(coalesce(u.raw_user_meta_data->>'full_name', '')), '') is not null
  and p.account_name is distinct from left(btrim(u.raw_user_meta_data->>'full_name'), 80);

select app.propagate_name(user_id) from app.profiles;
