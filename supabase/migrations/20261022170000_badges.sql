-- Badges and titles (PRD D-16). Badges are derived on every read from recorded
-- check-ins, hosting check-ins and group ownership, so correcting or cancelling
-- the evidence removes the badge. Only "seen" markers and the chosen title are
-- stored. Nothing here reads payments, no-shows, waitlist position or reliability.
create table app.badge_views (
  user_id uuid not null references auth.users(id) on delete cascade,
  badge_id text not null check (length(badge_id) between 1 and 80),
  seen_at timestamptz not null default now(),
  primary key (user_id,badge_id)
);
create table app.user_titles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  badge_id text not null check (length(badge_id) between 1 and 80),
  updated_at timestamptz not null default now()
);
create index attendance_changes_by_actor on app.attendance_changes(actor_id,party_id);
alter table app.badge_views enable row level security;
alter table app.user_titles enable row level security;
revoke all on app.badge_views,app.user_titles from public,anon,authenticated;
grant select,insert,update,delete on app.badge_views,app.user_titles to service_role;

-- Sessions I attended: seat 1 of a confirmed party checked in, session not cancelled.
create function app.badge_sessions(p_user uuid) returns table(session_id uuid,group_id uuid,at timestamptz,promoted boolean)
language sql stable security invoker set search_path='' as $$
  select p.session_id,s.group_id,min(a.changed_at),
    bool_or(exists(select 1 from app.registration_events e where e.party_id=p.id and e.kind='promoted'))
  from app.parties p
  join app.seat_attendance a on a.party_id=p.id and a.seat=1 and a.state='checked_in'
  join app.sessions s on s.id=p.session_id
  where p.user_id=p_user and p.state='confirmed' and s.state<>'cancelled'
  group by p.session_id,s.group_id;
$$;
-- Other accounts checked in at a session I attended, with when we first played. Guests have no account.
create function app.badge_met(p_user uuid) returns table(user_id uuid,at timestamptz)
language sql stable security invoker set search_path='' as $$
  select o.user_id,min(greatest(m.at,oa.changed_at))
  from app.badge_sessions(p_user) m
  join app.parties o on o.session_id=m.session_id and o.user_id<>p_user and o.state='confirmed'
  join app.seat_attendance oa on oa.party_id=o.id and oa.seat=1 and oa.state='checked_in'
  group by o.user_id;
$$;
-- Sessions I ran: I recorded at least one check-in there (only managers can).
create function app.badge_hosted(p_user uuid) returns table(session_id uuid,at timestamptz,full_house boolean)
language sql stable security invoker set search_path='' as $$
  select s.id,min(c.created_at),
    (select coalesce(sum(f.seats),0) from app.parties f where f.session_id=s.id and f.state='confirmed')>=(s.details->>'capacity')::integer
  from app.attendance_changes c
  join app.parties p on p.id=c.party_id
  join app.sessions s on s.id=p.session_id
  where c.actor_id=p_user and c.state='checked_in' and s.state<>'cancelled'
  group by s.id;
$$;

create function app.earned_badges(p_user uuid) returns table(id text,badge text,group_id uuid,group_name text,earned_at timestamptz)
language sql stable security invoker set search_path='' as $$
  with played as (
    select b.*,row_number() over (order by b.at,b.session_id) n,row_number() over (partition by b.group_id order by b.at,b.session_id) gn
    from app.badge_sessions(p_user) b
  ), met as (
    select m.at,row_number() over (order by m.at,m.user_id) n from app.badge_met(p_user) m
  ), ran as (
    select h.*,row_number() over (order by h.at,h.session_id) n from app.badge_hosted(p_user) h
  ), guests as (
    select min(a.changed_at) at from app.parties p
    join app.seat_attendance a on a.party_id=p.id and a.seat=2 and a.state='checked_in'
    join app.sessions s on s.id=p.session_id
    where p.user_id=p_user and p.state='confirmed' and s.state<>'cancelled'
  )
  select 'first-rally','first-rally',null::uuid,null::text,at from played where n=1
  union all select 'sessions-'||n,'sessions-'||n,null,null,at from played where n in (10,25,50,100)
  union all select 'regular:'||p.group_id,'regular',p.group_id,g.name,p.at from played p join app.groups g on g.id=p.group_id where p.gn=5
  union all select 'off-the-bench','off-the-bench',null,null,min(at) from played where promoted having count(*)>0
  union all select 'plus-one','plus-one',null,null,at from guests where at is not null
  union all select 'new-faces-'||n,'new-faces-'||n,null,null,at from met where n in (10,25,50)
  union all select 'host','host',null,null,at from ran where n=1
  union all select 'hosted-10','hosted-10',null,null,at from ran where n=10
  union all select 'full-house','full-house',null,null,min(at) from ran where full_house having count(*)>0
  union all select 'founder:'||g.id,'founder',g.id,g.name,g.created_at
    from app.group_roles r join app.groups g on g.id=r.group_id where r.user_id=p_user and r.role='owner';
$$;

