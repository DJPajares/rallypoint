-- D-18 follow-up (owner, 2026-10-23): a party with anyone checked in showed up,
-- so its spot can't go to the waitlist; the organizer collects at the court.
-- Correcting the check-in back to unrecorded makes it releasable again. Check-in
-- and release both take the group lock, so they never interleave.
create or replace function app.party_releasable(p_party uuid,p_at timestamptz) returns boolean
language sql stable security invoker set search_path='' as $$
  select exists(
    select 1 from app.parties p
      join app.sessions s on s.id=p.session_id
      join app.fee_obligations f on f.party_id=p.id
    where p.id=p_party and p.state='confirmed' and s.state='published'
      and coalesce(s.details->>'paymentMode','organizer')='organizer'
      and coalesce((s.details->>'releaseUnpaid')::boolean,false)
      and (s.details->>'cutoffAt')::timestamptz<=p_at and p_at<(s.details->>'startsAt')::timestamptz
      and f.liability_state='due' and not f.marked_paid and f.total_minor>0
      and app.party_confirmed_at(p.id)<(s.details->>'cutoffAt')::timestamptz
      and not exists(select 1 from app.seat_attendance a where a.party_id=p.id and a.state='checked_in'));
$$;
revoke all on function app.party_releasable(uuid,timestamptz) from public,anon,authenticated;
grant execute on function app.party_releasable(uuid,timestamptz) to service_role;
