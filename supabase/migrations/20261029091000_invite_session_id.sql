-- P-38: the session page's organizers need the session's id to invite people.
create or replace function app.registration_view(p_actor uuid,p_session uuid,p_party uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb; mine jsonb;
begin
  result:=app.registration_view_before_invites(p_actor,p_session,p_party);
  select jsonb_build_object('id',i.id,'inviterName',i.inviter_name) into mine
    from app.invites i where i.session_id=p_session and i.invitee_id=p_actor and i.state='pending'
      and app.session_open_for_invites(p_session) limit 1;
  result:=result||jsonb_build_object('invite',mine);
  if coalesce((result->>'canManage')::boolean,false) then
    result:=result||jsonb_build_object('sessionId',p_session,'invites',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,
        'name',coalesce(pr.display_name,pr.account_name,'Participant'),'state',i.state,'sentAt',i.created_at)
        order by i.created_at desc),'[]'::jsonb)
      from app.invites i left join app.profiles pr on pr.user_id=i.invitee_id where i.session_id=p_session));
  end if;
  return result;
end;
$$;
