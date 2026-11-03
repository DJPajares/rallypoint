-- Answering a ranked match (D-26, WDL-422). Everyone in a proposed match
-- accepts within 48 hours; then it is confirmed. A decline ends the
-- decliner's search (with their partner's: a doubles team searches together)
-- and puts the other side back in the queue. A lapsed proposal puts back each
-- side whose players all accepted and ends the others' searches. Nobody is
-- penalised. Going back keeps the original wait and gives back the time the
-- proposal took. After 3 days unmatched a player may widen the search to the
-- regions of their areas; it never widens by itself.
--
-- Recovery: restore api.run_matchmaking from 20261103120000_ranked_matching.sql,
-- app.search_view, api.read_my_search and api.read_operation from
-- 20261103110000_ranked_search.sql / 20261103111000_ranked_search_review_fixes.sql, then
--   drop function api.answer_match(uuid,uuid,uuid,boolean), api.widen_search(uuid,uuid,uuid),
--     app.match_view(app.ranked_matches,uuid), app.requeue_side(uuid,smallint), app.end_side(uuid,smallint);

-- Back in the queue: same wait, and the days spent on the proposal given back.
create function app.requeue_side(p_match uuid, p_side smallint) returns void
language sql security invoker set search_path = '' as $$
  update app.ranked_searches s set state = 'searching', ends_at = s.ends_at + (now() - s.matched_at),
      match_id = null, matched_at = null
    where s.state = 'matched' and s.id in (select p.search_id from app.ranked_match_players p
      where p.match_id = p_match and p.side = p_side);
  update app.ranked_match_players set released_at = now()
    where match_id = p_match and side = p_side and released_at is null;
$$;

create function app.end_side(p_match uuid, p_side smallint) returns void
language sql security invoker set search_path = '' as $$
  update app.ranked_searches s set state = 'cancelled', ended_at = now()
    where s.state = 'matched' and s.id in (select p.search_id from app.ranked_match_players p
      where p.match_id = p_match and p.side = p_side);
  update app.ranked_match_players set released_at = now()
    where match_id = p_match and side = p_side and released_at is null;
$$;

-- A match as one of its players sees it: names and answers, never ratings.
create function app.match_view(m app.ranked_matches, p_actor uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('id', m.id, 'format', m.format,
    'state', case when m.state = 'proposed' and m.respond_by <= now() then 'expired' else m.state end,
    'area', (select jsonb_build_object('key', a.key, 'label', coalesce(a.everyday_name, a.name))
      from app.areas a where a.key = m.area_key),
    'court', (select jsonb_build_object('id', c.id, 'name', c.name, 'mapsUrl', c.maps_url)
      from app.courts c where c.id = m.court_id),
    'window', m.time_window,
    'respondBy', m.respond_by,
    'players', (select jsonb_agg(app.search_person(p.user_id) || jsonb_build_object(
        'side', case when p.side = me.side then 'yours' else 'theirs' end,
        'accepted', p.answer is not null, 'you', p.user_id = p_actor)
      order by p.side <> me.side, p.user_id <> p_actor, p.user_id)
      from app.ranked_match_players p where p.match_id = m.id),
    'myAnswer', me.answer)
  from app.ranked_match_players me where me.match_id = m.id and me.user_id = p_actor;
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
      then s.invite_token end,
    'wide', s.wide,
    'canWiden', s.state = 'searching' and app.search_active(s) and not s.wide
      and s.started_at <= now() - interval '3 days',
    'regions', (select coalesce(jsonb_agg(r.name order by r.sort_order), '[]'::jsonb) from app.regions r
      where r.key in (select a.region_key from app.areas a where a.key = any(s.areas))));
$$;

create or replace function api.read_my_search(p_actor_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'search', (select app.search_view(s, p_actor_id) from app.ranked_searches s
      where s.starter_id = p_actor_id or (s.partner_id = p_actor_id and s.started_at is not null)
      order by app.search_active(s) desc, s.created_at desc limit 1),
    'invites', coalesce((select jsonb_agg(jsonb_build_object('token', s.invite_token,
        'starterName', app.search_person(s.starter_id)->>'name', 'format', s.format,
        'areas', app.search_areas_json(s.areas), 'endsAt', s.ends_at) order by s.created_at)
      from app.ranked_searches s
      where s.partner_id = p_actor_id and s.state = 'waiting_partner' and app.search_active(s)), '[]'::jsonb),
    'match', (select app.match_view(m, p_actor_id) from app.ranked_match_players p
      join app.ranked_matches m on m.id = p.match_id
      where p.user_id = p_actor_id and p.released_at is null limit 1));
$$;

