-- Level title fixes (WDL-405 review).
--
-- 1. Rosters ask for every person's title. Someone with no title now costs one
--    key lookup instead of a full badge evaluation; only a chosen badge is
--    evaluated, and only its levels are read.
--
-- 2. Complete recovery for 20261025100000_level_titles.sql (its header note was
--    cut off). The app is not launched; old choices are not kept. To roll back:
--    restore app.earned_badges, app.visible_title and api.set_my_title from
--    20261022170000_badges.sql, and api.read_my_badges and api.read_profile
--    from 20261025090000_badge_levels.sql (their latest definitions before
--    WDL-405), then map each badge back to its level-1 old title:
--      update app.user_titles set badge_id=case badge_id
--        when 'rally' then 'first-rally' when 'new-faces' then 'new-faces-10'
--        else badge_id end;  -- host, plus-one and full-house keep their ids
--      delete from app.user_titles where badge_id='steady';

create or replace function app.visible_title(p_user uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare chosen text; reached integer;
begin
  select badge_id into chosen from app.user_titles where user_id=p_user;
  if chosen is null then return null; end if;
  select max(l.level) into reached from app.badge_levels(p_user) l where l.badge=chosen;
  if reached is null then return null; end if;
  return jsonb_build_object('key',chosen,'level',reached);
end;
$$;

revoke all on function app.visible_title(uuid) from public,anon,authenticated;
grant execute on function app.visible_title(uuid) to service_role;
