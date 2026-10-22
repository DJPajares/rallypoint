-- Pesos (PRD D-17, R1): add PHP, two decimal places, everywhere a currency is
-- checked. Existing obligations and split runs are not rewritten.
alter table app.fee_obligations drop constraint fee_obligations_currency_check,
  add constraint fee_obligations_currency_check check(currency in ('PHP','SGD','USD','EUR','GBP','JPY','KWD'));
alter table app.split_runs drop constraint split_runs_currency_check,
  add constraint split_runs_currency_check check(currency in ('PHP','SGD','USD','EUR','GBP','JPY','KWD'));

-- The live definition with only the currency list changed.
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
      or coalesce((p_details->>(case when p_details->>'feeMode'='split' then 'totalMinor' else 'feeMinor' end))::numeric,-1) not between 0 and 9007199254740991
      or (p_details->>(case when p_details->>'feeMode'='split' then 'totalMinor' else 'feeMinor' end))::numeric <> trunc((p_details->>(case when p_details->>'feeMode'='split' then 'totalMinor' else 'feeMinor' end))::numeric)
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
$function$
;
