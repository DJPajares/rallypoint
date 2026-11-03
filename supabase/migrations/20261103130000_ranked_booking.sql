-- Booking a ranked match (D-26, WDL-424). Once everyone has accepted, any
-- player can claim the booking ("I'll book the court"): the first claim wins
-- and holds for 48 hours, and the booker can hand it back. The booker then
-- enters the court, time and cost, and one private session is created for
-- exactly the matched players, run by the booker, with the court's cost split
-- equally and paid to the booker (Pay the organizer). Every player is
-- registered for it. A booked match is no longer let go after 4 days.
-- Pickleball sessions may now have 2 spots, so a singles match fits.
--
-- Recovery: restore api.run_matchmaking from 20261103122000_ranked_matchmaking_review_fixes.sql, then
--   drop function api.claim_booking(uuid,uuid,uuid), api.release_booking(uuid,uuid,uuid),
--     api.book_match(uuid,uuid,uuid,jsonb,text), app.match_players_open(uuid,uuid);
--   alter table app.ranked_match_players drop column no_show_at;
--   update app.ranked_matches set end_reason = 'declined' where end_reason = 'withdrawn';
--   alter table app.ranked_matches drop column booker_id, drop column claim_until, drop column session_id,
--     drop column booked_at, drop column ended_by, drop constraint ranked_matches_end_reason_check,
--     add constraint ranked_matches_end_reason_check check (end_reason in ('declined', 'expired', 'unbooked'));
--   update app.activity_limits set min_capacity = 4 where activity_key = 'pickleball';
-- Sessions already created stay as ordinary private sessions.

alter table app.ranked_matches
  add column booker_id uuid references auth.users(id) on delete set null,
  add column claim_until timestamptz,
  add column session_id uuid references app.sessions(id) on delete set null,
  add column booked_at timestamptz,
  add column ended_by uuid references auth.users(id) on delete set null;
alter table app.ranked_matches drop constraint ranked_matches_end_reason_check;
alter table app.ranked_matches add constraint ranked_matches_end_reason_check
  check (end_reason in ('declined', 'expired', 'unbooked', 'withdrawn'));
create unique index ranked_matches_session on app.ranked_matches(session_id) where session_id is not null;
alter table app.ranked_match_players add column no_show_at timestamptz;

update app.activity_limits set min_capacity = 2 where activity_key = 'pickleball';

-- The actor is a player still holding a seat in this match.
create function app.match_players_open(p_match uuid, p_user uuid) returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists (select 1 from app.ranked_match_players
    where match_id = p_match and user_id = p_user and released_at is null);
$$;

