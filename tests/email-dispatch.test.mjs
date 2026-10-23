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
    title: "Synthetic email dispatch test",
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
/** Moves a booked session time to cross a boundary; the booked-details guard is off for that one update only. */
function shift(id, field, interval) {
  sql(`alter table app.sessions disable trigger protect_booked_session;`);
  try {
    sql(
      `update app.sessions set details=jsonb_set(details,'{${field}}',to_jsonb((clock_timestamp()+interval ${interval})::text)) where id='${id}';`,
    );
  } finally {
    sql(`alter table app.sessions enable trigger protect_booked_session;`);
  }
}
const rpc = async (name, args) => {
  const { data, error } = await admin.schema("api").rpc(name, args);
  assert.ok(!error, `${name}: ${error?.message}`);
  return data;
};
const uuid = () => crypto.randomUUID();
const row = (id) =>
  JSON.parse(
    sql(`select row_to_json(j) from app.email_jobs j where id='${id}';`),
  );
const dayKey = "to_char(now() at time zone 'utc','YYYY-MM-DD')";
const monthKey = "to_char(now() at time zone 'utc','YYYY-MM')";
const nextMidnight = `(date_trunc('day',now() at time zone 'utc')+interval '1 day') at time zone 'utc'`;
const nextMonth = `(date_trunc('month',now() at time zone 'utc')+interval '1 month') at time zone 'utc'`;
const setBudget = (day, month) =>
  sql(
    `insert into app.email_budget(period,attempts) values('d:'||${dayKey},${day}),('m:'||${monthKey},${month}) on conflict (period) do update set attempts=excluded.attempts;`,
  );
const budget = () =>
  sql(
    `select coalesce((select attempts from app.email_budget where period='d:'||${dayKey}),0)||':'||coalesce((select attempts from app.email_budget where period='m:'||${monthKey}),0);`,
  );
const resetSender = () =>
  sql(
    `update app.email_sender set holder=null,lease_until=null,circuit_until=null,circuit_reason=null,last_request_at=null where id=1;`,
  );
const sender = () =>
  JSON.parse(sql(`select row_to_json(s) from app.email_sender s;`));
const near = (iso, seconds, tolerance = 8) =>
  Math.abs((Date.parse(iso) - Date.now()) / 1000 - seconds) < tolerance;

