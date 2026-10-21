import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import {
  localEnv,
  fixturePassword,
  firstGroup,
  secondGroup,
} from "../scripts/local-env.mjs";
const env = localEnv();
const base = process.env.RALLYPOINT_TEST_URL ?? "http://127.0.0.1:5173";
assert.ok(
  ["127.0.0.1", "localhost"].includes(new URL(base).hostname),
  "Tests require a local app.",
);
async function login(name) {
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email: `${name}@rallypoint.test`,
    password: fixturePassword,
  });
  assert.ok(!error && data.session, `Synthetic ${name} login must succeed.`);
  return { token: data.session.access_token, id: data.user.id, client };
}
const api = (path, actor) =>
  fetch(base + path, {
    headers: actor ? { Authorization: `Bearer ${actor.token}` } : {},
  });
const sql = (query) =>
  execFileSync(
    "npx",
    ["--no-install", "supabase", "db", "query", "--local", query],
    { stdio: "pipe" },
  );
test("local identity and group authorization boundary", async (t) => {
  const organizer = await login("organizer"),
    member = await login("member"),
    outsider = await login("outsider"),
    newcomer = await login("newcomer");
  await t.test("public configuration excludes server secrets", async () => {
    assert.equal((await api("/api/health")).status, 200);
    const response = await api("/api/config");
    const text = await response.text();
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.ok(
      !text.includes(env.SUPABASE_SECRET_KEY),
      "Server secret must never be serialized.",
    );
    assert.equal(JSON.parse(text).auth.localEmail, true);
  });
  await t.test("missing and forged sessions are denied directly", async () => {
    assert.equal((await api("/api/workspace")).status, 401);
    assert.equal(
      (await api("/api/workspace", { token: "invalid-token" })).status,
      401,
    );
  });
  await t.test("managed identity and isolated group projection", async () => {
    assert.equal(
      (await (await api("/api/me", organizer)).json()).id,
      organizer.id,
    );
    const { groups } = await (await api("/api/workspace", organizer)).json();
    assert.equal(groups.length, 1);
    assert.equal(groups[0].id, firstGroup);
    assert.equal(
      (await api(`/api/groups/${firstGroup}/setup`, organizer)).status,
      200,
    );
  });
  await t.test(
    "member and unrelated organizer cannot manage the group",
    async () => {
      for (const actor of [member, outsider])
        assert.equal(
          (await api(`/api/groups/${firstGroup}/setup`, actor)).status,
          403,
        );
      assert.equal(
        (await api(`/api/groups/${secondGroup}/setup`, organizer)).status,
        403,
      );
    },
  );
  await t.test("no memberships returns a truthful empty result", async () => {
    assert.deepEqual(
      (await (await api("/api/workspace", newcomer)).json()).groups,
      [],
    );
  });
  await t.test("editable metadata cannot escalate a member role", async () => {
    assert.ok(
      !(
        await member.client.auth.updateUser({
          data: { role: "owner", group_id: firstGroup },
        })
      ).error,
    );
    assert.equal(
      (await api(`/api/groups/${firstGroup}/setup`, member)).status,
      403,
    );
  });
  await t.test(
    "role revocation takes effect with the same access token",
    async () => {
      sql(
        `delete from app.group_roles where group_id='${firstGroup}' and user_id='${organizer.id}';`,
      );
      try {
        assert.equal(
          (await api(`/api/groups/${firstGroup}/setup`, organizer)).status,
          403,
        );
      } finally {
        sql(
          `insert into app.group_roles values('${firstGroup}','${organizer.id}','organizer');`,
        );
      }
    },
  );
  await t.test(
    "browser RPC actor forgery and raw table access are denied",
    async () => {
      const response = await fetch(
        env.SUPABASE_URL + "/rest/v1/rpc/read_group_setup",
        {
          method: "POST",
          headers: {
            apikey: env.SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${member.token}`,
            "Content-Type": "application/json",
            "Content-Profile": "api",
          },
          body: JSON.stringify({
            p_actor_id: organizer.id,
            p_group_id: firstGroup,
          }),
        },
      );
      assert.ok(
        [401, 403, 404].includes(response.status),
        "Backend RPC must deny browser credentials.",
      );
      const table = await fetch(env.SUPABASE_URL + "/rest/v1/groups", {
        headers: {
          apikey: env.SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${member.token}`,
          "Accept-Profile": "app",
        },
      });
      assert.ok(!table.ok, "Internal tables must not be exposed.");
    },
  );
  await t.test("unknown API operations stay JSON", async () => {
    const response = await api("/api/no-such-operation");
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, "not_found");
  });
});
