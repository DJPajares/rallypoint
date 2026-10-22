-- Qualify the PL/pgSQL pricing-run variable separately from allocation columns.
create or replace function api.correct_split(p_actor_id uuid,p_actor_name text,p_key uuid,p_slug uuid,p_basis text,p_total_minor bigint,p_reason text,p_undo_party uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s app.sessions; receipt app.operation_receipts; old_run app.split_runs; payload jsonb; input jsonb; preview jsonb;
 new_run_id uuid; at_time timestamptz; changes jsonb; kind text; v jsonb; f app.fee_obligations; party uuid; new_amount bigint; rev integer;
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
   jsonb_build_object('preview',preview,'financialBasis',app.split_basis_state(s.id,input),'changes',changes,'kind',kind),p_actor_id,trim(p_actor_name),at_time,trim(p_reason)) returning id into new_run_id;
 insert into app.split_allocations(run_id,party_id,seat,amount_minor)
 select new_run_id,(x->>'partyId')::uuid,(x->>'seat')::smallint,(x->>'amountMinor')::bigint from jsonb_array_elements(preview->'seats') a(x);
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
       values(party,null,(v->>'chargedSeats')::integer,preview->>'currency','split',new_amount,new_run_id,2);
     rev:=2;
     insert into app.fee_changes(party_id,revision,action,actor_id,actor_name,created_at,previous_minor,current_minor,currency,split_run_id)
       values(party,rev,'split_corrected',p_actor_id,trim(p_actor_name),at_time,null,new_amount,preview->>'currency',new_run_id);
   elsif f.split_total_minor is distinct from new_amount or f.liability_state<>'due' then
     update app.fee_obligations set split_total_minor=new_amount,split_run_id=new_run_id,liability_state='due',removed_at=null,removed_by=null,revision=revision+1
       where party_id=party returning revision into rev;
     insert into app.fee_changes(party_id,revision,action,actor_id,actor_name,created_at,previous_minor,current_minor,currency,split_run_id)
       values(party,rev,'split_corrected',p_actor_id,trim(p_actor_name),at_time,f.split_total_minor,new_amount,f.currency,new_run_id);
   end if;
 end loop;
 update app.sessions set split_revision=split_revision+1,current_split_run_id=new_run_id where id=s.id;
 insert into app.operation_receipts values(p_actor_id,p_key,'correct_split',payload,new_run_id,at_time);
 return jsonb_build_object('operationKey',p_key,'committedRunId',new_run_id,'registration',app.registration_view(p_actor_id,s.id),'split',app.managed_split(s.id));
end;
$$;
