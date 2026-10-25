-- Level titles (WDL-405, PRD D-16). A person shows one badge as their title;
-- it reads that badge's current level title ("Mainstay"), which the app names
-- from {key, level}. app.user_titles.badge_id now holds the badge key. The old
-- badge evaluation existed only for titles and is dropped.
--
-- Existing choices move one way (owner, 2026-10-25: the app is not launched,
-- "we can change anything"): every old title maps to its badge, and Founder
-- maps to Host only when Host is started; otherwise that choice is removed.
-- Recovery: restore app.earned_badges from 20261022170000_badges.sql and the
-- replaced functions from 20261022170000_badges.sql (visible_title,
-- set_my_title), 20261025090000_badge_levels.sql (read_my_badges, read_profile),
-- then map back: -- Founder had no matching badge: it becomes Host only where Host is started.
delete from app.user_titles t where t.badge_id like 'founder:%'
  and not exists(select 1 from app.badge_levels(t.user_id) l where l.badge='host');
update app.user_titles set badge_id=case
    when badge_id in ('first-rally','sessions-10','sessions-25','sessions-50','sessions-100','off-the-bench')
      or badge_id like 'regular:%' then 'rally'
    when badge_id in ('new-faces-10','new-faces-25','new-faces-50') then 'new-faces'
    when badge_id in ('hosted-10') or badge_id like 'founder:%' then 'host'
    else badge_id end,
  updated_at=now()
  where badge_id not in ('rally','steady','new-faces','plus-one','host','full-house');
-- Every old id is mapped above; nothing outside the catalog may remain.
delete from app.user_titles where badge_id not in ('rally','steady','new-faces','plus-one','host','full-house');

-- The shown title: the chosen badge at its current level, while it is started.
create or replace function app.visible_title(p_user uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('key',t.badge_id,'level',max(l.level))
  from app.user_titles t join app.badge_levels(p_user) l on l.badge=t.badge_id
  where t.user_id=p_user group by t.badge_id;
$$;

-- Choose a started badge, or none. The level is never stored, so the title
-- follows the badge up and down.
create or replace function api.set_my_title(p_actor_id uuid,p_badge_id text) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
  if p_badge_id is null then
    delete from app.user_titles where user_id=p_actor_id;
  elsif not exists(select 1 from app.badge_levels(p_actor_id) l where l.badge=p_badge_id) then
    raise check_violation using message='title_not_earned';
  else
    insert into app.user_titles(user_id,badge_id) values(p_actor_id,p_badge_id)
      on conflict(user_id) do update set badge_id=excluded.badge_id,updated_at=now();
  end if;
  return api.read_my_badges(p_actor_id);
end;
$$;

create or replace function api.read_my_badges(p_actor_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare items jsonb; reached jsonb;
  catalog constant text[] := array['rally','steady','new-faces','plus-one','host','full-house'];
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
      'groups',(select count(*) from app.group_roles where user_id=p_actor_id)));
end;
$$;

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
    'activities', p.activities);
end;
$$;

drop function app.earned_badges(uuid);

revoke all on function app.visible_title(uuid),api.set_my_title(uuid,text),api.read_my_badges(uuid),api.read_profile(uuid)
  from public,anon,authenticated;
grant execute on function app.visible_title(uuid),api.set_my_title(uuid,text),api.read_my_badges(uuid),api.read_profile(uuid)
  to service_role;
