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
function details(capacity, extra = {}) {
  const now = Date.now();
  return {
    title: "Synthetic email queue test",
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
    paymentMode: "organizer",
    releaseUnpaid: true,
    ...extra,
  };
}
/**
 * Synthetic fixtures move a booked time to cross a boundary; the trigger that
 * freezes booked details is switched off only for that one update.
 */
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
/** The cutoff is now: everyone booked so far booked before it, and anyone joining next is after it. */
const cutoffPassed = (id) => shift(id, "cutoffAt", "'0 seconds'");

test("signals leave one durable, private email job per recipient", async (t) => {
  const organizer = await login("organizer@rallypoint.test"),
    actors = [],
    events = [],
    extraUsers = [];
  const nonce = crypto.randomUUID().slice(0, 8);
  async function event(capacity = "6", extra = {}) {
    const r = await request(`/api/groups/${firstGroup}/sessions`, organizer, {
      operationKey: crypto.randomUUID(),
      groupId: firstGroup,
      intent: "publish",
      details: details(capacity, extra),
    });
    assert.equal(r.status, 200, await r.clone().text());
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
    assert.equal(r.status, 200, await r.clone().text());
    return (await r.json()).registration.own;
  }
  const withdraw = async (s, a, party) => {
    const r = await request(`/api/registrations/${s.slug}/withdraw`, a, {
      operationKey: crypto.randomUUID(),
      partyId: party.id,
    });
    assert.equal(r.status, 200, await r.clone().text());
  };
  const cancel = (s) =>
    request(`/api/sessions/${s.id}/cancel`, organizer, {
      operationKey: crypto.randomUUID(),
    });
  const saveInstructions = async (s, revision, text) => {
    const r = await request(
      `/api/sessions/${s.id}/payment-instructions`,
      organizer,
      {
        operationKey: crypto.randomUUID(),
        revision,
        action: "save",
        text,
      },
    );
    assert.equal(r.status, 200, await r.clone().text());
  };
  /** Jobs for one session as "kind:user:state" lines, easiest to compare as sets. */
  const jobs = (s, kind) =>
    sql(
      `select coalesce(string_agg(user_id::text||':'||state||':'||coalesce(reason,''),',' order by user_id),'') from app.email_jobs where session_id='${s.id}' and kind='${kind}';`,
    )
      .split(",")
      .filter(Boolean);
  const users = (s, kind) =>
    jobs(s, kind)
      .map((j) => j.split(":")[0])
      .sort();
  const count = (s, kind) =>
    Number(
      sql(
        `select count(*) from app.email_jobs where session_id='${s.id}' and kind='${kind}';`,
      ),
    );
  const ids = (...list) => list.map((a) => a.id).sort();
  async function account(label) {
    const email = `outbox-${nonce}-${label}@rallypoint.test`;
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
    for (let i = 0; i < 6; i++) {
      const a = await account(`p${i}`);
      extraUsers.push(a.id);
      actors.push(await login(a.email));
    }

    await t.test(
      "a confirmed join, a waitlisted join, a promotion and a release each queue one email for the primary",
      async () => {
        const s = await event("2"),
          a = await join(s, actors[0]),
          b = await join(s, actors[1], 2);
        assert.equal(b.state, "waitlisted");
        assert.deepEqual(users(s, "joined_confirmed"), ids(actors[0]));
        assert.deepEqual(users(s, "joined_waitlisted"), ids(actors[1]));
        assert.equal(count(s, "promoted"), 0);
        await withdraw(s, actors[0], a);
        assert.equal((await view(s, actors[1])).own.state, "confirmed");
        assert.deepEqual(jobs(s, "promoted"), [`${actors[1].id}:queued:`]);
        assert.deepEqual(jobs(s, "joined_confirmed"), [
          `${actors[0].id}:queued:`,
        ]);
        assert.equal(count(s, "released"), 0);
        assert.equal(
          sql(
            `select count(*) from app.email_jobs where session_id='${s.id}' and (user_id is null or party_id is null);`,
          ),
          "0",
        );
        // The promoted party's own job points at that party, not at the guest.
        assert.equal(
          sql(
            `select count(distinct party_id) from app.email_jobs where session_id='${s.id}' and kind in ('joined_waitlisted','promoted');`,
          ),
          "1",
        );
        cutoffPassed(s.id);
        const r = await request(
          `/api/registrations/${s.slug}/release`,
          organizer,
          {
            operationKey: crypto.randomUUID(),
            partyId: b.id,
            revision: 1,
            noteSentAt: null,
          },
        );
        assert.equal(r.status, 200, await r.clone().text());
        assert.deepEqual(jobs(s, "released"), [`${actors[1].id}:queued:`]);
        assert.equal(
          sql(
            `select count(*) from app.email_jobs where session_id='${s.id}';`,
          ),
          "4",
          "Withdrawing queues nothing of its own",
        );
        assert.equal(
          sql(
            `select count(*) from app.email_jobs where session_id='${s.id}' and (payload is not null or provider_id is not null or attempts<>0 or ambiguous or lease_until is not null);`,
          ),
          "0",
          "A new job holds no address, body or attempt",
        );
      },
    );

    await t.test("a replayed join queues nothing new", async () => {
      const s = await event("2"),
        key = crypto.randomUUID();
      const body = {
        operationKey: key,
        version: s.version,
        seats: 1,
        guestName: "",
        consent: true,
      };
      for (let i = 0; i < 2; i++)
        assert.equal(
          (await request(`/api/registrations/${s.slug}`, actors[0], body))
            .status,
          200,
        );
      assert.equal(count(s, "joined_confirmed"), 1);
      assert.equal(
        sql(`select count(*) from app.email_jobs where session_id='${s.id}';`),
        "1",
      );
    });

    await t.test(
      "join and promotion expire at the earlier of start or 23 hours",
      async () => {
        const now = Date.now();
        const soon = await event("2", {
          startLocal: local(now + 2 * 3600000),
          endLocal: local(now + 3 * 3600000),
          cutoffLocal: local(now + 3600000),
        });
        await join(soon, actors[0]);
        assert.equal(
          sql(
            `select j.expires_at=(s.details->>'startsAt')::timestamptz from app.email_jobs j join app.sessions s on s.id=j.session_id where j.session_id='${soon.id}';`,
          ),
          "t",
          "A session starting in 2 hours stops the email at its start",
        );
        const later = await event("2", {
          startLocal: local(now + 48 * 3600000),
          endLocal: local(now + 50 * 3600000),
          cutoffLocal: local(now + 24 * 3600000),
        });
        await join(later, actors[0]);
        assert.equal(
          sql(
            `select abs(extract(epoch from j.expires_at-(j.created_at+interval '23 hours')))<5 from app.email_jobs j where j.session_id='${later.id}';`,
          ),
          "t",
          "A session starting in 48 hours stops the email after 23 hours",
        );
        assert.equal(
          sql(
            `select j.next_attempt_at=j.created_at from app.email_jobs j where j.session_id='${later.id}';`,
          ),
          "t",
          "The first attempt is due at once",
        );
      },
    );

    await t.test(
      "cancellation reaches active primaries and those whose unpaid fee it ended, once each",
      async () => {
        const s = await event("6");
        await join(s, actors[0]); // A: stays confirmed
        const c = await join(s, actors[2]); // C: withdraws after the cutoff
        const d = await join(s, actors[3]); // D: withdraws before the cutoff
        const e = await join(s, actors[4]); // E: has two parties over time
        await withdraw(s, actors[3], d);
        cutoffPassed(s.id);
        await withdraw(s, actors[2], c);
        await withdraw(s, actors[4], e);
        await join(s, actors[4]);
        const b = await join(s, actors[1], 2); // B: waitlisted
        sql(`update app.parties set state='waitlisted' where id='${b.id}';`);
        assert.equal(count(s, "cancelled"), 0);
        const r = await cancel(s);
        assert.equal(r.status, 200, await r.clone().text());
        assert.deepEqual(
          users(s, "cancelled"),
          ids(actors[0], actors[1], actors[2], actors[4]),
          "Active primaries and the primary whose retained fee ended; not the one who left before the cutoff",
        );
        assert.equal(
          sql(
            `select count(*) from app.email_jobs where session_id='${s.id}' and kind='cancelled' and state='queued' and abs(extract(epoch from expires_at-(created_at+interval '23 hours')))<5 and party_id is null;`,
          ),
          "4",
        );
        // A repeated cancellation adds nothing.
        assert.equal((await cancel(s)).status, 200);
        assert.equal(count(s, "cancelled"), 4);
      },
    );

    await t.test("a draft cancellation queues nothing", async () => {
      const r = await request(`/api/groups/${firstGroup}/sessions`, organizer, {
        operationKey: crypto.randomUUID(),
        groupId: firstGroup,
        intent: "draft",
        details: details("2"),
      });
      assert.equal(r.status, 200, await r.clone().text());
      const draft = (await r.json()).session;
      events.push(draft.id);
      assert.equal((await cancel(draft)).status, 200);
      assert.equal(
        sql(
          `select count(*) from app.email_jobs where session_id='${draft.id}';`,
        ),
        "0",
      );
      assert.equal(
        sql(
          `select count(*) from app.email_suppressions where session_id='${draft.id}';`,
        ),
        "0",
      );
    });

    await t.test(
      "instruction changes after booking queue one email per active primary, combining unsent changes",
      async () => {
        const s = await event("2");
        await join(s, actors[0]);
        const b = await join(s, actors[1], 2);
        assert.equal(b.state, "waitlisted");
        await saveInstructions(s, 0, "Synthetic bank 1");
        assert.deepEqual(
          users(s, "instructions_changed"),
          ids(actors[0], actors[1]),
        );
        await saveInstructions(s, 1, "Synthetic bank 2");
        assert.equal(
          count(s, "instructions_changed"),
          2,
          "A second change while the first is unattempted adds none",
        );
        sql(
          `update app.email_jobs set state='sent' where session_id='${s.id}' and kind='instructions_changed' and user_id='${actors[0].id}';`,
        );
        await saveInstructions(s, 2, "Synthetic bank 3");
        assert.equal(
          sql(
            `select count(*) from app.email_jobs where session_id='${s.id}' and kind='instructions_changed' and user_id='${actors[0].id}';`,
          ),
          "2",
          "After the first was sent, a new change queues a new email",
        );
        assert.equal(
          sql(
            `select count(*) from app.email_jobs where session_id='${s.id}' and kind='instructions_changed' and user_id='${actors[1].id}';`,
          ),
          "1",
        );
        assert.equal(
          sql(
            `select count(*) from app.email_jobs where session_id='${s.id}' and kind='instructions_changed' and state='queued' and abs(extract(epoch from expires_at-(created_at+interval '23 hours')))<5;`,
          ),
          "2",
        );
      },
    );

    await t.test(
      "more than 50 recipients suppresses the whole session-wide update",
      async () => {
        const s = await event("100");
        const crowd = [];
        for (let i = 0; i < 51; i++) {
          const a = await account(`c${i}`);
          crowd.push(a.id);
          extraUsers.push(a.id);
        }
        sql(
          crowd
            .map(
              (id, i) =>
                `insert into app.parties(session_id,user_id,primary_name,seats,state,queue_sequence,consent_version,consent_at) values('${s.id}','${id}','Synthetic ${i}',1,'confirmed',${i + 1},${s.version},now());`,
            )
            .join(""),
        );
        assert.equal((await cancel(s)).status, 200);
        assert.equal(count(s, "cancelled"), 0);
        assert.equal(
          sql(
            `select count(*)||':'||min(reason)||':'||min(recipients)||':'||min(kind) from app.email_suppressions where session_id='${s.id}';`,
          ),
          "1:audience_limit:51:cancelled",
        );
      },
    );

    await t.test(
      "job 501 is suppressed with queue_capacity evidence and the join still commits",
      async () => {
        const s = await event("2");
        const active = Number(
          sql(
            `select count(*) from app.email_jobs where state in ('queued','sending');`,
          ),
        );
        sql(
          `insert into app.email_jobs(kind,session_id,user_id,source_key,state,next_attempt_at,expires_at)
            select 'reminder','${s.id}','${actors[5].id}','filler-'||g,'queued',now(),now()+interval '1 day' from generate_series(1,${500 - active}) g;`,
        );
        try {
          assert.equal(
            sql(
              `select count(*) from app.email_jobs where state in ('queued','sending');`,
            ),
            "500",
          );
          const own = await join(s, actors[0]);
          assert.equal(own.state, "confirmed");
          assert.deepEqual(jobs(s, "joined_confirmed"), [
            `${actors[0].id}:not_sent:queue_capacity`,
          ]);
          assert.equal(
            sql(
              `select count(*) from app.email_jobs where state in ('queued','sending');`,
            ),
            "500",
            "A suppressed job does not count as waiting",
          );
        } finally {
          sql(
            `delete from app.email_jobs where session_id='${s.id}' and source_key like 'filler-%';`,
          );
        }
      },
    );

    await t.test("only the service role can reach the outbox", () => {
      for (const table of ["email_jobs", "email_suppressions"]) {
        assert.equal(
          sql(
            `select relrowsecurity and not (has_table_privilege('anon','app.${table}','select,insert,update,delete') or has_table_privilege('authenticated','app.${table}','select,insert,update,delete')) and has_table_privilege('service_role','app.${table}','select,insert') from pg_class where oid='app.${table}'::regclass;`,
          ),
          "t",
        );
      }
      assert.equal(
        sql(
          `select has_function_privilege('authenticated','app.enqueue_email(text,uuid,uuid,uuid,text,timestamptz)','execute') or has_function_privilege('anon','app.enqueue_bulk(text,uuid,text,uuid[],timestamptz)','execute');`,
        ),
        "f",
      );
    });
  } finally {
    if (events.length) {
      const list = events.map((id) => `'${id}'`).join(",");
      const parties = `select id from app.parties where session_id in(${list})`;
      sql(
        `begin;delete from app.email_jobs where session_id in(${list});delete from app.email_suppressions where session_id in(${list});delete from app.payment_notes where party_id in(${parties});delete from app.operation_receipts where resource_id in(${parties}) or resource_id in(${list});delete from app.attendance_changes where party_id in(${parties});delete from app.seat_attendance where party_id in(${parties});delete from app.fee_changes where party_id in(${parties});delete from app.registration_events where party_id in(${parties});delete from app.fee_obligations where party_id in(${parties});delete from app.parties where session_id in(${list});delete from app.session_changes where session_id in(${list});delete from app.sessions where id in(${list});commit;`,
      );
    }
    for (const id of extraUsers) await admin.auth.admin.deleteUser(id);
  }
});
