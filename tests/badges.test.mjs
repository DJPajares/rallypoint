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
      `insert into app.group_roles(group_id,user_id,role) select id,'${actor.id}','cohost' from app.groups where origin_group_id='${firstGroup}' on conflict do nothing;`,
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
    const s = (await r.json()).session;
    // Co-hosts belong to each session (P-35); add this test's co-hosts to it.
    if (cohosts.length)
      sql(
        `insert into app.group_roles(group_id,user_id,role) select group_id,u,'cohost' from app.sessions, unnest(array[${cohosts.map((id) => `'${id}'::uuid`).join(",")}]) u where id='${s.id}' on conflict do nothing;`,
      );
    return s;
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
  const badge = (b, key) => b.badges.find((x) => x.key === key);
  const levels = (b, key) => badge(b, key).levels.map((l) => l.level);
  const seenLevels = (b, key) =>
    badge(b, key)
      .levels.filter((l) => l.seen)
      .map((l) => l.level);
  const started = (b) =>
    b.badges.filter((x) => x.levels.length).map((x) => x.key);
  const markSeen = (a, ids) => request("/api/me/badges/seen", a, { ids });
  const setTitle = (a, badgeId) => request("/api/me/title", a, { badgeId });
  // Booked sessions keep their details; fixtures move a session in time directly.
  // Fixtures give a session another organizer (its hosting team's owner) or
  // a listed activity directly.
  const ownedBy = (s, a) =>
    sql(
      `update app.group_roles set user_id='${a.id}' where role='owner' and group_id=(select group_id from app.sessions where id='${s.id}');`,
    );
  const activity = (s, key) =>
    unlocked(
      `update app.sessions set activity_key=${key ? `'${key}'` : "null"} where id='${s.id}'`,
    );
  const move = (s, startsAt, timeZone) =>
    unlocked(
      `update app.sessions set details=details||jsonb_build_object('startsAt','${startsAt}','endsAt',('${startsAt}'::timestamptz+interval '2 hours')::text,'timeZone','${timeZone}') where id='${s.id}'`,
    );
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
      "a first check-in starts Rally at level 1, unseen until marked seen",
      async () => {
        const p = await fresh("first"),
          s = await event(),
          party = await join(s, p);
        let b = await badges(p);
        assert.deepEqual(
          b.badges.map((x) => [x.key, x.current, x.levels]),
          [
            ["rally", 0, []],
            ["steady", 0, []],
            ["explorer", 0, []],
            ["all-rounder", 0, []],
            ["new-faces", 0, []],
            ["crew", 0, []],
            ["plus-one", 0, []],
            ["host", 0, []],
            ["full-house", 0, []],
            ["open-door", 0, []],
          ],
        );
        await mark(s, host, party.id, 1, "checked_in", 0);
        b = await badges(p);
        assert.equal(badge(b, "rally").current, 1);
        assert.deepEqual(
          badge(b, "rally").levels.map(({ level, seen }) => ({ level, seen })),
          [{ level: 1, seen: false }],
        );
        assert.ok(Date.parse(badge(b, "rally").levels[0].earnedAt));
        assert.equal(badge(b, "steady").current, 1);
        // One organizer is not yet Explorer; a session without a listed
        // activity is never All-Rounder.
        assert.equal(badge(b, "explorer").current, 1);
        assert.equal(badge(b, "all-rounder").current, 0);
        assert.deepEqual(started(b), ["rally"]);
        assert.deepEqual(b.stats, { played: 1, hosted: 0, groups: 0 });
        assert.equal("titles" in b, false);
        const r = await markSeen(p, ["rally:1"]);
        assert.equal(r.status, 200);
        assert.deepEqual(seenLevels(await r.json(), "rally"), [1]);
        assert.deepEqual(seenLevels(await badges(p), "rally"), [1]);
      },
    );

    await t.test(
      "the tenth session reaches level 2; a correction takes it back and re-earning stays seen",
      async () => {
        const p = await fresh("ten"),
          parties = [];
        for (let i = 0; i < 10; i++) {
          const s = await event();
          parties.push([s, await join(s, p)]);
        }
        for (const [s, party] of parties.slice(0, 9))
          await mark(s, host, party.id, 1, "checked_in", 0);
        let b = await badges(p);
        assert.equal(badge(b, "rally").current, 9);
        assert.deepEqual(levels(b, "rally"), [1]);
        const [last, lastParty] = parties[9];
        await mark(last, host, lastParty.id, 1, "checked_in", 0);
        b = await badges(p);
        assert.deepEqual(levels(b, "rally"), [1, 2]);
        assert.equal(badge(b, "rally").current, 10);
        assert.equal((await markSeen(p, ["rally:1", "rally:2"])).status, 200);
        await mark(last, host, lastParty.id, 1, "unrecorded", 1);
        b = await badges(p);
        assert.deepEqual(levels(b, "rally"), [1]);
        await mark(last, host, lastParty.id, 1, "checked_in", 2);
        b = await badges(p);
        assert.deepEqual(levels(b, "rally"), [1, 2]);
        assert.deepEqual(seenLevels(b, "rally"), [1, 2]);
      },
    );

    await t.test(
      "a guest check-in counts for Plus One, not Rally",
      async () => {
        const p = await fresh("guest"),
          s = await event(),
          party = await join(s, p, 2);
        await mark(s, host, party.id, 2, "checked_in", 0);
        const b = await badges(p);
        assert.deepEqual(started(b), ["plus-one"]);
        assert.equal(badge(b, "plus-one").current, 1);
        assert.equal(badge(b, "rally").current, 0);
        assert.equal(b.stats.played, 0);
      },
    );

    await t.test(
      "five other accounts at one session reach New Faces level 1; guests don't count",
      async () => {
        const people = [];
        for (let i = 0; i < 6; i++) people.push(await fresh(`met-${i}`));
        const s = await event("8");
        for (const [i, person] of people.entries()) {
          const party = await join(s, person, i === 5 ? 2 : 1);
          await mark(s, host, party.id, 1, "checked_in", 0);
          if (i === 5) await mark(s, host, party.id, 2, "checked_in", 0);
        }
        for (const person of people) {
          const b = await badges(person);
          assert.equal(badge(b, "new-faces").current, 5);
          assert.deepEqual(levels(b, "new-faces"), [1]);
        }
      },
    );

    await t.test(
      "a host who checks themselves in at a full session earns Rally, Host and Full House",
      async () => {
        const runner = await cohost("runner"),
          q = await fresh("full-q"),
          s = await event("2");
        const own = await join(s, runner),
          other = await join(s, q);
        await mark(s, runner, own.id, 1, "checked_in", 0);
        await mark(s, runner, other.id, 1, "checked_in", 0);
        const b = await badges(runner);
        assert.deepEqual(started(b), ["rally", "host", "full-house"]);
        assert.equal(badge(b, "host").current, 1);
        assert.equal(b.stats.hosted, 1);
        const open = await event("4");
        await mark(open, runner, (await join(open, q)).id, 1, "checked_in", 0);
        const after = await badges(runner);
        assert.equal(badge(after, "host").current, 2);
        assert.equal(badge(after, "full-house").current, 1);
      },
    );

    await t.test(
      "Explorer counts different organizers, never yourself, and corrections take it back",
      async () => {
        const p = await fresh("explorer"),
          other = await fresh("explorer-org"),
          a = await event(),
          b = await event(),
          own = await event();
        ownedBy(b, other);
        ownedBy(own, p);
        const pa = await join(a, p),
          pb = await join(b, p),
          po = await join(own, p);
        await mark(a, host, pa.id, 1, "checked_in", 0);
        await mark(own, host, po.id, 1, "checked_in", 0);
        let view = await badges(p);
        assert.equal(badge(view, "explorer").current, 1);
        assert.deepEqual(levels(view, "explorer"), []);
        await mark(b, host, pb.id, 1, "checked_in", 0);
        view = await badges(p);
        assert.equal(badge(view, "explorer").current, 2);
        assert.deepEqual(levels(view, "explorer"), [1]);
        // The public profile shows the level, never who or how many.
        const { profile } = await (await request("/api/me/profile", p)).json();
        const shown = (
          await (await request(`/api/people/${profile.profileId}`, null)).json()
        ).profile;
        assert.deepEqual(
          shown.badges.find((x) => x.key === "explorer"),
          { key: "explorer", level: 1 },
        );
        await mark(b, host, pb.id, 1, "unrecorded", 1);
        view = await badges(p);
        assert.equal(badge(view, "explorer").current, 1);
        assert.deepEqual(levels(view, "explorer"), []);
      },
    );

    await t.test(
      "All-Rounder counts sessions outside your most-played activity; Other never counts",
      async () => {
        const p = await fresh("rounder"),
          plan = [
            "tennis",
            "tennis",
            "badminton",
            "general",
            null,
            "badminton",
          ],
          played = [];
        for (const key of plan) {
          const s = await event();
          activity(s, key);
          played.push([s, await join(s, p)]);
        }
        const check = async (i) =>
          mark(played[i][0], host, played[i][1].id, 1, "checked_in", 0);
        await check(0);
        await check(1);
        let view = await badges(p);
        assert.equal(badge(view, "all-rounder").current, 0);
        await check(2);
        view = await badges(p);
        assert.equal(badge(view, "all-rounder").current, 1);
        assert.deepEqual(levels(view, "all-rounder"), [1]);
        await check(3);
        await check(4);
        assert.equal(badge(await badges(p), "all-rounder").current, 1);
        // Tennis 2, badminton 2: two sessions sit outside the main activity.
        await check(5);
        assert.equal(badge(await badges(p), "all-rounder").current, 2);
        await mark(played[2][0], host, played[2][1].id, 1, "unrecorded", 1);
        await mark(played[5][0], host, played[5][1].id, 1, "unrecorded", 1);
        view = await badges(p);
        assert.equal(badge(view, "all-rounder").current, 0);
        assert.deepEqual(levels(view, "all-rounder"), []);
      },
    );

    await t.test(
      "Crew counts people checked in with you at three sessions, once each",
      async () => {
        const p = await fresh("crew-p"),
          q = await fresh("crew-q"),
          r = await fresh("crew-r"),
          sessions = [];
        for (let i = 0; i < 3; i++) {
          const s = await event();
          const pp = await join(s, p),
            pq = await join(s, q);
          await mark(s, host, pp.id, 1, "checked_in", 0);
          if (i < 2) await mark(s, host, pq.id, 1, "checked_in", 0);
          sessions.push([s, pq]);
        }
        await mark(
          sessions[0][0],
          host,
          (await join(sessions[0][0], r)).id,
          1,
          "checked_in",
          0,
        );
        let view = await badges(p);
        assert.equal(badge(view, "crew").current, 0);
        const [third, thirdQ] = sessions[2];
        await mark(third, host, thirdQ.id, 1, "checked_in", 0);
        for (const person of [p, q]) {
          view = await badges(person);
          assert.equal(badge(view, "crew").current, 1);
          assert.deepEqual(levels(view, "crew"), [1]);
        }
        assert.equal(badge(await badges(r), "crew").current, 0);
        await mark(third, host, thirdQ.id, 1, "unrecorded", 1);
        view = await badges(p);
        assert.equal(badge(view, "crew").current, 0);
        assert.deepEqual(levels(view, "crew"), []);
      },
    );

    await t.test(
      "Open Door counts different people at sessions you ran, not you and not guests",
      async () => {
        const runner = await cohost("door"),
          people = [];
        for (let i = 0; i < 10; i++) people.push(await fresh(`door-${i}`));
        const first = await event("12"),
          second = await event("4");
        const own = await join(first, runner);
        await mark(first, runner, own.id, 1, "checked_in", 0);
        for (const [i, person] of people.slice(0, 9).entries()) {
          const party = await join(first, person, i === 0 ? 2 : 1);
          await mark(first, runner, party.id, 1, "checked_in", 0);
          if (i === 0) await mark(first, runner, party.id, 2, "checked_in", 0);
        }
        let view = await badges(runner);
        assert.equal(badge(view, "open-door").current, 9);
        assert.deepEqual(levels(view, "open-door"), []);
        // Someone already counted, at a second session, adds nothing.
        await mark(
          second,
          runner,
          (await join(second, people[1])).id,
          1,
          "checked_in",
          0,
        );
        assert.equal(badge(await badges(runner), "open-door").current, 9);
        const last = await join(second, people[9]);
        await mark(second, runner, last.id, 1, "checked_in", 0);
        view = await badges(runner);
        assert.equal(badge(view, "open-door").current, 10);
        assert.deepEqual(levels(view, "open-door"), [1]);
        await mark(second, runner, last.id, 1, "unrecorded", 1);
        assert.deepEqual(levels(await badges(runner), "open-door"), []);
      },
    );

    await t.test("a new badge can be a title, at its level", async () => {
      const p = await fresh("new-title"),
        other = await fresh("new-title-org"),
        a = await event(),
        b = await event();
      ownedBy(b, other);
      await mark(a, host, (await join(a, p)).id, 1, "checked_in", 0);
      let r = await setTitle(p, "explorer");
      assert.equal(r.status, 422);
      assert.equal(await code(r), "title_not_earned");
      await mark(b, host, (await join(b, p)).id, 1, "checked_in", 0);
      r = await setTitle(p, "explorer");
      assert.equal(r.status, 200);
      assert.deepEqual((await r.json()).title, { key: "explorer", level: 1 });
    });

    await t.test(
      "Steady counts months by the session's own date and zone",
      async () => {
        const p = await fresh("steady"),
          a = await event(),
          b = await event();
        await mark(a, host, (await join(a, p)).id, 1, "checked_in", 0);
        await mark(b, host, (await join(b, p)).id, 1, "checked_in", 0);
        move(a, "2026-01-15T10:00:00Z", "Asia/Manila");
        // 16:30 UTC on 31 January is already 1 February in Manila.
        move(b, "2026-01-31T16:30:00Z", "Asia/Manila");
        let view = await badges(p);
        assert.equal(badge(view, "steady").current, 2);
        assert.deepEqual(levels(view, "steady"), [1]);
        move(b, "2026-01-31T16:30:00Z", "UTC");
        view = await badges(p);
        assert.equal(badge(view, "steady").current, 1);
        assert.deepEqual(levels(view, "steady"), []);
        move(b, "2026-02-01T08:00:00Z", "Nowhere/Bogus");
        view = await badges(p);
        assert.equal(badge(view, "steady").current, 2);
      },
    );

    await t.test(
      "no-shows, waiting and cancelled sessions earn nothing",
      async () => {
        const x = await fresh("noshow"),
          w = await fresh("waiting"),
          c = await fresh("cancel"),
          s = await event("1"),
          gone = await event();
        const px = await join(s, x),
          pw = await join(s, w);
        assert.equal(pw.state, "waitlisted");
        unlocked(
          `update app.sessions set details=jsonb_set(details,'{endsAt}',to_jsonb((clock_timestamp()-interval '1 minute')::text)) where id='${s.id}'`,
        );
        await mark(s, host, px.id, 1, "no_show", 0);
        await mark(gone, host, (await join(gone, c)).id, 1, "checked_in", 0);
        assert.deepEqual(started(await badges(c)), ["rally"]);
        unlocked(
          `update app.sessions set state='cancelled' where id='${gone.id}'`,
        );
        for (const actor of [x, w, c]) {
          const b = await badges(actor);
          assert.deepEqual(started(b), []);
          assert.equal(badge(b, "rally").current, 0);
          assert.equal(b.stats.played, 0);
        }
      },
    );

    await t.test(
      "seen markers take only earned levels, once, and refuse bad ids",
      async () => {
        const p = await fresh("seen"),
          s = await event();
        await mark(s, host, (await join(s, p)).id, 1, "checked_in", 0);
        assert.equal((await markSeen(p, ["host:5"])).status, 200);
        const count = () =>
          sql(`select count(*) from app.badge_views where user_id='${p.id}';`);
        assert.equal(count(), "0");
        const both = await Promise.all([
          markSeen(p, ["rally:1"]),
          markSeen(p, ["rally:1"]),
        ]);
        assert.deepEqual(
          both.map((r) => r.status),
          [200, 200],
        );
        assert.equal(count(), "1");
        for (const bad of [
          [],
          Array.from({ length: 51 }, () => "rally:1"),
          ["rally:0"],
          ["first-rally"],
          ["x".repeat(81)],
          "rally:1",
        ]) {
          const refused = await request("/api/me/badges/seen", p, { ids: bad });
          assert.equal(refused.status, 422);
          assert.equal(await code(refused), "invalid_badges");
        }
      },
    );

    await t.test(
      "badge data can't be read or written around the API",
      async () => {
        const p = await fresh("direct");
        const signedIn = createClient(
          env.SUPABASE_URL,
          env.SUPABASE_PUBLISHABLE_KEY,
          {
            auth: { persistSession: false, autoRefreshToken: false },
            global: { headers: { Authorization: `Bearer ${p.token}` } },
          },
        );
        for (const db of [client(), signedIn])
          for (const schema of ["api", "app"]) {
            const read = await db
              .schema(schema)
              .rpc("read_my_badges", { p_actor_id: p.id });
            assert.ok(read.error, `${schema}.read_my_badges must be refused`);
            const write = await db.schema(schema).rpc("mark_badges_seen", {
              p_actor_id: p.id,
              p_ids: ["rally:1"],
            });
            assert.ok(
              write.error,
              `${schema}.mark_badges_seen must be refused`,
            );
          }
      },
    );

    await t.test(
      "a title is a started badge: refused before, shown at its level on rosters",
      async () => {
        const p = await fresh("title-p"),
          q = await fresh("title-q"),
          s = await event();
        const pp = await join(s, p),
          pq = await join(s, q);
        let r = await setTitle(p, "rally");
        assert.equal(r.status, 422);
        assert.equal(await code(r), "title_not_earned");
        await mark(s, host, pp.id, 1, "checked_in", 0);
        await mark(s, host, pq.id, 1, "checked_in", 0);
        r = await setTitle(p, "host");
        assert.equal(r.status, 422);
        assert.equal(await code(r), "title_not_earned");
        for (const bad of [
          "nope",
          5,
          "sessions-25",
          "first-rally",
          "rally:1",
          `founder:${firstGroup}`,
        ]) {
          r = await setTitle(p, bad);
          assert.equal(r.status, 422, String(bad));
          assert.equal(await code(r), "invalid_title");
        }
        r = await setTitle(p, "rally");
        assert.equal(r.status, 200);
        assert.deepEqual((await r.json()).title, { key: "rally", level: 1 });
        for (const viewer of [q, organizer]) {
          const roster = (await view(s, viewer)).roster;
          assert.deepEqual(roster.find((x) => x.primaryName === p.name).title, {
            key: "rally",
            level: 1,
          });
          assert.equal(
            roster.find((x) => x.primaryName === q.name).title,
            null,
          );
        }
        // The public profile carries the same two facts, nothing more.
        const { profile } = await (await request("/api/me/profile", p)).json();
        const shown = (
          await (await request(`/api/people/${profile.profileId}`, null)).json()
        ).profile;
        assert.deepEqual(shown.title, { key: "rally", level: 1 });
        r = await setTitle(p, null);
        assert.equal(r.status, 200);
        assert.equal((await r.json()).title, null);
        assert.equal(
          sql(`select count(*) from app.user_titles where user_id='${p.id}';`),
          "0",
        );
      },
    );

    await t.test(
      "the title follows its badge's level, hides at level 0 and comes back",
      async () => {
        const p = await fresh("title-level"),
          parties = [];
        for (let i = 0; i < 10; i++) {
          const s = await event();
          parties.push([s, await join(s, p)]);
        }
        for (const [s, party] of parties.slice(0, 9))
          await mark(s, host, party.id, 1, "checked_in", 0);
        const both = await Promise.all([
          setTitle(p, "rally"),
          setTitle(p, "rally"),
        ]);
        assert.deepEqual(
          both.map((x) => x.status),
          [200, 200],
        );
        assert.equal(
          sql(`select count(*) from app.user_titles where user_id='${p.id}';`),
          "1",
        );
        const [last, lastParty] = parties[9];
        await mark(last, host, lastParty.id, 1, "checked_in", 0);
        assert.deepEqual((await badges(p)).title, { key: "rally", level: 2 });
        assert.deepEqual(
          (await view(last, organizer)).roster.find(
            (x) => x.primaryName === p.name,
          ).title,
          { key: "rally", level: 2 },
        );
        await mark(last, host, lastParty.id, 1, "unrecorded", 1);
        assert.deepEqual((await badges(p)).title, { key: "rally", level: 1 });
        for (const [s, party] of parties.slice(0, 9))
          await mark(s, host, party.id, 1, "unrecorded", 1);
        assert.equal((await badges(p)).title, null);
        assert.equal(
          (await view(parties[0][0], organizer)).roster.find(
            (x) => x.primaryName === p.name,
          ).title,
          null,
        );
        assert.equal(
          sql(`select badge_id from app.user_titles where user_id='${p.id}';`),
          "rally",
        );
        await mark(parties[0][0], host, parties[0][1].id, 1, "checked_in", 2);
        assert.deepEqual((await badges(p)).title, { key: "rally", level: 1 });
      },
    );

    await t.test(
      "starting a group is not a badge and gives no title",
      async () => {
        const f = await fresh("founder");
        const r = await request("/api/groups", f, {
          operationKey: crypto.randomUUID(),
          name: `Badge group ${nonce}`,
        });
        assert.equal(r.status, 200);
        groups.push((await r.json()).group.id);
        const b = await badges(f);
        assert.deepEqual(started(b), []);
        const refused = await setTitle(f, "host");
        assert.equal(refused.status, 422);
        assert.equal(await code(refused), "title_not_earned");
      },
    );
  } finally {
    for (const id of cohosts)
      sql(
        `delete from app.group_roles where group_id in (select id from app.groups where origin_group_id='${firstGroup}') and user_id='${id}';`,
      );
    for (const id of groups) sql(`delete from app.groups where id='${id}';`);
  }
});
