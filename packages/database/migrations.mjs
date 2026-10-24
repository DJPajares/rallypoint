import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
export const root = resolve(import.meta.dirname, "../..");
export const baselineName = "0_rallypoint_baseline_20261023144000";
export const repairName = "20261024100000_sessions_profiles";
export const sourceFiles = () =>
  readdirSync(resolve(root, "supabase/migrations"))
    .filter((n) => /^\d+_.+\.sql$/.test(n))
    .sort();
export function migrationTarget(target, connectionString) {
  if (!["local", "production"].includes(target))
    throw new Error("Choose local or production explicitly.");
  const url = new URL(connectionString);
  const allowedOptions = new Set([
    "schema",
    "sslmode",
    "sslrootcert",
    "sslcert",
    "sslkey",
    "sslaccept",
    "connect_timeout",
    "connection_limit",
    "pool_timeout",
    "pgbouncer",
    "application_name",
    "options",
    "statement_timeout",
  ]);
  for (const key of url.searchParams.keys())
    if (!allowedOptions.has(key))
      throw new Error(
        "Unsupported migration URL option; connection overrides are forbidden.",
      );
  if (!["postgres:", "postgresql:"].includes(url.protocol))
    throw new Error("PostgreSQL URL required.");
  if (
    target === "local" &&
    (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.port !== "54322")
  )
    throw new Error("Local migrations require loopback port 54322.");
  if (
    target === "production" &&
    !(
      url.hostname === "aws-1-ap-southeast-1.pooler.supabase.com" &&
      url.port === "5432" &&
      decodeURIComponent(url.username) === "postgres.zqidfkofbzusvpikftdf" &&
      url.pathname === "/postgres"
    )
  )
    throw new Error(
      "Production migrations require the existing RallyPoint Session pooler.",
    );
  url.searchParams.delete("options");
  url.searchParams.delete("statement_timeout");
  url.searchParams.set("schema", "rallypoint_migrations");
  return {
    url: url.href,
    schema: target === "local" ? "api" : "rallypoint_api",
    dataSchema: target === "local" ? "app" : "rallypoint",
  };
}
export function renderHistory(target) {
  if (!["local", "production"].includes(target))
    throw new Error("Unknown migration target.");
  const files = sourceFiles();
  const base = files.filter(
    (n) => n <= "20261023144000_email_attempting_is_ambiguous.sql",
  );
  const repair = files.filter(
    (n) =>
      n > "20261023144000_email_attempting_is_ambiguous.sql" &&
      n <= "20261024100000_profile_fixes.sql",
  );
  if (base.length !== 32 || repair.length !== 5)
    throw new Error("Reviewed migration source is incomplete.");
  const map = (s) =>
    target === "local"
      ? s
      : s
          .replace(/\bapp\b/g, "rallypoint")
          .replace(/\bapi\b/g, "rallypoint_api")
          .replaceAll("'payment-qr'", "'rallypoint-payment-qr'");
  const render = (list) =>
    list
      .map(
        (n) =>
          `\n-- Source: ${n}\n${map(readFileSync(resolve(root, "supabase/migrations", n), "utf8"))}\n`,
      )
      .join("");
  const atomic = (sql) =>
    `BEGIN;\nset local lock_timeout='5s';\nset local statement_timeout='90s';\n${sql}\nnotify pgrst, 'reload schema';\nCOMMIT;\n`;
  const guard =
    target === "production"
      ? execFileSync(
          process.execPath,
          [
            resolve(root, "scripts/render-staging-schema.mjs"),
            "--upgrade-sessions-profiles",
          ],
          { encoding: "utf8" },
        )
      : `do $guard$ begin
 if to_regclass('app.profiles') is not null or (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('app','api')) <> 95 then
  raise exception 'Local Sessions/Profile baseline differs; inspect before applying';
 end if;
end $guard$;\n${render(repair)}`;
  return [
    { name: baselineName, files: base, sql: atomic(render(base)) },
    { name: repairName, files: repair, sql: atomic(guard) },
    ...files
      .filter((n) => n > "20261024100000_profile_fixes.sql")
      .map((n) => ({
        name: n.slice(0, -4),
        files: [n],
        sql: atomic(render([n])),
      })),
  ];
}