-- Accept or decline a proposed match.
create function api.answer_match(p_actor_id uuid, p_key uuid, p_match uuid, p_accept boolean) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare m app.ranked_matches; me app.ranked_match_players;
  payload jsonb := jsonb_build_object('match', p_match, 'accept', p_accept);
begin
  if p_actor_id is null then raise insufficient_privilege; end if;
  if p_accept is null then raise check_violation using message = 'invalid_input'; end if;
  if app.search_receipt(p_actor_id, p_key, 'answer_match', payload) is not null then
    return jsonb_build_object('operationKey', p_key) || api.read_my_search(p_actor_id);
  end if;
  if not exists (select 1 from app.ranked_match_players where match_id = p_match and user_id = p_actor_id) then
    raise sqlstate 'P0001' using message = 'match_not_found';
  end if;
  perform app.lock_searchers(array(select user_id from app.ranked_match_players where match_id = p_match));
  select * into m from app.ranked_matches where id = p_match for update;
  select * into me from app.ranked_match_players where match_id = p_match and user_id = p_actor_id;
  if m.state <> 'proposed' or m.respond_by <= now() or me.released_at is not null then
    raise sqlstate 'P0001' using message = 'proposal_closed';
  end if;
  if p_accept then
    update app.ranked_match_players set answer = 'accepted', answered_at = now()
      where match_id = p_match and user_id = p_actor_id and answer is null;
    if not exists (select 1 from app.ranked_match_players where match_id = p_match and answer is null) then
      update app.ranked_matches set state = 'confirmed', confirmed_at = now() where id = p_match;
    end if;
  else
    perform app.end_side(p_match, me.side);
    perform app.requeue_side(p_match, (3 - me.side)::smallint);
    update app.ranked_matches set state = 'cancelled', end_reason = 'declined', ended_at = now()
      where id = p_match;
  end if;
  insert into app.operation_receipts values (p_actor_id, p_key, 'answer_match', payload, p_match, now());
  return jsonb_build_object('operationKey', p_key) || api.read_my_search(p_actor_id);
end;
$$;

