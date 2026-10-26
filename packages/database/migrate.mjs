import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.ts";
import { functions } from "./src/functions.ts";
import {
  envValue,
  root,
  renderHistory,
  migrationTarget,
  baselineName,
  repairName,
} from "./migrations.mjs";
const target = process.argv[2];
let database, folder;
try {
  // Production reads its own gitignored file at the repository root, once
  // filled in, so `pnpm db:migrate:prod` needs nothing typed. A value already
  // in the environment wins; only this one name is read from the file.
  if (
    target === "production" &&
    !process.env.RALLYPOINT_MIGRATION_DATABASE_URL
  ) {
    let file = "";
    try {
      file = readFileSync(resolve(root, ".env.production"), "utf8");
    } catch {
      // No file: the environment variable is the only other source.
    }
    const url = envValue(file, "RALLYPOINT_MIGRATION_DATABASE_URL");
    // process.env turns undefined into the text "undefined"; set only a value.
    if (url) process.env.RALLYPOINT_MIGRATION_DATABASE_URL = url;
  }
  if (target === "local" && !process.env.RALLYPOINT_MIGRATION_DATABASE_URL) {
    // Load only the local DB value; never replace inherited service credentials.
    const line = readFileSync(resolve(root, "apps/web/.env.local"), "utf8")
      .split("\n")
      .find((l) => l.startsWith("DATABASE_URL="));
    process.env.RALLYPOINT_MIGRATION_DATABASE_URL = line?.slice(
      "DATABASE_URL=".length,
    );
  }
  if (!process.env.RALLYPOINT_MIGRATION_DATABASE_URL)
    throw new Error(
      target === "production"
        ? "RALLYPOINT_MIGRATION_DATABASE_URL is required: set it in .env.production at the repository root (see .env.production.example)."
        : "RALLYPOINT_MIGRATION_DATABASE_URL is required.",
    );
  const config = migrationTarget(
    target,
    process.env.RALLYPOINT_MIGRATION_DATABASE_URL,
  );
  const history = renderHistory(target);
  mkdirSync(resolve(root, ".local/prisma-migrations"), {
    recursive: true,
    mode: 0o700,
  });
  folder = mkdtempSync(resolve(root, ".local/prisma-migrations", target + "-"));
  writeFileSync(
    resolve(folder, "migration_lock.toml"),
    'provider = "postgresql"\n',
  );
  for (const m of history) {
    mkdirSync(resolve(folder, m.name));
    writeFileSync(resolve(folder, m.name, "migration.sql"), m.sql);
  }
  database = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: config.url,
      max: 1,
      connectionTimeoutMillis: 5000,
    }),
    log: [],
  });
  const read = (sql) => database.$queryRawUnsafe(sql);
  const [state] = await read(
    `select count(*)::int functions,md5(string_agg(pg_get_functiondef(p.oid),E'\\n' order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid))) fingerprint,to_regclass('rallypoint_migrations._prisma_migrations') is not null history_exists from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('${config.dataSchema}','${config.schema}');`,
  );
  const applied = state.history_exists
    ? await read(
        "select migration_name,finished_at,rolled_back_at,checksum from rallypoint_migrations._prisma_migrations",
      )
    : [];
  const finished = new Set(
    applied
      .filter((m) => m.finished_at && !m.rolled_back_at)
      .map((m) => m.migration_name),
  );
  if (applied.some((m) => !m.finished_at && !m.rolled_back_at))
    throw new Error(
      "A failed Prisma migration needs inspection before retrying.",
    );
  for (const migration of history) {
    const installed = applied.find(
      (m) =>
        m.migration_name === migration.name &&
        m.finished_at &&
        !m.rolled_back_at,
    );
    if (
      installed &&
      installed.checksum !==
        createHash("sha256").update(migration.sql).digest("hex")
    )
      throw new Error(`Applied migration checksum differs: ${migration.name}.`);
  }
  const legacyVersions = async () => {
    const [{ present }] = await read(
      "select to_regclass('supabase_migrations.schema_migrations') is not null present",
    );
    return new Set(
      present
        ? (
            await read(
              "select version from supabase_migrations.schema_migrations",
            )
          ).map((r) => r.version)
        : [],
    );
  };
  const adopt = [];
  const verifyContract = async () => {
    const [{ catalog }] = await read(
      `select jsonb_object_agg(p.proname,jsonb_build_object('args',(select jsonb_object_agg(p.proargnames[a.n],a.typ::regtype::text) from unnest(p.proargtypes::oid[]) with ordinality a(typ,n)),'allowed',has_function_privilege('service_role',p.oid,'execute'))) catalog from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='${config.schema}';`,
    );
    for (const [name, args] of Object.entries(functions)) {
      const actual = catalog?.[name];
      // A function without arguments reports null rather than an empty map.
      const actualArgs = actual?.args ?? {};
      if (
        !actual?.allowed ||
        Object.keys(actualArgs).length !== Object.keys(args).length ||
        Object.entries(args).some(
          ([key, type]) =>
            actualArgs[key] !==
            (type === "timestamptz" ? "timestamp with time zone" : type),
        )
      )
        throw new Error(`Database API contract mismatch: ${name}.`);
    }
  };
  if (!finished.has(baselineName) && state.functions) {
    if (target === "production") {
      if (
        state.functions === 95 &&
        state.fingerprint === "53b0a936b162b0555bf193e879cd1761"
      )
        adopt.push(baselineName);
      else if (
        state.functions === 101 &&
        state.fingerprint === "151b1745055dd6be3f5c4336ff60f503"
      )
        adopt.push(baselineName, repairName);
      else
        throw new Error(
          "Production functions differ from the reviewed migration checkpoints.",
        );
    } else {
      const [legacy] = await read(
        "select to_regclass('supabase_migrations.schema_migrations') is not null present",
      );
      if (!legacy.present)
        throw new Error(
          "Existing local schema has no migration history; inspect before baselining.",
        );
      const versions = await legacyVersions();
      for (const m of history) {
        if (m.files.every((f) => versions.has(f.split("_")[0])))
          adopt.push(m.name);
        else break;
      }
      if (!adopt.includes(baselineName))
        throw new Error("Local baseline migrations are incomplete.");
    }
  }
  if (target === "local" && finished.has(baselineName)) {
    const versions = await legacyVersions();
    for (const migration of history)
      if (
        !finished.has(migration.name) &&
        !adopt.includes(migration.name) &&
        migration.files.every((f) => versions.has(f.split("_")[0]))
      )
        adopt.push(migration.name);
  }
  if (adopt.includes(repairName)) await verifyContract();
  await database.$disconnect();
  const cli = (args) => {
    const r = spawnSync(
      process.execPath,
      [
        resolve(import.meta.dirname, "node_modules/prisma/build/index.js"),
        "migrate",
        ...args,
        "--config",
        resolve(import.meta.dirname, "prisma.migrate.config.ts"),
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          RALLYPOINT_MIGRATION_DATABASE_URL: config.url,
          RALLYPOINT_MIGRATIONS_PATH: folder,
        },
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    if (r.status !== 0) {
      const code =
        (r.stdout + "\n" + r.stderr).match(/\bP\d{4}\b/)?.[0] ??
        "command_failed";
      throw new Error(
        `Prisma migration ${args[0]} failed (${code}); no URL or SQL diagnostics were logged.`,
      );
    }
  };
  for (const name of adopt.filter((n) => !finished.has(n)))
    cli(["resolve", "--applied", name]);
  cli(["deploy"]);
  await database.$executeRawUnsafe(
    "REVOKE ALL ON SCHEMA rallypoint_migrations FROM public, anon, authenticated, service_role",
  );
  await database.$executeRawUnsafe(
    "REVOKE ALL ON ALL TABLES IN SCHEMA rallypoint_migrations FROM public, anon, authenticated, service_role",
  );
  await verifyContract();
  const completed = await read(
    "select migration_name from rallypoint_migrations._prisma_migrations where finished_at is not null and rolled_back_at is null order by migration_name",
  );
  console.log(
    JSON.stringify({
      target,
      adopted: adopt,
      applied: history
        .filter((m) => !finished.has(m.name) && !adopt.includes(m.name))
        .map((m) => m.name),
      completed: completed.map((m) => m.migration_name),
      historySchema: "rallypoint_migrations",
    }),
  );
} catch (error) {
  // Prisma/driver errors can embed credentials, queries and private row details.
  console.error(
    error instanceof Error && !("meta" in error) && !("code" in error)
      ? error.message
      : "Database migration failed; no credential or SQL diagnostics were logged.",
  );
  process.exitCode = 1;
} finally {
  await database?.$disconnect();
  if (folder) rmSync(folder, { recursive: true, force: true });
}
