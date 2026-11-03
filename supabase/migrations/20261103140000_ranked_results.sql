-- Ranked results (D-26, WDL-425). Once check-in closes (30 minutes after the
-- start), anyone who didn't check in decides the match: nobody there, or
-- someone missing on both sides, and it doesn't count; someone missing on
-- one side, and that side loses with no dispute (in doubles both partners
-- lose). Otherwise a checked-in player reports who won and a checked-in
-- player on the other side confirms or disputes within 48 hours; silence
-- confirms, a dispute voids it, and no report within 48 hours of the end
-- voids it. A finished result goes to the rating engine once, keyed by the
-- match, and is final. Either way every seat is released and both searches
-- end, saying how the match went. A no-show is never named publicly.
--
-- Recovery: restore api.run_matchmaking from 20261103130000_ranked_booking.sql,
-- app.search_view from 20261103131000_ranked_match_session.sql and app.match_view from
-- 20261103133000_ranked_booking_review_fixes.sql, then
--   drop function api.report_result(uuid,uuid,uuid,boolean), api.answer_result(uuid,uuid,uuid,boolean),
--     app.settle_presence(uuid), app.finish_match(uuid,smallint,text), app.void_match(uuid,text),
--     app.close_match(uuid), app.result_open(uuid,uuid);
--   (finished matches keep their state; their ratings stay applied)
--   alter table app.ranked_matches drop column presence_settled_at, drop column reported_side,
--     drop column reported_winner, drop column reported_at, drop column confirm_by,
--     drop column winner_side, drop column finished_at;

alter table app.ranked_matches
  add column presence_settled_at timestamptz,
  add column reported_side smallint check (reported_side in (1, 2)),
  add column reported_winner smallint check (reported_winner in (1, 2)),
  add column reported_at timestamptz,
  add column confirm_by timestamptz,
  add column winner_side smallint check (winner_side in (1, 2)),
  add column finished_at timestamptz;
alter table app.ranked_matches drop constraint ranked_matches_state_check;
alter table app.ranked_matches add constraint ranked_matches_state_check
  check (state in ('proposed', 'confirmed', 'cancelled', 'completed', 'void'));
alter table app.ranked_matches drop constraint ranked_matches_end_reason_check;
alter table app.ranked_matches add constraint ranked_matches_end_reason_check
  check (end_reason in ('declined', 'expired', 'unbooked', 'withdrawn', 'disputed', 'unreported', 'absent'));

-- Every seat let go and both searches ended; the match stays on the search
-- so the Ranked page can say how it went.
create function app.close_match(p_match uuid) returns void
language sql security invoker set search_path = '' as $$
  update app.ranked_searches set state = 'cancelled', ended_at = now()
    where match_id = p_match and state = 'matched';
  update app.ranked_match_players set released_at = now() where match_id = p_match and released_at is null;
$$;

-- A finished match: its result goes to the rating engine once (keyed by the match).
create function app.finish_match(p_match uuid, p_winner smallint, p_reason text) returns void
language plpgsql security invoker set search_path = '' as $$
declare m app.ranked_matches; played timestamptz;
begin
  select * into m from app.ranked_matches where id = p_match for update;
  if m.state <> 'confirmed' then return; end if;
  select (details->>'startsAt')::timestamptz into played from app.sessions where id = m.session_id;
  perform app.apply_ranked_result(m.id, m.activity_key, m.format,
    array(select user_id from app.ranked_match_players where match_id = m.id and side = p_winner order by user_id),
    array(select user_id from app.ranked_match_players where match_id = m.id and side <> p_winner order by user_id),
    played);
  update app.ranked_matches set state = 'completed', winner_side = p_winner, end_reason = p_reason,
    finished_at = now(), ended_at = now(), presence_settled_at = coalesce(presence_settled_at, now())
    where id = m.id;
  perform app.close_match(m.id);
end;
$$;

-- A match that doesn't count: no rating changes for anyone.
create function app.void_match(p_match uuid, p_reason text) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  update app.ranked_matches set state = 'void', end_reason = p_reason, finished_at = now(), ended_at = now(),
    presence_settled_at = coalesce(presence_settled_at, now())
    where id = p_match and state = 'confirmed';
  if found then perform app.close_match(p_match); end if;
end;
$$;

