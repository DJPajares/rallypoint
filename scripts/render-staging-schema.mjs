import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
if (args.length && (args.length !== 1 || args[0] !== "--upgrade"))
  throw new Error(
    "Use no arguments for an initial install, or --upgrade for the 2026-10-23 bootstrap upgrade.",
  );
const upgrade = args.length === 1;
const allFiles = readdirSync(resolve(root, "supabase/migrations"))
  .filter((n) => /^\d+_.+\.sql$/.test(n))
  .sort();
const files = upgrade
  ? allFiles.filter(
      (n) =>
        n > "20261022170000_badges.sql" &&
        n <= "20261023144000_email_attempting_is_ambiguous.sql",
    )
  : allFiles;
if (upgrade && files.length !== 16)
  throw new Error("The reviewed 16-migration upgrade source is incomplete.");
let sql = upgrade
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
