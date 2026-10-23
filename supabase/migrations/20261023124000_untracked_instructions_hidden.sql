-- "Not tracked here" has no payment instructions (PRD D-18, P-01). An organizer
-- can save instructions and a QR while a session is "Pay the organizer", then
-- switch it to "Not tracked here" before anyone books. The stored rows stay, so
-- switching back shows them again, but nobody may read them while the session
-- is untracked: not through the registration view and not through the QR route.
--
-- Both reads decide through this one predicate (the registration view only adds
-- the instructions key for an entitled reader, and read_payment_qr refuses an
-- unentitled one), so the mode check lives here once. The session's mode is
-- read the same way as everywhere else: a missing mode means "Pay the organizer".
create or replace function app.payment_entitled(p_actor uuid,p_session uuid) returns boolean
language sql stable security invoker set search_path='' as $$
  select coalesce((select s.details->>'paymentMode' from app.sessions s where s.id=p_session),'organizer')<>'untracked'
    and (exists(select 1 from app.sessions s join app.group_roles r on r.group_id=s.group_id
        where s.id=p_session and r.user_id=p_actor and r.role in ('owner','organizer','cohost'))
      or exists(select 1 from app.sessions s join app.parties p on p.session_id=s.id
        where s.id=p_session and s.state not in ('draft','cancelled') and p.user_id=p_actor and p.state in ('confirmed','waitlisted')));
$$;

revoke all on function app.payment_entitled(uuid,uuid) from public,anon,authenticated;
grant execute on function app.payment_entitled(uuid,uuid) to service_role;
