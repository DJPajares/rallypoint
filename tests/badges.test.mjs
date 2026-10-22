import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import {
  localEnv,
  fixturePassword,
  firstGroup,
} from "../scripts/local-env.mjs";
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
const client = () =>
  createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
async function login(email) {
  const { data, error } = await client().auth.signInWithPassword({
    email,
    password: fixturePassword,
  });
  assert.ok(!error && data.session, "Synthetic sign-in must succeed");
  return { id: data.user.id, token: data.session.access_token };
}
const request = (path, actor, body, method) =>
  fetch(base + path, {
    method: method ?? (body ? "POST" : "GET"),
    headers: {
      ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
const local = (ms) => new Date(ms).toISOString().slice(0, 16);
function details(capacity) {
  const now = Date.now();
  return {
    title: "Synthetic badge test",
    activity: "Workshop",
    startLocal: local(now + 86400000),
    endLocal: local(now + 93600000),
    timeZone: "UTC",
    location: "Synthetic room",
    instructions: "Test only",
    capacity,
    openLocal: local(now - 3600000),
    cutoffLocal: local(now + 43200000),
    fee: "12.50",
    currency: "SGD",
    guests: true,
  };
}
// Booked details are locked by a trigger; synthetic fixtures change them directly.
const unlocked = (statement) =>
  sql(
    `alter table app.sessions disable trigger protect_booked_session;${statement};alter table app.sessions enable trigger protect_booked_session;`,
  );
const code = async (r) => (await r.json()).error?.code;

test("badges and titles", async (t) => {
  const organizer = await login("organizer@rallypoint.test");
  const nonce = crypto.randomUUID().slice(0, 8);
  const groupName = sql(
    `select name from app.groups where id='${firstGroup}';`,
  );
  const cohosts = [],
    groups = [];
  async function fresh(label) {
    const email = `b1-${nonce}-${label}@rallypoint.test`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: fixturePassword,
      email_confirm: true,
      user_metadata: { full_name: `Badge ${label} ${nonce}` },
    });
    assert.ok(!error && data.user);
    return { ...(await login(email)), name: `Badge ${label} ${nonce}` };
  }
  async function cohost(label) {
    const actor = await fresh(label);
    sql(
      `insert into app.group_roles(group_id,user_id,role) values('${firstGroup}','${actor.id}','cohost');`,
    );
    cohosts.push(actor.id);
    return actor;
  }
  async function event(capacity = "4") {
    const r = await request(`/api/groups/${firstGroup}/sessions`, organizer, {
      operationKey: crypto.randomUUID(),
      groupId: firstGroup,
      intent: "publish",
      details: details(capacity),
    });
    assert.equal(r.status, 200);
    return (await r.json()).session;
  }
  const view = async (s, a) =>
    (await (await request(`/api/registrations/${s.slug}`, a)).json())
      .registration;
  async function join(s, a, seats = 1) {
    const r = await request(`/api/registrations/${s.slug}`, a, {
      operationKey: crypto.randomUUID(),
      version: s.version,
      seats,
      guestName: seats === 2 ? "Guest" : "",
      consent: true,
    });
    assert.equal(r.status, 200);
    return (await r.json()).registration.own;
  }
  async function mark(s, a, partyId, seat, state, revision) {
    const r = await request(`/api/registrations/${s.slug}/attendance`, a, {
      operationKey: crypto.randomUUID(),
      partyId,
      seat,
      state,
      revision,
    });
    assert.equal(r.status, 200, `attendance ${state}`);
  }
  async function badges(a) {
    const r = await request("/api/me/badges", a);
    assert.equal(r.status, 200);
    return r.json();
  }
  const ids = (b) => b.earned.map((badge) => badge.id);
  const setTitle = (a, badgeId) => request("/api/me/title", a, { badgeId });
  try {
    const host = await cohost("host");

    await t.test("requires sign-in and refuses other methods", async () => {
      assert.equal((await request("/api/me/badges", null)).status, 401);
      assert.equal(
        (await request("/api/me/title", null, { badgeId: null })).status,
        401,
      );
      assert.equal(
        (await request("/api/me/badges", host, null, "PUT")).status,
        405,
      );
      assert.equal(
        (await request("/api/me/badges/seen", host, null, "GET")).status,
        405,
      );
    });

    await t.test(
      "a first check-in earns First Rally, unseen until marked seen",
      async () => {
        const p = await fresh("first"),
          s = await event(),
          party = await join(s, p);
        assert.deepEqual((await badges(p)).earned, []);
        await mark(s, host, party.id, 1, "checked_in", 0);
        const b = await badges(p);
        assert.deepEqual(ids(b), ["first-rally"]);
        assert.equal(b.earned[0].seen, false);
        assert.deepEqual(b.stats, { played: 1, hosted: 0, groups: 0 });
        assert.deepEqual(
          b.progress.find((x) => x.key === "regular"),
          {
            key: "regular",
            groupId: firstGroup,
            groupName,
            current: 1,
            target: 5,
          },
        );
        assert.equal(
          b.progress.find((x) => x.key === "sessions-10").current,
          1,
        );
        const r = await request("/api/me/badges/seen", p, {
          ids: ["first-rally"],
        });
        assert.equal(r.status, 200);
        assert.equal((await r.json()).earned[0].seen, true);
        assert.equal((await badges(p)).earned[0].seen, true);
      },
    );

    await t.test("a guest check-in earns Plus One", async () => {
      const p = await fresh("guest"),
        s = await event(),
        party = await join(s, p, 2);
      await mark(s, host, party.id, 2, "checked_in", 0);
      const b = await badges(p);
      assert.deepEqual(ids(b), ["plus-one"]);
      assert.equal(b.stats.played, 0);
    });

    await t.test("people met counts other accounts, not guests", async () => {
      const a = await fresh("met-a"),
        b = await fresh("met-b"),
        c = await fresh("met-c"),
        s = await event();
      const pa = await join(s, a),
        pb = await join(s, b),
        pc = await join(s, c, 2);
      await mark(s, host, pa.id, 1, "checked_in", 0);
      await mark(s, host, pb.id, 1, "checked_in", 0);
      await mark(s, host, pc.id, 2, "checked_in", 0);
      for (const actor of [a, b])
        assert.equal(
          (await badges(actor)).progress.find((x) => x.key === "new-faces-10")
            .current,
          1,
        );
    });

    await t.test(
      "running check-in earns Host and a full session earns Full House",
      async () => {
        const runner = await cohost("runner"),
          p = await fresh("full-a"),
          q = await fresh("full-b");
        const open = await event("2");
        await mark(open, runner, (await join(open, p)).id, 1, "checked_in", 0);
        let b = await badges(runner);
        assert.deepEqual(ids(b), ["host"]);
        assert.equal(b.stats.hosted, 1);
        const full = await event("1");
        await mark(full, runner, (await join(full, q)).id, 1, "checked_in", 0);
        b = await badges(runner);
        assert.deepEqual(ids(b).sort(), ["full-house", "host"]);
        assert.equal(b.stats.hosted, 2);
        assert.equal(b.stats.groups, 1);
      },
    );

    await t.test("starting a group earns Founder for that group", async () => {
      const f = await fresh("founder");
      const r = await request("/api/groups", f, {
        operationKey: crypto.randomUUID(),
        name: `Badge group ${nonce}`,
      });
      assert.equal(r.status, 200);
      const group = (await r.json()).group;
      groups.push(group.id);
      const b = await badges(f);
      assert.deepEqual(
        b.earned.map(({ id, key, groupId, groupName: name }) => ({
          id,
          key,
          groupId,
          name,
        })),
        [
          {
            id: `founder:${group.id}`,
            key: "founder",
            groupId: group.id,
            name: `Badge group ${nonce}`,
          },
        ],
      );
    });

    await t.test(
      "titles: only earned badges, null clears, and rosters show them",
      async () => {
        const p = await fresh("title-p"),
          q = await fresh("title-q"),
          s = await event();
        const pp = await join(s, p),
          pq = await join(s, q);
        await mark(s, host, pp.id, 1, "checked_in", 0);
        await mark(s, host, pq.id, 1, "checked_in", 0);
        let r = await setTitle(p, "host");
        assert.equal(r.status, 422);
        assert.equal(await code(r), "title_not_earned");
        for (const bad of ["nope", 5, `first-rally:${firstGroup}`]) {
          r = await setTitle(p, bad);
          assert.equal(r.status, 422);
          assert.equal(await code(r), "invalid_title");
        }
        r = await setTitle(p, "first-rally");
        assert.equal(r.status, 200);
        assert.deepEqual((await r.json()).title, {
          id: "first-rally",
          key: "first-rally",
          groupName: null,
        });
        for (const viewer of [q, organizer]) {
          const entry = (await view(s, viewer)).roster.find(
            (x) => x.primaryName === p.name,
          );
          assert.deepEqual(entry.title, {
            key: "first-rally",
            groupName: null,
          });
        }
        assert.equal(
          (await view(s, q)).roster.find((x) => x.primaryName === q.name).title,
          null,
        );
        r = await setTitle(p, null);
        assert.equal(r.status, 200);
        assert.equal((await r.json()).title, null);
      },
    );

    await t.test("correction removes the badge and its title", async () => {
      const p = await fresh("fix-p"),
        q = await fresh("fix-q"),
        s = await event();
      const pp = await join(s, p),
        pq = await join(s, q);
      await mark(s, host, pp.id, 1, "checked_in", 0);
      await mark(s, host, pq.id, 1, "checked_in", 0);
      assert.equal((await setTitle(p, "first-rally")).status, 200);
      await mark(s, host, pp.id, 1, "unrecorded", 1);
      const b = await badges(p);
      assert.deepEqual(b.earned, []);
      assert.equal(b.title, null);
      assert.equal(
        (await view(s, q)).roster.find((x) => x.primaryName === p.name).title,
        null,
      );
    });

    await t.test("seen markers ignore badges not earned", async () => {
      const p = await fresh("seen");
      const r = await request("/api/me/badges/seen", p, {
        ids: ["sessions-100"],
      });
      assert.equal(r.status, 200);
      assert.equal(
        sql(`select count(*) from app.badge_views where user_id='${p.id}';`),
        "0",
      );
      for (const bad of [
        [],
        Array.from({ length: 51 }, () => "first-rally"),
        ["first rally"],
        "first-rally",
      ]) {
        const refused = await request("/api/me/badges/seen", p, { ids: bad });
        assert.equal(refused.status, 422);
        assert.equal(await code(refused), "invalid_badges");
      }
    });

    await t.test("no-shows and waiting earn nothing", async () => {
      const x = await fresh("noshow"),
        w = await fresh("waiting"),
        s = await event("1");
      const px = await join(s, x),
        pw = await join(s, w);
      assert.equal(pw.state, "waitlisted");
      unlocked(
        `update app.sessions set details=jsonb_set(details,'{endsAt}',to_jsonb((clock_timestamp()-interval '1 minute')::text)) where id='${s.id}'`,
      );
      await mark(s, host, px.id, 1, "no_show", 0);
      for (const actor of [x, w]) {
        const b = await badges(actor);
        assert.deepEqual(b.earned, []);
        assert.equal(b.stats.played, 0);
      }
    });

    await t.test(
      "moving up from the waitlist and showing up earns Off the Bench",
      async () => {
        const x = await fresh("bench-x"),
          w = await fresh("bench-w"),
          s = await event("1");
        const px = await join(s, x),
          pw = await join(s, w);
        const r = await request(`/api/registrations/${s.slug}/withdraw`, x, {
          operationKey: crypto.randomUUID(),
          partyId: px.id,
        });
        assert.equal(r.status, 200);
        await mark(s, host, pw.id, 1, "checked_in", 0);
        assert.deepEqual(ids(await badges(w)).sort(), [
          "first-rally",
          "off-the-bench",
        ]);
      },
    );

    await t.test("cancelled sessions do not count", async () => {
      const p = await fresh("cancel"),
        s = await event();
      await mark(s, host, (await join(s, p)).id, 1, "checked_in", 0);
      assert.deepEqual(ids(await badges(p)), ["first-rally"]);
      unlocked(`update app.sessions set state='cancelled' where id='${s.id}'`);
      assert.deepEqual((await badges(p)).earned, []);
    });
  } finally {
    for (const id of cohosts)
      sql(
        `delete from app.group_roles where group_id='${firstGroup}' and user_id='${id}';`,
      );
    for (const id of groups) sql(`delete from app.groups where id='${id}';`);
  }
});
