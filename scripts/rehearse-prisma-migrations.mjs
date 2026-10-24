import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const root = process.cwd();
const { renderHistory } = await import(
  root + "/packages/database/migrations.mjs"
);
const prisma = root + "/packages/database/node_modules/prisma/build/index.js";
const docker = (args, input) =>
  execFileSync("docker", args, {
    input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 16 * 1024 * 1024,
  });
const made = [];
try {
  for (const target of ["local", "production"]) {
    const db = "rp_prisma_" + target + "_" + Date.now();
    docker([
      "exec",
      "supabase_db_rallypoint",
      "createdb",
      "-U",
      "postgres",
      db,
    ]);
    made.push(db);
    const sql = (q) =>
      docker(
        [
          "exec",
          "-i",
          "supabase_db_rallypoint",
          "psql",
          "-U",
          "postgres",
          "-d",
          db,
          "-v",
          "ON_ERROR_STOP=1",
          "-Atq",
        ],
        q,
      ).trim();
    sql(
      "create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create schema extensions;create extension if not exists pgcrypto with schema extensions;",
    );
    const history = renderHistory(target);
    const folder = mkdtempSync(
      resolve(root, ".local/prisma-migrations/rehearsal-"),
    );
    try {
      writeFileSync(
        resolve(folder, "migration_lock.toml"),
        'provider = "postgresql"\n',
      );
      for (const m of history) {
        mkdirSync(resolve(folder, m.name));
        writeFileSync(resolve(folder, m.name, "migration.sql"), m.sql);
      }
      const repair = resolve(folder, history[1].name, "migration.sql");
      writeFileSync(
        repair,
        history[1].sql.replace("COMMIT;", "select 1/0;\nCOMMIT;"),
      );
      const env = {
        ...process.env,
        RALLYPOINT_MIGRATION_DATABASE_URL: `postgresql://postgres:postgres@127.0.0.1:54322/${db}?schema=rallypoint_migrations`,
        RALLYPOINT_MIGRATIONS_PATH: folder,
      };
      const run = (args) =>
        spawnSync(
          process.execPath,
          [
            prisma,
            "migrate",
            ...args,
            "--config",
            root + "/packages/database/prisma.migrate.config.ts",
          ],
          { env, cwd: root, encoding: "utf8" },
        );
      const failed = run(["deploy"]);
      if (failed.status === 0)
        throw new Error("Injected failure was not rejected");
      if (
        !/division by zero|current transaction is aborted/.test(
          failed.stdout + failed.stderr,
        )
      ) {
        console.log((failed.stdout + failed.stderr).slice(-1700));
        throw new Error("Unexpected rehearsal failure");
      }
      const schema = target === "local" ? "app" : "rallypoint";
      assert.equal(
        sql(`select to_regclass('${schema}.profiles') is null;`),
        "t",
      );
      assert.equal(
        sql(
          `select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('${schema}','${target === "local" ? "api" : "rallypoint_api"}');`,
        ),
        "95",
      );
      writeFileSync(repair, history[1].sql);
      assert.equal(
        run(["resolve", "--rolled-back", history[1].name]).status,
        0,
      );
      const done = run(["deploy"]);
      if (done.status !== 0) {
        console.log((done.stdout + done.stderr).slice(-1700));
        throw new Error("Migration rehearsal did not complete");
      }
      assert.equal(
        sql(`select to_regclass('${schema}.profiles') is not null;`),
        "t",
      );
      assert.equal(run(["deploy"]).status, 0);
      if (target === "local") {
        const wrapper = () =>
          spawnSync(
            process.execPath,
            [root + "/packages/database/migrate.mjs", "local"],
            { env, encoding: "utf8" },
          );
        assert.equal(
          wrapper().status,
          0,
          "Fresh Prisma-only databases must support repeat runs without a legacy Supabase ledger",
        );
        sql(
          "update rallypoint_migrations._prisma_migrations set checksum=repeat('0',64) where migration_name='" +
            history[0].name +
            "'",
        );
        const drift = wrapper();
        assert.notEqual(drift.status, 0);
        assert.match(drift.stderr, /checksum differs/);
        sql(
          "update rallypoint_migrations._prisma_migrations set checksum='" +
            createHash("sha256").update(history[0].sql).digest("hex") +
            "' where migration_name='" +
            history[0].name +
            "'",
        );
      }
      console.log(
        JSON.stringify({
          target,
          transactionRollback: "passed",
          deploy: "passed",
          repeat: "no-op",
          history: sql(
            "select count(*) from rallypoint_migrations._prisma_migrations where finished_at is not null and rolled_back_at is null;",
          ),
        }),
      );
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  for (const db of made.reverse())
    docker(["exec", "supabase_db_rallypoint", "dropdb", "-U", "postgres", db]);
}
