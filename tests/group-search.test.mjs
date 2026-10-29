import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { localEnv, fixturePassword } from "../scripts/local-env.mjs";

// P-37: signed-in people find groups by name. Public results open the group
// page; private ones show only their name and that they're private. Synthetic
// accounts only.
const env = localEnv(),
  base = process.env.RALLYPOINT_TEST_URL ?? "http://127.0.0.1:3000";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const sql = (query) =>
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      "supabase_db_rallypoint",
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-Atq",
    ],
    { input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  ).trim();
const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
async function login(email) {
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password: fixturePassword,
  });
  assert.ok(!error && data.session, "Synthetic sign-in must succeed");
  return { id: data.user.id, token: data.session.access_token };
}
const request = (path, actor, body) =>
  fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

test("group search", async (t) => {
  const nonce = crypto.randomUUID().slice(0, 8),
    users = [],
    groups = [];
  t.after(() => {
    const ids = groups.map((id) => `'${id}'`).join(",") || "null";
    sql(`begin;
      delete from app.group_join_requests where group_id in (${ids});
      delete from app.operation_receipts where resource_id in (${ids});
      delete from app.group_roles where group_id in (${ids});
      delete from app.groups where id in (${ids});
      ${users.map((id) => `delete from auth.users where id='${id}';`).join("\n")}
      commit;`);
  });
  async function person(label) {
    const email = `p37-${nonce}-${label}@rallypoint.test`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: fixturePassword,
      email_confirm: true,
      user_metadata: { full_name: `Synthetic ${label}` },
    });
    assert.ok(!error && data.user);
    users.push(data.user.id);
    return login(email);
  }
  const [owner, finder] = await Promise.all(["owner", "finder"].map(person));
  // Groups made in SQL so the limit test stays fast; the owner holds each.
  function group(name, { kind = "community", visibility = "public" } = {}) {
    const id = sql(
      kind === "host"
        ? `insert into app.groups(name,kind,visibility,invite_token) values ('${name}','host',null,null) returning id;`
        : `insert into app.groups(name,visibility) values ('${name}','${visibility}') returning id;`,
    );
    groups.push(id);
    sql(
      `insert into app.group_roles(group_id,user_id,role) values ('${id}','${owner.id}','owner');`,
    );
    return id;
  }
  const search = (q, who = finder) =>
    request(
      `/api/groups/search${q === undefined ? "" : `?q=${encodeURIComponent(q)}`}`,
      who,
    );
  const found = async (q, who) => {
    const r = await search(q, who);
    assert.equal(r.status, 200, await r.clone().text());
    return (await r.json()).groups;
  };

  await t.test("signed-out search is refused", async () => {
    assert.equal((await search(`Find ${nonce}`, null)).status, 401);
  });

  await t.test("query must be 2 to 40 characters", async () => {
    for (const q of [undefined, "", "a", " b ", "x".repeat(41)]) {
      const r = await search(q);
      assert.equal(r.status, 422, `q=${JSON.stringify(q)}`);
    }
    // Length counts characters, so an emoji is one character, not two.
    assert.equal((await search("😀")).status, 422);
    assert.equal((await search("😀".repeat(21))).status, 200);
  });

  await t.test(
    "public result links; private result shows name only",
    async () => {
      const pub = group(`Find ${nonce} Public`);
      group(`Find ${nonce} Secret`, { visibility: "private" });
      const results = await found(`find ${nonce.toUpperCase()}`);
      assert.deepEqual(results, [
        {
          id: pub,
          name: `Find ${nonce} Public`,
          visibility: "public",
          viewerRole: null,
        },
        { name: `Find ${nonce} Secret`, visibility: "private" },
      ]);
      for (const r of results)
        for (const key of ["memberCount", "members", "inviteToken"])
          assert.equal(key in r, false, key);
    },
  );

  await t.test("a private group you're in shows as yours", async () => {
    group(`Mine ${nonce} Private`, { visibility: "private" });
    const [mine] = await found(`Mine ${nonce}`, owner);
    assert.equal(mine.visibility, "private");
    assert.equal(mine.viewerRole, "admin");
    assert.ok(mine.id);
  });

  await t.test("archived groups and hosting teams are left out", async () => {
    const gone = group(`Gone ${nonce} Archived`);
    sql(`update app.groups set archived_at=now() where id='${gone}';`);
    group(`Gone ${nonce} Team`, { kind: "host" });
    assert.deepEqual(await found(`Gone ${nonce}`), []);
  });

  await t.test("names starting with the search come first", async () => {
    group(`Zeta ${nonce} Club`);
    group(`${nonce} Zeta Club`);
    const names = (await found(`${nonce} Zeta`)).map((g) => g.name);
    assert.deepEqual(names, [`${nonce} Zeta Club`]);
    const both = (await found(`Zeta`)).filter((g) => g.name.includes(nonce));
    assert.deepEqual(
      both.map((g) => g.name),
      [`Zeta ${nonce} Club`, `${nonce} Zeta Club`],
    );
  });

  await t.test("wildcards are plain text", async () => {
    group(`Pct ${nonce} 100% Fun`);
    assert.deepEqual(await found("%_"), []);
    assert.equal((await found(`${nonce} 100%`)).length, 1);
  });

  await t.test("at most 20 results", async () => {
    for (let i = 0; i < 22; i++)
      group(`Many ${nonce} ${String(i).padStart(2, "0")}`);
    const results = await found(`Many ${nonce}`);
    assert.equal(results.length, 20);
    assert.equal(results[0].name, `Many ${nonce} 00`);
  });
});
