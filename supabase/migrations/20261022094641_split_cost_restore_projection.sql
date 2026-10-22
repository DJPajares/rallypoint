-- Current-run membership decides whether the organizer must review restoration.
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
      else jsonb_build_object('splitClaim',app.split_claim((v->>'id')::uuid,true),'splitUndoRequiresReview',exists(select 1 from app.sessions s join app.split_claims c on c.party_id=(v->>'id')::uuid where s.id=p_session and s.current_split_run_id is not null and c.waived and not exists(select 1 from app.split_allocations a where a.run_id=s.current_split_run_id and a.party_id=c.party_id))) end order by n),'[]'::jsonb)
      into rows from jsonb_array_elements(result->'roster') with ordinality a(v,n);
    result:=jsonb_set(result,'{roster}',rows);
  end if;
  return result;
end;
$$;
