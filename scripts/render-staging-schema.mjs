import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
if (
  args.length &&
  (args.length !== 1 ||
    !["--upgrade", "--upgrade-sessions-profiles"].includes(args[0]))
)
  throw new Error(
    "Use no arguments for an initial install, --upgrade for the bootstrap upgrade, or --upgrade-sessions-profiles for the reviewed Sessions/Profile repair.",
  );
const upgrade = args[0] === "--upgrade";
const profiles = args[0] === "--upgrade-sessions-profiles";
const allFiles = readdirSync(resolve(root, "supabase/migrations"))
  .filter((n) => /^\d+_.+\.sql$/.test(n))
  .sort();
const files = upgrade
  ? allFiles.filter(
      (n) =>
        n > "20261022170000_badges.sql" &&
        n <= "20261023144000_email_attempting_is_ambiguous.sql",
    )
  : profiles
    ? allFiles.filter(
        (n) =>
          n > "20261023144000_email_attempting_is_ambiguous.sql" &&
          n <= "20261024100000_profile_fixes.sql",
      )
    : allFiles;
if (upgrade && files.length !== 16)
  throw new Error("The reviewed 16-migration upgrade source is incomplete.");
if (profiles && files.length !== 5)
  throw new Error(
    "The reviewed five-migration Sessions/Profile source is incomplete.",
  );
let sql = profiles
  ? `-- Repair the known 20261023144000 baseline through 20261024100000 only.
-- Run atomically: Supabase apply_migration or psql --single-transaction -v ON_ERROR_STOP=1.
-- Requires a verified scoped recovery copy, including the seven stored-name columns.
set local lock_timeout = '5s';
set local statement_timeout = '90s';
select pg_advisory_xact_lock(hashtextextended('rallypoint_sessions_profiles_20261024',0));
do $guard$ declare fingerprint text; total integer; shape text; begin
  if to_regclass('rallypoint.profiles') is not null
    or to_regprocedure('rallypoint_api.list_my_sessions(uuid)') is not null
    or to_regprocedure('rallypoint_api.ensure_my_profile(uuid,text)') is not null then
    raise exception 'RallyPoint is already upgraded or partially upgraded; inspect before proceeding';
  end if;
  select count(*), md5(string_agg(pg_get_functiondef(p.oid),E'\\n'
    order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)))
    into total, fingerprint from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('rallypoint','rallypoint_api');
  if total <> 95 or fingerprint is distinct from '53b0a936b162b0555bf193e879cd1761'
    or to_regclass('rallypoint.sessions') is null
    or not exists(select 1 from storage.buckets where id='rallypoint-payment-qr') then
    raise exception 'RallyPoint baseline differs from the reviewed 20261023144000 checkpoint';
  end if;
  select md5(string_agg(item,E'\\n' order by item)) into shape from (
    select concat_ws('|','column',c.table_name,c.column_name,c.ordinal_position,c.data_type,c.udt_schema,c.udt_name,c.is_nullable,c.column_default,c.is_identity,c.is_generated,c.generation_expression) item from information_schema.columns c where c.table_schema='rallypoint'
    union all select concat_ws('|','constraint',r.relname,c.conname,pg_get_constraintdef(c.oid)) from pg_constraint c join pg_class r on r.oid=c.conrelid join pg_namespace n on n.oid=r.relnamespace where n.nspname='rallypoint'
    union all select concat_ws('|','index',tablename,indexname,indexdef) from pg_indexes where schemaname='rallypoint'
    union all select concat_ws('|','trigger',r.relname,t.tgname,pg_get_triggerdef(t.oid),t.tgenabled) from pg_trigger t join pg_class r on r.oid=t.tgrelid join pg_namespace n on n.oid=r.relnamespace where n.nspname='rallypoint' and not t.tgisinternal
    union all select concat_ws('|','policy',tablename,policyname,permissive,roles::text,cmd,qual,with_check) from pg_policies where schemaname='rallypoint'
  ) objects;
  if shape is distinct from 'bd23e4157e2c634a18be9ea48d7ed772'
    or (select count(*) from pg_tables where schemaname='rallypoint') <> 26
    or exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='rallypoint' and c.relkind='r' and (not c.relrowsecurity
        or has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        or has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')))
    or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('rallypoint','rallypoint_api') and (
        has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute')
        or not has_function_privilege('service_role',p.oid,'execute'))) then
    raise exception 'RallyPoint table or security baseline differs from the reviewed checkpoint';
  end if;
end $guard$;
`
  : upgrade
    ? `-- Upgrade the known bootstrap through 20261023144000 only.
-- Run atomically: Supabase apply_migration or psql --single-transaction -v ON_ERROR_STOP=1.
-- Requires a verified recovery backup; never use db push/reset against the shared project.
set local lock_timeout = '5s';
set local statement_timeout = '90s';
select pg_advisory_xact_lock(hashtextextended('rallypoint_staging_upgrade_20261023',0));
do $guard$ begin
  if to_regclass('rallypoint.sessions') is null
    or to_regclass('rallypoint.badge_views') is null
    or to_regnamespace('rallypoint_api') is null
    or not exists(select 1 from storage.buckets where id='rallypoint-payment-qr') then
    raise exception 'The known bootstrap and private bucket must exist before this upgrade';
  end if;
  if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='rallypoint' and c.relname in
      ('payment_notes','payment_instruction_notices','session_change_signals','email_jobs','email_suppressions','email_sender','email_budget')) then
    raise exception 'RallyPoint is already upgraded or partially upgraded; inspect before proceeding';
  end if;
end $guard$;
`
    : `-- Initial RallyPoint staging install only. Never run db push/reset against the shared project.
-- Source migration list is preserved below; existing app schemas and Auth settings are untouched.
do $guard$ begin
  if exists(select 1 from pg_namespace where nspname in ('rallypoint','rallypoint_api'))
    or exists(select 1 from storage.buckets where id='rallypoint-payment-qr') then
    raise exception 'RallyPoint namespace already exists; use a reviewed incremental migration';
  end if;
end $guard$;\n`;
for (const file of files) {
  const original = readFileSync(
    resolve(root, "supabase/migrations", file),
    "utf8",
  );
  const rendered = original
    .replace(/\bapp\b/g, "rallypoint")
    .replace(/\bapi\b/g, "rallypoint_api")
    .replaceAll("'payment-qr'", "'rallypoint-payment-qr'");
  sql += `\n-- Source: ${file}\n${rendered}\n`;
}
sql += "\nnotify pgrst, 'reload schema';\n";
process.stdout.write(sql);
