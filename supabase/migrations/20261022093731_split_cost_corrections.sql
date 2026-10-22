-- Reviewed repricing keeps immutable runs and prior payment declarations intact.
alter table app.fee_changes drop constraint fee_changes_action_check;
alter table app.fee_changes add constraint fee_changes_action_check check(action in ('marked_paid','marked_unpaid','waived','waiver_undone','removed_before_cutoff','split_corrected'));
grant update(split_total_minor,split_run_id) on app.fee_obligations to service_role;

create function app.own_split_history(p_party uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('previousMinor',v->'previousMinor','currentMinor',v->'currentMinor',
   'kind',r.snapshot->>'kind','at',r.created_at) order by r.revision desc),'[]'::jsonb)
 from app.split_runs r cross join lateral jsonb_array_elements(coalesce(r.snapshot->'changes','[]'::jsonb)) a(v)
 where v->>'partyId'=p_party::text and v->'previousMinor' is distinct from v->'currentMinor';
$$;

create or replace function app.split_preview(p_session uuid,p_input jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare s app.sessions; r app.split_runs; c app.split_claims; result jsonb; rows jsonb; blocked jsonb;
  total bigint; undo_party uuid; intent text:=p_input->>'intent';
begin
 select * into s from app.sessions where id=p_session;
 if coalesce(s.details->>'feeMode','fixed')<>'split' or s.state not in ('published','completed') then raise sqlstate 'P0001' using message='split_unavailable';end if;
 if intent='finalize' then
   if s.current_split_run_id is not null then raise sqlstate 'P0001' using message='split_already_finalized';end if;
   total:=(s.details->>'totalMinor')::bigint;
 elsif intent='correct' then
   if s.current_split_run_id is null then raise sqlstate 'P0001' using message='split_not_finalized';end if;
   select * into r from app.split_runs where id=s.current_split_run_id;
   if jsonb_typeof(p_input->'totalMinor') is distinct from 'number' or (p_input->>'totalMinor')::numeric<>trunc((p_input->>'totalMinor')::numeric) then raise check_violation using message='invalid_split';end if;
   total:=(p_input->>'totalMinor')::bigint;
   if total is null or total not between 0 and 9007199254740991 then raise check_violation using message='invalid_split';end if;
   if total>r.total_minor then raise sqlstate 'P0001' using message='split_total_increase';end if;
   undo_party:=(p_input->>'undoWaiverPartyId')::uuid;
   if undo_party is not null then
     select c2.* into c from app.split_claims c2 join app.parties p on p.id=c2.party_id where p.session_id=s.id and c2.party_id=undo_party;
     if not found or not c.eligible or not c.waived then raise sqlstate 'P0001' using message='split_undo_requires_review';end if;
   end if;
 else raise check_violation using message='invalid_split';end if;
 result:=app.split_allocation(s.id,total,undo_party);
 select coalesce(jsonb_agg(v||jsonb_build_object('previousMinor',f.split_total_minor,'markedPaid',coalesce(f.marked_paid,false),
   'primaryName',p.primary_name,'guestName',p.guest_name,'changes',app.own_split_history(p.id)) order by ord),'[]'::jsonb)
   into rows from jsonb_array_elements(result->'parties') with ordinality a(v,ord)
   join app.parties p on p.id=(v->>'partyId')::uuid left join app.fee_obligations f on f.party_id=p.id;
 select coalesce(jsonb_agg(f.party_id order by f.party_id),'[]'::jsonb) into blocked
   from app.fee_obligations f join app.parties p on p.id=f.party_id
   left join lateral(select (v->>'totalMinor')::bigint amount from jsonb_array_elements(result->'parties') a(v) where v->>'partyId'=f.party_id::text) proposed on true
   where p.session_id=s.id and f.marked_paid and proposed.amount is distinct from f.split_total_minor;
 return result||jsonb_build_object('parties',rows,'basis',app.split_basis(s.id,p_input),'currency',s.details->>'currency',
   'currentRunId',s.current_split_run_id,'blockedPaidPartyIds',blocked);
end;
$$;

create function api.correct_split(p_actor_id uuid,p_actor_name text,p_key uuid,p_slug uuid,p_basis text,p_total_minor bigint,p_reason text,p_undo_party uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s app.sessions; receipt app.operation_receipts; old_run app.split_runs; payload jsonb; input jsonb; preview jsonb;
 run_id uuid; at_time timestamptz; changes jsonb; kind text; v jsonb; f app.fee_obligations; party uuid; new_amount bigint; rev integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text||p_key::text,0));
 select * into s from app.sessions where slug=p_slug;
 if not found then raise insufficient_privilege using message='group_access_denied';end if;
 perform app.require_manager(p_actor_id,s.group_id);
 select * into s from app.sessions where id=s.id for update;
 payload:=jsonb_build_object('slug',p_slug,'basis',p_basis,'totalMinor',p_total_minor,'reason',p_reason,'undoWaiverPartyId',p_undo_party);
 select * into receipt from app.operation_receipts where actor_id=p_actor_id and request_key=p_key;
 if found then
   if receipt.action<>'correct_split' or receipt.payload<>payload then raise sqlstate 'P0001' using message='idempotency_conflict';end if;
   return jsonb_build_object('operationKey',p_key,'committedRunId',receipt.resource_id,'registration',app.registration_view(p_actor_id,s.id),'split',app.managed_split(s.id));
 end if;
 at_time:=clock_timestamp();perform app.require_split_start(s,at_time);
 if p_basis is null or p_basis !~ '^[0-9a-f]{64}$' or p_reason is null or length(trim(p_reason)) not between 1 and 300 or p_actor_name is null or length(trim(p_actor_name)) not between 1 and 80 then raise check_violation using message='invalid_split';end if;
 input:=jsonb_build_object('intent','correct','totalMinor',p_total_minor)||case when p_undo_party is null then '{}'::jsonb else jsonb_build_object('undoWaiverPartyId',p_undo_party) end;
 preview:=app.split_preview(s.id,input);
 if preview->>'basis'<>p_basis then raise sqlstate 'P0001' using message='stale_split';end if;
 if jsonb_array_length(preview->'blockedPaidPartyIds')>0 then raise sqlstate 'P0001' using message='split_paid_allocation';end if;
 select * into old_run from app.split_runs where id=s.current_split_run_id;
 kind:=case when p_undo_party is not null then 'waiver_restored' when p_total_minor<old_run.total_minor then 'total_reduced' else 'waiver_redistributed' end;
 -- Record the full previous/current allocation union, including parties excluded now.
 with previous as(select party_id,sum(amount_minor)::bigint amount from app.split_allocations where run_id=s.current_split_run_id group by party_id),
 proposed as(select (x->>'partyId')::uuid party_id,(x->>'totalMinor')::bigint amount from jsonb_array_elements(preview->'parties') a(x))
 select coalesce(jsonb_agg(jsonb_build_object('partyId',coalesce(a.party_id,b.party_id),'previousMinor',a.amount,'currentMinor',b.amount) order by coalesce(a.party_id,b.party_id)),'[]'::jsonb)
 into changes from previous a full join proposed b using(party_id);
 insert into app.split_runs(session_id,revision,total_minor,currency,paying_seats,state,basis,snapshot,actor_id,actor_name,created_at,reason)
 values(s.id,s.split_revision+1,p_total_minor,preview->>'currency',(preview->>'payingSeats')::bigint,preview->>'state',p_basis,
   jsonb_build_object('preview',preview,'financialBasis',app.split_basis_state(s.id,input),'changes',changes,'kind',kind),p_actor_id,trim(p_actor_name),at_time,trim(p_reason)) returning id into run_id;
 insert into app.split_allocations(run_id,party_id,seat,amount_minor)
 select run_id,(x->>'partyId')::uuid,(x->>'seat')::smallint,(x->>'amountMinor')::bigint from jsonb_array_elements(preview->'seats') a(x);
 if p_undo_party is not null then
   update app.split_claims set waived=false,revision=revision+1,changed_at=at_time,changed_by=p_actor_id where party_id=p_undo_party returning revision into rev;
   insert into app.split_claim_changes values(p_undo_party,rev,'waiver_undone',p_actor_id,trim(p_actor_name),at_time);
 end if;
 for v in select value from jsonb_array_elements(preview->'parties') loop
   party:=(v->>'partyId')::uuid;new_amount:=(v->>'totalMinor')::bigint;
   select * into f from app.fee_obligations where party_id=party for update;
   if not found then
     -- Revision 1 is the allocation; revision 2 attributes its reviewed introduction.
     insert into app.fee_obligations(party_id,unit_minor,charged_seats,currency,mode,split_total_minor,split_run_id,revision)
       values(party,null,(v->>'chargedSeats')::integer,preview->>'currency','split',new_amount,run_id,2);
     rev:=2;
     insert into app.fee_changes(party_id,revision,action,actor_id,actor_name,created_at,previous_minor,current_minor,currency,split_run_id)
       values(party,rev,'split_corrected',p_actor_id,trim(p_actor_name),at_time,null,new_amount,preview->>'currency',run_id);
   elsif f.split_total_minor is distinct from new_amount or f.liability_state<>'due' then
     update app.fee_obligations set split_total_minor=new_amount,split_run_id=run_id,liability_state='due',removed_at=null,removed_by=null,revision=revision+1
       where party_id=party returning revision into rev;
     insert into app.fee_changes(party_id,revision,action,actor_id,actor_name,created_at,previous_minor,current_minor,currency,split_run_id)
       values(party,rev,'split_corrected',p_actor_id,trim(p_actor_name),at_time,f.split_total_minor,new_amount,f.currency,run_id);
   end if;
 end loop;
 update app.sessions set split_revision=split_revision+1,current_split_run_id=run_id where id=s.id;
 insert into app.operation_receipts values(p_actor_id,p_key,'correct_split',payload,run_id,at_time);
 return jsonb_build_object('operationKey',p_key,'committedRunId',run_id,'registration',app.registration_view(p_actor_id,s.id),'split',app.managed_split(s.id));
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
  if f.mode='split' and p_action='undo_waiver' and not exists(select 1 from app.split_allocations a where a.run_id=s.current_split_run_id and a.party_id=f.party_id) then
    raise sqlstate 'P0001' using message='split_undo_requires_review';end if;
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
  if f.mode='split' and p_action in ('waive','undo_waiver') then
    with changed as(update app.split_claims set waived=(p_action='waive'),revision=revision+1,changed_at=now_at,changed_by=p_actor_id where party_id=f.party_id returning party_id,revision)
    insert into app.split_claim_changes select party_id,revision,case p_action when 'waive' then 'waived' else 'waiver_undone' end,p_actor_id,trim(p_actor_name),now_at from changed;
  end if;
  insert into app.operation_receipts values(p_actor_id,p_key,'update_payment',payload,f.party_id,now_at);
  return jsonb_build_object('registration',app.registration_view(p_actor_id,s.id),'operationKey',p_key);
