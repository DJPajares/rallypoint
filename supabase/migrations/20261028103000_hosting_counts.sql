-- P-35 / WDL-413: counts follow the new model. A person's "groups" are the
-- groups people join, never the hosting teams behind their sessions, and an
-- Ask to join card shows how often the person played in the viewer's own
-- sessions ("Played in your sessions") instead of in a group.

create or replace function api.read_my_badges(p_actor_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare items jsonb; reached jsonb;
  catalog constant text[] := array['rally','steady','new-faces','plus-one','host','full-house'];
begin
  select coalesce(jsonb_object_agg(c.badge,c.n),'{}'::jsonb) into items
    from (select i.badge,max(i.n) n from app.badge_items(p_actor_id) i group by i.badge) c;
  select coalesce(jsonb_object_agg(r.badge,r.levels),'{}'::jsonb) into reached
    from (select l.badge,jsonb_agg(jsonb_build_object('level',l.level,'earnedAt',l.earned_at,
      'seen',exists(select 1 from app.badge_views v where v.user_id=p_actor_id and v.badge_id=l.badge||':'||l.level)) order by l.level) levels
      from app.badge_levels(p_actor_id) l group by l.badge) r;
  return jsonb_build_object(
    'badges',(select jsonb_agg(jsonb_build_object('key',k,'current',coalesce((items->>k)::integer,0),'levels',coalesce(reached->k,'[]'::jsonb)) order by o)
      from unnest(catalog) with ordinality u(k,o)),
    'title',app.visible_title(p_actor_id),
    'stats',jsonb_build_object('played',(select count(*) from app.badge_sessions(p_actor_id)),
      'hosted',(select count(*) from app.badge_hosted(p_actor_id)),
      'groups',(select count(*) from app.group_roles gr join app.groups gg on gg.id=gr.group_id where gr.user_id=p_actor_id and gg.kind='community')));
end;
$$;

create or replace function api.read_profile(p_profile_id uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare p app.profiles;
  catalog constant text[] := array['rally','steady','new-faces','plus-one','host','full-house'];
begin
  select * into p from app.profiles where profile_id = p_profile_id;
  if p.user_id is null then raise no_data_found using message = 'profile_not_found'; end if;
  return jsonb_build_object('profileId', p.profile_id, 'name', coalesce(p.display_name, p.account_name),
    'title', app.visible_title(p.user_id),
    'badges', coalesce((select jsonb_agg(jsonb_build_object('key', b.badge, 'level', b.level) order by array_position(catalog, b.badge))
      from (select l.badge, max(l.level) level from app.badge_levels(p.user_id) l group by l.badge) b), '[]'::jsonb),
    'stats', jsonb_build_object('played', (select count(*) from app.badge_sessions(p.user_id)),
      'hosted', (select count(*) from app.badge_hosted(p.user_id)),
      'groups', (select count(*) from app.group_roles gr join app.groups gg on gg.id=gr.group_id where gr.user_id=p.user_id and gg.kind='community')),
    'activities', app.profile_activities_json(p.user_id));
end;
$$;

create or replace function app.registration_view(p_actor uuid,p_session uuid,p_party uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb; s app.sessions; r app.join_requests; own_request jsonb; waiting jsonb;
  started boolean; occupied bigint; queued bigint;
begin
  result:=app.registration_view_before_requests(p_actor,p_session,p_party);
  select * into s from app.sessions where id=p_session;
  started:=clock_timestamp()>=(s.details->>'startsAt')::timestamptz;
  select * into r from app.join_requests where session_id=p_session and user_id=p_actor
    order by asked_at desc,id desc limit 1;
  -- A booked person sees their booking, never a request.
  if found and r.state<>'accepted' and not exists(select 1 from app.parties b
      where b.session_id=p_session and b.user_id=p_actor and b.state in ('confirmed','waitlisted')) then
    own_request:=jsonb_build_object('id',r.id,
      'state',case when r.state<>'pending' then r.state
        when s.state='cancelled' then 'session_cancelled'
        when started or s.state<>'published' then 'expired'
        else 'pending' end,
      'seats',r.seats,'guestName',r.guest_name,
      'needsConfirm',r.state='pending' and app.request_needs_confirm(r),
      'askedAt',r.asked_at,
      'cancelsLeft',greatest(0,2-(select count(*) from app.join_requests c
        where c.session_id=p_session and c.user_id=p_actor and c.state='cancelled')));
  end if;
  result:=result||jsonb_build_object('joinRequest',own_request);
  if coalesce((result->>'canManage')::boolean,false) then
    select coalesce(sum(seats),0) into occupied from app.parties where session_id=p_session and state='confirmed';
    select count(*) into queued from app.parties where session_id=p_session and state='waitlisted';
    select coalesce(jsonb_agg(x.item order by x.asked_at,x.id),'[]'::jsonb) into waiting from (
      select q.asked_at,q.id,jsonb_build_object('id',q.id,'profileId',pr.profile_id,
        'name',coalesce(pr.display_name,pr.account_name,q.primary_name),
        'title',app.visible_title(q.user_id),
        'level',(select pa.level from app.profile_activities pa
          where pa.user_id=q.user_id and pa.activity_key=s.activity_key order by pa.position limit 1),
        'played',(select count(*) from app.badge_sessions(q.user_id)),
        'hosted',(select count(*) from app.badge_hosted(q.user_id)),
        'playedWithYou',(select count(*) from app.badge_sessions(q.user_id) b
          where exists(select 1 from app.group_roles m where m.group_id=b.group_id and m.user_id=p_actor
            and m.role in ('owner','organizer','cohost'))),
        'seats',q.seats,'guestName',q.guest_name,'askedAt',q.asked_at,
        'needsConfirm',app.request_needs_confirm(q),
        'fitsNow',queued=0 and occupied+q.seats<=(s.details->>'capacity')::integer,
        'waitlistPosition',case when queued=0 and occupied+q.seats<=(s.details->>'capacity')::integer then null else queued+1 end
      ) as item
      from app.join_requests q left join app.profiles pr on pr.user_id=q.user_id
      where q.session_id=p_session and q.state='pending' and s.state='published' and not started
    ) x;
    result:=result||jsonb_build_object('requests',waiting);
  end if;
  return result;
end;
$$;