create function api.claim_booking(p_actor_id uuid, p_key uuid, p_match uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare m app.ranked_matches; payload jsonb := jsonb_build_object('match', p_match);
begin
  if p_actor_id is null then raise insufficient_privilege; end if;
  if app.search_receipt(p_actor_id, p_key, 'claim_booking', payload) is not null then
    return jsonb_build_object('operationKey', p_key) || api.read_my_search(p_actor_id);
  end if;
  if not app.match_players_open(p_match, p_actor_id) then
    raise sqlstate 'P0001' using message = 'match_not_found';
  end if;
  perform app.lock_searchers(array(select user_id from app.ranked_match_players where match_id = p_match));
  select * into m from app.ranked_matches where id = p_match for update;
  if m.state <> 'confirmed' or m.session_id is not null then
    raise sqlstate 'P0001' using message = 'booking_closed';
  end if;
  if m.booker_id is not null and m.booker_id <> p_actor_id and m.claim_until > now() then
    raise sqlstate 'P0001' using message = 'booking_taken';
  end if;
  -- Claiming again while holding the claim keeps its original 48 hours.
  if m.booker_id is distinct from p_actor_id or m.claim_until <= now() then
    update app.ranked_matches set booker_id = p_actor_id, claim_until = now() + interval '48 hours'
      where id = p_match;
  end if;
  insert into app.operation_receipts values (p_actor_id, p_key, 'claim_booking', payload, p_match, now());
  return jsonb_build_object('operationKey', p_key) || api.read_my_search(p_actor_id);
end;
$$;

-- "I can't book": the claim goes back to everyone.
create function api.release_booking(p_actor_id uuid, p_key uuid, p_match uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare m app.ranked_matches; payload jsonb := jsonb_build_object('match', p_match);
begin
  if p_actor_id is null then raise insufficient_privilege; end if;
  if app.search_receipt(p_actor_id, p_key, 'release_booking', payload) is not null then
    return jsonb_build_object('operationKey', p_key) || api.read_my_search(p_actor_id);
  end if;
  if not app.match_players_open(p_match, p_actor_id) then
    raise sqlstate 'P0001' using message = 'match_not_found';
  end if;
  perform app.lock_searchers(array(select user_id from app.ranked_match_players where match_id = p_match));
  select * into m from app.ranked_matches where id = p_match for update;
  if m.state <> 'confirmed' or m.session_id is not null then
    raise sqlstate 'P0001' using message = 'booking_closed';
  end if;
  if m.booker_id is distinct from p_actor_id or m.claim_until <= now() then
    raise sqlstate 'P0001' using message = 'not_booker';
  end if;
  update app.ranked_matches set booker_id = null, claim_until = null where id = p_match;
  insert into app.operation_receipts values (p_actor_id, p_key, 'release_booking', payload, p_match, now());
  return jsonb_build_object('operationKey', p_key) || api.read_my_search(p_actor_id);
end;
$$;

-- Create the match session. p_details are ordinary session details, already
-- checked by the session rules in the API; the session is private and every
-- player gets access and a confirmed place. A retry by key returns the same
-- session: the receipt covers the match, not the details, whose opening time
-- is "now" and so differs on a retry.
create function api.book_match(p_actor_id uuid, p_key uuid, p_match uuid, p_details jsonb, p_host_name text)
returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare m app.ranked_matches; payload jsonb := jsonb_build_object('match', p_match);
  saved jsonb; sid uuid; v_slug uuid; u record;
begin
  if p_actor_id is null then raise insufficient_privilege; end if;
  if app.search_receipt(p_actor_id, p_key, 'book_match', payload) is not null then
    return jsonb_build_object('operationKey', p_key) || api.read_my_search(p_actor_id);
  end if;
  if not app.match_players_open(p_match, p_actor_id) then
    raise sqlstate 'P0001' using message = 'match_not_found';
  end if;
  perform app.lock_searchers(array(select user_id from app.ranked_match_players where match_id = p_match));
  select * into m from app.ranked_matches where id = p_match for update;
  if m.state <> 'confirmed' or m.session_id is not null then
    raise sqlstate 'P0001' using message = 'booking_closed';
  end if;
  if m.booker_id is distinct from p_actor_id or m.claim_until <= now() then
    raise sqlstate 'P0001' using message = 'not_booker';
  end if;
  if jsonb_typeof(p_details) <> 'object' or p_details->>'access' <> 'private'
    or p_details->>'capacity' <> (select count(*)::text from app.ranked_match_players where match_id = p_match) then
    raise check_violation using message = 'invalid_input';
  end if;
  saved := api.save_new_session(p_actor_id, md5(p_key::text || ':session')::uuid, 'publish', p_details,
    p_host_name, null, null, null);
  sid := (saved->'session'->>'id')::uuid;
  select slug into v_slug from app.sessions where id = sid;
  -- Matched players are strangers, so they're listed directly.
  insert into app.session_access(session_id, user_id, added_by)
    select sid, p.user_id, p_actor_id from app.ranked_match_players p
    where p.match_id = p_match and p.user_id <> p_actor_id;
  for u in select p.user_id from app.ranked_match_players p where p.match_id = p_match
      order by p.user_id <> p_actor_id, p.side, p.user_id loop
    perform api.join_session(u.user_id, md5(p_key::text || ':' || u.user_id::text)::uuid, v_slug,
      (select version from app.sessions where id = sid), 1, '', app.search_person(u.user_id)->>'name', true);
  end loop;
  update app.ranked_matches set session_id = sid, booked_at = now() where id = p_match;
  insert into app.operation_receipts values (p_actor_id, p_key, 'book_match', payload, p_match, now());
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

create or replace function api.read_operation(p_actor_id uuid,p_key uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r app.operation_receipts;
begin
  select * into r from app.operation_receipts where actor_id=p_actor_id and request_key=p_key;
  if r.action in ('start_search','answer_search_invite','cancel_search','restart_search',
      'answer_match','widen_search','claim_booking','release_booking','book_match') then
    return jsonb_build_object('operationKey',p_key) || api.read_my_search(p_actor_id);
  end if;
  return app.read_operation_before_ranked_search(p_actor_id,p_key);
end;
$$;

revoke all on function app.match_players_open(uuid,uuid), api.claim_booking(uuid,uuid,uuid),
  api.release_booking(uuid,uuid,uuid), api.book_match(uuid,uuid,uuid,jsonb,text)
  from public, anon, authenticated;
grant execute on function app.match_players_open(uuid,uuid), api.claim_booking(uuid,uuid,uuid),
  api.release_booking(uuid,uuid,uuid), api.book_match(uuid,uuid,uuid,jsonb,text) to service_role;
