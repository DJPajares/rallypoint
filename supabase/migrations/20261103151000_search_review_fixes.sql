-- Review fixes for Search (D-27). A name that is only the start of
-- someone's email (an account made without a name, whose display name fell
-- back to it) is never findable: not in people search, and not when matching
-- a session's host by name. The person becomes findable by choosing a name.
-- The check reads auth.users, which the app's role can't, so it is a small
-- definer function that returns only true or false; the email never leaves it.
--
-- Recovery: restore app.host_discoverable and api.search_people from
-- 20261103150000_search_discovery.sql, then drop function app.name_from_email(uuid);

create function app.name_from_email(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from app.profiles pr join auth.users u on u.id = pr.user_id
    where pr.user_id = p_user and pr.display_name is null
      and lower(btrim(pr.account_name)) = lower(split_part(u.email, '@', 1)));
$$;

create or replace function app.host_discoverable(p_group uuid) returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists (select 1 from app.group_roles r join app.profiles pr on pr.user_id = r.user_id
    where r.group_id = p_group and r.role in ('owner', 'organizer') and pr.discoverable
      and not app.name_from_email(pr.user_id));
$$;

create or replace function api.search_people(p_actor_id uuid, p_query text) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare q text := lower(btrim(coalesce(p_query, '')));
begin
  if p_actor_id is null then raise insufficient_privilege; end if;
  if char_length(q) not between 2 and 40 then raise check_violation using message = 'invalid_input'; end if;
  return jsonb_build_object('people', coalesce((select jsonb_agg(jsonb_build_object(
      'profileId', x.profile_id, 'name', x.name,
      'activities', (select coalesce(jsonb_agg(jsonb_build_object('name', coalesce(pa.custom_name, a.name),
          'level', pa.level) order by pa.position), '[]'::jsonb)
        from app.profile_activities pa left join app.activities a on a.key = pa.activity_key
        where pa.user_id = x.user_id),
      'ranks', app.visible_ranks(x.user_id)) order by x.n)
    from (
      select pr.profile_id, pr.user_id, coalesce(pr.display_name, pr.account_name) as name,
        row_number() over (order by left(lower(coalesce(pr.display_name, pr.account_name)), char_length(q)) <> q,
          lower(coalesce(pr.display_name, pr.account_name)), pr.profile_id) as n
      from app.profiles pr
      where pr.discoverable and pr.user_id <> p_actor_id and not app.name_from_email(pr.user_id)
        and position(q in lower(coalesce(pr.display_name, pr.account_name, ''))) > 0
      order by n limit 20) x), '[]'::jsonb));
end;
$$;

revoke all on function app.name_from_email(uuid) from public, anon, authenticated;
grant execute on function app.name_from_email(uuid) to service_role;
