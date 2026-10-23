import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
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
      if (output.includes("P03_LOCKED")) {
        clearTimeout(timer);
        resolve();
      }
    });
    proc.on("exit", () => {
      clearTimeout(timer);
      if (!output.includes("P03_LOCKED"))
        reject(Error("Lock fixture exited early"));
    });
  });
  proc.stderr.on("data", (chunk) => {
    err += chunk.toString();
  });
  proc.stdin.end(
    `begin;\nselect id from app.groups where id='${firstGroup}' for update;\nselect id from app.sessions where id='${id}' for update;\nupdate app.sessions set details=jsonb_set(details,'{${field}}',to_jsonb((clock_timestamp()+interval '${delayMs} milliseconds')::text)) where id='${id}';\n\\echo P03_LOCKED\nselect pg_sleep(1.2);\ncommit;\n`,
  );
  await ready;
  return { finished };
}
test("registration ordering, integrity, fee and privacy contract", async (t) => {
  const actors = [],
    events = [];
  const organizer = await login("organizer@rallypoint.test");
  const nonce = crypto.randomUUID().slice(0, 8);
  async function event(capacity = "12", guests = true) {
    const r = await request(`/api/groups/${firstGroup}/sessions`, organizer, {
      operationKey: crypto.randomUUID(),
      groupId: firstGroup,
      intent: "publish",
      details: details(capacity, guests),
    });
    assert.equal(r.status, 200);
    const s = (await r.json()).session;
    events.push(s.id);
    return s;
  }
  const body = (s, seats = 1, extra = {}) => ({
    operationKey: crypto.randomUUID(),
    version: s.version,
    seats,
    guestName: seats === 2 ? "Guest" : "",
    consent: true,
    ...extra,
  });
  const join = (s, actor, seats = 1, extra = {}) =>
    request(`/api/registrations/${s.slug}`, actor, body(s, seats, extra));
  const view = async (s, actor) =>
    (await (await request(`/api/registrations/${s.slug}`, actor)).json())
      .registration;
  try {
    for (let i = 0; i < 15; i++) {
      const email = `p03-${nonce}-${i}@rallypoint.test`;
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: fixturePassword,
        email_confirm: true,
        user_metadata: { full_name: `Participant ${i}` },
      });
      assert.ok(!error && data.user);
      actors.push(await login(email));
    }
    await t.test(
      "unsigned joins, missing consent, disabled guests and stale terms are refused",
      async () => {
        const s = await event("12", false);
        assert.equal((await join(s, null)).status, 401);
        assert.equal(
          (await join(s, actors[0], 1, { consent: false })).status,
          422,
        );
        assert.equal((await join(s, actors[0], 2)).status, 422);
        assert.equal(
          (await join(s, actors[0], 1, { version: s.version + 1 })).status,
          409,
        );
        assert.equal(
          row(
            `select count(*)::int as n from app.parties where session_id='${s.id}'`,
          ).n,
          0,
        );
      },
    );
    await t.test(
      "impossible parties, future opening and replay after closure are safe",
      async () => {
        const small = await event("1", true);
        assert.equal((await join(small, actors[0], 2)).status, 422);
        const future = await event();
        sql(
          `update app.sessions set details=jsonb_set(details,'{opensAt}',to_jsonb((clock_timestamp()+interval '1 hour')::text)) where id='${future.id}';`,
        );
        assert.equal((await join(future, actors[0])).status, 409);
        const s = await event(),
          b = body(s);
        const first = (
          await (
            await request(`/api/registrations/${s.slug}`, actors[0], b)
          ).json()
        ).registration.own;
        sql(`update app.sessions set state='cancelled' where id='${s.id}';`);
        const replay = (
          await (
            await request(`/api/registrations/${s.slug}`, actors[0], b)
          ).json()
        ).registration.own;
        assert.equal(replay.id, first.id);
        assert.equal(replay.state, "confirmed");
        assert.equal((await join(s, actors[1])).status, 409);
        sql(`update app.parties set state='withdrawn' where id='${first.id}';`);
        const old = (
          await (
            await request(`/api/operations/${b.operationKey}`, actors[0])
          ).json()
        ).registration.own;
        assert.equal(old.state, "withdrawn");
      },
    );
    let race;
    await t.test(
      "two simultaneous final-seat requests produce one confirmation and one waitlist",
      async () => {
        race = await event();
        for (let i = 0; i < 11; i++)
          assert.equal((await join(race, actors[i])).status, 200);
        const rs = await Promise.all([
          join(race, actors[11]),
          join(race, actors[12]),
        ]);
        for (const r of rs) assert.equal(r.status, 200);
        const states = await Promise.all(
          rs.map(async (r) => (await r.json()).registration.own.state),
        );
        assert.deepEqual(states.sort(), ["confirmed", "waitlisted"]);
        assert.equal(
          row(
            `select sum(seats)::int as n from app.parties where session_id='${race.id}' and state='confirmed'`,
          ).n,
          12,
        );
      },
    );
    await t.test(
      "same-key and new-key duplicates retain one party, fee and event without membership",
      async () => {
        const s = await event(),
          b = body(s, 2);
        const rs = await Promise.all([
          request(`/api/registrations/${s.slug}`, actors[0], b),
          request(`/api/registrations/${s.slug}`, actors[0], b),
        ]);
        const a = (await rs[0].json()).registration.own,
          c = (await rs[1].json()).registration.own;
        assert.equal(a.id, c.id);
        assert.equal(a.fee.totalMinor, 2500);
        const another = await join(s, actors[0], 1);
        assert.equal((await another.json()).registration.own.seats, 2);
        assert.equal(
          (
            await request(`/api/registrations/${s.slug}`, actors[0], {
              ...b,
              seats: 1,
            })
          ).status,
          409,
        );
        assert.equal(
          row(
            `select count(*)::int as n from app.parties where session_id='${s.id}'`,
          ).n,
          1,
        );
        assert.equal(
          row(
            `select count(*)::int as n from app.fee_obligations where party_id='${a.id}'`,
          ).n,
          1,
        );
        assert.equal(
          row(
            `select count(*)::int as n from app.registration_events where party_id='${a.id}'`,
          ).n,
          1,
        );
        assert.equal(
          row(
            `select count(*)::int as n from app.group_roles where user_id='${actors[0].id}'`,
          ).n,
          0,
        );
        const recovered = await request(
          `/api/operations/${b.operationKey}`,
          actors[0],
        );
        assert.equal((await recovered.json()).registration.own.id, a.id);
        assert.equal(
          (await request(`/api/operations/${b.operationKey}`, actors[1]))
            .status,
          404,
        );
        assert.equal(
          (
            await request(`/api/sessions/${s.id}`, organizer, {
              operationKey: crypto.randomUUID(),
              groupId: firstGroup,
              intent: "update",
              version: s.version,
              details: { ...s.details, fee: "13.00" },
            })
          ).status,
          409,
        );
      },
    );
    let queue;
    await t.test(
      "two-seat head party blocks later solos and waiting incurs no fee",
      async () => {
        queue = await event();
        for (let i = 0; i < 11; i++) await join(queue, actors[i]);
        for (const [i, seats] of [
          [11, 2],
          [12, 1],
          [13, 1],
        ])
          assert.equal(
            (await (await join(queue, actors[i], seats)).json()).registration
              .own.state,
            "waitlisted",
          );
        for (let i = 11; i < 14; i++) {
          const p = (await view(queue, actors[i])).own;
          assert.equal(p.queuePosition, i - 10);
          assert.equal(p.fee, null);
        }
        const counts = (
          await (await request(`/api/shared/${queue.slug}`)).json()
        ).session.counts;
        assert.deepEqual(counts, { confirmedSeats: 11, waitingParties: 3 });
      },
    );
    await t.test(
      "fixture seat release promotes the whole head once and preserves later order",
      async () => {
        sql(
          `begin;select id from app.groups where id='${firstGroup}' for update;select id from app.sessions where id='${queue.id}' for update;update app.parties set state='withdrawn' where session_id='${queue.id}' and user_id='${actors[0].id}';select app.fill_waitlist('${queue.id}');select app.fill_waitlist('${queue.id}');commit;`,
        );
        const head = (await view(queue, actors[11])).own;
        assert.equal(head.state, "confirmed");
        assert.equal(head.seats, 2);
        assert.equal(head.fee.totalMinor, 2500);
        assert.equal((await view(queue, actors[12])).own.queuePosition, 1);
        assert.equal(
          row(
            `select count(*)::int as n from app.registration_events where party_id='${head.id}' and kind='promoted'`,
          ).n,
          1,
        );
        assert.equal(
          row(
            `select sum(seats)::int as n from app.parties where session_id='${queue.id}' and state='confirmed'`,
          ).n,
          12,
        );
      },
    );
    await t.test(
      "public, waiting, confirmed and organizer views expose only their permitted fields",
      async () => {
        const publicBody = await (
          await request(`/api/shared/${queue.slug}`)
        ).json();
        assert.ok(!JSON.stringify(publicBody).includes("Participant"));
        const waiting = await view(queue, actors[12]);
        assert.equal(waiting.rosterAllowed, false);
        assert.deepEqual(waiting.roster, []);
        const confirmed = await view(queue, actors[1]);
        assert.equal(confirmed.rosterAllowed, true);
        for (const person of confirmed.roster)
          assert.deepEqual(Object.keys(person).sort(), [
            "guestName",
            "primaryName",
            "seats",
            // The badge a person chose to show (D-16); null when none.
            "title",
          ]);
        const unrelated = await view(queue, actors[14]);
        assert.equal(unrelated.own, null);
        assert.deepEqual(unrelated.roster, []);
        const management = await view(queue, organizer);
        assert.equal(management.canManage, true);
        assert.ok(management.roster.some((p) => p.fee?.totalMinor === 2500));
        const browser = client();
        assert.ok(
          (
            await browser.schema("api").rpc("read_registration", {
              p_actor_id: organizer.id,
              p_slug: queue.slug,
            })
          ).error,
        );
        const forged = await join(await event(), actors[14], 1, {
          actorId: organizer.id,
          role: "owner",
        });
        assert.equal((await forged.json()).registration.canManage, false);
      },
    );
    await t.test(
      "post-lock opening/start clock boundaries and terminal lifecycle are authoritative",
      async () => {
        const start = await event();
        const hold = await lockedWindow(start.id, "startsAt");
        const r = await join(start, actors[14]);
        await hold.finished;
        assert.equal(r.status, 409);
        assert.equal((await r.json()).error.code, "registration_closed");
        const opening = await event();
        const heldOpen = await lockedWindow(opening.id, "opensAt");
        const opened = await join(opening, actors[14]);
        await heldOpen.finished;
        assert.equal(opened.status, 200);
        for (const state of ["cancelled", "completed"]) {
          const s = await event();
          sql(`update app.sessions set state='${state}' where id='${s.id}';`);
          assert.equal((await join(s, actors[14])).status, 409);
          assert.equal(
            (
              await request(`/api/sessions/${s.id}`, organizer, {
                operationKey: crypto.randomUUID(),
                groupId: firstGroup,
                intent: "update",
                version: s.version,
                details: s.details,
              })
            ).status,
            409,
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
    for (const actor of actors) await admin.auth.admin.deleteUser(actor.id);
  }
});
