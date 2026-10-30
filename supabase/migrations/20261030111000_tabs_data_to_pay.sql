-- Review fix: Home's "N to pay" counts the same people as the session's game
-- day "To pay": anyone in the session whose fee is due, unpaid and above zero,
-- including someone who withdrew after the cutoff and a final split share.

create or replace function app.my_session_extras(p_row jsonb) returns jsonb
language sql stable security invoker set search_path='' as $$
  select p_row||jsonb_build_object('location',coalesce(s.details->>'location',''))
    ||case when p_row->>'status'='organizing' and s.state='published'
        and (s.details->>'startsAt')::timestamptz>now() then
      jsonb_build_object(
        'waitingCount',(select count(*) from app.parties w where w.session_id=s.id and w.state='waitlisted'),
        'toPayCount',case when coalesce(s.details->>'paymentMode','organizer')='organizer' then
          (select count(*) from app.parties p join app.fee_obligations f on f.party_id=p.id
            where p.session_id=s.id and f.liability_state='due' and not f.marked_paid
              and coalesce(f.split_total_minor,f.total_minor)>0) else 0 end)
      else '{}'::jsonb end
  from app.sessions s where s.slug=(p_row->>'slug')::uuid;
$$;
