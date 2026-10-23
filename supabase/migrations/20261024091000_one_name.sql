-- One name everywhere (P-21): a saved or cleared name is copied onto every
-- record that stores the person's name, so existing rosters, histories and
-- emails show the current name. Only the name columns are written; states,
-- seats, fees, ids and timestamps are never touched, and none of the written
-- tables queue emails on update.
--
-- Runs as the table owner because the history tables are append-only for the
-- service role. Callable only through the api functions (execute is granted to
-- service_role alone) and it takes the person's id, never a name.
create or replace function app.propagate_name(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare shown text;
begin
  select coalesce(display_name, account_name) into shown from app.profiles where user_id = p_user;
  if shown is null then return; end if;
  update app.parties set primary_name = shown where user_id = p_user and primary_name is distinct from shown;
  update app.fee_changes set actor_name = shown where actor_id = p_user and actor_name is distinct from shown;
  update app.attendance_changes set actor_name = shown where actor_id = p_user and actor_name is distinct from shown;
  update app.split_claim_changes set actor_name = shown where actor_id = p_user and actor_name is distinct from shown;
  update app.split_runs set actor_name = shown where actor_id = p_user and actor_name is distinct from shown;
  update app.session_cancellations set actor_name = shown where actor_id = p_user and actor_name is distinct from shown;
  update app.payment_instructions set updated_by_name = shown where updated_by = p_user and updated_by_name is distinct from shown;
end;
$$;

-- Same as before, and a refreshed account name (when no chosen name overrides
-- it) is carried onto the person's records too.
create or replace function api.ensure_my_profile(p_actor_id uuid, p_account_name text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare account text := left(coalesce(nullif(btrim(p_account_name), ''), 'Participant'), 80); result jsonb; changed integer;
begin
  insert into app.profiles(user_id, account_name) values (p_actor_id, account)
    on conflict (user_id) do update set account_name = excluded.account_name
    where app.profiles.account_name is distinct from excluded.account_name;
  get diagnostics changed = row_count;
  if changed > 0 and exists (select 1 from app.profiles where user_id = p_actor_id and display_name is null) then
    perform app.propagate_name(p_actor_id);
  end if;
  select jsonb_build_object('profileId', p.profile_id, 'name', coalesce(p.display_name, p.account_name))
    into result from app.profiles p where p.user_id = p_actor_id;
  return result;
end;
$$;

-- Same roster as before; each entry also carries the person's profile id (null
-- when they have no profile row yet) so a name can link to their profile.
create or replace function app.registration_view_before_split(p_actor uuid,p_session uuid,p_party uuid default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare own app.parties; manager boolean; roster jsonb; own_json jsonb;
begin
  select * into own from app.parties where session_id=p_session and user_id=p_actor
    and (p_party is null or id=p_party) order by (state in ('confirmed','waitlisted')) desc,queue_sequence desc limit 1;
  select exists(select 1 from app.group_roles r join app.sessions s on s.group_id=r.group_id
    where s.id=p_session and r.user_id=p_actor and r.role in ('owner','organizer','cohost')) into manager;
  if own.id is not null then
    own_json:=jsonb_build_object('id',own.id,'state',own.state,'seats',own.seats,'primaryName',own.primary_name,'guestName',own.guest_name,
      'consentVersion',own.consent_version,'withdrawnAt',own.withdrawn_at,'queuePosition',case when own.state='waitlisted' then
        (select count(*)+1 from app.parties where session_id=p_session and state='waitlisted' and queue_sequence<own.queue_sequence) else null end,
      'fee',app.party_fee(own.id));
  end if;
  if manager or own.state='confirmed' then
    select coalesce(jsonb_agg(
      case when manager then jsonb_build_object('id',p.id,'primaryName',p.primary_name,'guestName',p.guest_name,'seats',p.seats,'state',p.state,
        'fee',app.managed_fee(p.id),'attendance',app.managed_attendance(p.id),'title',app.visible_title(p.user_id),
        'profileId',(select pr.profile_id from app.profiles pr where pr.user_id=p.user_id))
      else jsonb_build_object('primaryName',p.primary_name,'guestName',p.guest_name,'seats',p.seats,'title',app.visible_title(p.user_id),
        'profileId',(select pr.profile_id from app.profiles pr where pr.user_id=p.user_id)) end order by p.queue_sequence),'[]'::jsonb)
      into roster from app.parties p where p.session_id=p_session and (manager or p.state='confirmed');
  end if;
  return jsonb_build_object('own',own_json,'canManage',manager,'rosterAllowed',manager or coalesce(own.state='confirmed',false),
    'roster',coalesce(roster,'[]'::jsonb),'counts',app.registration_counts(p_session));
end;
$$;