-- Check-in has closed: absences decide the match, or everyone is there.
create function app.settle_presence(p_match uuid) returns void
language plpgsql security invoker set search_path = '' as $$
declare m app.ranked_matches; starts timestamptz; missing_1 integer; missing_2 integer; present integer;
begin
  select * into m from app.ranked_matches where id = p_match for update;
  if m.state <> 'confirmed' or m.session_id is null or m.presence_settled_at is not null then return; end if;
  select (details->>'startsAt')::timestamptz into starts from app.sessions where id = m.session_id;
  if now() <= starts + interval '30 minutes' then return; end if;
  select count(*) filter (where side = 1 and not here), count(*) filter (where side = 2 and not here),
      count(*) filter (where here)
    into missing_1, missing_2, present
    from (select p.side, app.match_checked_in(m.session_id, p.user_id) as here
      from app.ranked_match_players p where p.match_id = m.id) x;
  if present = 0 or (missing_1 > 0 and missing_2 > 0) then
    perform app.void_match(m.id, 'absent');
  elsif missing_1 > 0 then
    perform app.finish_match(m.id, 2::smallint, 'absent');
  elsif missing_2 > 0 then
    perform app.finish_match(m.id, 1::smallint, 'absent');
  else
    update app.ranked_matches set presence_settled_at = now() where id = m.id;
  end if;
end;
$$;

-- Shared opening checks for reporting and answering; returns the locked match.
create function app.result_open(p_actor uuid, p_match uuid) returns app.ranked_matches
language plpgsql security invoker set search_path = '' as $$
declare m app.ranked_matches; starts timestamptz;
begin
  if not exists (select 1 from app.ranked_match_players where match_id = p_match and user_id = p_actor) then
    raise sqlstate 'P0001' using message = 'match_not_found';
  end if;
  perform app.lock_searchers(array(select user_id from app.ranked_match_players where match_id = p_match));
  select * into m from app.ranked_matches where id = p_match for update;
  if m.state in ('completed', 'void') then raise sqlstate 'P0001' using message = 'result_settled'; end if;
  if m.state <> 'confirmed' or m.session_id is null then
    raise sqlstate 'P0001' using message = 'result_not_open';
  end if;
  select (details->>'startsAt')::timestamptz into starts from app.sessions where id = m.session_id;
  if now() <= starts + interval '30 minutes' then
    raise sqlstate 'P0001' using message = 'result_not_open';
  end if;
  return m;
end;
$$;

-- "We won" or "we lost". The other side reporting the same winner confirms
-- it; a different winner is a dispute.
create function api.report_result(p_actor_id uuid, p_key uuid, p_match uuid, p_won boolean) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare m app.ranked_matches; v_side smallint; winner smallint;
  payload jsonb := jsonb_build_object('match', p_match, 'won', p_won);
begin
  if p_actor_id is null then raise insufficient_privilege; end if;
  if p_won is null then raise check_violation using message = 'invalid_input'; end if;
  if app.search_receipt(p_actor_id, p_key, 'report_result', payload) is not null then
    return jsonb_build_object('operationKey', p_key) || api.read_my_search(p_actor_id);
  end if;
  m := app.result_open(p_actor_id, p_match);
  perform app.settle_presence(m.id);
  select * into m from app.ranked_matches where id = p_match;
  -- An absence settled it just now: that stands, and the report doesn't.
  if m.state <> 'confirmed' then
    return jsonb_build_object('settledFirst', true) || api.read_my_search(p_actor_id);
  end if;
  if not app.match_checked_in(m.session_id, p_actor_id) then
    raise sqlstate 'P0001' using message = 'not_checked_in';
  end if;
  select side into v_side from app.ranked_match_players where match_id = m.id and user_id = p_actor_id;
  winner := case when p_won then v_side else 3 - v_side end;
  if m.reported_side is null then
    update app.ranked_matches set reported_side = v_side, reported_winner = winner, reported_at = now(),
      confirm_by = now() + interval '48 hours' where id = m.id;
  elsif m.reported_side = v_side then
    raise sqlstate 'P0001' using message = 'already_reported';
  elsif m.reported_winner = winner then
    perform app.finish_match(m.id, winner, null);
  else
    perform app.void_match(m.id, 'disputed');
  end if;
  insert into app.operation_receipts values (p_actor_id, p_key, 'report_result', payload, m.id, now());
  return jsonb_build_object('operationKey', p_key) || api.read_my_search(p_actor_id);
end;
$$;

