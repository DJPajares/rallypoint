-- Payment modes (PRD D-18, P-01). A session either tracks nothing here
-- ("untracked") or has the organizer collect payment ("organizer"). Sessions
-- saved before this change have no mode and behave as "organizer".

-- The live publish validation with two changes: a mode must be a known one, and
-- an untracked session carries no fee fields. The unpaid-release switch needs a
-- fixed fee above zero.
CREATE OR REPLACE FUNCTION app.save_session_before_cancellation(p_actor_id uuid, p_key uuid, p_group_id uuid, p_session_id uuid, p_intent text, p_version integer, p_details jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare s app.sessions; receipt app.operation_receipts; payload jsonb;
  changed jsonb; published boolean;
begin
  if p_intent not in ('draft','publish','update') then raise check_violation using message='invalid_input'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text || p_key::text,0));
  perform app.require_manager(p_actor_id,p_group_id);
  payload := jsonb_build_object('groupId',p_group_id,'sessionId',p_session_id,'intent',p_intent,'version',p_version,'details',p_details);
  select * into receipt from app.operation_receipts where actor_id=p_actor_id and request_key=p_key;
  if found then
    if receipt.action <> 'save_session' or receipt.payload <> payload then raise sqlstate 'P0001' using message='idempotency_conflict'; end if;
    select * into s from app.sessions where id=receipt.resource_id;
    return jsonb_build_object('session',app.session_view(s),'operationKey',p_key);
  end if;
  if p_session_id is not null then
    select * into s from app.sessions where id=p_session_id and group_id=p_group_id for update;
    if not found then raise insufficient_privilege using message='group_access_denied'; end if;
    if s.state in ('cancelled','completed') then raise sqlstate 'P0001' using message='session_closed'; end if;
    if p_version is distinct from s.version then raise sqlstate 'P0001' using message='stale_version'; end if;
    if s.bookings_started_at is not null and s.details <> p_details then raise sqlstate 'P0001' using message='booked_event_locked'; end if;
    if s.state='published' and p_intent <> 'update' then raise sqlstate 'P0001' using message='already_published'; end if;
    if s.state='draft' and p_intent='update' then raise check_violation using message='invalid_input'; end if;
  elsif p_intent='update' then raise check_violation using message='invalid_input';
  end if;
  published := p_intent in ('publish','update');
  if published then
    if coalesce(p_details->>'feeMode','fixed') not in ('fixed','split') or coalesce(length(trim(p_details->>'title')),0) not between 1 and 120
      or coalesce(length(trim(p_details->>'activity')),0) not between 1 and 80
      or coalesce(length(trim(p_details->>'location')),0) not between 1 and 300
      or coalesce((p_details->>'capacity')::bigint,0) not between 1 and 2147483647
      or not coalesce((p_details->>'endsAt')::timestamptz > (p_details->>'startsAt')::timestamptz,false)
      or not coalesce((p_details->>'opensAt')::timestamptz < (p_details->>'startsAt')::timestamptz,false)
      or not coalesce((p_details->>'cutoffAt')::timestamptz between (p_details->>'opensAt')::timestamptz and (p_details->>'startsAt')::timestamptz,false)
      or coalesce(p_details->>'currency','') not in ('PHP','SGD','USD','EUR','GBP','JPY','KWD')
      or coalesce(p_details->>'paymentMode','organizer') not in ('untracked','organizer')
      or coalesce(jsonb_typeof(p_details->'releaseUnpaid'),'boolean')<>'boolean'
      or (coalesce(p_details->>'paymentMode','organizer')='untracked' and (p_details ? 'feeMode' or p_details ? 'feeMinor' or p_details ? 'totalMinor'
        or coalesce((p_details->>'releaseUnpaid')::boolean,false)))
      or (coalesce(p_details->>'paymentMode','organizer')='organizer' and (
        coalesce((p_details->>(case when p_details->>'feeMode'='split' then 'totalMinor' else 'feeMinor' end))::numeric,-1) not between 0 and 9007199254740991
        or (p_details->>(case when p_details->>'feeMode'='split' then 'totalMinor' else 'feeMinor' end))::numeric <> trunc((p_details->>(case when p_details->>'feeMode'='split' then 'totalMinor' else 'feeMinor' end))::numeric)
        or (coalesce((p_details->>'releaseUnpaid')::boolean,false)
          and (p_details->>'feeMode'='split' or coalesce((p_details->>'feeMinor')::numeric,0)<=0))))
    then raise check_violation using message='invalid_input'; end if;
  end if;
  if p_session_id is null then
    insert into app.sessions(group_id,state,details) values(p_group_id,case when published then 'published' else 'draft' end,p_details) returning * into s;
  elsif s.details <> p_details or (p_intent='publish' and s.state='draft') then
    select coalesce(jsonb_agg(key),'[]'::jsonb) into changed from jsonb_object_keys(p_details) key where s.details->key is distinct from p_details->key;
    update app.sessions set details=p_details,state=case when published then 'published' else 'draft' end,version=version+1,updated_at=clock_timestamp() where id=s.id returning * into s;
    if p_intent='update' then insert into app.session_changes values(s.id,s.version,p_actor_id,changed,now()); end if;
  end if;
  insert into app.operation_receipts values(p_actor_id,p_key,'save_session',payload,s.id,now());
  return jsonb_build_object('session',app.session_view(s),'operationKey',p_key);
