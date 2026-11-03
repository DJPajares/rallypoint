-- Review fixes for ranked searches (WDL-421).
-- * An invite nobody answered ends as "unanswered", not "expired".
-- * When both doubles partners tap Search again, the second joins the
--   first's invite instead of sending another, so neither waits on the other.
-- * Searchers are locked strictly in id order.
-- * An invite link says only that it's closed to anyone outside the search,
--   and tells a directly invited partner it's for them (so they can decline).
--
-- Recovery: restore app.search_view, app.lock_searchers,
-- api.read_search_invite and api.restart_search from
-- 20261103110000_ranked_search.sql.

create or replace function app.lock_searchers(p_users uuid[]) returns void
language plpgsql security invoker set search_path = '' as $$
declare u uuid;
begin
  foreach u in array (select array_agg(distinct x order by x) from unnest(p_users) x where x is not null) loop
    perform pg_advisory_xact_lock(hashtextextended('ranked-search:' || u::text, 0));
  end loop;
end;
$$;

create or replace function app.search_view(s app.ranked_searches, p_actor uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'id', s.id, 'format', s.format,
    'state', case when app.search_active(s) then s.state else 'ended' end,
    'endReason', case when app.search_active(s) then null
      when s.state in ('cancelled', 'declined') then s.state
      when s.started_at is null then 'unanswered' else 'expired' end,
    'endsAt', s.ends_at,
    'role', case when s.starter_id = p_actor then 'starter' else 'partner' end,
    'areas', app.search_areas_json(s.areas),
    'courts', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by u.n)
      from unnest(s.courts) with ordinality u(id, n) join app.courts c on c.id = u.id), '[]'::jsonb),
    'windows', to_jsonb(s.windows),
    'partner', app.search_person(case when s.starter_id = p_actor then s.partner_id else s.starter_id end),
    'inviteToken', case when s.starter_id = p_actor and s.state = 'waiting_partner' and app.search_active(s)
      then s.invite_token end);
$$;

create or replace function api.read_search_invite(p_actor_id uuid, p_token uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('invite',
    case when s.state = 'waiting_partner' and app.search_active(s)
        or s.starter_id = p_actor_id or s.partner_id = p_actor_id
      then jsonb_build_object('token', s.invite_token,
        'starterName', app.search_person(s.starter_id)->>'name', 'format', s.format,
        'areas', app.search_areas_json(s.areas), 'endsAt', s.ends_at,
        'open', s.state = 'waiting_partner' and app.search_active(s),
        'own', s.starter_id = p_actor_id,
        'direct', not s.invite_by_link and s.partner_id = p_actor_id)
      else jsonb_build_object('open', false) end)
  from app.ranked_searches s
  where p_actor_id is not null and s.invite_token = p_token
    and (s.invite_by_link or s.partner_id = p_actor_id or s.starter_id = p_actor_id);
$$;

create or replace function api.restart_search(p_actor_id uuid, p_key uuid, p_search uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare s app.ranked_searches; payload jsonb := jsonb_build_object('search', p_search);
  other uuid; result_id uuid;
begin
  if p_actor_id is null then raise insufficient_privilege; end if;
  if app.search_receipt(p_actor_id, p_key, 'restart_search', payload) is not null then
    return jsonb_build_object('operationKey', p_key) || api.read_my_search(p_actor_id);
  end if;
  select * into s from app.ranked_searches where id = p_search
    and (starter_id = p_actor_id or (partner_id = p_actor_id and started_at is not null));
  if not found then raise sqlstate 'P0001' using message = 'search_not_found'; end if;
  perform app.lock_searchers(array[p_actor_id]);
  if app.active_search_of(p_actor_id) is not null then
    raise sqlstate 'P0001' using message = 'search_active';
  end if;
  other := case when s.starter_id = p_actor_id then s.partner_id else s.starter_id end;
  -- The other one already tapped Search again: join their invite instead of
  -- sending a second one, so neither ends up waiting on the other.
  if s.format = 'doubles' and other is not null then
    perform app.lock_searchers(array[p_actor_id, other]);
    select id into result_id from app.ranked_searches r
      where r.starter_id = other and r.partner_id = p_actor_id and r.state = 'waiting_partner'
        and r.restarted_from = s.id and app.search_active(r)
      for update;
    if result_id is not null then
      update app.ranked_searches set state = 'searching', started_at = now(),
        ends_at = now() + interval '7 days' where id = result_id;
      insert into app.operation_receipts values (p_actor_id, p_key, 'restart_search', payload, result_id, now());
      return jsonb_build_object('operationKey', p_key) || api.read_my_search(p_actor_id);
    end if;
  end if;
  insert into app.ranked_searches(format, starter_id, partner_id, invite_token, invite_by_link, state,
      areas, courts, windows, started_at, ends_at, restarted_from)
    values (s.format, p_actor_id, case when s.format = 'doubles' then other end,
      case when s.format = 'doubles' then gen_random_uuid() end,
      s.format = 'doubles' and other is null,
      case when s.format = 'doubles' then 'waiting_partner' else 'searching' end,
      s.areas, array(select c from unnest(s.courts) c where exists (select 1 from app.courts where id = c)),
      s.windows, case when s.format = 'singles' then now() end,
      now() + case when s.format = 'doubles' then interval '48 hours' else interval '7 days' end, s.id)
    returning id into result_id;
  insert into app.operation_receipts values (p_actor_id, p_key, 'restart_search', payload, result_id, now());
  return jsonb_build_object('operationKey', p_key) || api.read_my_search(p_actor_id);
end;
$$;
