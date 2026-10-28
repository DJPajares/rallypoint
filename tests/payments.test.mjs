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
function details(cutoffPast = false) {
  const now = Date.now();
  return {
    title: "Synthetic payment test",
    activity: "Workshop",
    startLocal: local(now + 86400000),
    endLocal: local(now + 93600000),
    timeZone: "UTC",
    location: "Synthetic room",
    instructions: "Test only",
    capacity: "4",
    openLocal: local(now - 3600000),
    cutoffLocal: local(cutoffPast ? now - 60000 : now + 43200000),
    fee: "12.50",
    currency: "SGD",
    guests: true,
  };
}
test("organizer payment markers and waivers", async (t) => {
  const organizer = await login("organizer@rallypoint.test"),
    outsider = await login("outsider@rallypoint.test"),
    actors = [],
    events = [];
  const nonce = crypto.randomUUID().slice(0, 8);
  async function event(cutoffPast) {
    const r = await request(`/api/groups/${firstGroup}/sessions`, organizer, {
      operationKey: crypto.randomUUID(),
      groupId: firstGroup,
      intent: "publish",
      details: details(cutoffPast),
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
  const managed = async (s, partyId) =>
    (await view(s, organizer)).roster.find((p) => p.id === partyId).fee;
  const pay = (s, a, partyId, action, revision, extra = {}) =>
    request(`/api/registrations/${s.slug}/payments`, a, {
      operationKey: crypto.randomUUID(),
      partyId,
      action,
      revision,
      ...extra,
    });
  try {
    for (let i = 0; i < 3; i++) {
      const email = `p05-${nonce}-${i}@rallypoint.test`;
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
      "only a current organizer or co-host can change payment records",
      async () => {
        const s = await event(),
          p = await join(s, actors[0]);
        const { revision } = await managed(s, p.id);
        assert.equal(
          (await pay(s, null, p.id, "mark_paid", revision)).status,
          401,
        );
        for (const a of [actors[0], actors[1], outsider]) {
          const r = await pay(s, a, p.id, "mark_paid", revision);
          assert.equal(r.status, 403);
          assert.equal((await r.json()).error.code, "group_access_denied");
        }
        assert.equal(
          (await pay(s, organizer, p.id, "refund", revision)).status,
          422,
        );
        assert.equal(
          (await pay(s, organizer, p.id, "mark_paid", 0)).status,
          422,
        );
        assert.equal(
          (await request(`/api/registrations/${s.slug}/payments`, organizer))
            .status,
          405,
        );
        assert.ok(
          (
            await client().schema("api").rpc("update_payment", {
              p_actor_id: organizer.id,
              p_actor_name: "Forged",
              p_key: crypto.randomUUID(),
              p_slug: s.slug,
              p_party_id: p.id,
              p_action: "mark_paid",
              p_revision: revision,
            })
          ).error,
        );
        // A co-host may act; once the role is revoked the next request is refused.
        sql(
          `insert into app.group_roles(group_id,user_id,role) select id,'${actors[2].id}','cohost' from app.groups where origin_group_id='${firstGroup}' on conflict do nothing;`,
        );
        try {
          assert.equal(
            (await pay(s, actors[2], p.id, "mark_paid", revision)).status,
            200,
          );
        } finally {
          sql(
            `delete from app.group_roles where group_id in (select id from app.groups where origin_group_id='${firstGroup}') and user_id='${actors[2].id}';`,
          );
        }
        const after = await managed(s, p.id);
        assert.equal(
          (await pay(s, actors[2], p.id, "mark_unpaid", after.revision)).status,
          403,
        );
        assert.equal((await view(s, actors[0])).own.fee.markedPaid, true);
      },
    );
    await t.test(
      "paid, corrected and waived records keep actor/time and never touch seats",
      async () => {
        const s = await event(),
          p = await join(s, actors[0], 2);
        let fee = await managed(s, p.id);
        assert.equal(fee.revision, 1);
        assert.equal(
          (await pay(s, organizer, p.id, "mark_paid", 1)).status,
          200,
        );
        // Waiving a paid fee would rewrite a payment record into a waiver.
        assert.equal((await pay(s, organizer, p.id, "waive", 2)).status, 409);
        assert.equal(
          (await pay(s, organizer, p.id, "mark_unpaid", 2)).status,
          200,
        );
        assert.equal((await pay(s, organizer, p.id, "waive", 3)).status, 200);
        const marked = await pay(s, organizer, p.id, "mark_paid", 4);
        assert.equal(marked.status, 409);
        assert.equal(
          (await marked.json()).error.code,
          "payment_transition_invalid",
        );
        fee = await managed(s, p.id);
        assert.equal(fee.liabilityState, "waived");
        assert.equal(fee.markedPaid, false);
        assert.deepEqual(
          fee.history.map((h) => h.action),
          ["waived", "marked_unpaid", "marked_paid"],
        );
        assert.ok(fee.history.every((h) => h.by && h.at));
        const own = (await view(s, actors[0])).own;
        assert.equal(own.state, "confirmed");
        assert.equal(own.seats, 2);
        assert.equal(own.fee.liabilityState, "waived");
        assert.equal(own.fee.history, undefined);
        assert.equal(
          (await pay(s, organizer, p.id, "undo_waiver", 4)).status,
          200,
        );
        assert.equal((await managed(s, p.id)).liabilityState, "due");
        assert.deepEqual((await view(s, actors[1])).counts, {
          confirmedSeats: 2,
          waitingParties: 0,
        });
      },
    );
    await t.test(
      "a retained late-withdrawal fee stays visible until explicitly waived",
      async () => {
        const s = await event(true),
          p = await join(s, actors[0]);
        assert.equal(
          (
            await request(`/api/registrations/${s.slug}/withdraw`, actors[0], {
              operationKey: crypto.randomUUID(),
              partyId: p.id,
            })
          ).status,
          200,
        );
        let fee = await managed(s, p.id);
        assert.equal(fee.liabilityState, "due");
        assert.equal(fee.revision, 1);
        assert.equal(
          (await pay(s, organizer, p.id, "waive", fee.revision)).status,
          200,
        );
        fee = await managed(s, p.id);
        assert.equal(fee.liabilityState, "waived");
        assert.equal((await view(s, actors[0])).own.state, "withdrawn");
        // A pre-cutoff withdrawal is a policy outcome, not something to undo here.
        const early = await event(),
          q = await join(early, actors[1]);
        await request(`/api/registrations/${early.slug}/withdraw`, actors[1], {
          operationKey: crypto.randomUUID(),
          partyId: q.id,
        });
        const removed = await managed(early, q.id);
        assert.equal(removed.liabilityState, "removed_before_cutoff");
        assert.equal(removed.revision, 2);
        assert.equal(removed.history[0].action, "removed_before_cutoff");
        for (const action of ["mark_paid", "waive", "undo_waiver"])
          assert.equal(
            (await pay(early, organizer, q.id, action, 2)).status,
            409,
          );
      },
    );
    await t.test(
      "stale and simultaneous corrections cannot silently overwrite each other",
      async () => {
        const s = await event(),
          p = await join(s, actors[0]);
        const responses = await Promise.all([
          pay(s, organizer, p.id, "mark_paid", 1),
          pay(s, organizer, p.id, "waive", 1),
        ]);
        assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
        const loser = responses.find((r) => r.status === 409);
        assert.equal((await loser.json()).error.code, "stale_payment");
        const fee = await managed(s, p.id);
        assert.equal(fee.revision, 2);
        assert.equal(fee.history.length, 1);
        assert.equal(
          row(
            `select count(*)::int n from app.fee_changes where party_id='${p.id}'`,
          ).n,
          1,
        );
        // Replaying one request key returns the result once; reuse with other details is refused.
        const key = crypto.randomUUID();
        const action = fee.markedPaid ? "mark_unpaid" : "undo_waiver";
        const replays = await Promise.all([
          pay(s, organizer, p.id, action, 2, { operationKey: key }),
          pay(s, organizer, p.id, action, 2, { operationKey: key }),
        ]);
        assert.deepEqual(
          replays.map((r) => r.status),
          [200, 200],
        );
        assert.equal((await managed(s, p.id)).revision, 3);
        assert.equal(
          (await pay(s, organizer, p.id, "mark_paid", 3, { operationKey: key }))
            .status,
          409,
        );
        const check = await request(`/api/operations/${key}`, organizer);
        assert.equal(check.status, 200);
        assert.equal(
          (await check.json()).registration.roster.find((r) => r.id === p.id)
            .fee.revision,
          3,
        );
        assert.equal(
          (await request(`/api/operations/${key}`, actors[0])).status,
          404,
        );
      },
    );
    await t.test(
      "participants see only their own fees, on the session and in Dues",
      async () => {
        const s = await event(),
          mine = await join(s, actors[0]),
          theirs = await join(s, actors[1]);
        await pay(s, organizer, theirs.id, "mark_paid", 1);
        const v = await view(s, actors[0]);
        assert.ok(v.roster.every((r) => !("fee" in r) && !("id" in r)));
        assert.equal(v.own.fee.markedPaid, false);
        const dues = (await (await request("/api/dues", actors[0])).json())
          .dues;
        assert.ok(dues.every((d) => d.partyId !== theirs.id));
        const item = dues.find((d) => d.partyId === mine.id);
        assert.equal(item.session.slug, s.slug);
        assert.equal(item.fee.totalMinor, 1250);
        assert.equal(item.fee.history, undefined);
        const outside = (await (await request("/api/dues", outsider)).json())
          .dues;
        assert.ok(
          outside.every((d) => ![mine.id, theirs.id].includes(d.partyId)),
        );
        assert.equal((await request("/api/dues", null)).status, 401);
        assert.ok(
          (
            await client()
              .schema("api")
              .rpc("list_my_dues", { p_actor_id: actors[0].id })
          ).error,
        );
      },
    );
  } finally {
    if (events.length) {
      const ids = events.map((id) => `'${id}'`).join(",");
      const parties = `select id from app.parties where session_id in(${ids})`;
      sql(
        `begin;delete from app.operation_receipts where resource_id in(${parties}) or resource_id in(${ids});delete from app.fee_changes where party_id in(${parties});delete from app.registration_events where party_id in(${parties});delete from app.fee_obligations where party_id in(${parties});delete from app.parties where session_id in(${ids});delete from app.session_changes where session_id in(${ids});delete from app.sessions where id in(${ids});commit;`,
      );
    }
    for (const a of actors) await admin.auth.admin.deleteUser(a.id);
  }
});
