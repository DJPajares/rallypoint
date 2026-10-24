import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { splitFixture } from "./helpers/split-fixtures.mjs";
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
function details(capacity = "12", guests = true) {
  const now = Date.now();
  return {
    title: "Synthetic registration test",
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
    guests,
  };
}
async function lockedWindow(id, field, delayMs = 700) {
  const proc = spawn(
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
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  let output = "",
    err = "";
  const finished = new Promise((resolve, reject) => {
    proc.on("close", (code) =>
      code === 0 ? resolve() : reject(Error("Synthetic lock fixture failed")),
    );
    proc.on("error", reject);
  });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("Lock fixture was not ready")),
      5000,
    );
    proc.stdout.on("data", (chunk) => {
      output += chunk.toString();
      if (output.includes("P04_LOCKED")) {
        clearTimeout(timer);
        resolve();
      }
    });
    proc.on("exit", () => {
      clearTimeout(timer);
      if (!output.includes("P04_LOCKED"))
        reject(Error("Lock fixture exited early"));
    });
  });
  proc.stderr.on("data", (chunk) => {
    err += chunk.toString();
  });
  proc.stdin.end(
    `begin;\nselect id from app.groups where id='${firstGroup}' for update;\nselect id from app.sessions where id='${id}' for update;\nupdate app.sessions set details=jsonb_set(details,'{${field}}',to_jsonb((clock_timestamp()+interval '${delayMs} milliseconds')::text)) where id='${id}';\n\\echo P04_LOCKED\nselect pg_sleep(1.2);\ncommit;\n`,
  );
  await ready;
  return { finished };
}
test("whole-party withdrawal and promotion contract", async (t) => {
  const organizer = await login("organizer@rallypoint.test"),
    actors = [],
    events = [];
  const nonce = crypto.randomUUID().slice(0, 8);
  async function event(capacity = "2", cutoffLocal) {
    const r = await request(`/api/groups/${firstGroup}/sessions`, organizer, {
      operationKey: crypto.randomUUID(),
      groupId: firstGroup,
      intent: "publish",
      details: {
        ...details(capacity),
        ...(cutoffLocal ? { cutoffLocal } : {}),
      },
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
  const withdraw = (s, a, p, extra = {}) =>
    request(`/api/registrations/${s.slug}/withdraw`, a, {
      operationKey: crypto.randomUUID(),
      partyId: p.id,
      ...extra,
    });
  try {
    for (let i = 0; i < 6; i++) {
      const email = `p04-${nonce}-${i}@rallypoint.test`;
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
      "only the primary may withdraw the targeted whole party",
      async () => {
        const s = await event();
        const p = await join(s, actors[0], 2);
        assert.equal((await withdraw(s, null, p)).status, 401);
        assert.equal((await withdraw(s, actors[1], p)).status, 403);
        assert.equal((await withdraw(s, organizer, p)).status, 403);
        assert.equal(
          (await withdraw(s, actors[0], p, { partyId: "bad" })).status,
          422,
        );
        assert.equal(
          (await request(`/api/registrations/${s.slug}/withdraw`, actors[0]))
            .status,
          405,
        );
        const browser = client();
        assert.ok(
          (
            await browser.schema("api").rpc("withdraw_party", {
              p_actor_id: actors[0].id,
              p_key: crypto.randomUUID(),
              p_slug: s.slug,
              p_party_id: p.id,
            })
          ).error,
        );
        assert.equal((await view(s, actors[0])).own.state, "confirmed");
      },
    );
    await t.test(
      "early rejected POST bodies keep JSON authorization and validation responses",
      async () => {
        const s = await event("1");
        for (let i = 0; i < 6; i++) {
          const r = await request(`/api/registrations/${s.slug}`, null, {
            operationKey: crypto.randomUUID(),
            version: s.version,
            seats: 1,
            guestName: "",
            consent: true,
          });
          assert.equal(r.status, 401);
          assert.equal((await r.json()).error.code, "sign_in_required");
          const invalid = await request(
            `/api/registrations/${s.slug}`,
            actors[0],
            {
              operationKey: crypto.randomUUID(),
              version: s.version,
              seats: 1,
              guestName: "",
              consent: false,
            },
          );
          assert.equal(invalid.status, 422);
          assert.equal(
            (await invalid.json()).error.code,
            "invalid_registration",
          );
        }
        assert.equal((await view(s, actors[0])).own, null);
      },
    );
    await t.test(
      "a two-seat head waits for both vacancies, then promotes once without solo bypass",
      async () => {
        const s = await event();
        const a = await join(s, actors[0]),
          b = await join(s, actors[1]);
        const head = await join(s, actors[2], 2),
          solo = await join(s, actors[3]);
        assert.equal(head.state, "waitlisted");
        assert.equal(solo.state, "waitlisted");
        assert.equal((await withdraw(s, actors[0], a)).status, 200);
        assert.equal((await view(s, actors[2])).own.state, "waitlisted");
        assert.equal((await view(s, actors[3])).own.queuePosition, 2);
        const key = crypto.randomUUID();
        const responses = await Promise.all([
          withdraw(s, actors[1], b, { operationKey: key }),
          withdraw(s, actors[1], b, { operationKey: key }),
          withdraw(s, actors[1], b),
        ]);
        assert.deepEqual(
          responses.map((r) => r.status),
          [200, 200, 200],
        );
        const promoted = (await view(s, actors[2])).own;
        assert.equal(promoted.state, "confirmed");
        assert.equal(promoted.fee.totalMinor, 2500);
        assert.equal((await view(s, actors[3])).own.queuePosition, 1);
        assert.deepEqual((await view(s, actors[2])).counts, {
          confirmedSeats: 2,
          waitingParties: 1,
        });
        assert.equal(
          row(
            `select count(*)::int n from app.registration_events where party_id='${promoted.id}' and kind='promoted'`,
          ).n,
          1,
        );
        assert.equal(
          row(
            `select count(*)::int n from app.fee_obligations where party_id='${promoted.id}'`,
          ).n,
          1,
        );
        assert.equal(
          row(
            `select count(*)::int n from app.registration_events where party_id='${b.id}' and kind='withdrawn'`,
          ).n,
          1,
        );
        assert.equal(
          (await (await request(`/api/operations/${key}`, actors[1])).json())
            .registration.own.state,
          "withdrawn",
        );
        assert.equal(
          (await request(`/api/operations/${key}`, actors[0])).status,
          404,
        );
        assert.equal(
          (await withdraw(s, actors[1], a, { operationKey: key })).status,
          409,
        );
        assert.ok(
          row(
            `select bookings_started_at is not null as booked from app.sessions where id='${s.id}'`,
          ).booked,
        );
      },
    );
    await t.test(
      "new arrivals cannot steal a released seat; waitlist withdrawal racing promotion finishes truthfully",
      async () => {
        for (let round = 0; round < 3; round++) {
          const s = await event("1"),
            a = await join(s, actors[0]),
            b = await join(s, actors[1]);
          const responses = await Promise.all([
            withdraw(s, actors[0], a),
            withdraw(s, actors[1], b),
            join(s, actors[2]),
          ]);
          assert.equal(responses[0].status, 200);
          assert.equal(responses[1].status, 200);
          assert.equal((await view(s, actors[1])).own.state, "withdrawn");
          assert.equal((await view(s, actors[2])).own.state, "confirmed");
          assert.equal((await view(s, actors[0])).counts.confirmedSeats, 1);
          assert.equal(
            row(
              `select count(*)::int n from app.registration_events where party_id='${b.id}' and kind='withdrawn'`,
            ).n,
            1,
          );
        }
      },
    );
    await t.test(
      "waitlist removal does not create a fee or resurrect on replay",
      async () => {
        const s = await event("1");
        await join(s, actors[0]);
        const p = await join(s, actors[1]);
        assert.equal(p.fee, null);
        const key = crypto.randomUUID();
        assert.equal(
          (await withdraw(s, actors[1], p, { operationKey: key })).status,
          200,
        );
        assert.equal((await view(s, actors[1])).own.fee, null);
        const active = await join(s, actors[1]);
        assert.notEqual(active.id, p.id);
        assert.equal(
          (await withdraw(s, actors[1], p, { operationKey: key })).status,
          200,
        );
        assert.equal((await view(s, actors[1])).own.id, active.id);
        assert.equal((await view(s, actors[1])).own.state, "waitlisted");
      },
    );
    await t.test(
      "removing an oversized waiting head immediately admits the next fitting party",
      async () => {
        const s = await event("2");
        await join(s, actors[0]);
        const head = await join(s, actors[1], 2);
        await join(s, actors[2]);
        assert.equal((await view(s, actors[2])).own.state, "waitlisted");
        assert.equal((await withdraw(s, actors[1], head)).status, 200);
        assert.equal((await view(s, actors[1])).own.fee, null);
        assert.equal((await view(s, actors[2])).own.state, "confirmed");
        assert.equal((await view(s, actors[2])).counts.confirmedSeats, 2);
      },
    );
    await t.test(
      "a failed promotion rolls back withdrawal, fees and receipt; identical retry then succeeds",
      async () => {
        const s = await event("1"),
          p = await join(s, actors[0]);
        await join(s, actors[1]);
        const key = crypto.randomUUID();
        sql(
          `create function app.p04_reject_promotion() returns trigger language plpgsql as $body$ begin raise exception 'synthetic promotion failure'; end; $body$;create trigger p04_reject_promotion before insert on app.registration_events for each row when(new.kind='promoted') execute function app.p04_reject_promotion();`,
        );
        try {
          assert.equal(
            (await withdraw(s, actors[0], p, { operationKey: key })).status,
            503,
          );
          const left = (await view(s, actors[0])).own;
          assert.equal(left.state, "confirmed");
          assert.equal(left.fee.liabilityState, "due");
          assert.equal((await view(s, actors[1])).own.state, "waitlisted");
          assert.equal(
            (await request(`/api/operations/${key}`, actors[0])).status,
            404,
          );
        } finally {
          sql(
            `drop trigger p04_reject_promotion on app.registration_events;drop function app.p04_reject_promotion();`,
          );
        }
        assert.equal(
          (await withdraw(s, actors[0], p, { operationKey: key })).status,
          200,
        );
        assert.equal((await view(s, actors[1])).own.state, "confirmed");
      },
    );
    await t.test(
      "before-cutoff unpaid fees are removed; late fees and replacement fees are independent",
      async () => {
        for (const late of [false, true]) {
          const s = await event(
            "1",
            late ? local(Date.now() - 300000) : undefined,
          );
          const departing = await join(s, actors[0]),
            waiting = await join(s, actors[1]);
          const r = await withdraw(s, actors[0], departing);
          assert.equal(r.status, 200);
          const left = (await r.json()).registration.own;
          assert.equal(left.state, "withdrawn");
          assert.ok(left.withdrawnAt);
          assert.equal(
            left.fee.liabilityState,
            late ? "due" : "removed_before_cutoff",
          );
          assert.equal(left.fee.totalMinor, 1250);
          assert.equal(left.fee.markedPaid, false);
          const replacement = (await view(s, actors[1])).own;
          assert.equal(replacement.id, waiting.id);
          assert.equal(replacement.state, "confirmed");
          assert.equal(replacement.fee.liabilityState, "due");
          assert.equal(replacement.fee.totalMinor, 1250);
          const audit = row(
            `select removed_by,removed_at from app.fee_obligations where party_id='${left.id}'`,
          );
          assert.equal(audit.removed_by, late ? null : actors[0].id);
          const publicBody = JSON.stringify(
            await (await request(`/api/shared/${s.slug}`)).json(),
          );
          assert.ok(
            !publicBody.includes("liabilityState") &&
              !publicBody.includes("Synthetic 0"),
          );
          assert.equal((await view(s, actors[0])).rosterAllowed, false);
        }
      },
    );
    await t.test(
      "exact cutoff retains liability; immediately before removes it and after retains it",
      async () => {
        const cutoff = "2030-01-01T00:00:00Z";
        for (const [offset, expected] of [
          ["-1 microsecond", "removed_before_cutoff"],
          ["0 microseconds", "due"],
          ["1 microsecond", "due"],
        ]) {
          const s = await event("1"),
            p = await join(s, actors[0]);
          // The production financial transition receives the post-lock server instant.
          // Explicit internal instants exercise equality without a browser clock override.
          sql(
            `select app.release_withdrawal_fee('${p.id}','${actors[0].id}','${cutoff}'::timestamptz+interval '${offset}','${cutoff}');`,
          );
          const fee = (await view(s, actors[0])).own.fee;
          assert.equal(fee.liabilityState, expected);
          assert.equal(fee.totalMinor, 1250);
        }
      },
    );
    await t.test(
      "paid declarations and their actor/time survive withdrawal on both sides of cutoff",
      async () => {
        for (const late of [false, true]) {
          const s = await event(
              "2",
              late ? local(Date.now() - 300000) : undefined,
            ),
            p = await join(s, actors[0], 2);
          sql(
            `update app.fee_obligations set marked_paid=true,payment_marked_at='2026-10-21T00:00:00Z',payment_marked_by='${organizer.id}' where party_id='${p.id}';`,
          );
          const before = row(
            `select marked_paid,payment_marked_at,payment_marked_by,total_minor from app.fee_obligations where party_id='${p.id}'`,
          );
          assert.equal((await withdraw(s, actors[0], p)).status, 200);
          assert.deepEqual(
            row(
              `select marked_paid,payment_marked_at,payment_marked_by,total_minor from app.fee_obligations where party_id='${p.id}'`,
            ),
            before,
          );
          const own = (await view(s, actors[0])).own;
          assert.equal(own.state, "withdrawn");
          assert.equal(own.fee.markedPaid, true);
          assert.equal(own.fee.liabilityState, "due");
        }
      },
    );
    await t.test(
      "cutoff is evaluated after a lock wait, and successful receipts replay after start",
      async () => {
        const s = await event("1"),
          p = await join(s, actors[0]);
        sql(`alter table app.sessions disable trigger protect_booked_session;`);
        const key = crypto.randomUUID();
        try {
          const hold = await lockedWindow(s.id, "cutoffAt");
          const r = await withdraw(s, actors[0], p, { operationKey: key });
          await hold.finished;
          assert.equal(r.status, 200);
          assert.equal(
            (await r.json()).registration.own.fee.liabilityState,
            "due",
          );
          sql(
            `update app.sessions set details=jsonb_set(details,'{startsAt}',to_jsonb((clock_timestamp()-interval '1 second')::text)) where id='${s.id}';`,
          );
        } finally {
          sql(
            `alter table app.sessions enable trigger protect_booked_session;`,
          );
        }
        assert.equal(
          (await withdraw(s, actors[0], p, { operationKey: key })).status,
          200,
        );
        assert.equal((await withdraw(s, actors[0], p)).status, 409);
        assert.equal(
          (await (await request(`/api/operations/${key}`, actors[0])).json())
            .registration.own.state,
          "withdrawn",
        );
      },
    );
    await t.test(
      "post-lock start and terminal events refuse withdrawal and promotion",
      async () => {
        const s = await event("1"),
          a = await join(s, actors[0]);
        await join(s, actors[1]);
        // Synthetic fixture deliberately changes a booked time solely to cross a lock boundary.
        sql(`alter table app.sessions disable trigger protect_booked_session;`);
        try {
          const hold = await lockedWindow(s.id, "startsAt");
          const r = await withdraw(s, actors[0], a);
          await hold.finished;
          assert.equal(r.status, 409);
          assert.equal((await r.json()).error.code, "withdrawal_closed");
        } finally {
          sql(
            `alter table app.sessions enable trigger protect_booked_session;`,
          );
        }
        assert.equal((await view(s, actors[0])).own.state, "confirmed");
        sql(`select app.fill_waitlist('${s.id}');`);
        assert.equal((await view(s, actors[1])).own.state, "waitlisted");
        for (const state of ["cancelled", "completed"]) {
          const terminal = await event("1"),
            p = await join(terminal, actors[0]);
          await join(terminal, actors[1]);
          sql(
            `update app.sessions set state='${state}' where id='${terminal.id}';select app.fill_waitlist('${terminal.id}');`,
          );
          assert.equal((await withdraw(terminal, actors[0], p)).status, 409);
          assert.equal(
            (await view(terminal, actors[1])).own.state,
            "waitlisted",
          );
        }
      },
    );
  } finally {
    if (events.length) {
      const ids = events.map((id) => `'${id}'`).join(",");
      sql(
        `begin;delete from app.operation_receipts where resource_id in(select id from app.parties where session_id in(${ids})) or resource_id in(${ids});delete from app.fee_changes where party_id in(select id from app.parties where session_id in(${ids}));delete from app.registration_events where party_id in(select id from app.parties where session_id in(${ids}));delete from app.fee_obligations where party_id in(select id from app.parties where session_id in(${ids}));delete from app.parties where session_id in(${ids});delete from app.session_changes where session_id in(${ids});delete from app.sessions where id in(${ids});commit;`,
      );
    }
    for (const a of actors) await admin.auth.admin.deleteUser(a.id);
  }
});

test("a player who withdrew can join again and gets a new place in line", async (t) => {
  const f = await splitFixture(t, {
    feeMode: "fixed",
    total: "10.00",
    seats: [1],
    capacity: 2,
    cutoffPast: true,
  });
  const [player] = f.actors,
    old = f.parties[0];
  const w = await f.post(
    player,
    `/api/registrations/${f.session.slug}/withdraw`,
    { operationKey: crypto.randomUUID(), partyId: old.id },
  );
  assert.equal(w.status, 200);
  assert.equal((await w.json()).registration.own.state, "withdrawn");
  const again = await f.join(player);
  assert.notEqual(again.id, old.id);
  assert.equal(again.state, "confirmed");
  // The withdrawn record keeps its retained fee; the new party has its own.
  assert.equal(
    f.sql(`select state from app.parties where id='${old.id}';`),
    "withdrawn",
  );
  assert.equal(
    f.sql(
      `select liability_state from app.fee_obligations where party_id='${old.id}';`,
    ),
    "due",
  );
  assert.equal(
    f.sql(
      `select count(*) from app.fee_obligations where party_id='${again.id}';`,
    ),
    "1",
  );
  const view = (
    await (
      await f.get(f.organizer, `/api/registrations/${f.session.slug}`)
    ).json()
  ).registration;
  const confirmed = view.roster.filter(
    (r) => r.state === "confirmed" && r.primaryName === "Split person 0",
  );
  assert.equal(confirmed.length, 1);
  assert.equal(confirmed[0].id, again.id);
});
