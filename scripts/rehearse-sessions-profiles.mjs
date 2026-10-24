// Synthetic-only rehearsal. Creates and removes its own databases on local Docker;
// never reads DATABASE_URL, links a project, or contacts hosted Supabase.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { functions } from "../packages/database/src/functions.ts";
const container = "supabase_db_rallypoint";
const base = `rp_profile_rehearsal_${Date.now()}`;
const restored = `${base}_restore`;
const created = [];
const docker = (args, input) =>
  execFileSync("docker", args, {
    input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 32 * 1024 * 1024,
  });
const query = (db, input) =>
  docker(
    [
      "exec",
      "-i",
      container,
      "psql",
      "-X",
      "-U",
      "postgres",
      "-d",
      db,
      "-v",
      "ON_ERROR_STOP=1",
      "-Atq",
    ],
    input,
  ).trim();
const create = (db) => {
  docker(["exec", container, "createdb", "-U", "postgres", db]);
  created.push(db);
};
const rejected = (db, sql, expected) => {
  const r = spawnSync(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-X",
      "-U",
      "postgres",
      "-d",
      db,
      "-v",
      "ON_ERROR_STOP=1",
      "-Atq",
    ],
    { input: sql, encoding: "utf8" },
  );
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, expected);
};
const map = (s) =>
  s
    .replace(/\bapp\b/g, "rallypoint")
    .replace(/\bapi\b/g, "rallypoint_api")
    .replaceAll("'payment-qr'", "'rallypoint-payment-qr'");
const names = {
  parties: "primary_name",
  fee_changes: "actor_name",
  attendance_changes: "actor_name",
  split_claim_changes: "actor_name",
  split_runs: "actor_name",
  session_cancellations: "actor_name",
  payment_instructions: "updated_by_name",
};
const fingerprint = (db) =>
  query(
    db,
    "select count(*)||'|'||md5(string_agg(pg_get_functiondef(p.oid),E'\\n' order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('rallypoint','rallypoint_api');",
  );
const tables = (db) =>
  query(
    db,
    "select tablename from pg_tables where schemaname='rallypoint' order by tablename;",
  ).split("\n");
const snapshot = (db, omitNames = false) =>
  Object.fromEntries(
    tables(db)
      .filter((t) => t !== "profiles")
      .map((t) => [
        t,
        JSON.parse(
          query(
            db,
            `select coalesce(jsonb_agg(r order by r::text),'[]') from (select to_jsonb(t)${omitNames && names[t] ? ` - '${names[t]}'` : ""} r from rallypoint.${t} t) x;`,
          ),
        ),
      ]),
  );
