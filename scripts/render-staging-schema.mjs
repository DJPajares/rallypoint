import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "..");
const files = readdirSync(resolve(root, "supabase/migrations"))
  .filter((n) => /^\d+_.+\.sql$/.test(n))
  .sort();
let sql = `-- Initial RallyPoint staging install only. Never run db push/reset against the shared project.
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