-- The other side confirms the report, or disputes it (then it doesn't count).
create function api.answer_result(p_actor_id uuid, p_key uuid, p_match uuid, p_agree boolean) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare m app.ranked_matches; v_side smallint;
  payload jsonb := jsonb_build_object('match', p_match, 'agree', p_agree);
begin
  if p_actor_id is null then raise insufficient_privilege; end if;
  if p_agree is null then raise check_violation using message = 'invalid_input'; end if;
  if app.search_receipt(p_actor_id, p_key, 'answer_result', payload) is not null then
    return jsonb_build_object('operationKey', p_key) || api.read_my_search(p_actor_id);
  end if;
  m := app.result_open(p_actor_id, p_match);
  perform app.settle_presence(m.id);
  select * into m from app.ranked_matches where id = p_match;
  if m.state <> 'confirmed' then
    return jsonb_build_object('settledFirst', true) || api.read_my_search(p_actor_id);
  end if;
  select side into v_side from app.ranked_match_players where match_id = m.id and user_id = p_actor_id;
  if m.reported_side is null or m.reported_side = v_side then
    raise sqlstate 'P0001' using message = 'nothing_to_answer';
  end if;
  if not app.match_checked_in(m.session_id, p_actor_id) then
    raise sqlstate 'P0001' using message = 'not_checked_in';
  end if;
  if p_agree then
    perform app.finish_match(m.id, m.reported_winner, null);
  else
    perform app.void_match(m.id, 'disputed');
  end if;
  insert into app.operation_receipts values (p_actor_id, p_key, 'answer_result', payload, m.id, now());
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
  for m in select * from app.ranked_matches where state = 'confirmed' and session_id is null and confirmed_at <= now() - interval '4 days'
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
  -- Check-in has closed: an absence decides the match, or a result is due.
  for m in select rm.* from app.ranked_matches rm join app.sessions s on s.id = rm.session_id
      where rm.state = 'confirmed' and rm.presence_settled_at is null
        and (s.details->>'startsAt')::timestamptz + interval '30 minutes' < now()
      order by rm.confirmed_at limit p_limit for update of rm skip locked loop
    locked := true;
    foreach u in array array(select p.user_id from app.ranked_match_players p where p.match_id = m.id) loop
      if not pg_try_advisory_xact_lock(hashtextextended('ranked-search:' || u::text, 0)) then
        locked := false; exit;
      end if;
    end loop;
    continue when not locked;
    perform app.settle_presence(m.id);
  end loop;
  -- A report nobody answered within 48 hours stands.
  for m in select * from app.ranked_matches where state = 'confirmed' and reported_side is not null
      and confirm_by <= now() order by confirm_by limit p_limit for update skip locked loop
    locked := true;
    foreach u in array array(select p.user_id from app.ranked_match_players p where p.match_id = m.id) loop
      if not pg_try_advisory_xact_lock(hashtextextended('ranked-search:' || u::text, 0)) then
        locked := false; exit;
      end if;
    end loop;
    continue when not locked;
    perform app.finish_match(m.id, m.reported_winner, null);
  end loop;
  -- Nobody reported within 48 hours of the session's end: it doesn't count.
  for m in select rm.* from app.ranked_matches rm join app.sessions s on s.id = rm.session_id
      where rm.state = 'confirmed' and rm.presence_settled_at is not null and rm.reported_side is null
        and (s.details->>'endsAt')::timestamptz + interval '48 hours' <= now()
      order by rm.confirmed_at limit p_limit for update of rm skip locked loop
    locked := true;
    foreach u in array array(select p.user_id from app.ranked_match_players p where p.match_id = m.id) loop
      if not pg_try_advisory_xact_lock(hashtextextended('ranked-search:' || u::text, 0)) then
        locked := false; exit;
      end if;
    end loop;
    continue when not locked;
    perform app.void_match(m.id, 'unreported');
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

create or replace function app.search_view(s app.ranked_searches, p_actor uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'id', s.id, 'format', s.format,
    'state', case when app.search_active(s) then s.state else 'ended' end,
    'endReason', case when app.search_active(s) then null
      when s.state = 'cancelled' and s.match_id is not null then coalesce((select case
          when m.state = 'completed' and m.winner_side = (select x.side from app.ranked_match_players x
            where x.match_id = m.id and x.user_id = p_actor) then 'match_won'
          when m.state = 'completed' and not app.match_checked_in(m.session_id, p_actor) then 'match_missed'
          when m.state = 'completed' then 'match_lost'
          when m.state = 'void' then 'match_void'
          when m.end_reason = 'declined' and m.declined_by = p_actor then 'declined_match'
          when m.end_reason = 'declined' then 'partner_declined_match'
          when m.end_reason = 'expired' then 'match_lapsed'
          when m.end_reason = 'withdrawn' and m.ended_by = p_actor then 'withdrew_match'
          when m.end_reason = 'withdrawn' then 'partner_withdrew_match' end
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
        when 'declined' then 'declined' when 'expired' then 'lapsed' when 'unbooked' then 'unbooked'
        when 'withdrawn' then 'withdrawn' end
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

create or replace function app.match_view(m app.ranked_matches, p_actor uuid) returns jsonb
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
        'accepted', p.answer is not null, 'you', p.user_id = p_actor,
        'checkedIn', app.match_checked_in(m.session_id, p.user_id))
      order by p.side <> me.side, p.user_id <> p_actor, p.user_id)
      from app.ranked_match_players p where p.match_id = m.id),
    'myAnswer', me.answer,
    'booking', case when m.state = 'confirmed' then jsonb_build_object(
      'state', case when m.session_id is not null then 'booked'
        when m.booker_id is not null and m.claim_until > now() then 'claimed' else 'open' end,
      'bookerName', case when m.session_id is not null or m.claim_until > now()
        then app.search_person(m.booker_id)->>'name' end,
      'you', coalesce(m.booker_id = p_actor and (m.session_id is not null or m.claim_until > now()), false),
      'claimUntil', case when m.session_id is null and m.claim_until > now() then m.claim_until end,
      'bookBy', m.confirmed_at + interval '4 days',
      'session', (select jsonb_build_object('slug', s.slug, 'startsAt', s.details->>'startsAt',
          'location', s.details->>'location', 'cutoffAt', s.details->>'cutoffAt',
          'currency', s.details->>'currency',
          'totalMinor', coalesce((s.details->>'totalMinor')::bigint, 0),
          'shareMinor', round(coalesce((s.details->>'totalMinor')::bigint, 0)::numeric
            / greatest((select count(*) from app.ranked_match_players x where x.match_id = m.id), 1)))
        from app.sessions s where s.id = m.session_id)) end,
    'result', (select jsonb_build_object(
        'state', case when now() <= (s.details->>'startsAt')::timestamptz + interval '30 minutes' then 'waiting'
          when m.reported_side is null then 'report' else 'reported' end,
        'reportedBy', case when m.reported_side is null then null
          when m.reported_side = me.side then 'yours' else 'theirs' end,
        'reportedWinner', case when m.reported_winner is null then null
          when m.reported_winner = me.side then 'yours' else 'theirs' end,
        'reportBy', (s.details->>'endsAt')::timestamptz + interval '48 hours',
        'confirmBy', m.confirm_by,
        'canAct', app.match_checked_in(m.session_id, p_actor)
          and now() > (s.details->>'startsAt')::timestamptz + interval '30 minutes'
          and (m.reported_side is null or m.reported_side <> me.side))
      from app.sessions s where s.id = m.session_id and m.state = 'confirmed'),
    'checkIn', (select jsonb_build_object(
        'opensAt', (s.details->>'startsAt')::timestamptz - interval '30 minutes',
        'closesAt', (s.details->>'startsAt')::timestamptz + interval '30 minutes',
        'you', app.match_checked_in(m.session_id, p_actor))
      from app.sessions s where s.id = m.session_id and m.state = 'confirmed'))
  from app.ranked_match_players me where me.match_id = m.id and me.user_id = p_actor;
$$;

create or replace function api.read_operation(p_actor_id uuid,p_key uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r app.operation_receipts;
begin
  select * into r from app.operation_receipts where actor_id=p_actor_id and request_key=p_key;
  if r.action in ('start_search','answer_search_invite','cancel_search','restart_search',
      'answer_match','widen_search','claim_booking','release_booking','book_match','ranked_check_in',
      'report_result','answer_result') then
    return jsonb_build_object('operationKey',p_key) || api.read_my_search(p_actor_id);
  end if;
  return app.read_operation_before_ranked_search(p_actor_id,p_key);
end;
$$;

revoke all on function app.close_match(uuid), app.finish_match(uuid,smallint,text), app.void_match(uuid,text),
  app.settle_presence(uuid), app.result_open(uuid,uuid), api.report_result(uuid,uuid,uuid,boolean),
  api.answer_result(uuid,uuid,uuid,boolean) from public, anon, authenticated;
grant execute on function app.close_match(uuid), app.finish_match(uuid,smallint,text), app.void_match(uuid,text),
  app.settle_presence(uuid), app.result_open(uuid,uuid), api.report_result(uuid,uuid,uuid,boolean),
  api.answer_result(uuid,uuid,uuid,boolean) to service_role;