test("dispatch leases, rechecks and accounts for every email attempt", async (t) => {
  const organizer = await login("organizer@rallypoint.test"),
    actors = [],
    events = [],
    extraUsers = [];
  const nonce = crypto.randomUUID().slice(0, 8);
  const saved = {
    sender: sql(`select row_to_json(s) from app.email_sender s;`),
    budget: sql(
      `select coalesce(json_agg(b),'[]'::json) from app.email_budget b;`,
    ),
    parked: sql(
      `select coalesce(string_agg(id::text,','),'') from app.email_jobs where state='queued';`,
    ),
  };
  async function event(capacity = "6", extra = {}) {
    const r = await request(`/api/groups/${firstGroup}/sessions`, organizer, {
      operationKey: uuid(),
      groupId: firstGroup,
      intent: "publish",
      details: details(capacity, extra),
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
  const withdraw = async (s, a, party) => {
    const r = await request(`/api/registrations/${s.slug}/withdraw`, a, {
      operationKey: uuid(),
      partyId: party.id,
    });
    assert.equal(r.status, 200, await r.clone().text());
  };
  const cancel = async (s) => {
    const r = await request(`/api/sessions/${s.id}/cancel`, organizer, {
      operationKey: uuid(),
    });
    assert.equal(r.status, 200, await r.clone().text());
  };
  /** A job that needs no party: due now, expiring in an hour unless told otherwise. */
  const newJob = (s, user, o = {}) =>
    sql(
      `insert into app.email_jobs(kind,session_id,party_id,user_id,source_key,next_attempt_at,expires_at,ambiguous) values('${o.kind ?? "instructions_changed"}','${s.id}',${o.party ? `'${o.party}'` : "null"},'${user.id}','${uuid()}',clock_timestamp()-interval '1 second',clock_timestamp()+interval '${o.expires ?? "1 hour"}',${o.ambiguous ? "true" : "false"}) returning id;`,
    );
  const forSession = (s, kind) =>
    JSON.parse(
      sql(
        `select coalesce(json_agg(json_build_object('id',id,'user',user_id,'state',state,'reason',reason,'kind',kind) order by created_at,id),'[]') from app.email_jobs where session_id='${s.id}'${kind ? ` and kind='${kind}'` : ""};`,
      ),
    );
  const clearJobs = () => {
    if (events.length)
      sql(
        `delete from app.email_jobs where session_id in(${events.map((id) => `'${id}'`).join(",")});`,
      );
  };
  const holder = uuid();
  /** Claims as the one test holder and keeps only this test's own jobs. */
  const claim = async (limit = 5, who = holder) => {
    const r = await rpc("claim_email_jobs", { p_holder: who, p_limit: limit });
    return r;
  };
  async function account(label) {
    const email = `dispatch-${nonce}-${label}@rallypoint.test`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: fixturePassword,
      email_confirm: true,
      user_metadata: { full_name: `Synthetic ${label}` },
    });
    assert.ok(!error && data.user);
    return { email, id: data.user.id };
  }
  try {
    // Foreign waiting jobs would be claimed by these runs; set them aside for the duration.
    if (saved.parked)
      sql(
        `update app.email_jobs set next_attempt_at=next_attempt_at+interval '1000 years' where id in(${saved.parked
          .split(",")
          .map((i) => `'${i}'`)
          .join(",")});`,
      );
    resetSender();
    for (let i = 0; i < 7; i++) {
      const a = await account(`p${i}`);
      extraUsers.push(a.id);
      actors.push(await login(a.email));
    }

    await t.test("only one holder leases the sender at a time", async () => {
      resetSender();
      const A = uuid(),
        B = uuid();
      assert.equal((await claim(5, A)).leased, true);
      const denied = await claim(5, B);
      assert.deepEqual(denied, { leased: false, jobs: [] });
      assert.equal(sender().holder, A);
      await rpc("release_email_sender", { p_holder: B });
      assert.equal(sender().holder, A, "A non-holder cannot release");
      await rpc("release_email_sender", { p_holder: A });
      assert.equal(sender().holder, null);
      assert.equal((await claim(5, B)).leased, true);
      sql(
        `update app.email_sender set lease_until=clock_timestamp()-interval '1 second';`,
      );
      assert.equal(
        (await claim(5, A)).leased,
        true,
        "An expired lease can be taken",
      );
      assert.equal(sender().holder, A);
      assert.ok(near(sender().lease_until, 120, 10));
      resetSender();
      const racers = await Promise.all(
        Array.from({ length: 6 }, () => claim(5, uuid())),
      );
      assert.equal(
        racers.filter((r) => r.leased).length,
        1,
        "Six simultaneous claims produce exactly one lease holder",
      );
      resetSender();
    });

    await t.test(
      "a claim returns at most five due jobs and marks them sending",
      async () => {
        resetSender();
        const s = await event("6");
        clearJobs();
        const ids = actors.map((a) => newJob(s, a));
        const r = await claim(10);
        assert.equal(r.jobs.length, 5);
        const states = forSession(s).reduce(
          (m, j) => ({ ...m, [j.state]: (m[j.state] ?? 0) + 1 }),
          {},
        );
        assert.deepEqual(states, { sending: 5, queued: 2 });
        for (const j of r.jobs) {
          assert.ok(ids.includes(j.id));
          assert.equal(j.idempotencyKey, `rallypoint-email-${j.id}`);
          assert.equal(j.attempts, 0);
          assert.equal(j.ambiguous, false);
          assert.equal(j.payload, null);
          assert.equal(row(j.id).state, "sending");
          assert.ok(near(row(j.id).lease_until, 120, 10));
        }
        assert.equal(
          (await claim(0)).jobs.length,
          0,
          "A limit of zero claims nothing",
        );
        resetSender();
        clearJobs();
      },
    );

    await t.test(
      "a claim carries the first name, queue place and session context",
      async () => {
        resetSender();
        const s = await event("1");
        const a = await join(s, actors[0]),
          b = await join(s, actors[1]);
        assert.equal(b.state, "waitlisted");
        const r = await claim(5);
        const mine = r.jobs.filter(
          (j) => j.userId === actors[0].id || j.userId === actors[1].id,
        );
        const byUser = Object.fromEntries(mine.map((j) => [j.userId, j]));
        assert.equal(byUser[actors[0].id].kind, "joined_confirmed");
        assert.equal(byUser[actors[0].id].context.firstName, "Synthetic");
        assert.equal(byUser[actors[0].id].context.queuePosition, null);
        assert.equal(byUser[actors[1].id].kind, "joined_waitlisted");
        assert.equal(byUser[actors[1].id].context.queuePosition, 1);
        const c = byUser[actors[1].id].context;
        assert.equal(c.title, "Synthetic email dispatch test");
        assert.equal(c.timeZone, "UTC");
        assert.equal(c.slug, s.slug);
        assert.ok(Date.parse(c.startsAt) > Date.now());
        assert.ok(Date.parse(c.cutoffAt) > Date.now());
        void a;
        resetSender();
        clearJobs();
      },
    );

    await t.test(
      "a cancelled session suppresses waiting join and promotion emails but not its cancellation email",
      async () => {
        resetSender();
        const s = await event("1");
        const a = await join(s, actors[0]);
        await join(s, actors[1]);
        await withdraw(s, actors[0], a);
        assert.equal(forSession(s, "promoted").length, 1);
        await cancel(s);
        const r = await claim(5);
        const mine = r.jobs.filter((j) =>
          forSession(s).some((x) => x.id === j.id),
        );
        assert.deepEqual(
          mine.map((j) => j.kind),
          ["cancelled"],
        );
        assert.equal(mine[0].userId, actors[1].id);
        for (const j of forSession(s).filter((x) => x.kind !== "cancelled")) {
          assert.equal(j.state, "not_sent");
          assert.equal(j.reason, "superseded");
        }
        resetSender();
        clearJobs();
      },
    );

    await t.test(
      "a withdrawn party's confirmation, an old waitlist notice and a mismatched release are superseded",
      async () => {
        resetSender();
        const s = await event("1");
        const a = await join(s, actors[0]); // confirmed, then withdraws
        const b = await join(s, actors[1]); // waitlisted, then promoted
        await withdraw(s, actors[0], a);
        const c = await join(s, actors[2]); // waitlisted behind b
        assert.equal(c.state, "waitlisted");
        // A release job for a party that was never released.
        const bogus = newJob(s, actors[1], { kind: "released", party: b.id });
        const r = await claim(10);
        const ids = new Set(r.jobs.map((j) => j.id));
        const jobs = forSession(s);
        const find = (kind, user) =>
          jobs.find((j) => j.kind === kind && j.user === user.id);
        assert.deepEqual(find("joined_confirmed", actors[0]).state, "not_sent");
        assert.equal(find("joined_confirmed", actors[0]).reason, "superseded");
        assert.equal(
          find("joined_waitlisted", actors[1]).reason,
          "superseded",
          "B is confirmed now",
        );
        assert.ok(
          ids.has(find("promoted", actors[1]).id),
          "The promotion is still true",
        );
        assert.ok(
          ids.has(find("joined_waitlisted", actors[2]).id),
          "C is still waitlisted",
        );
        assert.equal(row(bogus).reason, "superseded");
        assert.equal(row(bogus).state, "not_sent");
        resetSender();
        clearJobs();
      },
    );

    await t.test(
      "reminders: due window, confirmed in time, no late catch-up, no withdrawn",
      async () => {
        resetSender();
        const s = await event("6");
        const A = await join(s, actors[0]);
        const B = await join(s, actors[1]);
        const C = await join(s, actors[2]);
        await withdraw(s, actors[1], B);
        // A and B were confirmed an hour before the reminder time; C only just now.
        sql(
          `update app.registration_events set created_at=created_at-interval '1 hour' where party_id in('${A.id}','${B.id}');`,
        );
        clearJobs();
        shift(s.id, "startsAt", "'24 hours 10 minutes'");
        await claim(5);
        assert.equal(forSession(s, "reminder").length, 0, "Not yet due");
        shift(s.id, "startsAt", "'23 hours 59 minutes'");
        const r = await claim(5);
        const reminders = forSession(s, "reminder");
        assert.equal(
          reminders.length,
          1,
          "Only the party confirmed in time, still confirmed",
        );
        assert.equal(reminders[0].user, actors[0].id);
        assert.deepEqual(
          r.jobs.filter((j) => j.kind === "reminder").map((j) => j.userId),
          [actors[0].id],
        );
        assert.equal(
          sql(
            `select abs(extract(epoch from j.expires_at-((s.details->>'startsAt')::timestamptz-interval '24 hours'+interval '15 minutes')))<0.01 and j.party_id='${A.id}' from app.email_jobs j join app.sessions s on s.id=j.session_id where j.session_id='${s.id}' and j.kind='reminder';`,
          ),
          "t",
          "A reminder expires 15 minutes after it is due",
        );
        await claim(5);
        await claim(5);
        assert.equal(
          forSession(s, "reminder").length,
          1,
          "Claiming again adds no duplicate",
        );
        void C;
        // Once the 15 minutes are over nothing is created: no catch-up.
        const late = await event("6");
        const L = await join(late, actors[0]);
        sql(
          `update app.registration_events set created_at=created_at-interval '1 hour' where party_id='${L.id}';`,
        );
        clearJobs();
        shift(late.id, "startsAt", "'23 hours 44 minutes'");
        await claim(5);
        assert.equal(
          forSession(late, "reminder").length,
          0,
          "16 minutes after due is too late",
        );
        // A draft or cancelled session never gets one.
        shift(late.id, "startsAt", "'23 hours 59 minutes'");
        sql(`update app.sessions set state='draft' where id='${late.id}';`);
        await claim(5);
        assert.equal(
          forSession(late, "reminder").length,
          0,
          "Only a published session",
        );
        sql(`update app.sessions set state='published' where id='${late.id}';`);
        await claim(5);
        assert.equal(forSession(late, "reminder").length, 1);
        // Its reminder is superseded if the session stops being published before the attempt.
        const only = forSession(late, "reminder")[0];
        await rpc("release_email_sender", { p_holder: holder });
        sql(
          `update app.email_jobs set state='queued',lease_until=null where id='${only.id}';`,
        );
        sql(`update app.sessions set state='completed' where id='${late.id}';`);
        const again = await claim(5);
        assert.ok(!again.jobs.some((j) => j.id === only.id));
        assert.equal(row(only.id).reason, "superseded");
        // Move both sessions out of the reminder window so later claims leave them alone.
        shift(s.id, "startsAt", "'72 hours'");
        shift(late.id, "startsAt", "'72 hours'");
        resetSender();
        clearJobs();
      },
    );

    await t.test(
      "budget: 50 a day, then deferral without early expiry",
      async () => {
        resetSender();
        const s = await event("6");
        clearJobs();
        const id = newJob(s, actors[0]);
        const before = row(id).expires_at;
        await claim(5);
        setBudget(50, 10);
        const r = await rpc("begin_email_attempt", {
          p_holder: holder,
          p_job: id,
          p_payload: { to: "a@x" },
        });
        assert.equal(r.go, false);
        assert.equal(r.reason, "daily_limit");
        const j = row(id);
        assert.equal(j.state, "queued");
        assert.equal(j.reason, "daily_limit");
        assert.equal(j.attempts, 0, "No attempt was made");
        assert.equal(j.payload, null, "Nothing is frozen without an attempt");
        assert.equal(j.expires_at, before, "Deferral never extends expiry");
        assert.equal(
          sql(
            `select next_attempt_at=${nextMidnight} and (select circuit_until from app.email_sender)=next_attempt_at and (select circuit_reason from app.email_sender)='daily_limit' from app.email_jobs where id='${id}';`,
          ),
          "t",
        );
        assert.equal(budget(), "50:10", "A refused attempt costs nothing");
        const after = await claim(5);
        assert.deepEqual(
          after,
          { leased: true, jobs: [] },
          "The open circuit hands out nothing",
        );
        // Time keeps running while the circuit is open: the job still ends at its own expiry.
        sql(
          `update app.email_jobs set expires_at=clock_timestamp()-interval '1 second' where id='${id}';`,
        );
        await claim(5);
        assert.equal(row(id).state, "not_sent");
        assert.equal(row(id).reason, "expired");
        // The monthly budget opens the circuit to the first of next month.
        resetSender();
        setBudget(3, 1500);
        const id2 = newJob(s, actors[1]);
        await claim(5);
        const m = await rpc("begin_email_attempt", {
          p_holder: holder,
          p_job: id2,
          p_payload: { to: "a@x" },
        });
        assert.equal(m.reason, "monthly_limit");
        assert.equal(
          sql(
            `select next_attempt_at=${nextMonth} and (select circuit_until from app.email_sender)=${nextMonth} from app.email_jobs where id='${id2}';`,
          ),
          "t",
        );
        // A second job begun while the circuit stands is deferred too, without a debit.
        resetSender();
        sql(
          `update app.email_sender set circuit_until=clock_timestamp()+interval '1 hour',circuit_reason='daily_limit';`,
        );
        const id3 = newJob(s, actors[2]);
        sql(
          `update app.email_jobs set state='sending',lease_until=clock_timestamp()+interval '2 minutes' where id='${id3}';`,
        );
        sql(
          `update app.email_sender set holder='${holder}',lease_until=clock_timestamp()+interval '2 minutes';`,
        );
        setBudget(3, 4);
        const d = await rpc("begin_email_attempt", {
          p_holder: holder,
          p_job: id3,
          p_payload: { to: "a@x" },
        });
        assert.equal(d.go, false);
        assert.equal(row(id3).state, "queued");
        assert.equal(budget(), "3:4");
        resetSender();
        clearJobs();
      },
    );

    await t.test(
      "begin debits both budgets before the attempt, freezes the payload and spaces requests",
      async () => {
        resetSender();
        const s = await event("6");
        clearJobs();
        const one = newJob(s, actors[0]),
          two = newJob(s, actors[1]);
        setBudget(7, 70);
        await claim(5);
        const first = await rpc("begin_email_attempt", {
          p_holder: holder,
          p_job: one,
          p_payload: { to: "a@x", body: "one" },
        });
        assert.equal(first.go, true);
        assert.equal(first.waitMs, 0);
        assert.deepEqual(first.payload, { to: "a@x", body: "one" });
        assert.equal(budget(), "8:71");
        assert.equal(row(one).attempts, 1);
        assert.deepEqual(row(one).payload, { to: "a@x", body: "one" });
        const second = await rpc("begin_email_attempt", {
          p_holder: holder,
          p_job: two,
          p_payload: { to: "b@x", body: "two" },
        });
        assert.equal(second.go, true);
        assert.ok(
          second.waitMs > 800 && second.waitMs <= 1000,
          `waitMs ${second.waitMs}`,
        );
        assert.equal(budget(), "9:72");
        // A holder without the lease, or a job it does not hold, may not begin.
        const stranger = await rpc("begin_email_attempt", {
          p_holder: uuid(),
          p_job: one,
          p_payload: { to: "a@x" },
        });
        assert.equal(stranger.go, false);
        assert.equal(stranger.reason, "lease_lost");
        assert.equal(budget(), "9:72");
        resetSender();
        clearJobs();
      },
    );

    await t.test("retry schedule and attempt limit", async () => {
      resetSender();
      const s = await event("6");
      clearJobs();
      const id = newJob(s, actors[0]);
      const attempt = async (outcome, code, retry = null) => {
        sql(
          `update app.email_jobs set next_attempt_at=clock_timestamp()-interval '1 second' where id='${id}' and state='queued';`,
        );
        const c = await claim(5);
        assert.ok(
          c.jobs.some((j) => j.id === id),
          "The job is handed out again",
        );
        const b = await rpc("begin_email_attempt", {
          p_holder: holder,
          p_job: id,
          p_payload: { to: "a@x", body: "same" },
        });
        assert.equal(b.go, true);
        await rpc("finish_email_attempt", {
          p_holder: holder,
          p_job: id,
          p_outcome: outcome,
          p_code: code,
          p_provider_id: null,
          p_retry_after_seconds: retry,
        });
        return row(id);
      };
      let j = await attempt("transient", "http_503");
      assert.equal(j.state, "queued");
      assert.equal(j.attempts, 1);
      assert.equal(j.reason, "http_503");
      assert.ok(near(j.next_attempt_at, 60), "1 minute after attempt 1");
      assert.deepEqual(j.payload, { to: "a@x", body: "same" });
      assert.equal(j.lease_until, null);
      j = await attempt("transient", "http_503");
      assert.equal(j.attempts, 2);
      assert.ok(near(j.next_attempt_at, 300), "5 minutes after attempt 2");
      j = await attempt("transient", "http_503");
      assert.equal(j.attempts, 3);
      assert.equal(j.state, "not_sent");
      assert.equal(j.reason, "attempts_exhausted");
      assert.equal(j.payload, null);
      // A longer provider delay wins when it still fits before expiry.
      const longer = newJob(s, actors[1]);
      await claim(5);
      await rpc("begin_email_attempt", {
        p_holder: holder,
        p_job: longer,
        p_payload: { to: "a@x" },
      });
      await rpc("finish_email_attempt", {
        p_holder: holder,
        p_job: longer,
        p_outcome: "transient",
        p_code: "rate_limited",
        p_provider_id: null,
        p_retry_after_seconds: 600,
      });
      assert.equal(row(longer).state, "queued");
      assert.ok(near(row(longer).next_attempt_at, 600));
      // ...and a delay past expiry ends the job instead of attempting late.
      const toolong = newJob(s, actors[2], { expires: "5 minutes" });
      await claim(5);
      await rpc("begin_email_attempt", {
        p_holder: holder,
        p_job: toolong,
        p_payload: { to: "a@x" },
      });
      await rpc("finish_email_attempt", {
        p_holder: holder,
        p_job: toolong,
        p_outcome: "transient",
        p_code: "rate_limited",
        p_provider_id: null,
        p_retry_after_seconds: 600,
      });
      assert.equal(row(toolong).state, "not_sent");
      assert.equal(row(toolong).reason, "expired");
      assert.equal(row(toolong).payload, null);
      resetSender();
      clearJobs();
    });

    await t.test(
      "provider outcomes: accepted, permanent, quota and a missing email",
      async () => {
        resetSender();
        const s = await event("6");
        clearJobs();
        const finish = (job, outcome, code = null, pid = null) =>
          rpc("finish_email_attempt", {
            p_holder: holder,
            p_job: job,
            p_outcome: outcome,
            p_code: code,
            p_provider_id: pid,
            p_retry_after_seconds: null,
          });
        const begun = async (users) => {
          const ids = users.map((u) => newJob(s, u));
          await claim(5);
          for (const id of ids)
            await rpc("begin_email_attempt", {
              p_holder: holder,
              p_job: id,
              p_payload: { to: "a@x" },
            });
          return ids;
        };
        const [ok, bad, missing, daily, monthly] = await begun(
          actors.slice(0, 5),
        );
        await finish(ok, "accepted", null, "provider-1");
        assert.deepEqual(
          {
            s: row(ok).state,
            r: row(ok).reason,
            p: row(ok).provider_id,
            pay: row(ok).payload,
          },
          { s: "sent", r: null, p: "provider-1", pay: null },
        );
        await finish(bad, "permanent", "invalid_to_address");
        assert.deepEqual(
          { s: row(bad).state, r: row(bad).reason, pay: row(bad).payload },
          { s: "not_sent", r: "rejected", pay: null },
        );
        await finish(missing, "recipient_missing");
        assert.deepEqual(
          {
            s: row(missing).state,
            r: row(missing).reason,
            pay: row(missing).payload,
          },
          { s: "not_sent", r: "no_verified_email", pay: null },
        );
        const spent = budget();
        await finish(daily, "quota", "daily_quota");
        assert.equal(row(daily).state, "queued");
        assert.equal(row(daily).attempts, 1, "A quota attempt still counts");
        assert.equal(budget(), spent, "and is not refunded");
        assert.equal(
          sql(
            `select (select next_attempt_at from app.email_jobs where id='${daily}')=${nextMidnight} and circuit_until=${nextMidnight} and circuit_reason='daily_limit' from app.email_sender;`,
          ),
          "t",
        );
        await finish(monthly, "quota", "monthly_quota");
        assert.equal(
          sql(
            `select circuit_until=${nextMonth} and circuit_reason='monthly_limit' from app.email_sender;`,
          ),
          "t",
        );
        // A finish may not run twice: the second is a no-op.
        await finish(ok, "permanent", "x");
        assert.equal(row(ok).state, "sent");
        resetSender();
        clearJobs();
      },
    );

    await t.test(
      "an ambiguous attempt can only end as Not confirmed or Sent",
      async () => {
        resetSender();
        const s = await event("6");
        clearJobs();
        const step = async (id, outcome, code = null, pid = null) => {
          sql(
            `update app.email_jobs set next_attempt_at=clock_timestamp()-interval '1 second' where id='${id}' and state='queued';`,
          );
          await claim(5);
          const b = await rpc("begin_email_attempt", {
            p_holder: holder,
            p_job: id,
            p_payload: { to: "a@x" },
          });
          assert.equal(b.go, true);
          await rpc("finish_email_attempt", {
            p_holder: holder,
            p_job: id,
            p_outcome: outcome,
            p_code: code,
            p_provider_id: pid,
            p_retry_after_seconds: null,
          });
          return row(id);
        };
        const one = newJob(s, actors[0]);
        let j = await step(one, "ambiguous", "timeout");
        assert.equal(j.state, "queued");
        assert.equal(j.ambiguous, true);
        j = await step(one, "permanent", "invalid");
        assert.equal(j.state, "not_confirmed");
        assert.equal(j.reason, "rejected");
        assert.equal(j.payload, null);
        const two = newJob(s, actors[1]);
        await step(two, "ambiguous", "network");
        j = await step(two, "accepted", null, "provider-2");
        assert.equal(j.state, "sent");
        assert.equal(j.provider_id, "provider-2");
        // Exhausted, missing recipient and delivery-off endings stay Not confirmed too.
        const three = newJob(s, actors[2]);
        await step(three, "ambiguous", "timeout");
        await step(three, "transient", "http_503");
        j = await step(three, "transient", "http_503");
        assert.equal(j.state, "not_confirmed");
        assert.equal(j.reason, "attempts_exhausted");
        const four = newJob(s, actors[3]);
        await step(four, "ambiguous", "timeout");
        j = await step(four, "recipient_missing");
        assert.equal(j.state, "not_confirmed");
        // Waiting past expiry, or being superseded, after an unknown outcome is also Not confirmed.
        const five = newJob(s, actors[4]);
        await step(five, "ambiguous", "timeout");
        sql(
          `update app.email_jobs set expires_at=clock_timestamp()-interval '1 second' where id='${five}';`,
        );
        await claim(5);
        assert.equal(row(five).state, "not_confirmed");
        assert.equal(row(five).reason, "expired");
        // An unplain plain job expires as Not sent.
        const plain = newJob(s, actors[5]);
        sql(
          `update app.email_jobs set expires_at=clock_timestamp()-interval '1 second' where id='${plain}';`,
        );
        await claim(5);
        assert.equal(row(plain).state, "not_sent");
        assert.equal(row(plain).reason, "expired");
        resetSender();
        clearJobs();
      },
    );

    await t.test(
      "a holder that vanishes mid-attempt leaves an unknown outcome and a stale finish does nothing",
      async () => {
        resetSender();
        const s = await event("6");
        clearJobs();
        const A = uuid(),
          B = uuid();
        // A claims and begins, then disappears.
        const id = newJob(s, actors[0]);
        await claim(5, A);
        await rpc("begin_email_attempt", {
          p_holder: A,
          p_job: id,
          p_payload: { to: "a@x" },
        });
        sql(
          `update app.email_sender set lease_until=clock_timestamp()-interval '1 second';update app.email_jobs set lease_until=clock_timestamp()-interval '1 second' where id='${id}';`,
        );
        const taken = await claim(5, B);
        const again = taken.jobs.find((j) => j.id === id);
        assert.ok(again, "B gets the job back");
        assert.equal(
          again.ambiguous,
          true,
          "The request may have left, so the outcome is unknown",
        );
        assert.deepEqual(again.payload, { to: "a@x" });
        assert.equal(again.attempts, 1);
        // A's late result must not touch a job it no longer holds.
        await rpc("finish_email_attempt", {
          p_holder: A,
          p_job: id,
          p_outcome: "accepted",
          p_code: null,
          p_provider_id: "late",
          p_retry_after_seconds: null,
        });
        assert.equal(row(id).state, "sending");
        assert.equal(row(id).provider_id, null);
        assert.deepEqual(
          await rpc("begin_email_attempt", {
            p_holder: A,
            p_job: id,
            p_payload: { to: "a@x" },
          }),
          { go: false, payload: null, waitMs: 0, reason: "lease_lost" },
        );
        await rpc("finish_email_attempt", {
          p_holder: B,
          p_job: id,
          p_outcome: "permanent",
          p_code: "x",
          p_provider_id: null,
          p_retry_after_seconds: null,
        });
        assert.equal(row(id).state, "not_confirmed");
        // A job claimed but never begun simply returns to the line, plain.
        const quiet = newJob(s, actors[1]);
        await claim(5, B);
        sql(
          `update app.email_sender set lease_until=clock_timestamp()-interval '1 second';update app.email_jobs set lease_until=clock_timestamp()-interval '1 second' where id='${quiet}';`,
        );
        const next = await claim(5, A);
        assert.equal(next.jobs.find((j) => j.id === quiet)?.ambiguous, false);
        // A job at its third attempt that lost its holder cannot try a fourth time.
        const third = newJob(s, actors[2]);
        sql(
          `update app.email_jobs set attempts=3,payload='{"to":"a@x"}',state='sending',reason='attempting',lease_until=clock_timestamp()-interval '1 second' where id='${third}';`,
        );
        await claim(5, A);
        assert.equal(row(third).state, "not_confirmed");
        assert.equal(row(third).reason, "attempts_exhausted");
        assert.equal(row(third).payload, null);
        resetSender();
        clearJobs();
      },
    );

    await t.test(
      "the frozen payload never changes and a new address suppresses the job",
      async () => {
        resetSender();
        const s = await event("6");
        clearJobs();
        const id = newJob(s, actors[0]);
        await claim(5);
        const first = await rpc("begin_email_attempt", {
          p_holder: holder,
          p_job: id,
          p_payload: { to: "a@x", body: "original" },
        });
        assert.deepEqual(first.payload, { to: "a@x", body: "original" });
        await rpc("finish_email_attempt", {
          p_holder: holder,
          p_job: id,
          p_outcome: "transient",
          p_code: "http_503",
          p_provider_id: null,
          p_retry_after_seconds: null,
        });
        sql(
          `update app.email_jobs set next_attempt_at=clock_timestamp() where id='${id}';`,
        );
        const handed = await claim(5);
        assert.deepEqual(handed.jobs.find((j) => j.id === id).payload, {
          to: "a@x",
          body: "original",
        });
        const retry = await rpc("begin_email_attempt", {
          p_holder: holder,
          p_job: id,
          p_payload: { to: "a@x", body: "rewritten" },
        });
        assert.equal(retry.go, true);
        assert.deepEqual(
          retry.payload,
          { to: "a@x", body: "original" },
          "Same address: the old payload is reused unchanged",
        );
        assert.deepEqual(row(id).payload, { to: "a@x", body: "original" });
        await rpc("finish_email_attempt", {
          p_holder: holder,
          p_job: id,
          p_outcome: "transient",
          p_code: "http_503",
          p_provider_id: null,
          p_retry_after_seconds: null,
        });
        sql(
          `update app.email_jobs set next_attempt_at=clock_timestamp() where id='${id}';`,
        );
        await claim(5);
        const spent = budget();
        const moved = await rpc("begin_email_attempt", {
          p_holder: holder,
          p_job: id,
          p_payload: { to: "b@x", body: "new" },
        });
        assert.equal(moved.go, false);
        assert.equal(moved.reason, "destination_changed");
        assert.equal(row(id).state, "not_sent");
        assert.equal(row(id).reason, "destination_changed");
        assert.equal(row(id).payload, null);
        assert.equal(budget(), spent, "Nothing was attempted");
        resetSender();
        clearJobs();
      },
    );

    await t.test("delivery off marks due jobs Not sent", async () => {
      resetSender();
      const s = await event("6");
      clearJobs();
      const plain = newJob(s, actors[0]),
        unknown = newJob(s, actors[1], { ambiguous: true }),
        later = newJob(s, actors[2]);
      sql(
        `update app.email_jobs set next_attempt_at=clock_timestamp()+interval '1 hour' where id='${later}';`,
      );
      const other = uuid();
      await claim(0, other);
      assert.equal(
        await rpc("disable_due_emails", { p_holder: holder }),
        0,
        "Another holder owns the lease",
      );
      resetSender();
      assert.equal(await rpc("disable_due_emails", { p_holder: holder }), 2);
      assert.deepEqual(
        [row(plain), row(unknown), row(later)].map(
          (j) => `${j.state}:${j.reason}`,
        ),
        [
          "not_sent:delivery_disabled",
          "not_confirmed:delivery_disabled",
          "queued:null",
        ],
      );
      assert.equal(await rpc("disable_due_emails", { p_holder: holder }), 0);
      resetSender();
      clearJobs();
    });

    await t.test(
      "only the service role can call dispatch functions",
      async () => {
        const calls = {
          claim_email_jobs: { p_holder: uuid(), p_limit: 5 },
          begin_email_attempt: {
            p_holder: uuid(),
            p_job: uuid(),
            p_payload: {},
          },
          finish_email_attempt: {
            p_holder: uuid(),
            p_job: uuid(),
            p_outcome: "accepted",
            p_code: null,
            p_provider_id: null,
            p_retry_after_seconds: null,
          },
          release_email_sender: { p_holder: uuid() },
          disable_due_emails: { p_holder: uuid() },
        };
        for (const [name, args] of Object.entries(calls)) {
          const { error } = await client().schema("api").rpc(name, args);
          assert.ok(
            ["42501", "PGRST202"].includes(error?.code),
            `${name}: ${error?.code}`,
          );
        }
        const signed = createClient(
          env.SUPABASE_URL,
          env.SUPABASE_PUBLISHABLE_KEY,
          {
            auth: { persistSession: false, autoRefreshToken: false },
            global: { headers: { Authorization: `Bearer ${actors[0].token}` } },
          },
        );
        for (const [name, args] of Object.entries(calls)) {
          const { error } = await signed.schema("api").rpc(name, args);
          assert.ok(
            ["42501", "PGRST202"].includes(error?.code),
            `${name} (signed in): ${error?.code}`,
          );
        }
        assert.equal(
          sql(
            `select bool_or(has_function_privilege(r,f,'execute')) from unnest(array['anon','authenticated']) r, unnest(array['api.claim_email_jobs(uuid,integer)','api.begin_email_attempt(uuid,uuid,jsonb)','api.finish_email_attempt(uuid,uuid,text,text,text,integer)','api.release_email_sender(uuid)','api.disable_due_emails(uuid)','app.email_take_lease(uuid)','app.email_end_job(uuid,text)','app.email_defer_job(uuid,timestamptz,text)','app.email_open_circuit(boolean,timestamptz)','app.email_settle_jobs(timestamptz)']) f;`,
          ),
          "f",
        );
        assert.equal(
          sql(
            `select bool_and(has_function_privilege('service_role',f,'execute')) from unnest(array['api.claim_email_jobs(uuid,integer)','api.begin_email_attempt(uuid,uuid,jsonb)','api.finish_email_attempt(uuid,uuid,text,text,text,integer)','api.release_email_sender(uuid)','api.disable_due_emails(uuid)']) f;`,
          ),
          "t",
        );
        for (const table of ["email_sender", "email_budget"]) {
          assert.equal(
            sql(
              `select relrowsecurity and not (has_table_privilege('anon','app.${table}','select,insert,update,delete') or has_table_privilege('authenticated','app.${table}','select,insert,update,delete')) and has_table_privilege('service_role','app.${table}','select,update') from pg_class where oid='app.${table}'::regclass;`,
            ),
            "t",
          );
        }
        assert.equal(sql(`select count(*) from app.email_sender;`), "1");
      },
    );
  } finally {
    clearJobs();
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
