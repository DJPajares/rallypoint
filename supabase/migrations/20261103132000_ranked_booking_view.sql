-- What the match card shows once everyone has accepted (D-26, WDL-424):
-- whether the court is open to book, who is booking it and until when, the
-- booked session, and the check-in window with who has checked in.
--
-- Recovery: restore app.match_view from 20261103121000_ranked_match_answers.sql, then
--   drop function app.match_checked_in(uuid,uuid);

-- Checked in to a ranked match's session, by themselves.
create function app.match_checked_in(p_session uuid, p_user uuid) returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists (select 1 from app.parties pt
    join app.seat_attendance sa on sa.party_id = pt.id and sa.seat = 1 and sa.state = 'checked_in'
    where pt.session_id = p_session and pt.user_id = p_user and pt.state = 'confirmed');
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
          'location', s.details->>'location')
        from app.sessions s where s.id = m.session_id)) end,
    'checkIn', (select jsonb_build_object(
        'opensAt', (s.details->>'startsAt')::timestamptz - interval '30 minutes',
        'closesAt', (s.details->>'startsAt')::timestamptz + interval '30 minutes',
        'you', app.match_checked_in(m.session_id, p_actor))
      from app.sessions s where s.id = m.session_id and m.state = 'confirmed'))
  from app.ranked_match_players me where me.match_id = m.id and me.user_id = p_actor;
$$;

revoke all on function app.match_checked_in(uuid,uuid) from public, anon, authenticated;
grant execute on function app.match_checked_in(uuid,uuid) to service_role;
