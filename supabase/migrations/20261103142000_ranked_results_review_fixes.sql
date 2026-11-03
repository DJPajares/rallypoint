-- Review fixes for ranked results (WDL-425).
-- 1. The 48-hour deadlines hold on every write, not only in the scheduled
--    pass: a report or answer first settles anything already due (silence
--    confirms; no report means it doesn't count), and the buttons go when
--    the deadline does.
-- 2. Withdrawing after the cutoff counts as not showing up even if the
--    player rejoins and checks in (spec: "Withdrawing after the session's
--    cutoff counts as a no-show").
--
-- Recovery: restore app.settle_presence, api.report_result, api.answer_result,
-- app.search_view and app.match_view from 20261103140000_ranked_results.sql, then drop function app.settle_due(uuid);

create or replace function app.settle_presence(p_match uuid) returns void
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
    from (select p.side, app.match_checked_in(m.session_id, p.user_id) and p.no_show_at is null as here
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

-- Whatever is already due before a player acts: absences at check-in close,
-- a report nobody answered in 48 hours, or no report 48 hours after the end.
create or replace function app.settle_due(p_match uuid) returns void
language plpgsql security invoker set search_path = '' as $$
declare m app.ranked_matches; ends timestamptz;
begin
  perform app.settle_presence(p_match);
  select * into m from app.ranked_matches where id = p_match for update;
  if m.state <> 'confirmed' or m.session_id is null then return; end if;
  select (details->>'endsAt')::timestamptz into ends from app.sessions where id = m.session_id;
  if m.reported_side is not null and m.confirm_by <= now() then
    perform app.finish_match(m.id, m.reported_winner, null);
  elsif m.reported_side is null and m.presence_settled_at is not null and ends + interval '48 hours' <= now() then
    perform app.void_match(m.id, 'unreported');
  end if;
end;
$$;

create or replace function api.report_result(p_actor_id uuid, p_key uuid, p_match uuid, p_won boolean) returns jsonb
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
  perform app.settle_due(m.id);
  select * into m from app.ranked_matches where id = p_match;
  -- An absence settled it just now: that stands, and the report doesn't.
  if m.state <> 'confirmed' then
    return jsonb_build_object('settledFirst', true) || api.read_my_search(p_actor_id);
  end if;
  if not app.match_checked_in(m.session_id, p_actor_id) or exists (select 1 from app.ranked_match_players
      where match_id = m.id and user_id = p_actor_id and no_show_at is not null) then
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

create or replace function api.answer_result(p_actor_id uuid, p_key uuid, p_match uuid, p_agree boolean) returns jsonb
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
  perform app.settle_due(m.id);
  select * into m from app.ranked_matches where id = p_match;
  if m.state <> 'confirmed' then
    return jsonb_build_object('settledFirst', true) || api.read_my_search(p_actor_id);
  end if;
  select side into v_side from app.ranked_match_players where match_id = m.id and user_id = p_actor_id;
  if m.reported_side is null or m.reported_side = v_side then
    raise sqlstate 'P0001' using message = 'nothing_to_answer';
  end if;
  if not app.match_checked_in(m.session_id, p_actor_id) or exists (select 1 from app.ranked_match_players
      where match_id = m.id and user_id = p_actor_id and no_show_at is not null) then
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
        'canAct', coalesce(app.match_checked_in(m.session_id, p_actor) and me.no_show_at is null
          and now() > (s.details->>'startsAt')::timestamptz + interval '30 minutes'
          and ((m.reported_side is null and now() < (s.details->>'endsAt')::timestamptz + interval '48 hours')
            or (m.reported_side <> me.side and now() < m.confirm_by)), false))
      from app.sessions s where s.id = m.session_id and m.state = 'confirmed'),
    'checkIn', (select jsonb_build_object(
        'opensAt', (s.details->>'startsAt')::timestamptz - interval '30 minutes',
        'closesAt', (s.details->>'startsAt')::timestamptz + interval '30 minutes',
        'you', app.match_checked_in(m.session_id, p_actor))
      from app.sessions s where s.id = m.session_id and m.state = 'confirmed'))
  from app.ranked_match_players me where me.match_id = m.id and me.user_id = p_actor;
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
          when m.state = 'completed' and (not app.match_checked_in(m.session_id, p_actor)
            or exists (select 1 from app.ranked_match_players x
              where x.match_id = m.id and x.user_id = p_actor and x.no_show_at is not null)) then 'match_missed'
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

revoke all on function app.settle_due(uuid) from public, anon, authenticated;
grant execute on function app.settle_due(uuid) to service_role;
