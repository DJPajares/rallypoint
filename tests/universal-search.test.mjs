import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { localEnv, fixturePassword } from "../scripts/local-env.mjs";
import { sql } from "./helpers/split-fixtures.mjs";

// Universal search (owner, 2026-10-30): one search from the menu finds groups,
// as group search did, and the signed-in person's own sessions by title. Other
// people's sessions are never found (sessions aren't discoverable), and people
// can't be looked up. Synthetic accounts only.
const env = localEnv(),
  base = process.env.RALLYPOINT_TEST_URL ?? "http://127.0.0.1:3000";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const request = (path, actor, body) =>
  fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const local = (t) => new Date(t).toISOString().slice(0, 16);

test("universal search", async (t) => {
  const nonce = crypto.randomUUID().slice(0, 8),
    users = [],
    sessions = [],
    groups = [];
  t.after(() => {
    const ids = sessions.map((id) => `'${id}'`).join(",") || "null";
    const parties = `(select id from app.parties where session_id in (${ids}))`;
    const gids = groups.map((id) => `'${id}'`).join(",") || "null";
    sql(`begin;
      delete from app.operation_receipts where actor_id in (${users.map((id) => `'${id}'`).join(",") || "null"});
      delete from app.email_jobs where session_id in (${ids});
      delete from app.fee_obligations where party_id in ${parties};
      delete from app.fee_changes where party_id in ${parties};
      delete from app.registration_events where party_id in ${parties};
      delete from app.parties where session_id in (${ids});
      delete from app.session_changes where session_id in (${ids});
      create temp table gone as select group_id from app.sessions where id in (${ids});
      delete from app.sessions where id in (${ids});
      delete from app.groups where id in (select group_id from gone) or id in (${gids});
      ${users.map((id) => `delete from auth.users where id='${id}';`).join("\n")}
      commit;`);
  });
  async function person(label) {
    const email = `search-${nonce}-${label}@rallypoint.test`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: fixturePassword,
      email_confirm: true,
      user_metadata: { full_name: `Synthetic ${label}` },
    });
    assert.ok(!error && data.user);
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
    const who = { id: data.user.id, token: signed.data.session.access_token };
    await request("/api/me", who);
    return who;
  }
  const [mine, other] = await Promise.all(["mine", "other"].map(person));
  async function session(who, title, intent = "publish") {
    const now = Date.now();
    const r = await request("/api/sessions", who, {
      operationKey: crypto.randomUUID(),
      intent,
      details: {
        title,
        activity: "Workshop",
        startLocal: local(now + 86400000),
        endLocal: local(now + 93600000),
        timeZone: "UTC",
        location: "Synthetic room",
        instructions: "",
        capacity: "4",
        openLocal: local(now - 3600000),
        cutoffLocal: local(now + 43200000),
        fee: "0",
        currency: "SGD",
        guests: false,
      },
    });
    assert.equal(r.status, 200, await r.clone().text());
    const s = (await r.json()).session;
    sessions.push(s.id);
    return s;
  }
  const search = (q, who = mine) =>
    request(
      `/api/search${q === undefined ? "" : `?q=${encodeURIComponent(q)}`}`,
      who,
    );

  await t.test("signed in, 2 to 40 characters", async () => {
    assert.equal((await search(`Find ${nonce}`, null)).status, 401);
    for (const q of [undefined, "", "a", "x".repeat(41)])
      assert.equal((await search(q)).status, 422, JSON.stringify(q));
  });

  await t.test("finds groups and only your own sessions", async () => {
    const g = await request("/api/groups", mine, {
      operationKey: crypto.randomUUID(),
      name: `Find ${nonce} Club`,
      visibility: "public",
    });
    assert.equal(g.status, 200);
    groups.push((await g.json()).group.id);
    const organizing = await session(mine, `Find ${nonce} Doubles`);
    const draft = await session(mine, `Find ${nonce} Draft`, "draft");
    const theirs = await session(other, `Find ${nonce} Theirs`);
    const joined = await session(other, `Find ${nonce} Joined`);
    const j = await request(`/api/registrations/${joined.slug}`, mine, {
      operationKey: crypto.randomUUID(),
      version: joined.version,
      seats: 1,
      guestName: "",
      consent: true,
    });
    assert.equal(j.status, 200);
    const r = await search(`find ${nonce.toUpperCase()}`);
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.deepEqual(
      body.groups.map((x) => x.name),
      [`Find ${nonce} Club`],
    );
    const titles = body.sessions.map((x) => x.title).sort();
    assert.deepEqual(titles, [
      `Find ${nonce} Doubles`,
      `Find ${nonce} Draft`,
      `Find ${nonce} Joined`,
    ]);
    const status = Object.fromEntries(
      body.sessions.map((x) => [x.title, x.status]),
    );
    assert.equal(status[`Find ${nonce} Joined`], "in");
    assert.equal(status[`Find ${nonce} Doubles`], "organizing");
    // Only a draft carries its id, for its editor.
    const ids = body.sessions.filter((x) => x.id).map((x) => x.id);
    assert.deepEqual(ids, [draft.id]);
    assert.ok(!JSON.stringify(body).includes(theirs.slug));
    assert.ok(body.sessions.some((x) => x.slug === organizing.slug));
    // The other person finds their own two, not the draft.
    const theirsFound = (await (await search(`Find ${nonce}`, other)).json())
      .sessions.map((x) => x.title)
      .sort();
    assert.deepEqual(theirsFound, [
      `Find ${nonce} Joined`,
      `Find ${nonce} Theirs`,
    ]);
  });
});
