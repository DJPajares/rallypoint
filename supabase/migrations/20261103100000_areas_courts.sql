-- Areas and courts for ranked play (D-26, WDL-419). Areas are Singapore's 55
-- URA planning areas (Master Plan 2019) in their five regions, with an
-- everyday name where people use a different one. A court is shared by
-- everyone and belongs to one area: a name, the area and an optional https
-- Maps link. No coordinates are stored. Who added a court is kept for the
-- per-person limit and never returned by a read.
--
-- Recovery:
--   drop function api.read_areas(), api.list_courts(uuid,text),
--     api.add_court(uuid,uuid,text,text,text);
--   drop table app.courts, app.areas, app.regions;

create table app.regions (
  key text primary key check (key ~ '^[a-z][a-z-]{1,19}$'),
  name text not null unique,
  sort_order integer not null
);
insert into app.regions(key, name, sort_order) values
  ('central', 'Central', 1),
  ('east', 'East', 2),
  ('north', 'North', 3),
  ('north-east', 'North-East', 4),
  ('west', 'West', 5);

create table app.areas (
  key text primary key check (key ~ '^[a-z][a-z-]{1,39}$'),
  name text not null unique,
  everyday_name text unique,
  region_key text not null references app.regions(key),
  sort_order integer not null
);
insert into app.areas(key, name, everyday_name, region_key, sort_order) values
  ('bishan', 'Bishan', null, 'central', 1),
  ('bukit-merah', 'Bukit Merah', null, 'central', 2),
  ('bukit-timah', 'Bukit Timah', null, 'central', 3),
  ('downtown-core', 'Downtown Core', 'CBD (Downtown Core)', 'central', 4),
  ('geylang', 'Geylang', null, 'central', 5),
  ('kallang', 'Kallang', null, 'central', 6),
  ('marina-east', 'Marina East', null, 'central', 7),
  ('marina-south', 'Marina South', null, 'central', 8),
  ('marine-parade', 'Marine Parade', null, 'central', 9),
  ('museum', 'Museum', null, 'central', 10),
  ('newton', 'Newton', null, 'central', 11),
  ('novena', 'Novena', null, 'central', 12),
  ('orchard', 'Orchard', null, 'central', 13),
  ('outram', 'Outram', null, 'central', 14),
  ('queenstown', 'Queenstown', null, 'central', 15),
  ('river-valley', 'River Valley', null, 'central', 16),
  ('rochor', 'Rochor', null, 'central', 17),
  ('singapore-river', 'Singapore River', null, 'central', 18),
  ('southern-islands', 'Southern Islands', 'Sentosa (Southern Islands)', 'central', 19),
  ('straits-view', 'Straits View', null, 'central', 20),
  ('tanglin', 'Tanglin', null, 'central', 21),
  ('toa-payoh', 'Toa Payoh', null, 'central', 22),
  ('bedok', 'Bedok', null, 'east', 1),
  ('changi', 'Changi', null, 'east', 2),
  ('changi-bay', 'Changi Bay', null, 'east', 3),
  ('pasir-ris', 'Pasir Ris', null, 'east', 4),
  ('paya-lebar', 'Paya Lebar', null, 'east', 5),
  ('tampines', 'Tampines', null, 'east', 6),
  ('central-water-catchment', 'Central Water Catchment', null, 'north', 1),
  ('lim-chu-kang', 'Lim Chu Kang', null, 'north', 2),
  ('mandai', 'Mandai', null, 'north', 3),
  ('sembawang', 'Sembawang', null, 'north', 4),
  ('simpang', 'Simpang', null, 'north', 5),
  ('sungei-kadut', 'Sungei Kadut', null, 'north', 6),
  ('woodlands', 'Woodlands', null, 'north', 7),
  ('yishun', 'Yishun', null, 'north', 8),
  ('ang-mo-kio', 'Ang Mo Kio', null, 'north-east', 1),
  ('hougang', 'Hougang', null, 'north-east', 2),
  ('north-eastern-islands', 'North-Eastern Islands', null, 'north-east', 3),
  ('punggol', 'Punggol', null, 'north-east', 4),
  ('seletar', 'Seletar', null, 'north-east', 5),
  ('sengkang', 'Sengkang', null, 'north-east', 6),
  ('serangoon', 'Serangoon', null, 'north-east', 7),
  ('boon-lay', 'Boon Lay', null, 'west', 1),
  ('bukit-batok', 'Bukit Batok', null, 'west', 2),
  ('bukit-panjang', 'Bukit Panjang', null, 'west', 3),
  ('choa-chu-kang', 'Choa Chu Kang', null, 'west', 4),
  ('clementi', 'Clementi', null, 'west', 5),
  ('jurong-east', 'Jurong East', null, 'west', 6),
  ('jurong-west', 'Jurong West', null, 'west', 7),
  ('pioneer', 'Pioneer', null, 'west', 8),
  ('tengah', 'Tengah', null, 'west', 9),
  ('tuas', 'Tuas', null, 'west', 10),
  ('western-islands', 'Western Islands', null, 'west', 11),
  ('western-water-catchment', 'Western Water Catchment', null, 'west', 12);

