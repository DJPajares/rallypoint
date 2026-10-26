import { test } from "node:test";
import assert from "node:assert/strict";
import {
  envValue,
  renderHistory,
  migrationTarget,
} from "../packages/database/migrations.mjs";

test("Prisma migrations isolate local and production targets", () => {
  assert.equal(
    migrationTarget(
      "local",
      "postgresql://postgres:synthetic@127.0.0.1:54322/postgres",
    ).schema,
    "api",
  );
  assert.equal(
    migrationTarget(
      "production",
      "postgresql://postgres.zqidfkofbzusvpikftdf:synthetic@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres",
    ).schema,
    "rallypoint_api",
  );
  for (const [target, url] of [
    ["local", "postgresql://u:p@remote.invalid:54322/postgres"],
    ["production", "postgresql://u:p@127.0.0.1:54322/postgres"],
    [
      "local",
      "postgresql://u:p@127.0.0.1:54322/postgres?host=remote.invalid&port=5432&user=other",
    ],
    [
      "local",
      "postgresql://u:p@127.0.0.1:54322/postgres?%68ost=remote.invalid",
    ],
    ["local", "postgresql://u:p@127.0.0.1:54322/postgres?password=other"],
    [
      "production",
      "postgresql://postgres.other:p@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres",
    ],
  ])
    assert.throws(() => migrationTarget(target, url));
});

test("Prisma history separates the installed baseline from the pending five-file change", () => {
  for (const target of ["local", "production"]) {
    const files = renderHistory(target);
    assert.ok(files.length >= 2);
    assert.equal(files[0].name, "0_rallypoint_baseline_20261023144000");
    assert.equal(files[1].name, "20261024100000_sessions_profiles");
    assert.match(files[1].sql, /^BEGIN;/);
    assert.match(files[1].sql, /COMMIT;\s*$/);
    assert.equal([...files[1].sql.matchAll(/^-- Source:/gm)].length, 5);
    assert.equal(
      files[1].sql.includes("create table app.profiles"),
      target === "local",
    );
    assert.equal(
      files[1].sql.includes("create table rallypoint.profiles"),
      target === "production",
    );
    assert.ok(!files[1].sql.includes("create table app.groups"));
  }
});

test("a migration URL is read from a .env file line, quoted or not", () => {
  const file = [
    "# RallyPoint production migration",
    "OTHER=1",
    'RALLYPOINT_MIGRATION_DATABASE_URL="postgresql://u:p%40ss@h:5432/postgres"',
    "",
  ].join("\n");
  assert.equal(
    envValue(file, "RALLYPOINT_MIGRATION_DATABASE_URL"),
    "postgresql://u:p%40ss@h:5432/postgres",
  );
  assert.equal(envValue("A='x=y' \n", "A"), "x=y");
  assert.equal(envValue("A=plain\r\n", "A"), "plain");
  assert.equal(envValue("# A=commented\nB=2", "A"), undefined);
  assert.equal(envValue("A=", "A"), undefined);
  assert.equal(envValue("AB=1", "A"), undefined);
});
