import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { localEnv, fixturePassword } from "../scripts/local-env.mjs";

// P-38: direct invites to groups and sessions. Synthetic accounts only.
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

const local = (ms) => new Date(ms).toISOString().slice(0, 16);
const details = (over = {}) => {
  const now = Date.now();
  return {
    title: "Synthetic invite session",
    activity: "Workshop",
    startLocal: local(now + 86400000),
    endLocal: local(now + 93600000),
    timeZone: "UTC",
    location: "Synthetic room",
    instructions: "",
    capacity: "10",
    openLocal: local(now - 3600000),
    cutoffLocal: local(now + 43200000),
    fee: "5.00",
    currency: "SGD",
    guests: true,
    ...over,
  };
};

test("direct invites", async (t) => {
  const nonce = crypto.randomUUID().slice(0, 8),
    users = [],
    sessions = [],
    groups = [];
  t.after(() => {
    const s = sessions.map((id) => `'${id}'`).join(",") || "null";
    const g = groups.map((id) => `'${id}'`).join(",") || "null";
    const of = `(select id from app.parties where session_id in (${s}))`;
    sql(`begin;
      create temp table teams on commit drop as select group_id id from app.sessions where id in (${s});
      delete from app.invites where session_id in (${s}) or group_id in (${g}) or inviter_id in (${users.map((id) => `'${id}'`).join(",") || "null"});
      delete from app.join_requests where session_id in (${s});
      delete from app.group_join_requests where group_id in (${g});
      delete from app.operation_receipts where resource_id in (${s}) or resource_id in ${of} or resource_id in (${g}) or actor_id in (${users.map((id) => `'${id}'`).join(",") || "null"});
      delete from app.email_jobs where session_id in (${s});
      delete from app.fee_changes where party_id in ${of};
      delete from app.fee_obligations where party_id in ${of};
      delete from app.registration_events where party_id in ${of};
      delete from app.parties where session_id in (${s});
      delete from app.session_changes where session_id in (${s});
      delete from app.sessions where id in (${s});
      delete from app.group_roles where group_id in (select id from teams) or group_id in (${g});
      delete from app.groups where id in (select id from teams) or id in (${g});
      ${users.map((id) => `delete from auth.users where id='${id}';`).join("\n")}
      commit;`);
  });
  async function person(label) {
    const email = `p38-${nonce}-${label}@rallypoint.test`;
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
  const [org, a, b, c, d, stranger] = await Promise.all(
    ["org", "a", "b", "c", "d", "stranger"].map(person),
  );
  async function session(over = {}) {
    const r = await request("/api/sessions", org, {
      operationKey: crypto.randomUUID(),
      intent: "publish",
      details: details(over),
    });
    assert.equal(r.status, 200, await r.clone().text());
    const s = (await r.json()).session;
    sessions.push(s.id);
    return s;
  }
  const join = (s, who, version = s.version) =>
    request(`/api/registrations/${s.slug}`, who, {
      operationKey: crypto.randomUUID(),
      version,
      seats: 1,
      guestName: "",
      consent: true,
    });
  // Everyone but the stranger played in one of org's sessions.
  const known = await session();
  for (const who of [a, b, c, d])
    assert.equal((await join(known, who)).status, 200);
  const g = (
    await (
      await request("/api/groups", org, {
        operationKey: crypto.randomUUID(),
        name: "Synthetic invite group",
        visibility: "private",
      })
    ).json()
  ).group;
  groups.push(g.id);
  const send = (kind, target, who, profileId, key = crypto.randomUUID()) =>
    request("/api/invites", who, {
      operationKey: key,
      kind,
      target,
      profileId,
    });
  const act = (id, verb, who) =>
    request(`/api/invites/${id}/${verb}`, who, {
      operationKey: crypto.randomUUID(),
    });
  const mine = async (who) =>
    (await (await request("/api/me/invites", who)).json()).invites;

  await t.test("candidates are only people you know", async () => {
    const r = await request(
      `/api/invites/candidates?kind=group&target=${g.id}`,
      org,
    );
    assert.equal(r.status, 200, await r.clone().text());
    const ids = (await r.json()).people.map((p) => p.profileId);
    for (const who of [a, b, c, d]) assert.ok(ids.includes(who.profileId));
    assert.ok(!ids.includes(stranger.profileId));
    assert.ok(!ids.includes(org.profileId));
    const direct = await send("group", g.id, org, stranger.profileId);
    assert.equal(direct.status, 409);
    assert.equal((await direct.json()).error.code, "not_known");
  });

  await t.test("send is idempotent", async () => {
    const key = crypto.randomUUID();
    const first = await (
      await send("group", g.id, org, a.profileId, key)
    ).json();
    const again = await (
      await send("group", g.id, org, a.profileId, key)
    ).json();
    assert.equal(first.invite.id, again.invite.id);
    const other = await send("group", g.id, org, a.profileId);
    assert.equal(other.status, 409);
    assert.equal((await other.json()).error.code, "invite_exists");
  });

  await t.test("only the invitee sees it", async () => {
    assert.equal((await mine(a)).length, 1);
    assert.equal((await mine(a))[0].group.name, "Synthetic invite group");
    assert.equal((await mine(a))[0].inviterName, "Synthetic org");
    assert.deepEqual(await mine(b), []);
    const id = (await mine(a))[0].id;
    assert.equal((await act(id, "decline", b)).status, 403);
    assert.equal((await act(id, "accept", b)).status, 403);
  });

  await t.test("group invite: join makes a member", async () => {
    const id = (await mine(a))[0].id;
    assert.equal((await act(id, "accept", a)).status, 200);
    const view = (await (await request(`/api/groups/${g.id}`, a)).json()).group;
    assert.equal(view.viewerRole, "member");
    assert.deepEqual(await mine(a), []);
    const resend = await send("group", g.id, org, a.profileId);
    assert.equal(resend.status, 409);
    assert.equal((await resend.json()).error.code, "already_in");
  });

  await t.test("decline is final", async () => {
    await send("group", g.id, org, b.profileId);
    const id = (await mine(b))[0].id;
    assert.equal((await act(id, "decline", b)).status, 200);
    const again = await send("group", g.id, org, b.profileId);
    assert.equal(again.status, 409);
    assert.equal((await again.json()).error.code, "invite_declined");
  });

  await t.test("withdraw", async () => {
    await send("group", g.id, org, c.profileId);
    const id = (await mine(c))[0].id;
    assert.equal((await act(id, "withdraw", org)).status, 200);
    assert.deepEqual(await mine(c), []);
    const late = await act(id, "accept", c);
    assert.equal(late.status, 409);
    assert.equal((await late.json()).error.code, "invite_not_pending");
  });

  await t.test(
    "session invite skips ask to join and waitlists when full",
    async () => {
      const s = await session({ capacity: "1", joinMode: "request" });
      // Someone already holds the one seat.
      sql(
        `insert into app.group_roles(group_id,user_id,role) select group_id,'${d.id}','cohost' from app.sessions where id='${s.id}';`,
      );
      assert.equal((await join(s, d)).status, 200);
      assert.equal((await join(s, a)).status, 409);
      assert.equal((await send("session", s.id, org, a.profileId)).status, 200);
      const invite = (await mine(a))[0];
      assert.equal(invite.session.slug, s.slug);
      const view = (
        await (await request(`/api/registrations/${s.slug}`, a)).json()
      ).registration;
      assert.equal(view.invite.inviterName, "Synthetic org");
      const r = await join(s, a);
      assert.equal(r.status, 200, await r.clone().text());
      assert.equal((await r.json()).registration.own.state, "waitlisted");
      assert.equal(
        sql(`select state from app.invites where id='${invite.id}';`),
        "accepted",
      );
      assert.equal(
        sql(
          `select count(*) from app.email_jobs where session_id='${s.id}' and user_id='${a.id}';`,
        ),
        "0",
      );
      const managed = (
        await (await request(`/api/registrations/${s.slug}`, org)).json()
      ).registration;
      assert.equal(
        managed.invites.find((x) => x.id === invite.id).state,
        "accepted",
      );
    },
  );

  await t.test("join racing withdraw", async () => {
    const s = await session({ joinMode: "request" });
    await send("session", s.id, org, b.profileId);
    const id = (await mine(b)).find((x) => x.session?.slug === s.slug).id;
    const [joined, withdrawn] = await Promise.all([
      join(s, b),
      act(id, "withdraw", org),
    ]);
    const state = sql(`select state from app.invites where id='${id}';`);
    const parties = sql(
      `select count(*) from app.parties where session_id='${s.id}' and user_id='${b.id}';`,
    );
    if (joined.status === 200) {
      assert.equal(state, "accepted");
      assert.equal(parties, "1");
      assert.equal(withdrawn.status, 409);
    } else {
      assert.equal(state, "withdrawn");
      assert.equal(parties, "0");
    }
  });

  await t.test("expired at start", async () => {
    const s = await session();
    await send("session", s.id, org, c.profileId);
    sql(
      `update app.sessions set details=jsonb_set(details,'{startsAt}',to_jsonb((now()-interval '1 minute')::text)) where id='${s.id}';`,
    );
    assert.ok(!(await mine(c)).some((x) => x.session?.slug === s.slug));
    const r = await join(s, c);
    assert.equal(r.status, 409);
  });

  await t.test("role denial", async () => {
    const s = await session();
    assert.equal((await send("session", s.id, a, b.profileId)).status, 403);
    assert.equal((await send("session", s.id, null, b.profileId)).status, 401);
    assert.equal(
      (await request(`/api/invites/candidates?kind=session&target=${s.id}`, a))
        .status,
      403,
    );
    assert.equal((await send("group", g.id, a, d.profileId)).status, 403);
  });

  await t.test("cap of 20", async () => {
    const filler = Array.from({ length: 20 }, () => crypto.randomUUID());
    users.push(...filler);
    sql(`insert into auth.users(id) values ${filler.map((id) => `('${id}')`).join(",")};
      insert into app.invites(group_id,invitee_id,inviter_id,inviter_name)
        select '${g.id}',u,'${org.id}','Synthetic org' from unnest(array[${filler.map((id) => `'${id}'::uuid`).join(",")}]) u;`);
    const r = await send("group", g.id, org, d.profileId);
    assert.equal(r.status, 409);
    assert.equal((await r.json()).error.code, "invite_limit");
  });
});
