-- P-06 email delivery, last step: what organizers and co-hosts may know about the
-- emails around a session. Each roster row gets the latest email of every kind
-- for that party's primary, in one of four plain states, and the session gets a
-- summary: updates withheld because they would have reached too many people, and
-- how the cancellation emails went. Nobody else gets either key, and no address,
-- body or provider detail is read here.

-- The latest job of each kind for one account in one session. Waiting and
-- in-flight both read as queued. A reason is kept only when it is one the
-- organizer can be told: the sending limits while queued, or why it was not sent.
-- Anything else (a provider's own code, the in-flight marker) is dropped.
create function app.party_emails(p_session uuid,p_user uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('kind',x.kind,'status',x.status,'reason',x.reason,'attempts',x.attempts,'at',x.at)
    order by x.created_at,x.kind),'[]'::jsonb)
  from (
    select distinct on (j.kind) j.kind,j.created_at,j.attempts,j.updated_at as at,
      case j.state when 'sending' then 'queued' else j.state end as status,
      case
        when j.state in ('queued','sending') and j.reason in ('daily_limit','monthly_limit') then j.reason
        when j.state='not_sent' and j.reason in ('superseded','expired','rejected','attempts_exhausted','delivery_disabled',
          'queue_capacity','no_verified_email','destination_changed') then j.reason
        else null
      end as reason
    from app.email_jobs j where j.session_id=p_session and j.user_id=p_user
    order by j.kind,j.created_at desc,j.id desc
  ) x;
$$;

-- Withheld updates and the cancellation tally. The tally is null until a
-- cancellation email has been queued for anyone.
create function app.session_email_summary(p_session uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object(
    'suppressed',coalesce((select jsonb_agg(jsonb_build_object('kind',s.kind,'reason',s.reason,'recipients',s.recipients,'at',s.created_at)
      order by s.created_at,s.id) from app.email_suppressions s where s.session_id=p_session),'[]'::jsonb),
    'cancellation',(select jsonb_build_object(
        'queued',count(*) filter (where j.state in ('queued','sending')),
        'sent',count(*) filter (where j.state='sent'),
        'notConfirmed',count(*) filter (where j.state='not_confirmed'),
        'notSent',count(*) filter (where j.state='not_sent'))
      from app.email_jobs j where j.session_id=p_session and j.kind='cancelled' having count(*)>0));
$$;

-- Like the views it wraps, this is not marked STABLE. A confirmed participant's
-- registration is returned exactly as before.
alter function app.registration_view(uuid,uuid,uuid) rename to registration_view_before_email_status;
create function app.registration_view(p_actor uuid,p_session uuid,p_party uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb; rows jsonb;
begin
  result:=app.registration_view_before_email_status(p_actor,p_session,p_party);
  if not coalesce((result->>'canManage')::boolean,false) then return result; end if;
  select coalesce(jsonb_agg(a.entry||jsonb_build_object('emails',coalesce(app.party_emails(p_session,pa.user_id),'[]'::jsonb)) order by a.n),'[]'::jsonb)
    into rows from jsonb_array_elements(result->'roster') with ordinality a(entry,n)
    left join app.parties pa on pa.id=(a.entry->>'id')::uuid;
  return jsonb_set(result,'{roster}',rows)||jsonb_build_object('emailSummary',app.session_email_summary(p_session));
end;
$$;

revoke all on function app.party_emails(uuid,uuid),app.session_email_summary(uuid),
  app.registration_view_before_email_status(uuid,uuid,uuid),app.registration_view(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function app.party_emails(uuid,uuid),app.session_email_summary(uuid),
  app.registration_view_before_email_status(uuid,uuid,uuid),app.registration_view(uuid,uuid,uuid)
  to service_role;
