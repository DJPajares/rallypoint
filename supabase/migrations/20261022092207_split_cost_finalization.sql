-- Immutable pricing runs and per-seat amounts; pending claims remain distinct.
create table app.split_runs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references app.sessions(id),
  revision integer not null check(revision>0),
  total_minor bigint not null check(total_minor between 0 and 9007199254740991),
  currency text not null check(currency in ('SGD','USD','EUR','GBP','JPY','KWD')),
  paying_seats bigint not null check(paying_seats between 0 and 9007199254740991),
  state text not null check(state in ('allocated','unallocated')),
  basis text not null check(basis ~ '^[0-9a-f]{64}$'),
  snapshot jsonb not null,
  actor_id uuid not null references auth.users(id),
  actor_name text not null check(length(actor_name) between 1 and 80),
  created_at timestamptz not null,
  reason text not null default '' check(length(reason)<=300),
  unique(session_id,revision),unique(session_id,id)
);
create table app.split_allocations (
  run_id uuid not null references app.split_runs(id),
  party_id uuid not null references app.parties(id),
  seat smallint not null check(seat in (1,2)),
  amount_minor bigint not null check(amount_minor between 0 and 9007199254740991),
  primary key(run_id,party_id,seat)
);
create index split_allocations_by_party on app.split_allocations(party_id,run_id);
alter table app.sessions add column split_revision integer not null default 0 check(split_revision>=0),
  add column current_split_run_id uuid,
  add constraint current_split_matches_session foreign key(id,current_split_run_id) references app.split_runs(session_id,id);
alter table app.split_runs enable row level security;
alter table app.split_allocations enable row level security;
revoke all on app.split_runs,app.split_allocations from public,anon,authenticated;
grant select,insert on app.split_runs,app.split_allocations to service_role;
alter table app.fee_obligations
  alter column unit_minor drop not null,
  add column mode text not null default 'fixed' check(mode in ('fixed','split')),
  add column split_total_minor bigint check(split_total_minor between 0 and 9007199254740991),
  add column split_run_id uuid references app.split_runs(id),
  add constraint fee_amount_basis check(
    (mode='fixed' and unit_minor is not null and split_total_minor is null and split_run_id is null) or
    (mode='split' and unit_minor is null and split_total_minor is not null and split_run_id is not null));
alter table app.fee_changes add column previous_minor bigint,
  add column current_minor bigint, add column currency text,
  add column split_run_id uuid references app.split_runs(id);
update app.fee_changes c set previous_minor=f.total_minor,current_minor=f.total_minor,currency=f.currency
  from app.fee_obligations f where f.party_id=c.party_id;

