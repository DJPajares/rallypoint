import { test } from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../packages/database/src/index.ts";
import { localEnv } from "../scripts/local-env.mjs";
import { prismaFixture } from "./helpers/prisma-fixtures.mjs";

const env = localEnv();
test("Prisma preserves function results, SQLSTATE and bound values", async () => {
  const db = createDatabase(env);
  try {
    const empty = await db.rpc("list_my_groups", {
      p_actor_id: crypto.randomUUID(),
    });
    assert.deepEqual(empty, { data: [], error: null });
    const denied = await db.rpc("read_group_setup", {
      p_actor_id: crypto.randomUUID(),
      p_group_id: crypto.randomUUID(),
    });
    assert.equal(denied.error.code, "42501");
    assert.equal(denied.error.message, "group_access_denied");
    const missing = await db.rpc("read_shared_session", {
      p_slug: crypto.randomUUID(),
    });
    assert.deepEqual(missing, { data: null, error: null });
    // UUID casts must reject injected SQL as data, with the original SQLSTATE.
    const injection = await db.rpc("read_shared_session", {
      p_slug: "'); drop schema app cascade; --",
    });
    assert.equal(injection.error.code, "22P02");
    assert.deepEqual(
      await db.rpc("list_my_groups", { p_actor_id: crypto.randomUUID() }),
      empty,
    );
  } finally {
    await db.close();
  }
});

test("Prisma refuses untrusted function/schema identifiers and unknown arguments", async () => {
  const db = createDatabase(env);
  try {
    for (const [name, args] of [
      ["pg_sleep", {}],
      ["read_shared_session; select 1", {}],
      ["read_shared_session", { p_slug: crypto.randomUUID(), injected: true }],
    ]) {
      const result = await db.rpc(name, args);
      assert.ok(result.error);
      assert.equal(result.data, null);
    }
  } finally {
    await db.close();
  }
  assert.throws(() =>
    createDatabase({ ...env, SUPABASE_API_SCHEMA: 'api";drop schema app;--' }),
  );
});

test("Prisma supports deployment schema selection without a REST database call", async () => {
  const db = createDatabase({
    ...env,
    SUPABASE_API_SCHEMA: "missing_synthetic_api",
  });
  try {
    const result = await db.rpc("read_shared_session", {
      p_slug: crypto.randomUUID(),
    });
    assert.equal(result.error.code, "3F000");
  } finally {
    await db.close();
  }
});

test("Prisma does not connect until a database operation and closes safely", async () => {
  const db = createDatabase({});
  await db.close();
  const result = await db.rpc("list_my_groups", {
    p_actor_id: crypto.randomUUID(),
  });
  assert.ok(result.error);
  assert.equal(result.data, null);
});

test("Prisma binds JSON, nulls, arrays and bigint and assumes only service_role", async () => {
  const fixture = prismaFixture();
  const url = new URL(fixture.env.DATABASE_URL);
  url.searchParams.set("options", "-c search_path=public");
  url.searchParams.set("statement_timeout", "0");
  const db = createDatabase({ ...fixture.env, DATABASE_URL: url.href });
  try {
    fixture.sql(`
      create function ${fixture.schema}.preview_split(p_actor_id uuid,p_slug uuid,p_input jsonb) returns jsonb language sql as $$ select jsonb_build_object('role',current_user,'timeout',current_setting('statement_timeout'),'input',p_input,'actor',p_actor_id,'slug',p_slug) $$;
      create function ${fixture.schema}.mark_badges_seen(p_actor_id uuid,p_ids text[]) returns jsonb language sql as $$ select to_jsonb(p_ids) $$;
      create function ${fixture.schema}.correct_split(p_total_minor bigint) returns jsonb language sql as $$ select to_jsonb(p_total_minor::text) $$;
      create function ${fixture.schema}.release_email_sender(p_holder uuid) returns void language sql as $$ select $$;
      revoke all on all functions in schema ${fixture.schema} from public;
      grant execute on all functions in schema ${fixture.schema} to service_role;
    `);
    const input = {
      note: "quotes ' and \\ and $1; select",
      nested: { enabled: true },
      list: [1, null],
    };
    const json = await db.rpc("preview_split", {
      p_input: input,
      p_slug: null,
      p_actor_id: null,
    });
    assert.deepEqual(json, {
      data: { role: "service_role", timeout: "5s", input, actor: null, slug: null },
      error: null,
    });
    assert.deepEqual(
      await db.rpc("mark_badges_seen", {
        p_actor_id: null,
        p_ids: ["a", "quote'", "comma,", "back\\slash"],
      }),
      { data: ["a", "quote'", "comma,", "back\\slash"], error: null },
    );
    assert.deepEqual(
      await db.rpc("correct_split", { p_total_minor: Number.MAX_SAFE_INTEGER }),
      { data: String(Number.MAX_SAFE_INTEGER), error: null },
    );
    assert.equal(
      (await db.rpc("release_email_sender", { p_holder: crypto.randomUUID() }))
        .error,
      null,
    );
    assert.ok(
      (await db.rpc("preview_split", { p_input: input })).error,
      "Required parameters must not become null implicitly",
    );
  } finally {
    await db.close();
    fixture.close();
  }
});
