-- The match session (D-26, WDL-424). Each player checks themselves in from
-- 30 minutes before the start to 30 minutes after, on the match card; while
-- the match is on, nobody checks anyone else in, removes a player or cancels
-- the session. Withdrawing before the cutoff ends the ranked match with no
-- penalty: the session stays as an ordinary one, the leaver's side stops
-- searching and the other side searches again with its place kept. After the
-- cutoff, a withdrawal is kept for Results as a no-show. The session's own
-- fee rules (D-04) apply either way.
--
-- Recovery: restore app.search_view from 20261103122000_ranked_matchmaking_review_fixes.sql, then
--   drop function api.withdraw_party(uuid,uuid,uuid,uuid), api.record_attendance(uuid,text,uuid,uuid,uuid,integer,text,integer),
--     api.remove_party(uuid,text,uuid,uuid,uuid), api.cancel_session(uuid,text,uuid,uuid),
--     api.ranked_check_in(uuid,uuid,uuid), app.ranked_session_live(uuid);
--   and for each of withdraw_party, record_attendance, remove_party, cancel_session:
--   alter function app.<name>_before_ranked(...) set schema api; alter function api.<name>_before_ranked(...) rename to <name>;

-- A session whose ranked match is still on.
create function app.ranked_session_live(p_session uuid) returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists (select 1 from app.ranked_matches where session_id = p_session and state = 'confirmed');
$$;

