import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { localEnv, fixturePassword } from "../scripts/local-env.mjs";

// P-35: groups are Public/Private member lists people ask to join; the admin
// accepts or declines. Synthetic accounts only.
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
  const who = { id: data.user.id, token: data.session.access_token };
  const me = await request("/api/me", who);
  return { ...who, ...(await me.json()) };
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

test("group membership", async (t) => {
  const nonce = crypto.randomUUID().slice(0, 8),
    users = [],
    groups = [];
  t.after(() => {
    const ids = groups.map((id) => `'${id}'`).join(",") || "null";
    sql(`begin;
      delete from app.group_join_requests where group_id in (${ids});
      delete from app.operation_receipts where resource_id in (${ids}) or payload->>'groupId' in (${groups.map((id) => `'${id}'`).join(",") || "''"});
      delete from app.group_roles where group_id in (${ids});
      delete from app.groups where id in (${ids});
      ${users.map((id) => `delete from auth.users where id='${id}';`).join("\n")}
      commit;`);
  });
  async function person(label) {
    const email = `p35-${nonce}-${label}@rallypoint.test`;
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
  const [owner, a, b, c, d] = await Promise.all(
    ["admin", "a", "b", "c", "d"].map(person),
  );
  async function group(visibility) {
    const r = await request("/api/groups", owner, {
      operationKey: crypto.randomUUID(),
      name: `Synthetic ${visibility} group`,
      visibility,
    });
    assert.equal(r.status, 200, await r.clone().text());
    const g = (await r.json()).group;
    groups.push(g.id);
    return g;
  }
  const read = async (g, who, invite) =>
    request(`/api/groups/${g.id}${invite ? `?invite=${invite}` : ""}`, who);
  const view = async (g, who, invite) =>
    (await (await read(g, who, invite)).json()).group;
  const ask = (g, who, invite) =>
    request(`/api/groups/${g.id}/requests`, who, {
      operationKey: crypto.randomUUID(),
      ...(invite ? { invite } : {}),
    });
  const pending = (g, who) =>
    sql(
      `select id from app.group_join_requests where group_id='${g.id}' and user_id='${who.id}' and state='pending';`,
    );
  const answer = (g, who, requestId, action) =>
    request(`/api/groups/${g.id}/requests/answer`, who, {
      operationKey: crypto.randomUUID(),
      requestId,
      action,
    });
  const cancel = (g, who, requestId) =>
    request(`/api/groups/${g.id}/requests/cancel`, who, {
      operationKey: crypto.randomUUID(),
      requestId,
    });

  await t.test("public group: ask, admin accepts", async () => {
    const g = await group("public");
    const outside = await view(g, a);
    assert.equal(outside.viewerRole, null);
    assert.equal(outside.canAsk, true);
    assert.equal(outside.memberCount, 1);
    assert.equal(outside.members, undefined);
    assert.equal((await ask(g, a)).status, 200);
    assert.equal((await view(g, a)).request.state, "pending");
    const mine = await view(g, owner);
    assert.equal(mine.viewerRole, "admin");
    assert.equal(mine.requests.length, 1);
    assert.equal(mine.requests[0].name, "Synthetic a");
    for (const key of ["email", "userId", "noShows"])
      assert.equal(key in mine.requests[0], false, key);
    assert.equal((await answer(g, owner, pending(g, a), "accept")).status, 200);
    const inside = await view(g, a);
    assert.equal(inside.viewerRole, "member");
    assert.deepEqual(inside.members.map((m) => m.name).sort(), [
      "Synthetic a",
      "Synthetic admin",
    ]);
    assert.equal(inside.inviteToken, undefined);
    assert.equal(inside.requests, undefined);
  });

  await t.test("private group conceals without a token", async () => {
    const g = await group("private");
    const concealed = { id: g.id, visibility: "private", concealed: true };
    assert.deepEqual(await view(g, a), concealed);
    assert.deepEqual(await view(g, a, crypto.randomUUID()), concealed);
    assert.equal((await read(g, null)).status, 401);
    const r = await ask(g, a);
    assert.equal(r.status, 409);
    assert.equal((await r.json()).error.code, "invite_required");
    const wrong = await ask(g, a, crypto.randomUUID());
    assert.equal(wrong.status, 409);
  });

  await t.test("private group with the invite link", async () => {
    const g = await group("private");
    const token = (await view(g, owner)).inviteToken;
    assert.ok(token);
    const invited = await view(g, b, token);
    assert.equal(invited.name, "Synthetic private group");
    assert.equal(invited.canAsk, true);
    assert.equal(invited.members, undefined);
    // P-39: the link shows the name and Ask to join, not how many are in it.
    assert.equal("memberCount" in invited, false);
    assert.equal(typeof (await view(g, owner)).memberCount, "number");
    assert.equal((await ask(g, b, token)).status, 200);
    assert.equal(
      (await answer(g, owner, pending(g, b), "decline")).status,
      200,
    );
    const again = await ask(g, b, token);
    assert.equal(again.status, 409);
    assert.equal((await again.json()).error.code, "request_declined");
  });

  await t.test("only the admin answers and removes", async () => {
    const g = await group("public");
    await ask(g, a);
    await answer(g, owner, pending(g, a), "accept");
    await ask(g, b);
    const id = pending(g, b);
    for (const who of [a, c]) {
      assert.equal((await answer(g, who, id, "accept")).status, 403);
      assert.equal(
        (
          await request(`/api/groups/${g.id}/members/remove`, who, {
            operationKey: crypto.randomUUID(),
            profileId: owner.profileId,
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request(`/api/groups/${g.id}/visibility`, who, {
            operationKey: crypto.randomUUID(),
            visibility: "private",
          })
        ).status,
        403,
      );
    }
    assert.equal(pending(g, b), id);
  });

  await t.test("limits", async () => {
    const g = await group("public");
    for (let i = 0; i < 2; i++) {
      assert.equal((await ask(g, c)).status, 200);
      assert.equal((await cancel(g, c, pending(g, c))).status, 200);
    }
    const third = await ask(g, c);
    assert.equal(third.status, 409);
    assert.equal((await third.json()).error.code, "request_cancel_limit");
    const others = [];
    for (let i = 0; i < 10; i++) others.push(await group("public"));
    for (const o of others) assert.equal((await ask(o, d)).status, 200);
    const eleventh = await ask(await group("public"), d);
    assert.equal(eleventh.status, 409);
    assert.equal((await eleventh.json()).error.code, "request_limit");
  });

  await t.test("accept racing cancel has one result", async () => {
    const g = await group("public");
    await ask(g, a);
    const id = pending(g, a);
    const [x, y] = await Promise.all([
      answer(g, owner, id, "accept"),
      cancel(g, a, id),
    ]);
    assert.deepEqual([x.status, y.status].sort(), [200, 409]);
    const member = sql(
      `select count(*) from app.group_roles where group_id='${g.id}' and user_id='${a.id}';`,
    );
    assert.equal(member, x.status === 200 ? "1" : "0");
  });

  await t.test("admin cannot leave; member can", async () => {
    const g = await group("public");
    await ask(g, a);
    await answer(g, owner, pending(g, a), "accept");
    const leave = (who) =>
      request(`/api/groups/${g.id}/leave`, who, {
        operationKey: crypto.randomUUID(),
      });
    const refused = await leave(owner);
    assert.equal(refused.status, 409);
    assert.equal((await refused.json()).error.code, "admin_cannot_leave");
    assert.equal((await leave(a)).status, 200);
    assert.equal((await view(g, a)).viewerRole, null);
  });

  await t.test("removed member may ask again", async () => {
    const g = await group("public");
    await ask(g, a);
    await answer(g, owner, pending(g, a), "accept");
    const r = await request(`/api/groups/${g.id}/members/remove`, owner, {
      operationKey: crypto.randomUUID(),
      profileId: a.profileId,
    });
    assert.equal(r.status, 200, await r.clone().text());
    assert.equal((await view(g, a)).viewerRole, null);
    assert.equal((await ask(g, a)).status, 200);
  });

  await t.test("host groups are invisible", async () => {
    const team = sql("select id from app.groups where kind='host' limit 1;");
    assert.equal((await read({ id: team }, a)).status, 404);
    const workspace = await (await request("/api/workspace", owner)).json();
    assert.ok(workspace.groups.every((g) => groups.includes(g.id)));
    assert.ok(workspace.groups.every((g) => g.role === "admin"));
  });

  await t.test("visibility switch keeps pending requests", async () => {
    const g = await group("public");
    await ask(g, a);
    const id = pending(g, a);
    const r = await request(`/api/groups/${g.id}/visibility`, owner, {
      operationKey: crypto.randomUUID(),
      visibility: "private",
    });
    assert.equal(r.status, 200, await r.clone().text());
    assert.equal((await r.json()).group.visibility, "private");
    assert.equal(pending(g, a), id);
    assert.equal((await answer(g, owner, id, "accept")).status, 200);
  });

  await t.test(
    "after a group turns Private, a requester sees only their request",
    async () => {
      const g = await group("public");
      await ask(g, b);
      const id = pending(g, b);
      const r = await request(`/api/groups/${g.id}/visibility`, owner, {
        operationKey: crypto.randomUUID(),
        visibility: "private",
      });
      assert.equal(r.status, 200);
      const hidden = { id: g.id, visibility: "private", concealed: true };
      assert.deepEqual(await view(g, b), {
        ...hidden,
        request: { id, state: "pending" },
      });
      // The cancel answer, and its retry, show nothing more about the group.
      const operationKey = crypto.randomUUID();
      for (let i = 0; i < 2; i++) {
        const c = await request(`/api/groups/${g.id}/requests/cancel`, b, {
          operationKey,
          requestId: id,
        });
        assert.equal(c.status, 200, await c.clone().text());
        assert.deepEqual((await c.json()).group, hidden, `attempt ${i + 1}`);
      }
      assert.deepEqual(await view(g, b), hidden);
    },
  );
  await t.test("someone asking before opening the app is named", async () => {
    const g = await group("public");
    const email = `p35-${nonce}-fresh@rallypoint.test`;
    const { data } = await admin.auth.admin.createUser({
      email,
      password: fixturePassword,
      email_confirm: true,
      user_metadata: { full_name: "Synthetic fresh" },
    });
    users.push(data.user.id);
    const client = createClient(
      env.SUPABASE_URL,
      env.SUPABASE_PUBLISHABLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const signed = await client.auth.signInWithPassword({
      email,
      password: fixturePassword,
    });
    const fresh = { token: signed.data.session.access_token };
    assert.equal((await ask(g, fresh)).status, 200);
    assert.equal((await view(g, owner)).requests[0].name, "Synthetic fresh");
  });
  await t.test("anyone accepted can be removed by name", async () => {
    const g = await group("public");
    const { data } = await admin.auth.admin.createUser({
      email: `p35-${nonce}-noprofile@rallypoint.test`,
      password: fixturePassword,
      email_confirm: true,
      user_metadata: { full_name: "Synthetic no profile" },
    });
    users.push(data.user.id);
    const id = sql(
      `insert into app.group_join_requests(group_id,user_id) values('${g.id}','${data.user.id}') returning id;`,
    );
    const accepted = await answer(g, owner, id, "accept");
    assert.equal(accepted.status, 200);
    const joined = (await accepted.json()).group.members.find(
      (m) => m.role === "member",
    );
    assert.ok(joined.profileId);
    const removed = await request(`/api/groups/${g.id}/members/remove`, owner, {
      operationKey: crypto.randomUUID(),
      profileId: joined.profileId,
    });
    assert.equal(removed.status, 200, await removed.clone().text());
  });
});
