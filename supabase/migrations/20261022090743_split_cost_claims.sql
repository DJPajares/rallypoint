-- Split participation is contingent until organizer finalization. No amount is
-- payable or markable as paid while only a claim exists.
create table app.split_claims (
  party_id uuid primary key references app.parties(id),
  eligible boolean not null default true,
  waived boolean not null default false,
  revision integer not null default 1 check(revision>0),
  changed_at timestamptz not null,
  changed_by uuid not null references auth.users(id)
);
create table app.split_claim_changes (
  party_id uuid not null references app.split_claims(party_id),
  revision integer not null check(revision>0),
  action text not null check(action in ('confirmed','waived','waiver_undone','removed_before_cutoff')),
  actor_id uuid not null references auth.users(id),
  actor_name text not null check(length(actor_name) between 1 and 80),
  created_at timestamptz not null,
  primary key(party_id,revision)
);
alter table app.split_claims enable row level security;
alter table app.split_claim_changes enable row level security;
revoke all on app.split_claims,app.split_claim_changes from public,anon,authenticated;
grant select,insert,update on app.split_claims to service_role;
grant select,insert on app.split_claim_changes to service_role;

-- Called with the established group/session locks, exactly once on confirmed
-- admission or promotion. Fixed-fee admission retains its original behavior.
create function app.confirm_party_fee(p_party uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare p app.parties; s app.sessions; at_time timestamptz:=clock_timestamp();
begin
  select * into p from app.parties where id=p_party;
  select * into s from app.sessions where id=p.session_id;
  if coalesce(s.details->>'feeMode','fixed')='split' then
    insert into app.split_claims(party_id,changed_at,changed_by) values(p.id,at_time,p.user_id);
    insert into app.split_claim_changes values(p.id,1,'confirmed',p.user_id,p.primary_name,at_time);
  else
    insert into app.fee_obligations(party_id,unit_minor,charged_seats,currency)
      values(p.id,(s.details->>'feeMinor')::bigint,p.seats,s.details->>'currency');
  end if;
end;
$$;

create function app.split_summary(p_session uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare s app.sessions; n bigint; total bigint; base bigint; rem bigint;
begin
  select * into s from app.sessions where id=p_session;
  if coalesce(s.details->>'feeMode','fixed')<>'split' then return null; end if;
  select coalesce(sum(p.seats),0) into n from app.split_claims c join app.parties p on p.id=c.party_id
    where p.session_id=s.id and c.eligible and not c.waived;
  total:=(s.details->>'totalMinor')::bigint;
  if n>9007199254740991 then raise check_violation using message='fee_out_of_range'; end if;
  if n>0 then base:=total/n;rem:=total%n;end if;
  return jsonb_build_object('phase','estimating','currency',s.details->>'currency','totalMinor',total,'payingSeats',n,
    'estimatedSeatRange',case when n>0 then jsonb_build_object('minMinor',base,'maxMinor',base+case when rem>0 then 1 else 0 end) else null end,
    'prospectivePartyMinor',jsonb_build_object('one',total/(n+1)+greatest(0,total%(n+1)-n),
      'two',case when (s.details->>'guests')::boolean and (s.details->>'capacity')::bigint>=2
        then total/(n+2)*2+greatest(0,total%(n+2)-n) else null end));
end;
$$;

create function app.split_claim(p_party uuid,p_managed boolean) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare c app.split_claims; p app.parties; summary jsonb; n bigint; total bigint; preceding bigint; result jsonb;
begin
  select * into c from app.split_claims where party_id=p_party;
  if not found then return null; end if;
  select * into p from app.parties where id=p_party;
  summary:=app.split_summary(p.session_id);n:=(summary->>'payingSeats')::bigint;total:=(summary->>'totalMinor')::bigint;
  if c.eligible and not c.waived and n>0 then
    select coalesce(sum(p2.seats),0) into preceding from app.split_claims c2 join app.parties p2 on p2.id=c2.party_id
      where p2.session_id=p.session_id and c2.eligible and not c2.waived
        and (p2.queue_sequence<p.queue_sequence or (p2.queue_sequence=p.queue_sequence and p2.id<p.id));
  end if;
  result:=jsonb_build_object('eligible',c.eligible,'waived',c.waived,'estimateMinor',
    case when preceding is not null then total/n*p.seats+least(p.seats,greatest(0,total%n-preceding)) else null end);
  if p_managed then result:=result||jsonb_build_object('revision',c.revision);end if;
  return result;
end;
$$;

-- Caller already checked the current manager under the group/session locks.
create function app.update_split_claim(p_actor uuid,p_name text,p_key uuid,p_session uuid,p_slug uuid,p_party uuid,p_action text,p_revision integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c app.split_claims; next_revision integer; at_time timestamptz:=clock_timestamp();payload jsonb;
begin
  select c2.* into c from app.split_claims c2 join app.parties p on p.id=c2.party_id
    where c2.party_id=p_party and p.session_id=p_session for update of c2;
  if not found then raise sqlstate 'P0001' using message='fee_not_found';end if;
  if c.revision<>p_revision then raise sqlstate 'P0001' using message='stale_payment';end if;
  if p_action in ('mark_paid','mark_unpaid') then raise sqlstate 'P0001' using message='split_not_finalized';end if;
  if (p_action='waive' and not c.waived) or (p_action='undo_waiver' and c.waived) then
    update app.split_claims set waived=(p_action='waive'),revision=revision+1,changed_at=at_time,changed_by=p_actor
      where party_id=p_party returning revision into next_revision;
  else raise sqlstate 'P0001' using message='payment_transition_invalid';end if;
  insert into app.split_claim_changes values(p_party,next_revision,case p_action when 'waive' then 'waived' else 'waiver_undone' end,p_actor,p_name,at_time);
  payload:=jsonb_build_object('slug',p_slug,'partyId',p_party,'action',p_action,'revision',p_revision);
  insert into app.operation_receipts values(p_actor,p_key,'update_payment',payload,p_party,at_time);
  return jsonb_build_object('registration',app.registration_view(p_actor,p_session),'operationKey',p_key);
end;
$$;


create or replace function api.save_session(p_actor_id uuid,p_key uuid,p_group_id uuid,p_session_id uuid,p_intent text,p_version integer,p_details jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
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
      or coalesce(p_details->>'currency','') not in ('SGD','USD','EUR','GBP','JPY','KWD')
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
$$;

create or replace function app.fill_waitlist(p_session uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare s app.sessions; head app.parties; occupied bigint;
begin
  select * into s from app.sessions where id=p_session;
  perform 1 from app.groups where id=s.group_id for update;
  select * into s from app.sessions where id=p_session for update;
  if s.state<>'published' or clock_timestamp()>=(s.details->>'startsAt')::timestamptz then return; end if;
  select coalesce(sum(seats),0) into occupied from app.parties where session_id=p_session and state='confirmed';
  loop
    select * into head from app.parties where session_id=p_session and state='waitlisted' order by queue_sequence limit 1;
    exit when not found or occupied+head.seats>(s.details->>'capacity')::integer;
    exit when clock_timestamp()>=(s.details->>'startsAt')::timestamptz;
    update app.parties set state='confirmed' where id=head.id;
    perform app.confirm_party_fee(head.id);
    insert into app.registration_events(party_id,kind) values(head.id,'promoted');
    occupied:=occupied+head.seats;
  end loop;
end;
$$;

create or replace function api.join_session(p_actor_id uuid,p_key uuid,p_slug uuid,p_version integer,p_seats integer,p_guest_name text,p_primary_name text,p_consent boolean) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s app.sessions; p app.parties; receipt app.operation_receipts; payload jsonb; occupied bigint; result_state text; now_at timestamptz;
begin
  if p_seats not in (1,2) or p_consent is distinct from true or length(p_guest_name)>80 or length(p_primary_name) not between 1 and 80 then
    raise check_violation using message='invalid_registration'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text||p_key::text,0));
  select * into s from app.sessions where slug=p_slug;
  if not found then raise insufficient_privilege using message='session_unavailable'; end if;
  perform 1 from app.groups where id=s.group_id for update;
  select * into s from app.sessions where slug=p_slug for update;
  payload:=jsonb_build_object('slug',p_slug,'version',p_version,'seats',p_seats,'guestName',p_guest_name,'consent',p_consent);
  select * into receipt from app.operation_receipts where actor_id=p_actor_id and request_key=p_key;
  if found then
    if receipt.action<>'join_session' or receipt.payload<>payload then raise sqlstate 'P0001' using message='idempotency_conflict'; end if;
    return jsonb_build_object('registration',app.registration_view(p_actor_id,s.id,receipt.resource_id),'operationKey',p_key);
  end if;
  if s.state='draft' then raise insufficient_privilege using message='session_unavailable'; end if;
  select * into p from app.parties where session_id=s.id and user_id=p_actor_id and state in ('confirmed','waitlisted');
  if found then
    insert into app.operation_receipts values(p_actor_id,p_key,'join_session',payload,p.id,now());
    return jsonb_build_object('registration',app.registration_view(p_actor_id,s.id,p.id),'operationKey',p_key);
  end if;
  now_at:=clock_timestamp();
  if s.state<>'published' or now_at>=(s.details->>'startsAt')::timestamptz then raise sqlstate 'P0001' using message='registration_closed'; end if;
  if now_at<(s.details->>'opensAt')::timestamptz then raise sqlstate 'P0001' using message='registration_not_open'; end if;
  if p_version is distinct from s.version then raise sqlstate 'P0001' using message='stale_terms'; end if;
  if p_seats=2 and not (s.details->>'guests')::boolean then raise check_violation using message='guest_disabled'; end if;
  if p_seats>(s.details->>'capacity')::integer then raise check_violation using message='party_too_large'; end if;
  if (s.details->>'feeMinor')::numeric*p_seats>9007199254740991 then raise check_violation using message='fee_out_of_range'; end if;
  perform app.fill_waitlist(s.id);
  -- Recheck time immediately before accepting this new party, after queue work.
  if clock_timestamp()>=(s.details->>'startsAt')::timestamptz then raise sqlstate 'P0001' using message='registration_closed'; end if;
  select coalesce(sum(seats),0) into occupied from app.parties where session_id=s.id and state='confirmed';
  result_state:=case when not exists(select 1 from app.parties where session_id=s.id and state='waitlisted')
    and occupied+p_seats<=(s.details->>'capacity')::integer then 'confirmed' else 'waitlisted' end;
  update app.sessions set next_party_sequence=next_party_sequence+1,bookings_started_at=coalesce(bookings_started_at,clock_timestamp()) where id=s.id returning * into s;
  insert into app.parties(session_id,user_id,primary_name,guest_name,seats,state,queue_sequence,consent_version,consent_at)
    values(s.id,p_actor_id,p_primary_name,case when p_seats=2 then p_guest_name else '' end,p_seats,result_state,s.next_party_sequence,s.version,clock_timestamp()) returning * into p;
  if result_state='confirmed' then
    perform app.confirm_party_fee(p.id);
  end if;
  insert into app.registration_events(party_id,kind) values(p.id,result_state);
  insert into app.operation_receipts values(p_actor_id,p_key,'join_session',payload,p.id,now());
  return jsonb_build_object('registration',app.registration_view(p_actor_id,s.id,p.id),'operationKey',p_key);
end;
$$;

create or replace function app.registration_view_before_split(p_actor uuid,p_session uuid,p_party uuid default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare own app.parties; manager boolean; roster jsonb; own_json jsonb;
begin
  select * into own from app.parties where session_id=p_session and user_id=p_actor
    and (p_party is null or id=p_party) order by (state in ('confirmed','waitlisted')) desc,queue_sequence desc limit 1;
  select exists(select 1 from app.group_roles r join app.sessions s on s.group_id=r.group_id
    where s.id=p_session and r.user_id=p_actor and r.role in ('owner','organizer','cohost')) into manager;
  if own.id is not null then
    own_json:=jsonb_build_object('id',own.id,'state',own.state,'seats',own.seats,'primaryName',own.primary_name,'guestName',own.guest_name,
      'consentVersion',own.consent_version,'withdrawnAt',own.withdrawn_at,'queuePosition',case when own.state='waitlisted' then
        (select count(*)+1 from app.parties where session_id=p_session and state='waitlisted' and queue_sequence<own.queue_sequence) else null end,
      'fee',app.party_fee(own.id));
  end if;
  if manager or own.state='confirmed' then
    select coalesce(jsonb_agg(
      case when manager then jsonb_build_object('id',p.id,'primaryName',p.primary_name,'guestName',p.guest_name,'seats',p.seats,'state',p.state,
        'fee',app.managed_fee(p.id),'attendance',app.managed_attendance(p.id))
      else jsonb_build_object('primaryName',p.primary_name,'guestName',p.guest_name,'seats',p.seats) end order by p.queue_sequence),'[]'::jsonb)
      into roster from app.parties p where p.session_id=p_session and (manager or p.state='confirmed');
  end if;
  return jsonb_build_object('own',own_json,'canManage',manager,'rosterAllowed',manager or coalesce(own.state='confirmed',false),
    'roster',coalesce(roster,'[]'::jsonb),'counts',app.registration_counts(p_session));
end;
$$;

create or replace function app.registration_view(p_actor uuid,p_session uuid,p_party uuid default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb; own_id uuid; claim jsonb; rows jsonb;
begin
  result:=app.registration_view_before_split(p_actor,p_session,p_party);
  if app.split_summary(p_session) is null then return result;end if;
  result:=result||jsonb_build_object('split',app.split_summary(p_session));
  own_id:=(result#>>'{own,id}')::uuid;
  if own_id is not null then
    claim:=app.split_claim(own_id,false);
    if claim is not null then result:=jsonb_set(result,'{own}',(result->'own')||jsonb_build_object('splitClaim',claim));end if;
  end if;
  if (result->>'canManage')::boolean then
    select coalesce(jsonb_agg(v||case when app.split_claim((v->>'id')::uuid,true) is null then '{}'::jsonb
      else jsonb_build_object('splitClaim',app.split_claim((v->>'id')::uuid,true)) end order by n),'[]'::jsonb)
      into rows from jsonb_array_elements(result->'roster') with ordinality a(v,n);
    result:=jsonb_set(result,'{roster}',rows);
  end if;
  return result;
end;
$$;

create or replace function api.read_shared_session(p_slug uuid) returns jsonb
language sql volatile security invoker set search_path='' as $$
  select jsonb_build_object('slug',s.slug,'groupName',g.name,'version',s.version,'state',s.state,'details',s.details,
    'counts',app.registration_counts(s.id),'registrationWindow',case when s.state<>'published' or clock_timestamp()>=(s.details->>'startsAt')::timestamptz then 'closed'
      when clock_timestamp()<(s.details->>'opensAt')::timestamptz then 'not_open' else 'open' end)||case when coalesce(s.details->>'feeMode','fixed')='split' then jsonb_build_object('split',app.split_summary(s.id)) else '{}'::jsonb end
  from app.sessions s join app.groups g on g.id=s.group_id where s.slug=p_slug and s.state in ('published','completed','cancelled');
$$;

create or replace function app.release_withdrawal_fee_before_split(p_party uuid,p_actor uuid,p_at timestamptz,p_cutoff timestamptz) returns void
language sql security invoker set search_path='' as $$
  with released as (
    update app.fee_obligations set liability_state='removed_before_cutoff',removed_at=p_at,removed_by=p_actor,revision=revision+1
    where party_id=p_party and liability_state='due' and not marked_paid and p_at<p_cutoff
    returning party_id,revision)
  insert into app.fee_changes(party_id,revision,action,actor_id,actor_name,created_at)
  select r.party_id,r.revision,'removed_before_cutoff',p_actor,p.primary_name,p_at
  from released r join app.parties p on p.id=r.party_id;
$$;

create or replace function app.release_withdrawal_fee(p_party uuid,p_actor uuid,p_at timestamptz,p_cutoff timestamptz) returns void
language plpgsql security invoker set search_path='' as $$
begin
  perform app.release_withdrawal_fee_before_split(p_party,p_actor,p_at,p_cutoff);
  with removed as (
    update app.split_claims set eligible=false,revision=revision+1,changed_at=p_at,changed_by=p_actor
      where party_id=p_party and eligible and p_at<p_cutoff returning revision)
  insert into app.split_claim_changes(party_id,revision,action,actor_id,actor_name,created_at)
    select p_party,r.revision,'removed_before_cutoff',p_actor,p.primary_name,p_at
    from removed r join app.parties p on p.id=p_party;
end;
$$;

create or replace function api.update_payment(p_actor_id uuid,p_actor_name text,p_key uuid,p_slug uuid,p_party_id uuid,p_action text,p_revision integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s app.sessions; f app.fee_obligations; receipt app.operation_receipts; payload jsonb; now_at timestamptz; next_revision integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text||p_key::text,0));
  select * into s from app.sessions where slug=p_slug;
  if not found then raise insufficient_privilege using message='group_access_denied'; end if;
  -- Current role checked under the group lock; a revoked co-host is refused even on replay.
  perform app.require_manager(p_actor_id,s.group_id);
  select * into s from app.sessions where id=s.id for update;
  payload:=jsonb_build_object('slug',p_slug,'partyId',p_party_id,'action',p_action,'revision',p_revision);
  select * into receipt from app.operation_receipts where actor_id=p_actor_id and request_key=p_key;
  if found then
    if receipt.action<>'update_payment' or receipt.payload<>payload then raise sqlstate 'P0001' using message='idempotency_conflict'; end if;
    return jsonb_build_object('registration',app.registration_view(p_actor_id,s.id),'operationKey',p_key);
  end if;
  if p_action not in ('mark_paid','mark_unpaid','waive','undo_waiver') or length(trim(p_actor_name)) not between 1 and 80 then
    raise check_violation using message='invalid_payment_action';
  end if;
  if coalesce(s.details->>'feeMode','fixed')='split' and not exists(select 1 from app.fee_obligations f3 where f3.party_id=p_party_id) then
    return app.update_split_claim(p_actor_id,trim(p_actor_name),p_key,s.id,p_slug,p_party_id,p_action,p_revision);
  end if;
  select f2.* into f from app.fee_obligations f2 join app.parties p on p.id=f2.party_id
    where f2.party_id=p_party_id and p.session_id=s.id for update of f2;
  if not found then raise sqlstate 'P0001' using message='fee_not_found'; end if;
  if f.revision<>p_revision then raise sqlstate 'P0001' using message='stale_payment'; end if;
  now_at:=clock_timestamp();
  if p_action='mark_paid' and f.liability_state='due' and not f.marked_paid then
    update app.fee_obligations set marked_paid=true,payment_marked_at=now_at,payment_marked_by=p_actor_id,revision=revision+1
      where party_id=f.party_id returning revision into next_revision;
  elsif p_action='mark_unpaid' and f.marked_paid then
    update app.fee_obligations set marked_paid=false,payment_marked_at=now_at,payment_marked_by=p_actor_id,revision=revision+1
      where party_id=f.party_id returning revision into next_revision;
  elsif p_action='waive' and f.liability_state='due' and not f.marked_paid then
    update app.fee_obligations set liability_state='waived',removed_at=now_at,removed_by=p_actor_id,revision=revision+1
      where party_id=f.party_id returning revision into next_revision;
  elsif p_action='undo_waiver' and f.liability_state='waived' then
    update app.fee_obligations set liability_state='due',removed_at=null,removed_by=null,revision=revision+1
      where party_id=f.party_id returning revision into next_revision;
  else
    raise sqlstate 'P0001' using message='payment_transition_invalid';
  end if;
  insert into app.fee_changes(party_id,revision,action,actor_id,actor_name,created_at)
    values(f.party_id,next_revision,case p_action when 'mark_paid' then 'marked_paid' when 'mark_unpaid' then 'marked_unpaid'
      when 'waive' then 'waived' else 'waiver_undone' end,p_actor_id,trim(p_actor_name),now_at);
  insert into app.operation_receipts values(p_actor_id,p_key,'update_payment',payload,f.party_id,now_at);
  return jsonb_build_object('registration',app.registration_view(p_actor_id,s.id),'operationKey',p_key);
end;
$$;

revoke all on function app.confirm_party_fee(uuid),app.split_summary(uuid),app.split_claim(uuid,boolean),app.update_split_claim(uuid,text,uuid,uuid,uuid,uuid,text,integer),app.registration_view_before_split(uuid,uuid,uuid),app.release_withdrawal_fee_before_split(uuid,uuid,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function app.confirm_party_fee(uuid),app.split_summary(uuid),app.split_claim(uuid,boolean),app.update_split_claim(uuid,text,uuid,uuid,uuid,uuid,text,integer),app.registration_view_before_split(uuid,uuid,uuid),app.release_withdrawal_fee_before_split(uuid,uuid,timestamptz,timestamptz) to service_role;
