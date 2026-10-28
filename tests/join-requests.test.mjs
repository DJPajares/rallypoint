import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import {
  localEnv,
  fixturePassword,
  firstGroup,
} from "../scripts/local-env.mjs";

// P-34 Ask to join, end to end through the API with synthetic accounts only.
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
  const client = createClient(
    env.SUPABASE_URL,
    env.SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await client.auth.signInWithPassword({
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
const details = (over = {}) => {
  const now = Date.now();
  return {
    title: "Synthetic ask-to-join test",
    activity: "Workshop",
    startLocal: local(now + 86400000),
    endLocal: local(now + 93600000),
    timeZone: "UTC",
    location: "Synthetic room",
    instructions: "Test only",
    capacity: "4",
    openLocal: local(now - 3600000),
    cutoffLocal: local(now + 43200000),
    fee: "5.00",
    currency: "SGD",
    guests: true,
    joinMode: "request",
    ...over,
  };
};

test("ask to join contract", async (t) => {
  const organizer = await login("organizer@rallypoint.test"),
    sessions = [],
    users = [];
  const nonce = crypto.randomUUID().slice(0, 8);
  t.after(() => {
    if (!sessions.length && !users.length) return;
    const ids = sessions.map((id) => `'${id}'`).join(",") || "null";
    const of = `(select id from app.parties where session_id in (${ids}))`;
    sql(`begin;
      delete from app.join_requests where session_id in (${ids});
      delete from app.operation_receipts where resource_id in (${ids}) or resource_id in ${of};
      delete from app.email_jobs where session_id in (${ids});
      delete from app.seat_attendance where party_id in ${of};
      delete from app.fee_changes where party_id in ${of};
      delete from app.fee_obligations where party_id in ${of};
      delete from app.registration_events where party_id in ${of};
      delete from app.parties where session_id in (${ids});
      delete from app.session_changes where session_id in (${ids});
      delete from app.sessions where id in (${ids});
      ${users.map((id) => `delete from app.group_roles where user_id='${id}'; delete from auth.users where id='${id}';`).join("\n")}
      commit;`);
  });
  async function person(i) {
    const email = `p34-${nonce}-${i}@rallypoint.test`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: fixturePassword,
      email_confirm: true,
      user_metadata: { full_name: `Synthetic asker ${i}` },
    });
    assert.ok(!error && data.user);
    users.push(data.user.id);
    return login(email);
  }
  const [a, b, c, d] = await Promise.all([
    person(1),
    person(2),
    person(3),
    person(4),
  ]);
  async function event(over = {}) {
    const r = await request(`/api/groups/${firstGroup}/sessions`, organizer, {
      operationKey: crypto.randomUUID(),
      groupId: firstGroup,
      intent: "publish",
      details: details(over),
    });
    assert.equal(r.status, 200, await r.clone().text());
    const s = (await r.json()).session;
    sessions.push(s.id);
    return s;
  }
  const path = (s, rest = "") => `/api/registrations/${s.slug}${rest}`;
  const party = (seats = 1) => ({
    operationKey: crypto.randomUUID(),
    seats,
    guestName: seats === 2 ? "Guest" : "",
    consent: true,
  });
  const ask = (s, who, seats = 1, key) =>
    request(path(s, "/requests"), who, {
      ...party(seats),
      version: s.version,
      ...(key ? { operationKey: key } : {}),
    });
  const pendingId = (s, who) =>
    sql(
      `select id from app.join_requests where session_id='${s.id}' and user_id='${who.id}' and state='pending';`,
    );
  const answer = (s, who, verb, requestId, key = crypto.randomUUID()) =>
    request(path(s, `/requests/${verb}`), who, {
      operationKey: key,
      requestId,
    });
  const own = async (s, who) =>
    (await (await request(path(s), who)).json()).registration.own;

  await t.test("a direct join is refused on a request session", async () => {
    const s = await event();
    const r = await request(path(s), a, { ...party(), version: s.version });
    assert.equal(r.status, 409);
    assert.equal((await r.json()).error.code, "request_required");
    const o = await request(path(s), organizer, {
      ...party(),
      version: s.version,
    });
    assert.equal(o.status, 200);
  });

  await t.test("a request holds no seat and a repeat ask is the same request", async () => {
    const s = await event();
    const first = await ask(s, a);
    assert.equal(first.status, 200, await first.clone().text());
    const id = pendingId(s, a);
    assert.ok(id);
    assert.equal((await ask(s, a)).status, 200);
    assert.equal(pendingId(s, a), id);
    const shared = await (await request(`/api/shared/${s.slug}`)).json();
    assert.deepEqual(shared.session.counts, {
      confirmedSeats: 0,
      waitingParties: 0,
    });
  });

  await t.test("accept places the party and queues no email", async () => {
    const s = await event();
    await ask(s, a);
    const r = await answer(s, organizer, "accept", pendingId(s, a));
    assert.equal(r.status, 200, await r.clone().text());
    assert.deepEqual((await r.json()).accepted, {
      name: "Synthetic asker 1",
      state: "confirmed",
      queuePosition: null,
    });
    assert.equal((await own(s, a)).state, "confirmed");
    assert.equal(
      sql(`select count(*) from app.email_jobs where session_id='${s.id}';`),
      "0",
    );
  });

  await t.test("accepting into a full session waitlists at the back", async () => {
    const s = await event({ capacity: "1" });
    await ask(s, a);
    await ask(s, b);
    assert.equal(
      (await answer(s, organizer, "accept", pendingId(s, b))).status,
      200,
    );
    const r = await answer(s, organizer, "accept", pendingId(s, a));
    assert.equal((await r.json()).accepted.queuePosition, 1);
    const mine = await own(s, a);
    assert.equal(mine.state, "waitlisted");
    assert.equal(mine.queuePosition, 1);
  });

  await t.test("two accepts racing the last seat leave one seat taken", async () => {
    const s = await event({ capacity: "1" });
    await ask(s, a);
    await ask(s, b);
    const cohost = await login("member@rallypoint.test");
    sql(
      `update app.group_roles set role='cohost' where group_id='${firstGroup}' and user_id='${cohost.id}';`,
    );
    try {
      const [x, y] = await Promise.all([
        answer(s, organizer, "accept", pendingId(s, a)),
        answer(s, cohost, "accept", pendingId(s, b)),
      ]);
      assert.equal(x.status, 200);
      assert.equal(y.status, 200);
      const states = [(await own(s, a)).state, (await own(s, b)).state].sort();
      assert.deepEqual(states, ["confirmed", "waitlisted"]);
      assert.equal(
        sql(
          `select sum(seats) from app.parties where session_id='${s.id}' and state='confirmed';`,
        ),
        "1",
      );
    } finally {
      sql(
        `update app.group_roles set role='member' where group_id='${firstGroup}' and user_id='${cohost.id}';`,
      );
    }
  });

  await t.test("accept is idempotent and a second manager gets not pending", async () => {
    const s = await event();
    await ask(s, a);
    const id = pendingId(s, a),
      key = crypto.randomUUID();
    assert.equal((await answer(s, organizer, "accept", id, key)).status, 200);
    assert.equal((await answer(s, organizer, "accept", id, key)).status, 200);
    const again = await answer(s, organizer, "accept", id);
    assert.equal(again.status, 409);
    assert.equal((await again.json()).error.code, "request_not_pending");
    assert.equal(
      sql(
        `select count(*) from app.parties where session_id='${s.id}' and user_id='${a.id}';`,
      ),
      "1",
    );
  });

  await t.test("accept links a booking made while the session was direct", async () => {
    const s = await event({ joinMode: "direct" });
    assert.equal(
      (await request(path(s), a, { ...party(), version: s.version })).status,
      200,
    );
    const stale = sql(
      `insert into app.join_requests(session_id,user_id,primary_name,seats,consent_version,consent_at)
       values('${s.id}','${a.id}','Synthetic asker 1',1,${s.version},now()) returning id;`,
    );
    assert.equal((await answer(s, organizer, "accept", stale)).status, 200);
    assert.equal(
      sql(
        `select count(*) from app.parties where session_id='${s.id}' and user_id='${a.id}';`,
      ),
      "1",
    );
    assert.equal(
      sql(
        `select r.party_id=p.id from app.join_requests r join app.parties p on p.session_id=r.session_id and p.user_id=r.user_id where r.id='${stale}';`,
      ),
      "t",
    );
  });

  await t.test("switching to join directly keeps pending requests", async () => {
    const s = await event();
    await ask(s, a);
    const id = pendingId(s, a);
    const r = await request(`/api/sessions/${s.id}`, organizer, {
      operationKey: crypto.randomUUID(),
      groupId: firstGroup,
      intent: "update",
      version: s.version,
      details: { ...s.details, joinMode: "direct" },
    });
    assert.equal(r.status, 200, await r.clone().text());
    const updated = (await r.json()).session;
    assert.equal(pendingId(s, a), id);
    assert.equal(
      (await request(path(s), b, { ...party(), version: updated.version }))
        .status,
      200,
    );
    assert.equal((await answer(s, organizer, "accept", id)).status, 200);
  });

  await t.test("only the session's managers answer requests", async () => {
    const s = await event();
    await ask(s, a);
    const id = pendingId(s, a);
    const member = await login("member@rallypoint.test"),
      outsider = await login("outsider@rallypoint.test");
    for (const verb of ["accept", "decline"]) {
      assert.equal((await answer(s, member, verb, id)).status, 403);
      assert.equal((await answer(s, outsider, verb, id)).status, 403);
      assert.equal((await answer(s, b, verb, id)).status, 403);
      assert.equal((await answer(s, null, verb, id)).status, 401);
    }
    const rest = (who) =>
      request(path(s, "/requests/decline-rest"), who, {
        operationKey: crypto.randomUUID(),
      });
    assert.equal((await rest(member)).status, 403);
    assert.equal((await rest(null)).status, 401);
    assert.equal(pendingId(s, a), id);
  });

  await t.test("a declined person can't ask again", async () => {
    const s = await event();
    await ask(s, a);
    assert.equal(
      (await answer(s, organizer, "decline", pendingId(s, a))).status,
      200,
    );
    const r = await ask(s, a);
    assert.equal(r.status, 409);
    assert.equal((await r.json()).error.code, "request_declined");
  });

  await t.test("two cancels end asking for that session", async () => {
    const s = await event();
    for (let i = 0; i < 2; i++) {
      assert.equal((await ask(s, a)).status, 200);
      assert.equal(
        (
          await request(path(s, "/requests/cancel"), a, {
            operationKey: crypto.randomUUID(),
            requestId: pendingId(s, a),
          })
        ).status,
        200,
      );
    }
    const r = await ask(s, a);
    assert.equal(r.status, 409);
    assert.equal((await r.json()).error.code, "request_cancel_limit");
  });

  await t.test("ten waiting requests is the most one person can have", async () => {
    const s = await event();
    const others = [];
    for (let i = 0; i < 10; i++) others.push(await event());
    sql(
      others
        .map(
          (o) =>
            `insert into app.join_requests(session_id,user_id,primary_name,seats,consent_version,consent_at) values('${o.id}','${c.id}','Synthetic asker 3',1,${o.version},now());`,
        )
        .join("\n"),
    );
    const r = await ask(s, c);
    assert.equal(r.status, 409);
    assert.equal((await r.json()).error.code, "request_limit");
  });

  await t.test("a material change needs the requester to keep the request", async () => {
    const s = await event();
    await ask(s, a);
    const id = pendingId(s, a);
    const moved = await request(`/api/sessions/${s.id}`, organizer, {
      operationKey: crypto.randomUUID(),
      groupId: firstGroup,
      intent: "update",
      version: s.version,
      details: { ...s.details, location: "Another synthetic room" },
    });
    assert.equal(moved.status, 200, await moved.clone().text());
    const updated = (await moved.json()).session;
    const blocked = await answer(s, organizer, "accept", id);
    assert.equal(blocked.status, 409);
    assert.equal((await blocked.json()).error.code, "request_needs_confirm");
    const keep = await request(path(s, "/requests/keep"), a, {
      operationKey: crypto.randomUUID(),
      requestId: id,
      version: updated.version,
    });
    assert.equal(keep.status, 200, await keep.clone().text());
    assert.equal((await answer(s, organizer, "accept", id)).status, 200);
  });

  await t.test("asking and accepting stop at the start", async () => {
    const s = await event();
    await ask(s, a);
    const id = pendingId(s, a);
    sql(
      `update app.sessions set details=jsonb_set(details,'{startsAt}',to_jsonb((now()-interval '1 minute')::text)) where id='${s.id}';`,
    );
    const late = await ask(s, b);
    assert.equal(late.status, 409);
    assert.equal((await late.json()).error.code, "registration_closed");
    const accept = await answer(s, organizer, "accept", id);
    assert.equal(accept.status, 409);
    assert.equal((await accept.json()).error.code, "registration_closed");
  });

  await t.test("decline the rest declines only what is still waiting", async () => {
    const s = await event();
    await ask(s, a);
    await ask(s, b);
    await ask(s, d);
    assert.equal(
      (await answer(s, organizer, "accept", pendingId(s, a))).status,
      200,
    );
    const key = crypto.randomUUID();
    const rest = () =>
      request(path(s, "/requests/decline-rest"), organizer, {
        operationKey: key,
      });
    const r = await rest();
    assert.equal(r.status, 200);
    assert.equal((await r.json()).declined, 2);
    assert.equal((await (await rest()).json()).declined, 2);
    assert.equal((await own(s, a)).state, "confirmed");
  });

  await t.test("a booked session may switch who can join", async () => {
    const s = await event({ joinMode: "direct" });
    await request(path(s), a, { ...party(), version: s.version });
    const r = await request(`/api/sessions/${s.id}`, organizer, {
      operationKey: crypto.randomUUID(),
      groupId: firstGroup,
      intent: "update",
      version: s.version,
      details: { ...s.details, joinMode: "request" },
    });
    assert.equal(r.status, 200, await r.clone().text());
    assert.equal(
      sql(
        `select count(*) from app.session_changes where session_id='${s.id}' and material;`,
      ),
      "0",
    );
  });
});