create table app.courts (
  id uuid primary key default gen_random_uuid(),
  area_key text not null references app.areas(key),
  name text not null check (char_length(name) between 1 and 60 and name = btrim(name)
    and name ~ '[[:alnum:]]' and name !~ '[[:cntrl:]]'),
  maps_url text check (maps_url is null or (char_length(maps_url) <= 500 and maps_url ~ '^https://[^[:space:]]+$')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
-- One listing per name in an area, ignoring case.
create unique index courts_area_name on app.courts(area_key, lower(name));
create index courts_created_by on app.courts(created_by);

alter table app.regions enable row level security;
alter table app.areas enable row level security;
alter table app.courts enable row level security;
revoke all on app.regions, app.areas, app.courts from public, anon, authenticated;
grant select, insert, update, delete on app.regions, app.areas, app.courts to service_role;

-- The regions in order, each with its areas in order; public.
create function api.read_areas() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', g.key, 'name', g.name, 'areas',
      (select jsonb_agg(jsonb_build_object('key', a.key, 'label', coalesce(a.everyday_name, a.name)) order by a.sort_order)
        from app.areas a where a.region_key = g.key)) order by g.sort_order), '[]'::jsonb)
  from app.regions g;
$$;

-- One area's courts by name, for a signed-in person. Never says who added one.
create function api.list_courts(p_actor_id uuid, p_area_key text) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
begin
  if p_actor_id is null then raise insufficient_privilege; end if;
  if not exists (select 1 from app.areas where key = p_area_key) then
    raise check_violation using message = 'invalid_input';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'area', c.area_key, 'mapsUrl', c.maps_url)
      order by lower(c.name)), '[]'::jsonb)
    from app.courts c where c.area_key = p_area_key);
end;
$$;

-- Add a court. The same request key returns the same court; up to 20 per
-- person; a name already listed in that area is refused.
create function api.add_court(p_actor_id uuid, p_key uuid, p_area_key text, p_name text, p_maps_url text)
returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare receipt app.operation_receipts; result_id uuid;
  clean_name text := btrim(p_name);
  clean_url text := nullif(btrim(coalesce(p_maps_url, '')), '');
  payload jsonb;
begin
  if p_actor_id is null then raise insufficient_privilege; end if;
  payload := jsonb_build_object('area', p_area_key, 'name', clean_name, 'mapsUrl', clean_url);
  if p_key is null or not exists (select 1 from app.areas where key = p_area_key)
    or clean_name is null or char_length(clean_name) not between 1 and 60
    or clean_name !~ '[[:alnum:]]' or clean_name ~ '[[:cntrl:]]'
    or (clean_url is not null and (char_length(clean_url) > 500 or clean_url !~ '^https://[^[:space:]]+$')) then
    raise check_violation using message = 'invalid_input';
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

revoke all on function api.read_areas(), api.list_courts(uuid,text), api.add_court(uuid,uuid,text,text,text)
  from public, anon, authenticated;
grant execute on function api.read_areas(), api.list_courts(uuid,text), api.add_court(uuid,uuid,text,text,text)
  to service_role;
