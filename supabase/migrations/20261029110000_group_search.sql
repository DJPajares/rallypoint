-- P-37 / WDL-416: signed-in people find groups by name. Discovery covers
-- groups only. A public group, or one you're in, shows its id so its page
-- opens; a private group you're not in shows only its name and that it's
-- private. No counts or members, and at most 20 results per search.

create function api.search_groups(p_actor_id uuid,p_query text) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare q text:=lower(btrim(coalesce(p_query,'')));
begin
  if char_length(q) not between 2 and 40 then raise check_violation using message='invalid_input'; end if;
  return coalesce((select jsonb_agg(x.j order by x.n) from (
    select row_number() over (order by left(lower(g.name),char_length(q))<>q,g.name,g.id) n,
      case when g.visibility='public' or r.role is not null then
        jsonb_build_object('id',g.id,'name',g.name,'visibility',g.visibility,
          'viewerRole',case r.role when 'owner' then 'admin' when 'member' then 'member' end)
      else jsonb_build_object('name',g.name,'visibility',g.visibility) end j
    from app.groups g
    left join app.group_roles r on r.group_id=g.id and r.user_id=p_actor_id
    where g.kind='community' and g.archived_at is null
      and position(q in lower(g.name))>0
    order by 1 limit 20) x),'[]'::jsonb);
end;
$$;

revoke all on function api.search_groups(uuid,text) from public,anon,authenticated;
grant execute on function api.search_groups(uuid,text) to service_role;
