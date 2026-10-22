-- Match the explicit before/after DTO and keep zero amounts out of owing-first order.
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
    'parties',(select coalesce(jsonb_agg(jsonb_build_object('partyId',v->'partyId','previousMinor',v->'previousMinor','currentMinor',v->'totalMinor') order by ord),'[]'::jsonb) from jsonb_array_elements(h.snapshot#>'{preview,parties}') with ordinality a(v,ord))) order by h.revision desc),'[]'::jsonb)
    into history from app.split_runs h where h.session_id=s.id;
  return jsonb_build_object('summary',app.split_summary(s.id),'currentRunId',s.current_split_run_id,
    'revision',s.split_revision,'uncoveredMinor',coalesce(r.total_minor,(s.details->>'totalMinor')::bigint)-covered,'history',history);
end;
$$;

create or replace function api.list_my_dues(p_actor_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(d.item order by d.owing desc,d.starts_at desc),'[]'::jsonb) from (
    select jsonb_build_object('partyId',p.id,'partyState',p.state,'seats',p.seats,'fee',app.party_fee(p.id),
      'session',jsonb_build_object('slug',s.slug,'state',s.state,'title',s.details->>'title','startsAt',s.details->>'startsAt',
        'timeZone',s.details->>'timeZone')) item,
      (f.liability_state='due' and not f.marked_paid and coalesce(f.split_total_minor,f.total_minor)>0) owing,(s.details->>'startsAt')::timestamptz starts_at
    from app.fee_obligations f join app.parties p on p.id=f.party_id join app.sessions s on s.id=p.session_id
    where p.user_id=p_actor_id
    order by owing desc,starts_at desc limit 200) d;
$$;
