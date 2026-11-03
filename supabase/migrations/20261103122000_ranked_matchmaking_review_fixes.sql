-- Review fixes for ranked matchmaking (WDL-422).
-- 1. Someone who declines a match isn't shown the same opponents again for
--    7 days: a declined match blocks its two sides like a played one.
-- 2. People whose match fell through are told why: a search ended by a
--    match says who declined or that it ran out, and a search put back says
--    the last match was declined, ran out or wasn't booked (for a day).
-- 3. A match everyone accepted but nobody booked within 4 days lets everyone
--    search again with their place kept (spec: "nothing hangs forever").
--
-- Recovery: restore app.met_recently from 20261103120000_ranked_matching.sql and
-- app.search_view, api.answer_match and api.run_matchmaking from
-- 20261103121000_ranked_match_answers.sql, then
--   update app.ranked_matches set end_reason = 'expired' where end_reason = 'unbooked';
--   alter table app.ranked_matches drop column declined_by, drop constraint ranked_matches_end_reason_check,
--     add constraint ranked_matches_end_reason_check check (end_reason in ('declined', 'expired'));

alter table app.ranked_matches add column declined_by uuid references auth.users(id) on delete set null;
alter table app.ranked_matches drop constraint ranked_matches_end_reason_check;
alter table app.ranked_matches add constraint ranked_matches_end_reason_check
  check (end_reason in ('declined', 'expired', 'unbooked'));

create or replace function app.met_recently(p_a uuid[], p_b uuid[]) returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists (select 1 from app.ranked_results r where r.played_at > now() - interval '7 days'
      and (r.winners || r.losers) && p_a and (r.winners || r.losers) && p_b)
    or exists (select 1 from app.ranked_matches m
      join app.ranked_match_players pa on pa.match_id = m.id and pa.user_id = any(p_a)
      join app.ranked_match_players pb on pb.match_id = m.id and pb.user_id = any(p_b)
      where m.confirmed_at > now() - interval '7 days'
        or (m.end_reason = 'declined' and m.ended_at > now() - interval '7 days' and pa.side <> pb.side));
$$;

create or replace function app.search_view(s app.ranked_searches, p_actor uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'id', s.id, 'format', s.format,
    'state', case when app.search_active(s) then s.state else 'ended' end,
    'endReason', case when app.search_active(s) then null
      when s.state = 'cancelled' and s.match_id is not null then coalesce((select case
          when m.end_reason = 'declined' and m.declined_by = p_actor then 'declined_match'
          when m.end_reason = 'declined' then 'partner_declined_match'
          when m.end_reason = 'expired' then 'match_lapsed' end
        from app.ranked_matches m where m.id = s.match_id), 'cancelled')
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
    'returned', case when s.state = 'searching' and app.search_active(s) then (select case m.end_reason
        when 'declined' then 'declined' when 'expired' then 'lapsed' when 'unbooked' then 'unbooked' end
      from app.ranked_match_players p join app.ranked_matches m on m.id = p.match_id
      where p.search_id = s.id and p.user_id = p_actor and m.state = 'cancelled'
        and m.ended_at > now() - interval '1 day'
      order by m.ended_at desc limit 1) end,
    'wide', s.wide,
    'canWiden', s.state = 'searching' and app.search_active(s) and not s.wide
      and s.started_at <= now() - interval '3 days',
    'regions', (select coalesce(jsonb_agg(r.name order by r.sort_order), '[]'::jsonb) from app.regions r
      where r.key in (select a.region_key from app.areas a where a.key = any(s.areas))));
$$;

create or replace function api.answer_match(p_actor_id uuid, p_key uuid, p_match uuid, p_accept boolean) returns jsonb
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
    update app.ranked_matches set state = 'cancelled', end_reason = 'declined', ended_at = now(),
      declined_by = p_actor_id
      where id = p_match;
  end if;
  insert into app.operation_receipts values (p_actor_id, p_key, 'answer_match', payload, p_match, now());
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
  -- Not booked within 4 days of everyone accepting: everyone searches again.
  for m in select * from app.ranked_matches where state = 'confirmed' and confirmed_at <= now() - interval '4 days'
      order by confirmed_at limit p_limit for update skip locked loop
    locked := true;
    foreach u in array array(select p.user_id from app.ranked_match_players p where p.match_id = m.id) loop
      if not pg_try_advisory_xact_lock(hashtextextended('ranked-search:' || u::text, 0)) then
        locked := false; exit;
      end if;
    end loop;
    continue when not locked;
    perform app.requeue_side(m.id, 1::smallint);
    perform app.requeue_side(m.id, 2::smallint);
    update app.ranked_matches set state = 'cancelled', end_reason = 'unbooked', ended_at = now() where id = m.id;
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