end;
$$;

create or replace function app.update_split_claim(p_actor uuid,p_name text,p_key uuid,p_session uuid,p_slug uuid,p_party uuid,p_action text,p_revision integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c app.split_claims; next_revision integer; at_time timestamptz:=clock_timestamp();payload jsonb;
begin
  select c2.* into c from app.split_claims c2 join app.parties p on p.id=c2.party_id
    where c2.party_id=p_party and p.session_id=p_session for update of c2;
  if not found then raise sqlstate 'P0001' using message='fee_not_found';end if;
  if c.revision<>p_revision then raise sqlstate 'P0001' using message='stale_payment';end if;
  if p_action='undo_waiver' and c.waived and exists(select 1 from app.sessions where id=p_session and current_split_run_id is not null) then
    raise sqlstate 'P0001' using message='split_undo_requires_review';end if;
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
    if claim is not null then result:=jsonb_set(result,'{own}',(result->'own')||jsonb_build_object('splitClaim',claim,'splitHistory',app.own_split_history(own_id)));end if;
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

create or replace function app.managed_split(p_session uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare s app.sessions; r app.split_runs; covered bigint; history jsonb;
begin
  select * into s from app.sessions where id=p_session;
  select * into r from app.split_runs where id=s.current_split_run_id;
  select coalesce(sum(a.amount_minor),0) into covered from app.split_allocations a join app.fee_obligations f on f.party_id=a.party_id
    where a.run_id=s.current_split_run_id and f.liability_state='due';
  select coalesce(jsonb_agg(jsonb_build_object('runId',h.id,'totalMinor',h.total_minor,'currency',h.currency,
    'payingSeats',h.paying_seats,'by',h.actor_name,'at',h.created_at,'reason',h.reason,
    'parties',coalesce(h.snapshot->'changes',(select coalesce(jsonb_agg(jsonb_build_object('partyId',v->'partyId','previousMinor',v->'previousMinor','currentMinor',v->'totalMinor') order by ord),'[]'::jsonb) from jsonb_array_elements(h.snapshot#>'{preview,parties}') with ordinality a(v,ord)))) order by h.revision desc),'[]'::jsonb)
    into history from app.split_runs h where h.session_id=s.id;
  return jsonb_build_object('summary',app.split_summary(s.id),'currentRunId',s.current_split_run_id,
    'revision',s.split_revision,'uncoveredMinor',coalesce(r.total_minor,(s.details->>'totalMinor')::bigint)-covered,'history',history);
end;
$$;

revoke all on function app.own_split_history(uuid),api.correct_split(uuid,text,uuid,uuid,text,bigint,text,uuid) from public,anon,authenticated;
grant execute on function app.own_split_history(uuid),api.correct_split(uuid,text,uuid,uuid,text,bigint,text,uuid) to service_role;