create function api.ranked_check_in(p_actor_id uuid, p_key uuid, p_match uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare m app.ranked_matches; s app.sessions; p app.parties; a app.seat_attendance;
  payload jsonb := jsonb_build_object('match', p_match); now_at timestamptz; starts timestamptz; next_revision integer;
begin
  if p_actor_id is null then raise insufficient_privilege; end if;
  if app.search_receipt(p_actor_id, p_key, 'ranked_check_in', payload) is not null then
    return jsonb_build_object('operationKey', p_key) || api.read_my_search(p_actor_id);
  end if;
  if not app.match_players_open(p_match, p_actor_id) then
    raise sqlstate 'P0001' using message = 'match_not_found';
  end if;
  select * into m from app.ranked_matches where id = p_match;
  if m.state <> 'confirmed' or m.session_id is null then
    raise sqlstate 'P0001' using message = 'check_in_closed';
  end if;
  select * into s from app.sessions where id = m.session_id for update;
  select * into p from app.parties where session_id = s.id and user_id = p_actor_id and state = 'confirmed' for update;
  now_at := clock_timestamp();
  starts := (s.details->>'startsAt')::timestamptz;
  if not found or s.state not in ('published', 'completed')
    or now_at < starts - interval '30 minutes' or now_at > starts + interval '30 minutes' then
    raise sqlstate 'P0001' using message = 'check_in_closed';
  end if;
  select * into a from app.seat_attendance where party_id = p.id and seat = 1 for update;
  if coalesce(a.state, 'unrecorded') <> 'checked_in' then
    insert into app.seat_attendance(party_id, seat, state, revision, changed_at, changed_by)
      values (p.id, 1, 'checked_in', 1, now_at, p_actor_id)
      on conflict (party_id, seat) do update set state = excluded.state,
        revision = app.seat_attendance.revision + 1, changed_at = now_at, changed_by = p_actor_id
      returning revision into next_revision;
    insert into app.attendance_changes values (p.id, 1, next_revision, 'checked_in', p_actor_id,
      app.search_person(p_actor_id)->>'name', now_at);
  end if;
  insert into app.operation_receipts values (p_actor_id, p_key, 'ranked_check_in', payload, p_match, now_at);
  return jsonb_build_object('operationKey', p_key) || api.read_my_search(p_actor_id);
end;
$$;

-- Organizer actions that would undo a live ranked match are refused.
alter function api.record_attendance(uuid,text,uuid,uuid,uuid,integer,text,integer) rename to record_attendance_before_ranked;
alter function api.record_attendance_before_ranked(uuid,text,uuid,uuid,uuid,integer,text,integer) set schema app;
create function api.record_attendance(p_actor_id uuid, p_actor_name text, p_key uuid, p_slug uuid,
  p_party_id uuid, p_seat integer, p_state text, p_revision integer) returns jsonb
language plpgsql security invoker set search_path = '' as $$
begin
  if app.ranked_session_live((select id from app.sessions where slug = p_slug)) then
    raise sqlstate 'P0001' using message = 'ranked_match_session';
  end if;
  return app.record_attendance_before_ranked(p_actor_id, p_actor_name, p_key, p_slug, p_party_id, p_seat, p_state, p_revision);
end;
$$;

alter function api.remove_party(uuid,text,uuid,uuid,uuid) rename to remove_party_before_ranked;
alter function api.remove_party_before_ranked(uuid,text,uuid,uuid,uuid) set schema app;
create function api.remove_party(p_actor_id uuid, p_actor_name text, p_key uuid, p_slug uuid, p_party_id uuid)
returns jsonb
language plpgsql security invoker set search_path = '' as $$
begin
  if app.ranked_session_live((select id from app.sessions where slug = p_slug)) then
    raise sqlstate 'P0001' using message = 'ranked_match_session';
  end if;
  return app.remove_party_before_ranked(p_actor_id, p_actor_name, p_key, p_slug, p_party_id);
end;
$$;

alter function api.cancel_session(uuid,text,uuid,uuid) rename to cancel_session_before_ranked;
alter function api.cancel_session_before_ranked(uuid,text,uuid,uuid) set schema app;
create function api.cancel_session(p_actor_id uuid, p_actor_name text, p_key uuid, p_session_id uuid)
returns jsonb
language plpgsql security invoker set search_path = '' as $$
begin
  if app.ranked_session_live(p_session_id) then
    raise sqlstate 'P0001' using message = 'ranked_match_session';
  end if;
  return app.cancel_session_before_ranked(p_actor_id, p_actor_name, p_key, p_session_id);
end;
$$;

-- The ordinary withdrawal first (its fee rules and waitlist), then the ranked rules.
alter function api.withdraw_party(uuid,uuid,uuid,uuid) rename to withdraw_party_before_ranked;
alter function api.withdraw_party_before_ranked(uuid,uuid,uuid,uuid) set schema app;
create function api.withdraw_party(p_actor_id uuid, p_key uuid, p_slug uuid, p_party_id uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare result jsonb; s app.sessions; p app.parties; m app.ranked_matches; me app.ranked_match_players;
begin
  result := app.withdraw_party_before_ranked(p_actor_id, p_key, p_slug, p_party_id);
  select * into s from app.sessions where slug = p_slug;
  select * into m from app.ranked_matches where session_id = s.id and state = 'confirmed';
  if not found then return result; end if;
  select * into p from app.parties where id = p_party_id and user_id = p_actor_id and state = 'withdrawn';
  if not found then return result; end if;
  perform app.lock_searchers(array(select user_id from app.ranked_match_players where match_id = m.id));
  select * into m from app.ranked_matches where id = m.id for update;
  select * into me from app.ranked_match_players
    where match_id = m.id and user_id = p_actor_id and released_at is null and no_show_at is null;
  -- A replay finds the match already settled for this player.
  if m.state <> 'confirmed' or me.match_id is null then return result; end if;
  if p.withdrawn_at < (s.details->>'cutoffAt')::timestamptz then
    perform app.end_side(m.id, me.side);
    perform app.requeue_side(m.id, (3 - me.side)::smallint);
    update app.ranked_matches set state = 'cancelled', end_reason = 'withdrawn', ended_at = now(),
      ended_by = p_actor_id where id = m.id;
  else
    update app.ranked_match_players set no_show_at = p.withdrawn_at
      where match_id = m.id and user_id = p_actor_id;
  end if;
  return result;
end;
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

create or replace function api.read_operation(p_actor_id uuid,p_key uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r app.operation_receipts;
begin
  select * into r from app.operation_receipts where actor_id=p_actor_id and request_key=p_key;
  if r.action in ('start_search','answer_search_invite','cancel_search','restart_search',
      'answer_match','widen_search','claim_booking','release_booking','book_match','ranked_check_in') then
    return jsonb_build_object('operationKey',p_key) || api.read_my_search(p_actor_id);
  end if;
  return app.read_operation_before_ranked_search(p_actor_id,p_key);
end;
$$;

revoke all on function app.ranked_session_live(uuid), api.ranked_check_in(uuid,uuid,uuid),
  api.record_attendance(uuid,text,uuid,uuid,uuid,integer,text,integer), api.remove_party(uuid,text,uuid,uuid,uuid),
  api.cancel_session(uuid,text,uuid,uuid), api.withdraw_party(uuid,uuid,uuid,uuid)
  from public, anon, authenticated;
grant execute on function app.ranked_session_live(uuid), api.ranked_check_in(uuid,uuid,uuid),
  api.record_attendance(uuid,text,uuid,uuid,uuid,integer,text,integer), api.remove_party(uuid,text,uuid,uuid,uuid),
  api.cancel_session(uuid,text,uuid,uuid), api.withdraw_party(uuid,uuid,uuid,uuid)
  to service_role;