end;
$function$;


-- No fee obligation or split claim for an untracked session, on confirmation or
-- promotion alike. Everything else is the live definition.
create or replace function app.confirm_party_fee(p_party uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare p app.parties; s app.sessions; at_time timestamptz:=clock_timestamp();
begin
  select * into p from app.parties where id=p_party;
  select * into s from app.sessions where id=p.session_id;
  if coalesce(s.details->>'paymentMode','organizer')='untracked' then return; end if;
  if coalesce(s.details->>'feeMode','fixed')='split' then
    insert into app.split_claims(party_id,changed_at,changed_by) values(p.id,at_time,p.user_id);
    insert into app.split_claim_changes values(p.id,1,'confirmed',p.user_id,p.primary_name,at_time);
  else
    insert into app.fee_obligations(party_id,unit_minor,charged_seats,currency)
      values(p.id,(s.details->>'feeMinor')::bigint,p.seats,s.details->>'currency');
  end if;
end;
$$;

-- Payment instructions belong to "Pay the organizer".
alter function api.update_payment_instructions(uuid,text,uuid,uuid,integer,text,text,text,text,integer,text)
  rename to update_payment_instructions_before_payment_modes;
alter function api.update_payment_instructions_before_payment_modes(uuid,text,uuid,uuid,integer,text,text,text,text,integer,text) set schema app;
create function api.update_payment_instructions(p_actor_id uuid,p_actor_name text,p_key uuid,p_session_id uuid,p_revision integer,
  p_action text,p_body text,p_image_path text,p_image_type text,p_image_bytes integer,p_image_sha256 text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s app.sessions;
begin
  select * into s from app.sessions where id=p_session_id;
  if not found then raise insufficient_privilege using message='group_access_denied';end if;
  perform app.require_manager(p_actor_id,s.group_id);
  select * into s from app.sessions where id=p_session_id;
  if coalesce(s.details->>'paymentMode','organizer')='untracked' then raise sqlstate 'P0001' using message='payment_not_tracked';end if;
  return app.update_payment_instructions_before_payment_modes(p_actor_id,p_actor_name,p_key,p_session_id,p_revision,p_action,p_body,
    p_image_path,p_image_type,p_image_bytes,p_image_sha256);
end;
$$;

revoke all on function app.confirm_party_fee(uuid),app.save_session_before_cancellation(uuid,uuid,uuid,uuid,text,integer,jsonb),
  app.update_payment_instructions_before_payment_modes(uuid,text,uuid,uuid,integer,text,text,text,text,integer,text),
  api.update_payment_instructions(uuid,text,uuid,uuid,integer,text,text,text,text,integer,text) from public,anon,authenticated;
grant execute on function app.confirm_party_fee(uuid),app.save_session_before_cancellation(uuid,uuid,uuid,uuid,text,integer,jsonb),
  app.update_payment_instructions_before_payment_modes(uuid,text,uuid,uuid,integer,text,text,text,text,integer,text),
  api.update_payment_instructions(uuid,text,uuid,uuid,integer,text,text,text,text,integer,text) to service_role;