-- Counted badges under way: the next milestone, Regular per group, and hosting.
create function app.badge_progress(p_user uuid) returns table(badge text,group_id uuid,group_name text,current integer,target integer)
language sql stable security invoker set search_path='' as $$
  with played as (select count(*)::integer n from app.badge_sessions(p_user)),
  per_group as (select b.group_id,count(*)::integer n from app.badge_sessions(p_user) b group by b.group_id),
  met as (select count(*)::integer n from app.badge_met(p_user)),
  ran as (select count(*)::integer n from app.badge_hosted(p_user))
  select 'sessions-'||t,null::uuid,null::text,p.n,t from played p
    cross join lateral (select min(x) t from unnest(array[10,25,50,100]) x where x>p.n) next where p.n>0 and next.t is not null
  union all select 'regular',pg.group_id,g.name,pg.n,5 from per_group pg join app.groups g on g.id=pg.group_id where pg.n<5
  union all select 'new-faces-'||t,null,null,m.n,t from met m
    cross join lateral (select min(x) t from unnest(array[10,25,50]) x where x>m.n) next where m.n>0 and next.t is not null
  union all select 'hosted-10',null,null,r.n,10 from ran r where r.n between 1 and 9;
$$;

-- The chosen title, only while its badge is still earned.
create function app.visible_title(p_user uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare chosen text;
begin
  select badge_id into chosen from app.user_titles where user_id=p_user;
  if chosen is null then return null; end if;
  return (select jsonb_build_object('key',e.badge,'groupName',e.group_name) from app.earned_badges(p_user) e where e.id=chosen);
end;
$$;

create function api.read_my_badges(p_actor_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare earned jsonb; title jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'key',e.badge,'groupId',e.group_id,'groupName',e.group_name,'earnedAt',e.earned_at,
    'seen',exists(select 1 from app.badge_views v where v.user_id=p_actor_id and v.badge_id=e.id)) order by e.earned_at,e.id),'[]'::jsonb)
    into earned from app.earned_badges(p_actor_id) e;
  select jsonb_build_object('id',t.badge_id,'key',x->'key','groupName',x->'groupName') into title
    from app.user_titles t cross join jsonb_array_elements(earned) x where t.user_id=p_actor_id and x->>'id'=t.badge_id;
  return jsonb_build_object('earned',earned,
    'progress',coalesce((select jsonb_agg(jsonb_build_object('key',g.badge,'groupId',g.group_id,'groupName',g.group_name,'current',g.current,'target',g.target)
      order by g.badge,g.group_name) from app.badge_progress(p_actor_id) g),'[]'::jsonb),
    'title',title,
    'stats',jsonb_build_object('played',(select count(*) from app.badge_sessions(p_actor_id)),
      'hosted',(select count(*) from app.badge_hosted(p_actor_id)),
      'groups',(select count(*) from app.group_roles where user_id=p_actor_id)));
end;
$$;

-- Records only badges that are earned right now; anything else is ignored.
create function api.mark_badges_seen(p_actor_id uuid,p_ids text[]) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
  if coalesce(cardinality(p_ids),0) not between 1 and 50 then raise check_violation using message='invalid_badges'; end if;
  insert into app.badge_views(user_id,badge_id)
    select p_actor_id,e.id from app.earned_badges(p_actor_id) e where e.id=any(p_ids)
    on conflict do nothing;
  return api.read_my_badges(p_actor_id);
end;
$$;

create function api.set_my_title(p_actor_id uuid,p_badge_id text) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
  if p_badge_id is null then
    delete from app.user_titles where user_id=p_actor_id;
  elsif not exists(select 1 from app.earned_badges(p_actor_id) e where e.id=p_badge_id) then
    raise check_violation using message='title_not_earned';
  else
    insert into app.user_titles(user_id,badge_id) values(p_actor_id,p_badge_id)
      on conflict(user_id) do update set badge_id=excluded.badge_id,updated_at=now();
  end if;
  return api.read_my_badges(p_actor_id);
end;
$$;

-- Same roster as before, plus each person's visible title.
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
        'fee',app.managed_fee(p.id),'attendance',app.managed_attendance(p.id),'title',app.visible_title(p.user_id))
      else jsonb_build_object('primaryName',p.primary_name,'guestName',p.guest_name,'seats',p.seats,'title',app.visible_title(p.user_id)) end order by p.queue_sequence),'[]'::jsonb)
      into roster from app.parties p where p.session_id=p_session and (manager or p.state='confirmed');
  end if;
  return jsonb_build_object('own',own_json,'canManage',manager,'rosterAllowed',manager or coalesce(own.state='confirmed',false),
    'roster',coalesce(roster,'[]'::jsonb),'counts',app.registration_counts(p_session));
end;
$$;

revoke all on function app.badge_sessions(uuid),app.badge_met(uuid),app.badge_hosted(uuid),app.earned_badges(uuid),app.badge_progress(uuid),
  app.visible_title(uuid),api.read_my_badges(uuid),api.mark_badges_seen(uuid,text[]),api.set_my_title(uuid,text) from public,anon,authenticated;
grant execute on function app.badge_sessions(uuid),app.badge_met(uuid),app.badge_hosted(uuid),app.earned_badges(uuid),app.badge_progress(uuid),
  app.visible_title(uuid),api.read_my_badges(uuid),api.mark_badges_seen(uuid,text[]),api.set_my_title(uuid,text) to service_role;
