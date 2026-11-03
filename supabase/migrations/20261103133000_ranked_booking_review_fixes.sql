-- Review fixes for ranked booking (WDL-424).
-- 1. While the match is on, the booker can't move its time or change its
--    spots, visibility, list or cost (which could turn a withdrawal into a
--    no-show or let others in); title, instructions and place stay editable.
-- 2. The match card shows the court cost, each player's share and when
--    withdrawing stops being free.
-- 3. A claim never runs past the 4 days to book.
-- 4. When the booker withdraws before the cutoff, the session they ran is
--    cancelled, so nobody is left registered in a session nobody runs.
--
-- Recovery: restore api.claim_booking from 20261103130000_ranked_booking.sql,
-- api.withdraw_party from 20261103131000_ranked_match_session.sql and app.match_view from
-- 20261103132000_ranked_booking_view.sql, then
--   drop function api.update_session(uuid,uuid,uuid,text,integer,jsonb,jsonb);
--   alter function app.update_session_before_ranked(uuid,uuid,uuid,text,integer,jsonb,jsonb) set schema api;
--   alter function api.update_session_before_ranked(uuid,uuid,uuid,text,integer,jsonb,jsonb) rename to update_session;

create or replace function api.claim_booking(p_actor_id uuid, p_key uuid, p_match uuid) returns jsonb
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
  if m.state <> 'confirmed' or m.session_id is not null or m.confirmed_at + interval '4 days' <= now() then
    raise sqlstate 'P0001' using message = 'booking_closed';
  end if;
  if m.booker_id is not null and m.booker_id <> p_actor_id and m.claim_until > now() then
    raise sqlstate 'P0001' using message = 'booking_taken';
  end if;
  -- Claiming again while holding the claim keeps its original 48 hours.
  if m.booker_id is distinct from p_actor_id or m.claim_until <= now() then
    -- Never past the 4 days to book, when the match is let go.
    update app.ranked_matches set booker_id = p_actor_id,
      claim_until = least(now() + interval '48 hours', m.confirmed_at + interval '4 days')
      where id = p_match;
  end if;
  insert into app.operation_receipts values (p_actor_id, p_key, 'claim_booking', payload, p_match, now());
  return jsonb_build_object('operationKey', p_key) || api.read_my_search(p_actor_id);
end;
$$;

alter function api.update_session(uuid,uuid,uuid,text,integer,jsonb,jsonb) rename to update_session_before_ranked;
alter function api.update_session_before_ranked(uuid,uuid,uuid,text,integer,jsonb,jsonb) set schema app;
create function api.update_session(p_actor_id uuid, p_key uuid, p_session_id uuid, p_intent text,
  p_version integer, p_details jsonb, p_access jsonb default null) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare cur jsonb; k text; listed uuid[]; wanted uuid[];
begin
  if app.ranked_session_live(p_session_id)
    and not exists (select 1 from app.operation_receipts where actor_id = p_actor_id and request_key = p_key) then
    select details into cur from app.sessions where id = p_session_id;
    foreach k in array array['startsAt', 'endsAt', 'opensAt', 'cutoffAt', 'capacity', 'access', 'joinMode',
        'guests', 'feeMode', 'fee', 'feeMinor', 'totalMinor', 'paymentMode', 'currency', 'releaseUnpaid'] loop
      if (cur->k) is distinct from (p_details->k) then
        raise sqlstate 'P0001' using message = 'ranked_match_session';
      end if;
    end loop;
    if p_access is not null then
      select coalesce(array_agg(user_id order by user_id), '{}') into listed
        from app.session_access where session_id = p_session_id and user_id is not null;
      select coalesce(array_agg(pr.user_id order by pr.user_id), '{}') into wanted
        from jsonb_array_elements_text(coalesce(p_access->'people', '[]')) x join app.profiles pr on pr.profile_id::text = x;
      if jsonb_array_length(coalesce(p_access->'groups', '[]')) > 0 or listed <> wanted then
        raise sqlstate 'P0001' using message = 'ranked_match_session';
      end if;
    end if;
  end if;
  return app.update_session_before_ranked(p_actor_id, p_key, p_session_id, p_intent, p_version, p_details, p_access);
end;
$$;

create or replace function api.withdraw_party(p_actor_id uuid, p_key uuid, p_slug uuid, p_party_id uuid) returns jsonb
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
    -- The booker runs the session: when they leave, nobody does, so it's
    -- cancelled through the ordinary path and nobody owes anything for it.
    if app.is_session_manager(p_actor_id, s.group_id) then
      perform app.cancel_session_before_ranked(p_actor_id, app.search_person(p_actor_id)->>'name',
        md5(p_key::text || ':cancel')::uuid, s.id);
    end if;
  else
    update app.ranked_match_players set no_show_at = p.withdrawn_at
      where match_id = m.id and user_id = p_actor_id;
  end if;
  return result;
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
    'checkIn', (select jsonb_build_object(
        'opensAt', (s.details->>'startsAt')::timestamptz - interval '30 minutes',
        'closesAt', (s.details->>'startsAt')::timestamptz + interval '30 minutes',
        'you', app.match_checked_in(m.session_id, p_actor))
      from app.sessions s where s.id = m.session_id and m.state = 'confirmed'))
  from app.ranked_match_players me where me.match_id = m.id and me.user_id = p_actor;
$$;

revoke all on function api.update_session(uuid,uuid,uuid,text,integer,jsonb,jsonb) from public, anon, authenticated;
grant execute on function api.update_session(uuid,uuid,uuid,text,integer,jsonb,jsonb) to service_role;
