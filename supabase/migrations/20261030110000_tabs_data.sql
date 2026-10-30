-- Home, Sessions and Groups redesign (owner, 2026-10-30). Read-only additions:
-- - each of your groups carries its member count;
-- - each of your session rows carries its place, and a session you run that
--   hasn't started carries how many parties wait and how many still owe.
-- Everything here is already visible to the same person on the group or
-- session page.

create or replace function api.list_my_groups(p_actor_id uuid) returns jsonb
language sql stable set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name,
      'role', case r.role when 'owner' then 'admin' else 'member' end, 'visibility', g.visibility,
      'memberCount', (select count(*) from app.group_roles m where m.group_id = g.id))
    order by g.name), '[]'::jsonb)
  from app.groups g join app.group_roles r on r.group_id = g.id
  where r.user_id = p_actor_id and g.archived_at is null and g.kind = 'community';
$$;

alter function api.list_my_sessions(uuid) rename to list_my_sessions_before_tabs;
alter function api.list_my_sessions_before_tabs(uuid) set schema app;
create function api.list_my_sessions(p_actor_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
  result:=app.list_my_sessions_before_tabs(p_actor_id);
  return result||jsonb_build_object(
    'upcoming',(select coalesce(jsonb_agg(app.my_session_extras(x) order by n),'[]'::jsonb)
      from jsonb_array_elements(result->'upcoming') with ordinality u(x,n)),
    'past',(select coalesce(jsonb_agg(app.my_session_extras(x) order by n),'[]'::jsonb)
      from jsonb_array_elements(result->'past') with ordinality u(x,n)));
end;
$$;

create function app.my_session_extras(p_row jsonb) returns jsonb
language sql stable security invoker set search_path='' as $$
  select p_row||jsonb_build_object('location',coalesce(s.details->>'location',''))
    ||case when p_row->>'status'='organizing' and s.state='published'
        and (s.details->>'startsAt')::timestamptz>now() then
      jsonb_build_object(
        'waitingCount',(select count(*) from app.parties w where w.session_id=s.id and w.state='waitlisted'),
        'toPayCount',case when coalesce(s.details->>'paymentMode','organizer')='organizer' then
          (select count(*) from app.parties p join app.fee_obligations f on f.party_id=p.id
            where p.session_id=s.id and p.state='confirmed' and f.liability_state='due'
              and not f.marked_paid and f.total_minor>0) else 0 end)
      else '{}'::jsonb end
  from app.sessions s where s.slug=(p_row->>'slug')::uuid;
$$;

revoke all on function app.list_my_sessions_before_tabs(uuid),api.list_my_sessions(uuid),app.my_session_extras(jsonb)
  from public,anon,authenticated;
grant execute on function app.list_my_sessions_before_tabs(uuid),api.list_my_sessions(uuid),app.my_session_extras(jsonb)
  to service_role;
