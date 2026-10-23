-- Payment instructions changed after booking (PRD D-18, P-04). When a published
-- session that already has bookings gets its payment instructions saved, changed
-- or removed, the change leaves one private notice per saved revision. A later
-- task (P-06) reads these to email each confirmed and waitlisted primary one
-- link to the session. The notice holds no instruction text, image or actor:
-- people read the instructions on the session itself, where entitlement is
-- checked.

create table app.payment_instruction_notices (
  session_id uuid not null references app.sessions(id) on delete cascade,
  revision integer not null check(revision>0),
  created_at timestamptz not null,
  primary key(session_id,revision)
);
alter table app.payment_instruction_notices enable row level security;
revoke all on app.payment_instruction_notices from public,anon,authenticated;
grant select,insert on app.payment_instruction_notices to service_role;

-- Same signature, manager check and "Not tracked here" refusal as the
-- payment-modes wrapper. It takes the actor/key lock first (re-entrant for the
-- inner function) so it can tell a replay from a new change before anything is
-- written: a replayed request returns the saved result and adds no notice.
create or replace function api.update_payment_instructions(p_actor_id uuid,p_actor_name text,p_key uuid,p_session_id uuid,p_revision integer,
  p_action text,p_body text,p_image_path text,p_image_type text,p_image_bytes integer,p_image_sha256 text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s app.sessions; replay boolean; result jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text||p_key::text,0));
  select * into s from app.sessions where id=p_session_id;
  if not found then raise insufficient_privilege using message='group_access_denied';end if;
  perform app.require_manager(p_actor_id,s.group_id);
  select * into s from app.sessions where id=p_session_id;
  if coalesce(s.details->>'paymentMode','organizer')='untracked' then raise sqlstate 'P0001' using message='payment_not_tracked';end if;
  replay:=exists(select 1 from app.operation_receipts where actor_id=p_actor_id and request_key=p_key);
  result:=app.update_payment_instructions_before_payment_modes(p_actor_id,p_actor_name,p_key,p_session_id,p_revision,p_action,p_body,
    p_image_path,p_image_type,p_image_bytes,p_image_sha256);
  -- The group lock taken above holds booking, publishing and cancellation still,
  -- so the state read before the change is the state it was made in.
  if not replay and s.state='published' and s.bookings_started_at is not null then
    insert into app.payment_instruction_notices(session_id,revision,created_at)
      values(p_session_id,(result->>'revision')::integer,clock_timestamp())
      on conflict do nothing;
  end if;
  return result;
end;
$$;

revoke all on function api.update_payment_instructions(uuid,text,uuid,uuid,integer,text,text,text,text,integer,text) from public,anon,authenticated;
grant execute on function api.update_payment_instructions(uuid,text,uuid,uuid,integer,text,text,text,text,integer,text) to service_role;
