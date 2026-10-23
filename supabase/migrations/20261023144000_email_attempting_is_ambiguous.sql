-- P-06 email delivery: an attempt that began and never finished is not confirmed.
--
-- api.begin_email_attempt marks a job it is about to send as sending/attempting,
-- and the settle step already treats such a job as an unknown outcome when it
-- ends it. The organizer views did not: a drain that died after beginning, with
-- no drain running afterwards, showed "Not sent" and counted the job as not sent
-- once it expired, though the message may already have gone out. Both views now
-- treat a sending/attempting job like an ambiguous one. Replaces the functions in
-- 20261023143000; signatures, volatility and grants are unchanged.

create or replace function app.party_emails(p_session uuid,p_user uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('kind',x.kind,'status',x.status,'reason',x.reason,'attempts',x.attempts,'at',x.at)
    order by x.created_at,x.kind),'[]'::jsonb)
  from (
    select distinct on (j.kind) j.kind,j.created_at,j.attempts,j.updated_at as at,
      case
        when j.state in ('queued','sending') and j.expires_at<=now() then case when (j.ambiguous or (j.state='sending' and j.reason='attempting')) then 'not_confirmed' else 'not_sent' end
        when j.state='sending' then 'queued'
        else j.state
      end as status,
      case
        when j.state in ('queued','sending') and j.expires_at<=now() then case when (j.ambiguous or (j.state='sending' and j.reason='attempting')) then null else 'expired' end
        when j.state in ('queued','sending') and j.reason in ('daily_limit','monthly_limit') then j.reason
        when j.state='not_sent' and j.reason in ('superseded','expired','rejected','render_failed','attempts_exhausted','delivery_disabled',
          'queue_capacity','no_verified_email','destination_changed') then j.reason
        else null
      end as reason
    from app.email_jobs j where j.session_id=p_session and j.user_id=p_user
    order by j.kind,j.created_at desc,j.id desc
  ) x;
$$;

create or replace function app.session_email_summary(p_session uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object(
    'suppressed',coalesce((select jsonb_agg(jsonb_build_object('kind',s.kind,'reason',s.reason,'recipients',s.recipients,'at',s.created_at)
      order by s.created_at,s.id) from app.email_suppressions s where s.session_id=p_session
        and not (s.kind='instructions_changed' and exists(select 1 from app.email_jobs j
          where j.session_id=p_session and j.kind='instructions_changed' and j.created_at>s.created_at))),'[]'::jsonb),
    'cancellation',(select jsonb_build_object(
        'queued',count(*) filter (where j.state in ('queued','sending') and j.expires_at>now()),
        'sent',count(*) filter (where j.state='sent'),
        'notConfirmed',count(*) filter (where j.state='not_confirmed'
          or (j.state in ('queued','sending') and j.expires_at<=now() and (j.ambiguous or (j.state='sending' and j.reason='attempting')))),
        'notSent',count(*) filter (where j.state='not_sent'
          or (j.state in ('queued','sending') and j.expires_at<=now() and not (j.ambiguous or (j.state='sending' and j.reason='attempting')))))
      from app.email_jobs j where j.session_id=p_session and j.kind='cancelled' having count(*)>0));
$$;
