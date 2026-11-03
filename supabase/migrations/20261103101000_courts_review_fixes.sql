-- Review fixes for areas and courts (WDL-419). add_court says which field it
-- refuses, so the app can say the right thing; areas list in order of the
-- name people see; and checking an interrupted add by its request key finds
-- the court instead of falling through to the session checks.
--
-- Recovery: restore api.add_court and api.read_areas from
-- 20261103100000_areas_courts.sql, then
--   drop function api.read_operation(uuid,uuid);
--   alter function app.read_operation_before_courts(uuid,uuid) set schema api;
--   alter function api.read_operation_before_courts(uuid,uuid) rename to read_operation;

create or replace function api.add_court(p_actor_id uuid, p_key uuid, p_area_key text, p_name text, p_maps_url text)
returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare receipt app.operation_receipts; result_id uuid;
  clean_name text := btrim(p_name);
  clean_url text := nullif(btrim(coalesce(p_maps_url, '')), '');
  payload jsonb;
begin
  if p_actor_id is null then raise insufficient_privilege; end if;
  payload := jsonb_build_object('area', p_area_key, 'name', clean_name, 'mapsUrl', clean_url);
  if p_key is null then raise check_violation using message = 'invalid_input'; end if;
  if not exists (select 1 from app.areas where key = p_area_key) then
    raise check_violation using message = 'invalid_area';
  end if;
  if clean_name is null or char_length(clean_name) not between 1 and 60
    or clean_name !~ '[[:alnum:]]' or clean_name ~ '[[:cntrl:]]' then
    raise check_violation using message = 'invalid_name';
  end if;
  if clean_url is not null and (char_length(clean_url) > 500 or clean_url !~ '^https://[^[:space:]]+$') then
    raise check_violation using message = 'invalid_link';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text || p_key::text, 0));
  select * into receipt from app.operation_receipts where actor_id = p_actor_id and request_key = p_key;
  if found then
    if receipt.action <> 'add_court' or receipt.payload <> payload then
      raise sqlstate 'P0001' using message = 'idempotency_conflict';
    end if;
    result_id := receipt.resource_id;
  else
    -- One person's adds queue, so the limit holds under parallel requests.
    perform pg_advisory_xact_lock(hashtextextended('courts:' || p_actor_id::text, 0));
    if (select count(*) from app.courts where created_by = p_actor_id) >= 20 then
      raise sqlstate 'P0001' using message = 'court_limit';
    end if;
    begin
      insert into app.courts(area_key, name, maps_url, created_by)
        values (p_area_key, clean_name, clean_url, p_actor_id) returning id into result_id;
    exception when unique_violation then
      raise sqlstate 'P0001' using message = 'court_exists';
    end;
    insert into app.operation_receipts values (p_actor_id, p_key, 'add_court', payload, result_id, now());
  end if;
  return (select jsonb_build_object('court', jsonb_build_object('id', c.id, 'name', c.name, 'area', c.area_key, 'mapsUrl', c.maps_url),
      'operationKey', p_key)
    from app.courts c where c.id = result_id);
end;
$$;

create or replace function api.read_areas() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', g.key, 'name', g.name, 'areas',
      (select jsonb_agg(jsonb_build_object('key', a.key, 'label', coalesce(a.everyday_name, a.name))
          order by lower(coalesce(a.everyday_name, a.name)))
        from app.areas a where a.region_key = g.key)) order by g.sort_order), '[]'::jsonb)
  from app.regions g;
$$;

-- Recovery by key answers with the court the person added.
alter function api.read_operation(uuid,uuid) rename to read_operation_before_courts;
alter function api.read_operation_before_courts(uuid,uuid) set schema app;
create function api.read_operation(p_actor_id uuid,p_key uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r app.operation_receipts;
begin
  select * into r from app.operation_receipts where actor_id=p_actor_id and request_key=p_key;
  if r.action='add_court' then
    return (select jsonb_build_object('operationKey',p_key,'court',
        jsonb_build_object('id',c.id,'name',c.name,'area',c.area_key,'mapsUrl',c.maps_url))
      from app.courts c where c.id=r.resource_id);
  end if;
  return app.read_operation_before_courts(p_actor_id,p_key);
end;
$$;

revoke all on function api.add_court(uuid,uuid,text,text,text), api.read_areas(),
  app.read_operation_before_courts(uuid,uuid), api.read_operation(uuid,uuid)
  from public, anon, authenticated;
grant execute on function api.add_court(uuid,uuid,text,text,text), api.read_areas(),
  app.read_operation_before_courts(uuid,uuid), api.read_operation(uuid,uuid)
  to service_role;
