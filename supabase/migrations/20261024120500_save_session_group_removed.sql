-- Saving into a removed group now says so, instead of the generic organizer
-- access message. Only the archived refusal's message changes.
create or replace function api.save_session(p_actor_id uuid,p_key uuid,p_group_id uuid,p_session_id uuid,p_intent text,p_version integer,p_details jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s app.sessions;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text||p_key::text,0));
  perform app.require_manager(p_actor_id,p_group_id);
  if (select archived_at from app.groups where id=p_group_id) is not null then
    raise insufficient_privilege using message='group_removed';
  end if;
  if p_session_id is not null then
    select * into s from app.sessions where id=p_session_id and group_id=p_group_id for update;
    if s.state in ('cancelled','completed') and not exists(
      select 1 from app.operation_receipts where actor_id=p_actor_id and request_key=p_key) then
      raise sqlstate 'P0001' using message='session_closed';end if;
  end if;
  return app.save_session_before_cancellation(p_actor_id,p_key,p_group_id,p_session_id,p_intent,p_version,p_details);
end;
$$;
