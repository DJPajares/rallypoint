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
const row = (query) =>
  JSON.parse(sql(`select row_to_json(t) from (${query}) t;`));
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
function details(capacity = "4") {
  const now = Date.now();
  return {
    title: "Synthetic attendance test",
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
// Booked details are locked by a trigger; a synthetic fixture moves the end.
function endSession(id) {
  sql(
    `alter table app.sessions disable trigger protect_booked_session;update app.sessions set details=jsonb_set(details,'{endsAt}',to_jsonb((clock_timestamp()-interval '1 minute')::text)) where id='${id}';alter table app.sessions enable trigger protect_booked_session;`,
  );
}
test("organizer attendance per seat", async (t) => {
  const organizer = await login("organizer@rallypoint.test"),
    outsider = await login("outsider@rallypoint.test"),
    actors = [],
    events = [];
  const nonce = crypto.randomUUID().slice(0, 8);
  async function event(capacity) {
    const r = await request(`/api/groups/${firstGroup}/sessions`, organizer, {
      operationKey: crypto.randomUUID(),
      groupId: firstGroup,
      intent: "publish",
      details: details(capacity),
    });
    assert.equal(r.status, 200);
    const s = (await r.json()).session;
    events.push(s.id);
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
  const seats = async (s, partyId) =>
    (await view(s, organizer)).roster.find((p) => p.id === partyId).attendance;
  const mark = (s, a, partyId, seat, state, revision, extra = {}) =>
    request(`/api/registrations/${s.slug}/attendance`, a, {
      operationKey: crypto.randomUUID(),
      partyId,
      seat,
      state,
      revision,
      ...extra,
    });
  const code = async (r) => (await r.json()).error?.code;
  try {
    for (let i = 0; i < 3; i++) {
      const email = `p07-${nonce}-${i}@rallypoint.test`;
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: fixturePassword,
        email_confirm: true,
        user_metadata: { full_name: `Synthetic ${i}` },
      });
      assert.ok(!error && data.user);
      actors.push(await login(email));
    }
    await t.test(
      "only a current organizer or co-host can record attendance",
      async () => {
        const s = await event(),
          p = await join(s, actors[0]);
        assert.equal(
          (await mark(s, null, p.id, 1, "checked_in", 0)).status,
          401,
        );
        for (const a of [actors[0], actors[1], outsider]) {
          const r = await mark(s, a, p.id, 1, "checked_in", 0);
          assert.equal(r.status, 403);
          assert.equal(await code(r), "group_access_denied");
        }
        for (const bad of [
          { seat: 3 },
          { state: "present" },
          { revision: -1 },
          { partyId: "bad" },
        ])
          assert.equal(
            (await mark(s, organizer, p.id, 1, "checked_in", 0, bad)).status,
            422,
          );
        assert.equal(
          (await request(`/api/registrations/${s.slug}/attendance`, organizer))
            .status,
          405,
        );
        assert.ok(
          (
            await client().schema("api").rpc("record_attendance", {
              p_actor_id: organizer.id,
              p_actor_name: "Forged",
              p_key: crypto.randomUUID(),
              p_slug: s.slug,
              p_party_id: p.id,
              p_seat: 1,
              p_state: "checked_in",
              p_revision: 0,
            })
          ).error,
        );
        sql(
          `insert into app.group_roles(group_id,user_id,role) values('${firstGroup}','${actors[2].id}','cohost');`,
        );
        try {
          assert.equal(
            (await mark(s, actors[2], p.id, 1, "checked_in", 0)).status,
            200,
          );
        } finally {
          sql(
            `delete from app.group_roles where group_id='${firstGroup}' and user_id='${actors[2].id}';`,
          );
        }
        assert.equal(
          (await mark(s, actors[2], p.id, 1, "unrecorded", 1)).status,
          403,
        );
        const v = await view(s, actors[0]);
        assert.equal(v.own.attendance, undefined);
        assert.ok(v.roster.every((r) => !("attendance" in r)));
      },
    );
    await t.test(
      "primary and guest are recorded and corrected independently, without double counting",
      async () => {
        const s = await event(),
          p = await join(s, actors[0], 2);
        assert.deepEqual(
          (await seats(s, p.id)).map((a) => [a.seat, a.state, a.revision]),
          [
            [1, "unrecorded", 0],
            [2, "unrecorded", 0],
          ],
        );
        assert.equal(
          (await mark(s, organizer, p.id, 1, "checked_in", 0)).status,
          200,
        );
        const again = await mark(s, organizer, p.id, 1, "checked_in", 1);
        assert.equal(again.status, 409);
        assert.equal(await code(again), "attendance_unchanged");
        assert.equal(
          (await mark(s, organizer, p.id, 1, "unrecorded", 1)).status,
          200,
        );
        assert.equal(
          (await mark(s, organizer, p.id, 1, "checked_in", 2)).status,
          200,
        );
        const [primary, guest] = await seats(s, p.id);
        assert.equal(primary.state, "checked_in");
        assert.equal(primary.revision, 3);
        assert.ok(primary.by && primary.at);
        assert.equal(guest.state, "unrecorded");
        assert.equal(
          row(
            `select count(*)::int n from app.seat_attendance where party_id='${p.id}' and state='checked_in'`,
          ).n,
          1,
        );
        const own = (await view(s, actors[0])).own;
        assert.equal(own.state, "confirmed");
        assert.equal(own.fee.markedPaid, false);
      },
    );
    await t.test(
      "waitlisted, withdrawn and cancelled places cannot be checked in",
      async () => {
        const s = await event("1"),
          confirmed = await join(s, actors[0]),
          waiting = await join(s, actors[1]);
        assert.equal(waiting.state, "waitlisted");
        let r = await mark(s, organizer, waiting.id, 1, "checked_in", 0);
        assert.equal(r.status, 409);
        assert.equal(await code(r), "attendance_not_eligible");
        r = await mark(s, organizer, confirmed.id, 2, "checked_in", 0);
        assert.equal(await code(r), "seat_not_found");
        await request(`/api/registrations/${s.slug}/withdraw`, actors[0], {
          operationKey: crypto.randomUUID(),
          partyId: confirmed.id,
        });
        r = await mark(s, organizer, confirmed.id, 1, "checked_in", 0);
        assert.equal(await code(r), "attendance_not_eligible");
        const promoted = (await view(s, actors[1])).own;
        assert.equal(promoted.state, "confirmed");
        sql(`update app.sessions set state='cancelled' where id='${s.id}';`);
        r = await mark(s, organizer, promoted.id, 1, "checked_in", 0);
        assert.equal(await code(r), "attendance_not_eligible");
      },
    );
    await t.test(
      "no-shows are recorded only after the end, never automatically",
      async () => {
        const s = await event(),
          p = await join(s, actors[0], 2);
        await mark(s, organizer, p.id, 1, "checked_in", 0);
        const early = await mark(s, organizer, p.id, 2, "no_show", 0);
        assert.equal(early.status, 409);
        assert.equal(await code(early), "no_show_too_early");
        endSession(s.id);
        assert.equal((await seats(s, p.id))[1].state, "unrecorded");
        assert.equal(
          (await mark(s, organizer, p.id, 2, "no_show", 0)).status,
          200,
        );
        assert.deepEqual(
          (await seats(s, p.id)).map((a) => a.state),
          ["checked_in", "no_show"],
        );
        // A late correction is still possible after the session.
        assert.equal(
          (await mark(s, organizer, p.id, 2, "checked_in", 1)).status,
          200,
        );
        assert.equal((await view(s, actors[0])).own.fee.markedPaid, false);
      },
    );
    await t.test(
      "simultaneous and stale corrections return one truthful result",
      async () => {
        const s = await event(),
          p = await join(s, actors[0]);
        const responses = await Promise.all([
          mark(s, organizer, p.id, 1, "checked_in", 0),
          mark(s, organizer, p.id, 1, "checked_in", 0),
        ]);
        assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
        assert.equal(
          await code(responses.find((r) => r.status === 409)),
          "stale_attendance",
        );
        assert.equal(
          row(
            `select count(*)::int n from app.attendance_changes where party_id='${p.id}'`,
          ).n,
          1,
        );
        const key = crypto.randomUUID();
        const replays = await Promise.all([
          mark(s, organizer, p.id, 1, "unrecorded", 1, { operationKey: key }),
          mark(s, organizer, p.id, 1, "unrecorded", 1, { operationKey: key }),
        ]);
        assert.deepEqual(
          replays.map((r) => r.status),
          [200, 200],
        );
        assert.equal((await seats(s, p.id))[0].revision, 2);
        const check = await request(`/api/operations/${key}`, organizer);
        assert.equal(check.status, 200);
        assert.equal(
          (await check.json()).registration.roster[0].attendance[0].state,
          "unrecorded",
        );
        assert.equal(
          (await request(`/api/operations/${key}`, actors[0])).status,
          404,
        );
      },
    );
  } finally {
    if (events.length) {
      const ids = events.map((id) => `'${id}'`).join(",");
      const parties = `select id from app.parties where session_id in(${ids})`;
      sql(
        `begin;delete from app.operation_receipts where resource_id in(${parties}) or resource_id in(${ids});delete from app.attendance_changes where party_id in(${parties});delete from app.seat_attendance where party_id in(${parties});delete from app.fee_changes where party_id in(${parties});delete from app.registration_events where party_id in(${parties});delete from app.fee_obligations where party_id in(${parties});delete from app.parties where session_id in(${ids});delete from app.session_changes where session_id in(${ids});delete from app.sessions where id in(${ids});commit;`,
      );
    }
    for (const a of actors) await admin.auth.admin.deleteUser(a.id);
  }
});
