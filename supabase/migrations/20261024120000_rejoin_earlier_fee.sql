-- A player who withdrew after the cutoff and then rejoined keeps the fee that
-- was retained on the old booking until the organizer waives it. The page only
-- shows their current booking, so the old amount has to travel with it: the
-- viewer's other withdrawn or removed bookings in this session whose fee is
-- still owed, oldest first. Only the viewer's own bookings are read, so nobody
-- else ever receives this key.
--
-- Like the view it wraps, this is not marked STABLE.
alter function app.registration_view(uuid,uuid,uuid) rename to registration_view_before_earlier_fees;
create function app.registration_view(p_actor uuid,p_session uuid,p_party uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb; current_id uuid; earlier jsonb;
begin
  result:=app.registration_view_before_earlier_fees(p_actor,p_session,p_party);
  current_id:=(result#>>'{own,id}')::uuid;
  select coalesce(jsonb_agg(jsonb_build_object('currency',x.fee->>'currency','totalMinor',(x.fee->>'totalMinor')::bigint)
    order by x.queue_sequence,x.id),'[]'::jsonb)
    into earlier
    from (select p.id,p.queue_sequence,app.party_fee(p.id) as fee
      from app.parties p
      where p.session_id=p_session and p.user_id=p_actor and p.state in ('withdrawn','removed')
        and (current_id is null or p.id<>current_id)) x
    where x.fee->>'liabilityState'='due'
      and not coalesce((x.fee->>'markedPaid')::boolean,false)
      and coalesce((x.fee->>'totalMinor')::bigint,0)>0;
  return result||jsonb_build_object('earlierFees',earlier);
end;
$$;

revoke all on function app.registration_view_before_earlier_fees(uuid,uuid,uuid),app.registration_view(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function app.registration_view_before_earlier_fees(uuid,uuid,uuid),app.registration_view(uuid,uuid,uuid)
  to service_role;
