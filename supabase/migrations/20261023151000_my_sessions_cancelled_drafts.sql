-- A draft that was cancelled never had a public page or a start time, so it
-- would sit in Coming up forever linking to a page that is not there. Leave it
-- out, and never list a draft through a party.
create or replace function api.list_my_sessions(p_actor_id uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare result jsonb;
begin
  with mine as (
    select s.id, s.slug, s.state, s.details, g.name as group_name,
      exists (select 1 from app.group_roles r
        where r.group_id = s.group_id and r.user_id = p_actor_id
          and r.role in ('owner', 'organizer', 'cohost')) as manages,
      (select p.state from app.parties p
        where p.session_id = s.id and p.user_id = p_actor_id
          and p.state in ('confirmed', 'waitlisted')
        order by p.queue_sequence desc limit 1) as party_state,
      (select p.queue_sequence from app.parties p
        where p.session_id = s.id and p.user_id = p_actor_id
          and p.state in ('confirmed', 'waitlisted')
        order by p.queue_sequence desc limit 1) as party_sequence
    from app.sessions s join app.groups g on g.id = s.group_id
    where (exists (select 1 from app.group_roles r
        where r.group_id = s.group_id and r.user_id = p_actor_id
          and r.role in ('owner', 'organizer', 'cohost'))
      or (s.state <> 'draft' and exists (select 1 from app.parties p
        where p.session_id = s.id and p.user_id = p_actor_id
          and p.state in ('confirmed', 'waitlisted'))))
      and not exists (select 1 from app.session_cancellations c
        where c.session_id = s.id and c.previous_state = 'draft')
  ), shaped as (
    select m.*,
      case when m.state = 'cancelled' then 'cancelled'
        when m.state = 'draft' then 'draft'
        when m.manages then 'organizing'
        when m.party_state = 'confirmed' then 'in'
        else 'waitlisted' end as status,
      (m.details->>'startsAt')::timestamptz as starts_at,
      (m.details->>'endsAt')::timestamptz as ends_at
    from mine m
  ), rows_ as (
    select x.*,
      case when x.state = 'draft' then false
        when x.state = 'cancelled' then coalesce(x.starts_at <= now(), false)
        else coalesce(x.ends_at <= now(), false) end as over,
      jsonb_build_object(
        'id', case when x.state = 'draft' then x.id else null end,
        'slug', x.slug,
        'title', x.details->>'title',
        'groupName', x.group_name,
        'startLocal', coalesce(x.details->>'startLocal', ''),
        'startsAt', x.details->>'startsAt',
        'endsAt', x.details->>'endsAt',
        'timeZone', x.details->>'timeZone',
        'state', x.state,
        'status', x.status,
        'waitPosition', case when x.status = 'waitlisted' then
          (select count(*) + 1 from app.parties w
            where w.session_id = x.id and w.state = 'waitlisted'
              and w.queue_sequence < x.party_sequence) else null end
      ) as item
    from shaped x
  )
  select jsonb_build_object(
    'upcoming', coalesce((select jsonb_agg(u.item order by u.starts_at asc nulls last, u.item->>'title') from (
      select item, starts_at from rows_ where not over
      order by starts_at asc nulls last, item->>'title' limit 100) u), '[]'::jsonb),
    'past', coalesce((select jsonb_agg(q.item order by q.starts_at desc) from (
      select item, starts_at from rows_ where over
      order by starts_at desc limit 20) q), '[]'::jsonb),
    'pastTotal', (select count(*) from rows_ where over)
  ) into result;
  return result;
end;
$$;
revoke all on function api.list_my_sessions(uuid) from public, anon, authenticated;
grant execute on function api.list_my_sessions(uuid) to service_role;
