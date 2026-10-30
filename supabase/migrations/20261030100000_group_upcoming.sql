-- Group page redesign (owner, 2026-10-30): a group's admin and members see
-- the next sessions an organizer opened to the group through a private
-- session's access list (P-36). Only the title, activity and start; nobody
-- outside the group gets them. Never more than five.

alter function api.read_group(uuid,uuid,uuid) rename to read_group_before_upcoming;
alter function api.read_group_before_upcoming(uuid,uuid,uuid) set schema app;
create function api.read_group(p_actor_id uuid,p_group_id uuid,p_invite uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
  result:=app.read_group_before_upcoming(p_actor_id,p_group_id,p_invite);
  if result->>'viewerRole' is not null then
    result:=result||jsonb_build_object('upcoming',(select coalesce(jsonb_agg(jsonb_build_object(
        'slug',x.slug,'title',x.details->>'title','activity',coalesce(x.details->>'activity',''),
        'startsAt',x.details->>'startsAt','timeZone',x.details->>'timeZone')
        order by (x.details->>'startsAt')::timestamptz,x.id),'[]'::jsonb)
      from (select s.* from app.session_access a join app.sessions s on s.id=a.session_id
        where a.group_id=p_group_id and s.state='published'
          and (s.details->>'endsAt')::timestamptz>now()
        order by (s.details->>'startsAt')::timestamptz,s.id limit 5) x));
  end if;
  return result;
end;
$$;

revoke all on function app.read_group_before_upcoming(uuid,uuid,uuid),api.read_group(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function app.read_group_before_upcoming(uuid,uuid,uuid),api.read_group(uuid,uuid,uuid)
  to service_role;