create or replace function app.party_fee(p_party uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('unitMinor',unit_minor,'chargedSeats',charged_seats,'currency',currency,
    'totalMinor',coalesce(split_total_minor,total_minor),'liabilityState',liability_state,'removedAt',removed_at,'markedPaid',marked_paid)
    ||case when mode='split' then jsonb_build_object('mode','split','splitRunId',split_run_id) else '{}'::jsonb end
  from app.fee_obligations where party_id=p_party;
$$;
create or replace function app.managed_fee(p_party uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select app.party_fee(f.party_id)||jsonb_build_object('revision',f.revision,'history',
    coalesce((select jsonb_agg(jsonb_build_object('action',c.action,'by',c.actor_name,'at',c.created_at,
      'previousMinor',c.previous_minor,'currentMinor',c.current_minor,'currency',c.currency,'splitRunId',c.split_run_id)
      order by c.revision desc) from app.fee_changes c where c.party_id=f.party_id),'[]'::jsonb))
  from app.fee_obligations f where f.party_id=p_party;
$$;

create function app.require_split_start(p_session app.sessions,p_at timestamptz) returns void
language plpgsql security invoker set search_path='' as $$
begin
  if p_session.state not in ('published','completed') then raise sqlstate 'P0001' using message='split_unavailable';end if;
  if p_at<(p_session.details->>'startsAt')::timestamptz then raise sqlstate 'P0001' using message='split_too_early';end if;
end;
$$;
create function app.split_allocation(p_session uuid,p_total_minor bigint,p_undo_party uuid default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare n bigint; result jsonb;
begin
  if p_total_minor is null or p_total_minor not between 0 and 9007199254740991 then raise check_violation using message='invalid_split';end if;
  select coalesce(sum(p.seats),0) into n from app.parties p join app.split_claims c on c.party_id=p.id
    where p.session_id=p_session and c.eligible and (not c.waived or c.party_id=p_undo_party);
  if n>9007199254740991 then raise check_violation using message='invalid_split';end if;
  if n=0 then return jsonb_build_object('state','unallocated','totalMinor',p_total_minor,'payingSeats',0,
    'unallocatedMinor',p_total_minor,'seats','[]'::jsonb,'parties','[]'::jsonb);end if;
  with ordered as (
    select p.id,p.queue_sequence,p.seats,k.seat,row_number() over(order by p.queue_sequence,p.id,k.seat)-1 position
    from app.parties p join app.split_claims c on c.party_id=p.id cross join lateral generate_series(1,p.seats) k(seat)
    where p.session_id=p_session and c.eligible and (not c.waived or c.party_id=p_undo_party)
  ), allocated as (
    select *,p_total_minor/n+case when position<p_total_minor%n then 1 else 0 end minor from ordered
  ), grouped as (
    select id,queue_sequence,seats,sum(minor)::bigint total from allocated group by id,queue_sequence,seats
  ) select jsonb_build_object('state','allocated','totalMinor',p_total_minor,'payingSeats',n,'unallocatedMinor',0,
    'seats',(select jsonb_agg(jsonb_build_object('partyId',id,'seat',seat,'amountMinor',minor) order by position) from allocated),
    'parties',(select jsonb_agg(jsonb_build_object('partyId',id,'chargedSeats',seats,'totalMinor',total) order by queue_sequence,id) from grouped)) into result;
  return result;
end;
$$;

create function app.split_basis_state(p_session uuid,p_input jsonb) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('input',p_input,'sessionId',s.id,'state',s.state,'details',s.details,
    'revision',s.split_revision,'currentRunId',s.current_split_run_id,'claims',coalesce((
      select jsonb_agg(jsonb_build_object('partyId',p.id,'state',p.state,'seats',p.seats,'sequence',p.queue_sequence::text,
        'eligible',c.eligible,'waived',c.waived,'revision',c.revision,'feeRevision',f.revision,
        'paid',f.marked_paid,'liability',f.liability_state,'amount',coalesce(f.split_total_minor,f.total_minor)) order by p.id)
      from app.parties p join app.split_claims c on c.party_id=p.id left join app.fee_obligations f on f.party_id=p.id
      where p.session_id=s.id),'[]'::jsonb)) from app.sessions s where s.id=p_session;
$$;
create function app.split_basis(p_session uuid,p_input jsonb) returns text
language sql stable security invoker set search_path='' as $$
  select encode(sha256(convert_to(app.split_basis_state(p_session,p_input)::text,'UTF8')),'hex');
$$;
create function app.split_preview(p_session uuid,p_input jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare s app.sessions; result jsonb; rows jsonb;
begin
  select * into s from app.sessions where id=p_session;
  if coalesce(s.details->>'feeMode','fixed')<>'split' or s.state not in ('published','completed') then
    raise sqlstate 'P0001' using message='split_unavailable';end if;
  if p_input->>'intent' is distinct from 'finalize' then raise check_violation using message='invalid_split';end if;
  if s.current_split_run_id is not null then raise sqlstate 'P0001' using message='split_already_finalized';end if;
  result:=app.split_allocation(s.id,(s.details->>'totalMinor')::bigint);
  select coalesce(jsonb_agg(v||jsonb_build_object('previousMinor',null,'markedPaid',false,
    'primaryName',p.primary_name,'guestName',p.guest_name,'changes','[]'::jsonb) order by ord),'[]'::jsonb)
    into rows from jsonb_array_elements(result->'parties') with ordinality a(v,ord) join app.parties p on p.id=(v->>'partyId')::uuid;
  return result||jsonb_build_object('parties',rows,'basis',app.split_basis(s.id,p_input),'currency',s.details->>'currency',
    'currentRunId',s.current_split_run_id,'blockedPaidPartyIds','[]'::jsonb);
end;
$$;

create function app.managed_split(p_session uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare s app.sessions; r app.split_runs; covered bigint; history jsonb;
begin
  select * into s from app.sessions where id=p_session;
  select * into r from app.split_runs where id=s.current_split_run_id;
  select coalesce(sum(a.amount_minor),0) into covered from app.split_allocations a join app.fee_obligations f on f.party_id=a.party_id
    where a.run_id=s.current_split_run_id and f.liability_state='due';
  select coalesce(jsonb_agg(jsonb_build_object('runId',h.id,'totalMinor',h.total_minor,'currency',h.currency,
    'payingSeats',h.paying_seats,'by',h.actor_name,'at',h.created_at,'reason',h.reason,
    'parties',h.snapshot#>'{preview,parties}') order by h.revision desc),'[]'::jsonb)
    into history from app.split_runs h where h.session_id=s.id;
  return jsonb_build_object('summary',app.split_summary(s.id),'currentRunId',s.current_split_run_id,
    'revision',s.split_revision,'uncoveredMinor',coalesce(r.total_minor,(s.details->>'totalMinor')::bigint)-covered,'history',history);
end;
$$;

create function api.read_split(p_actor_id uuid,p_slug uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s app.sessions;
begin
  select * into s from app.sessions where slug=p_slug;
  if not found then raise insufficient_privilege using message='group_access_denied';end if;
  perform app.require_manager(p_actor_id,s.group_id);
  select * into s from app.sessions where id=s.id for share;
  if coalesce(s.details->>'feeMode','fixed')<>'split' then raise sqlstate 'P0001' using message='split_unavailable';end if;
  return jsonb_build_object('split',app.managed_split(s.id));
end;
$$;
create function api.preview_split(p_actor_id uuid,p_slug uuid,p_input jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s app.sessions;
begin
  select * into s from app.sessions where slug=p_slug;
  if not found then raise insufficient_privilege using message='group_access_denied';end if;
  perform app.require_manager(p_actor_id,s.group_id);
  select * into s from app.sessions where id=s.id for share;
  return jsonb_build_object('preview',app.split_preview(s.id,p_input));
end;
$$;

create function api.finalize_split(p_actor_id uuid,p_actor_name text,p_key uuid,p_slug uuid,p_basis text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s app.sessions; r app.operation_receipts; payload jsonb; preview jsonb; run_id uuid; at_time timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text||p_key::text,0));
  select * into s from app.sessions where slug=p_slug;
  if not found then raise insufficient_privilege using message='group_access_denied';end if;
  perform app.require_manager(p_actor_id,s.group_id);
  select * into s from app.sessions where id=s.id for update;
  payload:=jsonb_build_object('slug',p_slug,'basis',p_basis);
  select * into r from app.operation_receipts where actor_id=p_actor_id and request_key=p_key;
  if found then
    if r.action<>'finalize_split' or r.payload<>payload then raise sqlstate 'P0001' using message='idempotency_conflict';end if;
    return jsonb_build_object('operationKey',p_key,'committedRunId',r.resource_id,'registration',app.registration_view(p_actor_id,s.id),'split',app.managed_split(s.id));
  end if;
  at_time:=clock_timestamp();
  perform app.require_split_start(s,at_time);
  if p_basis is null or p_basis !~ '^[0-9a-f]{64}$' or length(trim(p_actor_name)) not between 1 and 80 then
    raise check_violation using message='invalid_split';end if;
  preview:=app.split_preview(s.id,jsonb_build_object('intent','finalize'));
  if preview->>'basis'<>p_basis then raise sqlstate 'P0001' using message='stale_split';end if;
  insert into app.split_runs(session_id,revision,total_minor,currency,paying_seats,state,basis,snapshot,actor_id,actor_name,created_at)
    values(s.id,s.split_revision+1,(preview->>'totalMinor')::bigint,preview->>'currency',(preview->>'payingSeats')::bigint,
      preview->>'state',p_basis,jsonb_build_object('preview',preview,'financialBasis',app.split_basis_state(s.id,jsonb_build_object('intent','finalize'))),p_actor_id,trim(p_actor_name),at_time) returning id into run_id;
  insert into app.split_allocations(run_id,party_id,seat,amount_minor)
    select run_id,(v->>'partyId')::uuid,(v->>'seat')::smallint,(v->>'amountMinor')::bigint from jsonb_array_elements(preview->'seats') a(v);
  insert into app.fee_obligations(party_id,unit_minor,charged_seats,currency,mode,split_total_minor,split_run_id)
    select (v->>'partyId')::uuid,null,(v->>'chargedSeats')::integer,preview->>'currency','split',(v->>'totalMinor')::bigint,run_id
    from jsonb_array_elements(preview->'parties') a(v);
  update app.sessions set split_revision=split_revision+1,current_split_run_id=run_id where id=s.id;
  insert into app.operation_receipts values(p_actor_id,p_key,'finalize_split',payload,run_id,at_time);
  return jsonb_build_object('operationKey',p_key,'committedRunId',run_id,'registration',app.registration_view(p_actor_id,s.id),'split',app.managed_split(s.id));
end;
$$;


create or replace function app.split_summary(p_session uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare s app.sessions; r app.split_runs; n bigint; total bigint; base bigint; rem bigint;
begin
  select * into s from app.sessions where id=p_session;
  if coalesce(s.details->>'feeMode','fixed')<>'split' then return null; end if;
  if s.current_split_run_id is not null then
    select * into r from app.split_runs where id=s.current_split_run_id;
    return jsonb_build_object('phase',case when r.state='unallocated' then 'unallocated' else 'finalized' end,
      'currency',r.currency,'totalMinor',r.total_minor,'payingSeats',r.paying_seats,'estimatedSeatRange',null,'prospectivePartyMinor',null);
  end if;
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

create or replace function app.split_claim(p_party uuid,p_managed boolean) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare c app.split_claims; p app.parties; summary jsonb; n bigint; total bigint; preceding bigint; result jsonb;
begin
  select * into c from app.split_claims where party_id=p_party;
  if not found then return null; end if;
  select * into p from app.parties where id=p_party;
  summary:=app.split_summary(p.session_id);n:=(summary->>'payingSeats')::bigint;total:=(summary->>'totalMinor')::bigint;
  if c.eligible and not c.waived and n>0 and summary->>'phase'='estimating' then
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
  if f.mode='split' and f.split_total_minor=0 and p_action='mark_paid' then raise sqlstate 'P0001' using message='payment_transition_invalid';end if;
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
  insert into app.fee_changes(party_id,revision,action,actor_id,actor_name,created_at,previous_minor,current_minor,currency,split_run_id)
    values(f.party_id,next_revision,case p_action when 'mark_paid' then 'marked_paid' when 'mark_unpaid' then 'marked_unpaid'
      when 'waive' then 'waived' else 'waiver_undone' end,p_actor_id,trim(p_actor_name),now_at,coalesce(f.split_total_minor,f.total_minor),coalesce(f.split_total_minor,f.total_minor),f.currency,f.split_run_id);
  insert into app.operation_receipts values(p_actor_id,p_key,'update_payment',payload,f.party_id,now_at);
  return jsonb_build_object('registration',app.registration_view(p_actor_id,s.id),'operationKey',p_key);
end;
$$;

create or replace function app.read_operation_before_split(p_actor_id uuid,p_key uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r app.operation_receipts; s app.sessions; p app.parties;
begin
  select * into r from app.operation_receipts where actor_id=p_actor_id and request_key=p_key;
  if not found then return null; end if;
  if r.action in ('join_session','withdraw_party') then
    select * into p from app.parties where id=r.resource_id and user_id=p_actor_id;
    select * into s from app.sessions where id=p.session_id;
    perform 1 from app.groups where id=s.group_id for share;
    perform 1 from app.sessions where id=s.id for share;
    return jsonb_build_object('operationKey',p_key,'registration',app.registration_view(p_actor_id,s.id,p.id));
  elsif r.action in ('update_payment','record_attendance') then
    select * into p from app.parties where id=r.resource_id;
    select * into s from app.sessions where id=p.session_id;
    perform app.require_manager(p_actor_id,s.group_id);
    perform 1 from app.sessions where id=s.id for share;
    return jsonb_build_object('operationKey',p_key,'registration',app.registration_view(p_actor_id,s.id));
  elsif r.action='save_session' then
    select * into s from app.sessions where id=r.resource_id;
    perform app.require_manager(p_actor_id,s.group_id);
    select * into s from app.sessions where id=r.resource_id;
    return jsonb_build_object('operationKey',p_key,'session',app.session_view(s));
  end if;
  perform app.require_manager(p_actor_id,r.resource_id);
  return jsonb_build_object('operationKey',p_key,'groupId',r.resource_id);
end;
$$;

create or replace function api.read_operation(p_actor_id uuid,p_key uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare receipt app.operation_receipts; s app.sessions;
begin
  select * into receipt from app.operation_receipts where actor_id=p_actor_id and request_key=p_key;
  if receipt.action in ('finalize_split','correct_split') then
    select s2.* into s from app.sessions s2 join app.split_runs r on r.session_id=s2.id where r.id=receipt.resource_id;
    perform app.require_manager(p_actor_id,s.group_id);
    perform 1 from app.sessions where id=s.id for share;
    return jsonb_build_object('operationKey',p_key,'committedRunId',receipt.resource_id,
      'registration',app.registration_view(p_actor_id,s.id),'split',app.managed_split(s.id));
  end if;
  return app.read_operation_before_split(p_actor_id,p_key);
end;
$$;

create function api.list_my_split_claims(p_actor_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(d.item order by d.starts_at desc),'[]'::jsonb) from (
    select jsonb_build_object('partyId',p.id,'partyState',p.state,'seats',p.seats,
      'split',app.split_summary(s.id),'splitClaim',app.split_claim(p.id,false),
      'session',jsonb_build_object('slug',s.slug,'state',s.state,'title',s.details->>'title','startsAt',s.details->>'startsAt','timeZone',s.details->>'timeZone')) item,
      (s.details->>'startsAt')::timestamptz starts_at
    from app.split_claims c join app.parties p on p.id=c.party_id join app.sessions s on s.id=p.session_id
    where p.user_id=p_actor_id and not exists(select 1 from app.fee_obligations f where f.party_id=p.id)
    order by starts_at desc limit 200) d;
$$;

revoke all on function app.require_split_start(app.sessions,timestamptz),app.split_allocation(uuid,bigint,uuid),app.split_basis_state(uuid,jsonb),app.split_basis(uuid,jsonb),app.split_preview(uuid,jsonb),app.managed_split(uuid),api.read_split(uuid,uuid),api.preview_split(uuid,uuid,jsonb),api.finalize_split(uuid,text,uuid,uuid,text),app.read_operation_before_split(uuid,uuid),api.list_my_split_claims(uuid) from public,anon,authenticated;
grant execute on function app.require_split_start(app.sessions,timestamptz),app.split_allocation(uuid,bigint,uuid),app.split_basis_state(uuid,jsonb),app.split_basis(uuid,jsonb),app.split_preview(uuid,jsonb),app.managed_split(uuid),api.read_split(uuid,uuid),api.preview_split(uuid,uuid,jsonb),api.finalize_split(uuid,text,uuid,uuid,text),app.read_operation_before_split(uuid,uuid),api.list_my_split_claims(uuid) to service_role;
