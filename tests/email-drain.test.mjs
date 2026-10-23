import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import {
  localEnv,
  fixturePassword,
  firstGroup,
} from "../scripts/local-env.mjs";
import { drainEmail } from "../packages/email/src/drain.ts";
import { deliveryFromEnv } from "../packages/email/src/client.ts";
import { mailpitProvider } from "../packages/email/src/provider.ts";

const env = localEnv(),
  base = process.env.RALLYPOINT_TEST_URL ?? "http://127.0.0.1:3000",
  inbox = "http://127.0.0.1:54324";
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
const authOptions = { persistSession: false, autoRefreshToken: false };
const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: authOptions,
});
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: authOptions,
  db: { schema: "api" },
});
const publicClient = () =>
  createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    auth: authOptions,
  });
async function login(email) {
  const { data, error } = await publicClient().auth.signInWithPassword({
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
const HOUR = 3600000;
function details(capacity, extra = {}) {
  const now = Date.now();
  return {
    title: "Synthetic email drain test",
    activity: "Workshop",
    startLocal: local(now + 72 * HOUR),
    endLocal: local(now + 75 * HOUR),
    timeZone: "UTC",
    location: "Synthetic room",
    instructions: "Test only",
    capacity,
    openLocal: local(now - HOUR),
    cutoffLocal: local(now + 48 * HOUR),
    fee: "12.50",
    currency: "SGD",
    guests: true,
    paymentMode: "organizer",
    releaseUnpaid: true,
    ...extra,
  };
}
const uuid = () => crypto.randomUUID();
const row = (id) =>
  JSON.parse(
    sql(`select row_to_json(j) from app.email_jobs j where id='${id}';`),
  );
const dayKey = "to_char(now() at time zone 'utc','YYYY-MM-DD')";
const monthKey = "to_char(now() at time zone 'utc','YYYY-MM')";
const setBudget = (day, month) =>
  sql(
    `insert into app.email_budget(period,attempts) values('d:'||${dayKey},${day}),('m:'||${monthKey},${month}) on conflict (period) do update set attempts=excluded.attempts;`,
  );
const resetSender = () =>
  sql(
    `update app.email_sender set holder=null,lease_until=null,circuit_until=null,circuit_reason=null,last_request_at=null where id=1;`,
  );
const rpc = async (name, args) => {
  const { data, error } = await db.rpc(name, args);
  assert.ok(!error, `${name}: ${error?.message}`);
  return data;
};

/** A recording stand-in for the email service. */
function stub() {
  const s = {
    calls: [],
    next: [],
    async send(m) {
      s.calls.push(m);
      return s.next.shift() ?? { outcome: "accepted", id: `stub-${s.calls.length}` };
    },
  };
  return s;
}

test("deliveryFromEnv picks a provider from the environment alone", () => {
  const keys = { SUPABASE_URL: env.SUPABASE_URL, SUPABASE_SECRET_KEY: "x" };
  assert.equal(deliveryFromEnv({}), null);
  assert.equal(deliveryFromEnv({ SUPABASE_URL: env.SUPABASE_URL }), null);
  assert.equal(deliveryFromEnv({ SUPABASE_SECRET_KEY: "x" }), null);
  const off = deliveryFromEnv({ ...keys, APP_ORIGIN: "https://rally.test" });
  assert.equal(off.provider, null, "Delivery is off unless enabled");
  const on = { ...keys, EMAIL_DELIVERY_ENABLED: "true", APP_ORIGIN: "https://rally.test" };
  assert.equal(deliveryFromEnv({ ...on }).provider, null, "No provider named");
  assert.equal(deliveryFromEnv({ ...on, EMAIL_PROVIDER: "resend" }).provider, null);
  assert.equal(deliveryFromEnv({ ...on, EMAIL_PROVIDER: "mailpit" }).provider, null);
  assert.equal(deliveryFromEnv({ ...on, EMAIL_PROVIDER: "other", RESEND_API_KEY: "k" }).provider, null);
  assert.equal(
    typeof deliveryFromEnv({ ...on, EMAIL_PROVIDER: "resend", RESEND_API_KEY: "k" }).provider.send,
    "function",
  );
  const mail = deliveryFromEnv({ ...on, EMAIL_PROVIDER: "mailpit", MAILPIT_URL: inbox });
  assert.equal(typeof mail.provider.send, "function");
  assert.equal(mail.from, "RallyPoint <no-reply@auth.wndrhive.com>");
  assert.equal(mail.appOrigin, "https://rally.test");
  assert.equal(
    deliveryFromEnv({ ...on, EMAIL_PROVIDER: "mailpit", MAILPIT_URL: inbox, EMAIL_FROM: "A <a@x.test>" }).from,
    "A <a@x.test>",
  );
});

test("an empty API schema setting falls back to the default schema", () => {
  const keys = { SUPABASE_URL: env.SUPABASE_URL, SUPABASE_SECRET_KEY: "x" };
  const schemaOf = (extra) =>
    deliveryFromEnv({ ...keys, ...extra }).db.rest.schemaName;
  assert.equal(schemaOf({ SUPABASE_API_SCHEMA: "" }), "api");
  assert.equal(schemaOf({}), "api");
  assert.equal(schemaOf({ SUPABASE_API_SCHEMA: "other_api" }), "other_api");
});

test("the drain sends each due email once, within the ceilings", async (t) => {
  const organizer = await login("organizer@rallypoint.test"),
    actors = [],
    events = [],
    extraUsers = [],
    inboxIds = [];
  const nonce = crypto.randomUUID().slice(0, 8);
  const mine = `drain-${nonce}-`;
  const saved = {
    sender: sql(`select row_to_json(s) from app.email_sender s;`),
    budget: sql(
      `select coalesce(json_agg(b),'[]'::json) from app.email_budget b;`,
    ),
    parked: sql(
      `select coalesce(string_agg(id::text,','),'') from app.email_jobs where state='queued';`,
    ),
  };
  async function event(capacity = "6") {
    const r = await request(`/api/groups/${firstGroup}/sessions`, organizer, {
      operationKey: uuid(),
      groupId: firstGroup,
      intent: "publish",
      details: details(capacity),
    });
    assert.equal(r.status, 200, await r.clone().text());
    const s = (await r.json()).session;
    events.push(s.id);
    return s;
  }
  async function join(s, a, seats = 1) {
    const r = await request(`/api/registrations/${s.slug}`, a, {
      operationKey: uuid(),
      version: s.version,
      seats,
      guestName: seats === 2 ? "Guest" : "",
      consent: true,
    });
    assert.equal(r.status, 200, await r.clone().text());
    return (await r.json()).registration.own;
  }
  const clearJobs = () => {
    if (events.length)
      sql(
        `delete from app.email_jobs where session_id in(${events.map((id) => `'${id}'`).join(",")});`,
      );
  };
  const jobsFor = (s, user) =>
    JSON.parse(
      sql(
        `select coalesce(json_agg(j order by created_at,id),'[]') from app.email_jobs j where session_id='${s.id}'${user ? ` and user_id='${user.id}'` : ""};`,
      ),
    );
  /** Only calls to this test's own synthetic accounts count. */
  const own = (provider) => provider.calls.filter((c) => c.to.startsWith(mine));
  const holders = () => uuid();
  const drain = (provider, extra = {}) =>
    drainEmail({
      db,
      admin: admin.auth.admin,
      provider,
      from: "RallyPoint <no-reply@auth.wndrhive.com>",
      appOrigin: "https://rally.test",
      holder: holders(),
      sleep: async () => {},
      ...extra,
    });
  const due = (id) =>
    sql(
      `update app.email_jobs set next_attempt_at=clock_timestamp()-interval '1 second' where id='${id}';`,
    );
  async function account(label, name = `Synthetic ${label}`) {
    const email = `${mine}${label}@rallypoint.test`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: fixturePassword,
      email_confirm: true,
      user_metadata: { full_name: name },
    });
    assert.ok(!error && data.user);
    extraUsers.push(data.user.id);
    return { email, id: data.user.id };
  }
  try {
    if (saved.parked)
      sql(
        `update app.email_jobs set next_attempt_at=next_attempt_at+interval '1000 years' where id in(${saved.parked
          .split(",")
          .map((i) => `'${i}'`)
          .join(",")});`,
      );
    resetSender();
    for (const label of ["p0", "p1", "p2", "p3", "p4"]) {
      const a = await account(label, label === "p1" ? "Zorblax Quimby" : undefined);
      actors.push({ ...(await login(a.email)), email: a.email });
    }

    await t.test(
      "a confirmed join becomes Sent to email service with one call",
      async () => {
        resetSender();
        const s = await event();
        await join(s, actors[0]);
        const p = stub();
        const result = await drain(p);
        assert.equal(result.leased, true);
        assert.equal(own(p).length, 1);
        const call = own(p)[0];
        assert.equal(call.to, actors[0].email);
        assert.equal(call.subject, "Your RallyPoint place");
        assert.equal(call.from, "RallyPoint <no-reply@auth.wndrhive.com>");
        assert.ok(call.text.includes(`https://rally.test/s/${s.slug}`));
        assert.match(call.idempotencyKey, /^rallypoint-email-/);
        const [job] = jobsFor(s, actors[0]);
        assert.equal(job.state, "sent");
        assert.equal(job.provider_id, "stub-1");
        assert.equal(job.payload, null);
        assert.equal(job.attempts, 1);
        assert.ok(result.sent >= 1);
        assert.equal(sql(`select holder is null from app.email_sender;`), "t");
        clearJobs();
      },
    );

    await t.test(
      "a crash after acceptance replays the same key and payload",
      async () => {
        resetSender();
        const s = await event();
        await join(s, actors[0]);
        const holder = uuid();
        const claimed = await rpc("claim_email_jobs", {
          p_holder: holder,
          p_limit: 5,
        });
        const job = claimed.jobs.find((j) => j.userId === actors[0].id);
        assert.ok(job);
        const frozenIn = {
          to: actors[0].email,
          from: "RallyPoint <no-reply@auth.wndrhive.com>",
          subject: "Your RallyPoint place",
          text: "Frozen body from the first attempt\n",
          html: "<p>Frozen body from the first attempt</p>",
        };
        const begun = await rpc("begin_email_attempt", {
          p_holder: holder,
          p_job: job.id,
          p_payload: frozenIn,
        });
        assert.equal(begun.go, true);
        // The first run "sent" the message, then died before recording the result.
        const firstKey = job.idempotencyKey;
        sql(
          `update app.email_jobs set lease_until=clock_timestamp()-interval '1 second' where id='${job.id}';update app.email_sender set lease_until=clock_timestamp()-interval '1 second';`,
        );
        const p = stub();
        const settle = await drain(p);
        assert.equal(settle.leased, true);
        assert.equal(own(p).length, 0, "The stale job waits out its retry spacing");
        assert.equal(row(job.id).state, "queued");
        assert.equal(row(job.id).ambiguous, true);
        due(job.id);
        const again = await drain(p);
        assert.equal(again.sent, 1);
        assert.equal(own(p).length, 1);
        const replay = own(p)[0];
        assert.equal(replay.idempotencyKey, firstKey);
        for (const field of ["to", "from", "subject", "text", "html"])
          assert.equal(replay[field], frozenIn[field], field);
        const after = row(job.id);
        assert.equal(after.state, "sent");
        assert.equal(after.attempts, 2);
        assert.equal(after.payload, null);
        clearJobs();
      },
    );

    await t.test(
      "a timeout leaves the job Not confirmed if it never resolves",
      async () => {
        resetSender();
        const s = await event();
        await join(s, actors[0]);
        const p = stub();
        for (let i = 0; i < 3; i++)
          p.next.push({ outcome: "ambiguous", code: "timeout" });
        const [job] = jobsFor(s, actors[0]);
        for (let i = 0; i < 3; i++) {
          if (i > 0) {
            assert.equal(row(job.id).state, "queued");
            due(job.id);
          }
          await drain(p);
        }
        assert.equal(own(p).length, 3);
        assert.equal(new Set(own(p).map((c) => c.idempotencyKey)).size, 1);
        assert.equal(new Set(own(p).map((c) => c.text)).size, 1);
        const done = row(job.id);
        assert.equal(done.state, "not_confirmed");
        assert.equal(done.payload, null);
        due(job.id);
        await drain(p);
        assert.equal(own(p).length, 3, "No fourth attempt");
        clearJobs();
      },
    );

    await t.test("a permanent rejection stops at once", async () => {
      resetSender();
      const s = await event();
      await join(s, actors[0]);
      const p = stub();
      p.next.push({ outcome: "permanent", code: "validation_error" });
      const result = await drain(p);
      assert.equal(own(p).length, 1);
      const [job] = jobsFor(s, actors[0]);
      assert.equal(job.state, "not_sent");
      assert.equal(job.reason, "rejected");
      assert.equal(job.payload, null);
      assert.ok(result.ended >= 1);
      due(job.id);
      await drain(p);
      assert.equal(own(p).length, 1);
      clearJobs();
    });

    await t.test("budget exhaustion makes no provider call", async () => {
      resetSender();
      const s = await event();
      await join(s, actors[0]);
      setBudget(50, 50);
      const p = stub();
      const result = await drain(p);
      assert.equal(own(p).length, 0);
      assert.equal(result.sent, 0);
      const [job] = jobsFor(s, actors[0]);
      assert.equal(job.state, "queued");
      assert.equal(job.reason, "daily_limit");
      assert.equal(job.attempts, 0);
      assert.equal(job.payload, null);
      resetSender();
      sql(`delete from app.email_budget;`);
      clearJobs();
    });

    await t.test("a quota answer opens the circuit and stops the run", async () => {
      resetSender();
      const s = await event();
      await join(s, actors[0]);
      await join(s, actors[1]);
      const p = stub();
      p.next.push({ outcome: "quota", code: "daily_quota" });
      await drain(p);
      assert.equal(own(p).length, 1, "The second job is not tried after the quota answer");
      const states = jobsFor(s).map((j) => `${j.state}:${j.reason}`);
      assert.deepEqual(states, ["queued:daily_limit", "queued:daily_limit"]);
      resetSender();
      sql(`delete from app.email_budget;`);
      clearJobs();
    });

    await t.test("overlapping drains send once", async () => {
      resetSender();
      const s = await event();
      for (const a of actors.slice(0, 3)) await join(s, a);
      const p = stub();
      const [x, y] = await Promise.all([drain(p), drain(p)]);
      assert.ok(x.leased || y.leased);
      assert.equal(own(p).length, 3);
      assert.equal(new Set(own(p).map((c) => c.idempotencyKey)).size, 3);
      assert.equal(new Set(own(p).map((c) => c.to)).size, 3);
      assert.deepEqual(
        jobsFor(s).map((j) => [j.state, j.attempts]),
        [
          ["sent", 1],
          ["sent", 1],
          ["sent", 1],
        ],
      );
      clearJobs();
    });

    await t.test("an account without a verified email is Not sent", async () => {
      resetSender();
      const s = await event();
      await join(s, actors[4]);
      sql(
        `update auth.users set email_confirmed_at=null where id='${actors[4].id}';`,
      );
      try {
        const p = stub();
        const result = await drain(p);
        assert.equal(own(p).length, 0);
        const [job] = jobsFor(s, actors[4]);
        assert.equal(job.state, "not_sent");
        assert.equal(job.reason, "no_verified_email");
        assert.equal(job.payload, null);
        assert.ok(result.ended >= 1);
      } finally {
        sql(
          `update auth.users set email_confirmed_at=now() where id='${actors[4].id}';`,
        );
      }
      clearJobs();
    });

    await t.test(
      "a bad stored time ends the job as render_failed instead of retrying",
      async () => {
        resetSender();
        const s = await event();
        await join(s, actors[0]);
        sql(`alter table app.sessions disable trigger protect_booked_session;`);
        try {
          sql(
            `update app.sessions set details=jsonb_set(details,'{timeZone}','"Not/AZone"') where id='${s.id}';`,
          );
        } finally {
          sql(`alter table app.sessions enable trigger protect_booked_session;`);
        }
        const p = stub();
        await drain(p);
        assert.equal(own(p).length, 0);
        const [job] = jobsFor(s, actors[0]);
        assert.equal(job.state, "not_sent");
        assert.equal(job.reason, "render_failed");
        clearJobs();
      },
    );

    await t.test(
      "no email body contains another participant, a payment reference or a note",
      async () => {
        resetSender();
        const s = await event();
        await join(s, actors[0], 2);
        const other = await join(s, actors[1]);
        const noted = await request(
          `/api/registrations/${s.slug}/payment-note`,
          actors[1],
          {
            operationKey: uuid(),
            partyId: other.id,
            action: "mark",
            reference: "REFLEAK-7391",
          },
        );
        assert.equal(noted.status, 200, await noted.clone().text());
        const saved = await request(
          `/api/sessions/${s.id}/payment-instructions`,
          organizer,
          {
            operationKey: uuid(),
            revision: 0,
            action: "save",
            text: "PayNow LEAKY 9123 4567",
          },
        );
        assert.equal(saved.status, 200, await saved.clone().text());
        const p = stub();
        await drain(p);
        const calls = own(p);
        assert.ok(calls.length >= 4, `join and instruction emails for two people (${calls.length})`);
        for (const c of calls)
          for (const text of [c.text, c.html, c.subject])
            for (const secret of ["Zorblax", "Quimby", "REFLEAK", "7391", "LEAKY", "9123", "PayNow"])
              assert.ok(!text.includes(secret), `${secret} must not appear`);
        // The other party's email is addressed to them, not copied to anyone else.
        assert.deepEqual(
          [...new Set(calls.map((c) => c.to))].sort(),
          [actors[0].email, actors[1].email].sort(),
        );
        clearJobs();
      },
    );

    await t.test(
      "delivery off ends due jobs without calling a provider",
      async () => {
        resetSender();
        const s = await event();
        await join(s, actors[0]);
        const p = stub();
        const result = await drain(null);
        assert.equal(result.leased, true);
        assert.ok(result.ended >= 1);
        assert.equal(p.calls.length, 0);
        const [job] = jobsFor(s, actors[0]);
        assert.equal(job.state, "not_sent");
        assert.equal(job.reason, "delivery_disabled");
        assert.equal(job.payload, null);
        assert.equal(sql(`select holder is null from app.email_sender;`), "t");
        clearJobs();
      },
    );

    await t.test("a drain that cannot take the lease does nothing", async () => {
      resetSender();
      const s = await event();
      await join(s, actors[0]);
      const holder = uuid();
      await rpc("claim_email_jobs", { p_holder: holder, p_limit: 0 });
      const p = stub();
      const result = await drain(p);
      assert.deepEqual(result, { leased: false, sent: 0, retried: 0, ended: 0, skipped: 0 });
      assert.equal(p.calls.length, 0);
      assert.equal(sql(`select holder from app.email_sender;`), holder, "The other holder keeps its lease");
      assert.equal((await drain(null)).leased, false);
      resetSender();
      clearJobs();
    });

    await t.test("the local inbox receives a message", async () => {
      resetSender();
      const s = await event();
      await join(s, actors[3]);
      const result = await drain(mailpitProvider({ baseUrl: inbox }));
      assert.ok(result.sent >= 1);
      const listing = await (await fetch(`${inbox}/api/v1/messages?limit=200`)).json();
      const found = listing.messages.filter(
        (m) =>
          m.To?.some((r) => r.Address === actors[3].email) &&
          m.Subject === "Your RallyPoint place",
      );
      for (const m of found) inboxIds.push(m.ID);
      assert.equal(found.length, 1);
      const [job] = jobsFor(s, actors[3]);
      assert.equal(job.state, "sent");
      assert.equal(job.provider_id, found[0].ID);
      clearJobs();
    });
  } finally {
    clearJobs();
    if (inboxIds.length) {
      await fetch(`${inbox}/api/v1/messages`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ IDs: inboxIds }),
      });
    }
    // A failed run can leave a message behind; remove only this run's own, by ID.
    try {
      const listing = await (await fetch(`${inbox}/api/v1/messages?limit=200`)).json();
      const stray = listing.messages
        .filter((m) => m.To?.some((r) => r.Address.startsWith(mine)))
        .map((m) => m.ID);
      if (stray.length)
        await fetch(`${inbox}/api/v1/messages`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ IDs: stray }),
        });
    } catch {
      // The inbox is optional for every other test.
    }
    if (events.length) {
      const list = events.map((id) => `'${id}'`).join(",");
      const parties = `select id from app.parties where session_id in(${list})`;
      sql(
        `begin;delete from app.email_jobs where session_id in(${list});delete from app.email_suppressions where session_id in(${list});delete from app.payment_notes where party_id in(${parties});delete from app.operation_receipts where resource_id in(${parties}) or resource_id in(${list});delete from app.attendance_changes where party_id in(${parties});delete from app.seat_attendance where party_id in(${parties});delete from app.fee_changes where party_id in(${parties});delete from app.registration_events where party_id in(${parties});delete from app.fee_obligations where party_id in(${parties});delete from app.parties where session_id in(${list});delete from app.session_changes where session_id in(${list});delete from app.sessions where id in(${list});commit;`,
      );
    }
    for (const id of extraUsers) await admin.auth.admin.deleteUser(id);
    if (saved.parked)
      sql(
        `update app.email_jobs set next_attempt_at=next_attempt_at-interval '1000 years' where id in(${saved.parked
          .split(",")
          .map((i) => `'${i}'`)
          .join(",")});`,
      );
    const prior = JSON.parse(saved.sender);
    sql(
      `update app.email_sender set holder=${prior.holder ? `'${prior.holder}'` : "null"},lease_until=${prior.lease_until ? `'${prior.lease_until}'` : "null"},circuit_until=${prior.circuit_until ? `'${prior.circuit_until}'` : "null"},circuit_reason=${prior.circuit_reason ? `'${prior.circuit_reason}'` : "null"},last_request_at=${prior.last_request_at ? `'${prior.last_request_at}'` : "null"} where id=1;delete from app.email_budget;insert into app.email_budget select * from json_populate_recordset(null::app.email_budget,'${saved.budget}');`,
    );
  }
});
