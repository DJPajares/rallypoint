-- A release names the "I've sent it" note the organizer saw (PRD D-18, P-02/P-03).
-- The confirmation repeats the player's note, but the player may post, change or
-- undo it after the organizer opened the sheet, and a note never changes the fee
-- revision. So the release now carries the note's send time as the organizer last
-- saw it (null when they saw none) and is refused if the stored note differs.
--
-- The check runs under the same locks as the note itself: the note write takes the
-- group and session locks, and so does this, so the two are serialized and the
-- note read here is the one that stands when the release commits.

drop function api.release_unpaid_party(uuid,text,uuid,uuid,uuid,integer);

create function api.release_unpaid_party(p_actor_id uuid,p_actor_name text,p_key uuid,p_slug uuid,p_party_id uuid,p_revision integer,p_note_sent_at timestamptz) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s app.sessions; f app.fee_obligations; receipt app.operation_receipts; payload jsonb; now_at timestamptz; next_revision integer; note_at timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text||p_key::text,0));
  select * into s from app.sessions where slug=p_slug;
  if not found then raise insufficient_privilege using message='group_access_denied'; end if;
  -- Group lock, with the current role checked under it: a revoked co-host is refused even on replay.
  perform app.require_manager(p_actor_id,s.group_id);
  select * into s from app.sessions where id=s.id for update;
  payload:=jsonb_build_object('slug',p_slug,'partyId',p_party_id,'revision',p_revision,'noteSentAt',p_note_sent_at);
  select * into receipt from app.operation_receipts where actor_id=p_actor_id and request_key=p_key;
  if found then
    if receipt.action<>'release_party' or receipt.payload<>payload then raise sqlstate 'P0001' using message='idempotency_conflict'; end if;
    return jsonb_build_object('registration',app.registration_view(p_actor_id,s.id),'operationKey',p_key);
  end if;
  if p_actor_name is null or length(trim(p_actor_name)) not between 1 and 80 then
    raise check_violation using message='invalid_release';
  end if;
  if coalesce(s.details->>'paymentMode','organizer')<>'organizer' or not coalesce((s.details->>'releaseUnpaid')::boolean,false) then
    raise sqlstate 'P0001' using message='release_not_enabled';
  end if;
  -- Server time after the locks: a request that waited on a lock is judged when it can act.
  now_at:=clock_timestamp();
  if s.state<>'published' or now_at>=(s.details->>'startsAt')::timestamptz then raise sqlstate 'P0001' using message='release_closed'; end if;
  if now_at<(s.details->>'cutoffAt')::timestamptz then raise sqlstate 'P0001' using message='release_too_early'; end if;
  select f2.* into f from app.fee_obligations f2 join app.parties p on p.id=f2.party_id
    where f2.party_id=p_party_id and p.session_id=s.id for update of f2;
  if not found then raise sqlstate 'P0001' using message='fee_not_found'; end if;
  if f.revision<>p_revision then raise sqlstate 'P0001' using message='stale_payment'; end if;
  if not app.party_releasable(f.party_id,now_at) then raise sqlstate 'P0001' using message='release_not_eligible'; end if;
  -- The note as it stands now, under the session lock a note write also needs. No row reads as null.
  select n.sent_at into note_at from app.payment_notes n where n.party_id=f.party_id;
  if note_at is distinct from p_note_sent_at then raise sqlstate 'P0001' using message='note_changed'; end if;
  update app.parties set state='removed' where id=f.party_id;
  update app.fee_obligations set liability_state='released_unpaid',removed_at=now_at,removed_by=p_actor_id,revision=revision+1
    where party_id=f.party_id returning revision into next_revision;
  insert into app.fee_changes(party_id,revision,action,actor_id,actor_name,created_at,previous_minor,current_minor,currency,split_run_id)
    values(f.party_id,next_revision,'released_unpaid',p_actor_id,trim(p_actor_name),now_at,f.total_minor,f.total_minor,f.currency,f.split_run_id);
  -- The signal the later email reads; the spot and the fee change commit or roll back with it.
  insert into app.registration_events(party_id,kind,created_at) values(f.party_id,'released',now_at);
  -- Never bypasses a head party that does not fit the freed seats.
  perform app.fill_waitlist(s.id);
  insert into app.operation_receipts values(p_actor_id,p_key,'release_party',payload,f.party_id,now_at);
  return jsonb_build_object('registration',app.registration_view(p_actor_id,s.id),'operationKey',p_key);
end;
$$;

revoke all on function api.release_unpaid_party(uuid,text,uuid,uuid,uuid,integer,timestamptz)
  from public,anon,authenticated;
grant execute on function api.release_unpaid_party(uuid,text,uuid,uuid,uuid,integer,timestamptz)
  to service_role;