-- After 3 days without a match, look across the regions of the chosen areas.
create function api.widen_search(p_actor_id uuid, p_key uuid, p_search uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare s app.ranked_searches; payload jsonb := jsonb_build_object('search', p_search);
begin
  if p_actor_id is null then raise insufficient_privilege; end if;
  if app.search_receipt(p_actor_id, p_key, 'widen_search', payload) is not null then
    return jsonb_build_object('operationKey', p_key) || api.read_my_search(p_actor_id);
  end if;
  select * into s from app.ranked_searches where id = p_search
    and (starter_id = p_actor_id or (partner_id = p_actor_id and started_at is not null)) for update;
  if not found then raise sqlstate 'P0001' using message = 'search_not_found'; end if;
  if s.state <> 'searching' or not app.search_active(s) or s.wide
    or s.started_at > now() - interval '3 days' then
    raise sqlstate 'P0001' using message = 'cannot_widen';
  end if;
  update app.ranked_searches set wide = true where id = s.id;
  insert into app.operation_receipts values (p_actor_id, p_key, 'widen_search', payload, s.id, now());
  return jsonb_build_object('operationKey', p_key) || api.read_my_search(p_actor_id);
end;
$$;

create or replace function api.run_matchmaking(p_limit integer) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare e app.ranked_engine; ids uuid[]; i integer; touched integer := 0; proposed integer := 0;
  a app.ranked_searches; b app.ranked_searches; first app.ranked_searches; second app.ranked_searches;
  last_at timestamptz; last_id uuid; u uuid; locked boolean; v_area text; v_court uuid; v_match uuid;
  m app.ranked_matches; v_side smallint; expired integer := 0;
begin
  if p_limit is null or p_limit < 1 then raise check_violation using message = 'invalid_input'; end if;
  if not pg_try_advisory_xact_lock(hashtextextended('ranked-matchmaking', 0)) then
    return jsonb_build_object('ran', false, 'proposed', 0, 'expired', 0);
  end if;
  select * into e from app.ranked_engine where id = 1 for update;
  -- Lapsed proposals first, so whoever goes back can be paired in this pass.
  for m in select * from app.ranked_matches where state = 'proposed' and respond_by <= now()
      order by respond_by limit p_limit for update skip locked loop
    locked := true;
    foreach u in array array(select p.user_id from app.ranked_match_players p where p.match_id = m.id) loop
      if not pg_try_advisory_xact_lock(hashtextextended('ranked-search:' || u::text, 0)) then
        locked := false; exit;
      end if;
    end loop;
    continue when not locked;
    foreach v_side in array array[1, 2]::smallint[] loop
      if exists (select 1 from app.ranked_match_players p
          where p.match_id = m.id and p.side = v_side and p.answer is null) then
        perform app.end_side(m.id, v_side);
      else
        perform app.requeue_side(m.id, v_side);
      end if;
    end loop;
    update app.ranked_matches set state = 'cancelled', end_reason = 'expired', ended_at = now() where id = m.id;
    expired := expired + 1;
  end loop;
  -- After the cursor first, then from the start: everyone is reached in turn.
  select array_agg(x.id order by x.wrapped, x.started_at, x.id) into ids from (
    select s.id, s.started_at, coalesce((s.started_at, s.id) <= (e.cursor_started_at, e.cursor_id), false) as wrapped
    from app.ranked_searches s
    where s.state = 'searching' and s.started_at is not null and s.ends_at > now()
    order by 3, s.started_at, s.id limit p_limit) x;

  for i in 1 .. coalesce(cardinality(ids), 0) loop
    exit when touched >= p_limit;
    select * into a from app.ranked_searches where id = ids[i];
    last_at := a.started_at; last_id := a.id;
    continue when a.state <> 'searching' or not app.search_active(a);
    touched := touched + 1;
    select s.* into b from app.ranked_searches s
    where s.id <> a.id and s.activity_key = a.activity_key and s.format = a.format
      and s.state = 'searching' and s.started_at is not null and s.ends_at > now()
      and app.search_reach(s) && app.search_reach(a)
      and (cardinality(s.windows) = 0 or cardinality(a.windows) = 0 or s.windows && a.windows)
      and abs(app.search_skill(s) - app.search_skill(a)) <= greatest(app.search_band(s), app.search_band(a))
      and not app.met_recently(app.search_users(a), app.search_users(s))
    order by s.started_at, s.id limit 1;
    continue when not found;
    -- Never wait on a person: someone mid-action is simply tried next pass.
    locked := true;
    foreach u in array app.search_users(a) || app.search_users(b) loop
      if not pg_try_advisory_xact_lock(hashtextextended('ranked-search:' || u::text, 0)) then
        locked := false; exit;
      end if;
    end loop;
    continue when not locked;
    select * into a from app.ranked_searches where id = a.id for update;
    select * into b from app.ranked_searches where id = b.id for update;
    continue when a.state <> 'searching' or b.state <> 'searching'
      or not app.search_active(a) or not app.search_active(b);
    if (b.started_at, b.id) < (a.started_at, a.id) then first := b; second := a;
    else first := a; second := b; end if;
    select o_area, o_court into v_area, v_court from app.match_place(first, second);
    insert into app.ranked_matches(activity_key, format, area_key, court_id, time_window, respond_by)
      values (first.activity_key, first.format, v_area, v_court,
        app.match_window(first.windows, second.windows), now() + interval '48 hours')
      returning id into v_match;
    insert into app.ranked_match_players(match_id, user_id, side, search_id)
      select v_match, x, 1, first.id from unnest(app.search_users(first)) x
      union all
      select v_match, x, 2, second.id from unnest(app.search_users(second)) x;
    update app.ranked_searches set state = 'matched', match_id = v_match, matched_at = now()
      where id in (first.id, second.id);
    proposed := proposed + 1;
    touched := touched + 1;
  end loop;

  -- A full batch leaves a cursor; a short one means everyone was reached.
  if coalesce(cardinality(ids), 0) >= p_limit then
    update app.ranked_engine set cursor_started_at = last_at, cursor_id = last_id where id = 1;
  else
    update app.ranked_engine set cursor_started_at = null, cursor_id = null where id = 1;
  end if;
  return jsonb_build_object('ran', true, 'proposed', proposed, 'expired', expired);
end;
$$;

-- Recovery by key answers with the person's current search and match.
create or replace function api.read_operation(p_actor_id uuid,p_key uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r app.operation_receipts;
begin
  select * into r from app.operation_receipts where actor_id=p_actor_id and request_key=p_key;
  if r.action in ('start_search','answer_search_invite','cancel_search','restart_search',
      'answer_match','widen_search') then
    return jsonb_build_object('operationKey',p_key) || api.read_my_search(p_actor_id);
  end if;
  return app.read_operation_before_ranked_search(p_actor_id,p_key);
end;
$$;

revoke all on function app.requeue_side(uuid,smallint), app.end_side(uuid,smallint),
  app.match_view(app.ranked_matches,uuid), api.answer_match(uuid,uuid,uuid,boolean),
  api.widen_search(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function app.requeue_side(uuid,smallint), app.end_side(uuid,smallint),
  app.match_view(app.ranked_matches,uuid), api.answer_match(uuid,uuid,uuid,boolean),
  api.widen_search(uuid,uuid,uuid) to service_role;