const upgrade = execFileSync(
  process.execPath,
  ["scripts/render-staging-schema.mjs", "--upgrade-sessions-profiles"],
  { encoding: "utf8" },
);
try {
  create(base);
  query(
    base,
    `create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create schema extensions; create extension if not exists pgcrypto with schema extensions;
    create schema unrelated; create table unrelated.sentinel(value text); insert into unrelated.sentinel values('preserve');`,
  );
  const files = readdirSync("supabase/migrations")
    .filter(
      (n) =>
        /^\d+_.+\.sql$/.test(n) &&
        n <= "20261023144000_email_attempting_is_ambiguous.sql",
    )
    .sort();
  query(
    base,
    files
      .map((n) => map(readFileSync(`supabase/migrations/${n}`, "utf8")))
      .join("\n"),
  );
  assert.equal(fingerprint(base), "95|53b0a936b162b0555bf193e879cd1761");
  // Fixed synthetic IDs keep the fixture auditable. Each stored-name column is populated.
  const u = "10000000-0000-4000-8000-000000000001",
    g = "20000000-0000-4000-8000-000000000001",
    s = "30000000-0000-4000-8000-000000000001",
    p = "40000000-0000-4000-8000-000000000001";
  query(
    base,
    `insert into auth.users values('${u}','migration@rallypoint.test','{"full_name":"Rehearsal account"}');
    insert into rallypoint.groups(id,name) values('${g}','Synthetic rehearsal');
    insert into rallypoint.group_roles values('${g}','${u}','owner');
    insert into rallypoint.sessions(id,group_id,details) values('${s}','${g}','{}');
    insert into rallypoint.sessions(group_id,details) values('${g}','{"title":"Kept draft"}');
    insert into rallypoint.parties(id,session_id,user_id,primary_name,seats,state,queue_sequence,consent_version,consent_at) values('${p}','${s}','${u}','Old name',1,'confirmed',1,1,now());
    insert into rallypoint.fee_obligations(party_id,unit_minor,charged_seats,currency) values('${p}',1000,1,'SGD');
    insert into rallypoint.fee_changes(party_id,revision,action,actor_id,actor_name) values('${p}',2,'marked_paid','${u}','Old name');
    insert into rallypoint.seat_attendance values('${p}',1,'checked_in',1,now(),'${u}');
    insert into rallypoint.attendance_changes values('${p}',1,1,'checked_in','${u}','Old name',now());
    insert into rallypoint.split_claims(party_id,changed_at,changed_by) values('${p}',now(),'${u}');
    insert into rallypoint.split_claim_changes values('${p}',1,'confirmed','${u}','Old name',now());
    insert into rallypoint.split_runs(session_id,revision,total_minor,currency,paying_seats,state,basis,snapshot,actor_id,actor_name,created_at) values('${s}',1,1000,'SGD',1,'allocated',repeat('a',64),'{}','${u}','Old name',now());
    insert into rallypoint.session_cancellations values('${s}','draft','${u}','Old name',now());
    insert into rallypoint.payment_instructions(session_id,body,revision,updated_by,updated_by_name,updated_at) values('${s}','Synthetic instructions',1,'${u}','Old name',now());`,
  );
  const before = snapshot(base),
    invariant = snapshot(base, true);
  const backup = docker([
    "exec",
    container,
    "pg_dump",
    "-U",
    "postgres",
    "-d",
    base,
    "--no-owner",
  ]);
  rejected(base, `begin;${upgrade}\nselect 1/0;commit;`, /division by zero/);
  assert.equal(fingerprint(base), "95|53b0a936b162b0555bf193e879cd1761");
  assert.deepEqual(snapshot(base), before);
  assert.equal(
    query(base, "select to_regclass('rallypoint.profiles') is null;"),
    "t",
  );
  rejected(
    base,
    `begin;create function rallypoint.drift() returns int language sql as 'select 1';${upgrade}\ncommit;`,
    /baseline differs/,
  );
  for (const drift of [
    "create table rallypoint.drift(value text)",
    "alter table rallypoint.parties disable row level security",
    "grant execute on function rallypoint_api.list_my_groups(uuid) to anon",
    "alter table rallypoint.parties add column drift text",
  ])
    rejected(base, `begin;${drift};${upgrade}\ncommit;`, /baseline differs/);
  query(base, `begin;${upgrade}\ncommit;`);
  assert.deepEqual(snapshot(base, true), invariant);
  for (const [table, col] of Object.entries(names))
    assert.equal(
      query(
        base,
        `select bool_and(${col}='Rehearsal account') from rallypoint.${table};`,
      ),
      "t",
      table,
    );
  assert.equal(
    query(base, "select value from unrelated.sentinel;"),
    "preserve",
  );
  assert.equal(
    query(
      base,
      "select count(*)||'|'||bool_and(relrowsecurity) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='rallypoint' and c.relkind='r';",
    ),
    "27|true",
  );
  assert.equal(
    query(
      base,
      "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('rallypoint','rallypoint_api') and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute'));",
    ),
    "0",
  );
  const catalog = JSON.parse(
    query(
      base,
      `select jsonb_object_agg(p.proname,jsonb_build_object('args',(select jsonb_object_agg(p.proargnames[a.n],a.typ::regtype::text) from unnest(p.proargtypes::oid[]) with ordinality a(typ,n)),'allowed',has_function_privilege('service_role',p.oid,'execute'))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='rallypoint_api';`,
    ),
  );
  for (const [name, args] of Object.entries(functions)) {
    assert.ok(catalog[name]?.allowed, name);
    assert.deepEqual(
      catalog[name].args,
      Object.fromEntries(
        Object.entries(args).map(([k, v]) => [
          k,
          v === "timestamptz" ? "timestamp with time zone" : v,
        ]),
      ),
      name,
    );
  }
  const calls = JSON.parse(
    query(
      base,
      `begin;set local role service_role;select jsonb_build_object('ensure',rallypoint_api.ensure_my_profile('${u}','Rehearsal account'),'mine',rallypoint_api.read_my_profile('${u}','Rehearsal account'),'sessions',rallypoint_api.list_my_sessions('${u}'));commit;`,
    ),
  );
  assert.equal(calls.mine.name, "Rehearsal account");
  assert.equal(calls.ensure.profileId, calls.mine.profileId);
  assert.deepEqual(
    calls.sessions.upcoming.map((s) => s.title),
    ["Kept draft"],
  );
  assert.deepEqual(calls.sessions.past, []);
  const publicProfile = JSON.parse(
    query(
      base,
      `begin;set local role service_role;select rallypoint_api.read_profile('${calls.mine.profileId}');commit;`,
    ),
  );
  assert.equal(publicProfile.name, "Rehearsal account");
  assert.equal(publicProfile.userId, undefined);
  const after = snapshot(base);
  rejected(
    base,
    `begin;${upgrade}\ncommit;`,
    /already upgraded or partially upgraded/,
  );
  assert.deepEqual(snapshot(base), after);
  create(restored);
  query(restored, backup);
  assert.deepEqual(snapshot(restored), before);
  assert.equal(fingerprint(restored), "95|53b0a936b162b0555bf193e879cd1761");
  console.log(
    JSON.stringify({
      baselineFunctions: 95,
      upgradedFunctions: fingerprint(base),
      checkedApiFunctions: Object.keys(functions).length,
      preservedTables: 26,
      updatedNameColumns: 7,
      rlsTables: 27,
      browserExecutableFunctions: 0,
      rollback: "passed",
      drift: "rejected",
      repeat: "rejected",
      syntheticBackupRestore: "passed",
      unrelatedSentinel: "preserved",
    }),
  );
} catch (error) {
  console.error(
    error.stderr
      ? String(error.stderr).split("\n").slice(-7).join("\n")
      : error.message,
  );
  process.exitCode = 1;
} finally {
  for (const db of created.reverse())
    docker(["exec", container, "dropdb", "-U", "postgres", db]);
}
