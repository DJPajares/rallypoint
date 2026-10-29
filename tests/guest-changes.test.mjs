import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { localEnv, fixturePassword } from "../scripts/local-env.mjs";
import { sql } from "./helpers/split-fixtures.mjs";

// P-27: a booked player drops their +1, or adds one later (owner, 2026-10-30).
// Dropping frees only the guest's place; the fee follows the cutoff rule and a
// paid marker never changes. Adding needs a free place and nobody waiting, so
// no waiting party is ever skipped. Synthetic accounts only.
const env = localEnv(),
  base = process.env.RALLYPOINT_TEST_URL ?? "http://127.0.0.1:3000";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const request = (path, actor, body) =>
  fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const local = (t) => new Date(t).toISOString().slice(0, 16);

async function world(t) {
  const nonce = crypto.randomUUID().slice(0, 8),
    users = [],
    sessions = [];
  t.after(() => {
    const ids = sessions.map((id) => `'${id}'`).join(",") || "null";
    const parties = `(select id from app.parties where session_id in (${ids}))`;
    sql(`begin;
      delete from app.operation_receipts where resource_id in (${ids}) or resource_id in ${parties}
        or actor_id in (${users.map((id) => `'${id}'`).join(",") || "null"});
      delete from app.email_jobs where session_id in (${ids});
      delete from app.attendance_changes where party_id in ${parties};
      delete from app.seat_attendance where party_id in ${parties};
      delete from app.fee_changes where party_id in ${parties};
      delete from app.fee_obligations where party_id in ${parties};
      delete from app.split_claim_changes where party_id in ${parties};
      delete from app.split_claims where party_id in ${parties};
      delete from app.registration_events where party_id in ${parties};
      delete from app.parties where session_id in (${ids});
      delete from app.session_changes where session_id in (${ids});
      create temp table gone as select group_id from app.sessions where id in (${ids});
      delete from app.sessions where id in (${ids});
      delete from app.groups where id in (select group_id from gone);
      ${users.map((id) => `delete from auth.users where id='${id}';`).join("\n")}
      commit;`);
  });
  async function person(label) {
    const email = `p27-${nonce}-${label}@rallypoint.test`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: fixturePassword,
      email_confirm: true,
      user_metadata: { full_name: `Synthetic ${label}` },
    });
    assert.ok(!error && data.user);
    users.push(data.user.id);
    const client = createClient(
      env.SUPABASE_URL,
      env.SUPABASE_PUBLISHABLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const signed = await client.auth.signInWithPassword({
      email,
      password: fixturePassword,
    });
    const who = {
      id: data.user.id,
      token: signed.data.session.access_token,
    };
    await request("/api/me", who);
    return who;
  }
  const organizer = await person("organizer");
  async function session(over = {}) {
    const now = Date.now();
    const r = await request("/api/sessions", organizer, {
      operationKey: crypto.randomUUID(),
      intent: "publish",
      details: {
        title: "Synthetic guest session",
        activity: "Workshop",
        startLocal: local(now + 86400000),
        endLocal: local(now + 93600000),
        timeZone: "UTC",
        location: "Synthetic room",
        instructions: "",
        capacity: "3",
        openLocal: local(now - 3600000),
        cutoffLocal: local(now + 43200000),
        fee: "5.00",
        currency: "SGD",
        guests: true,
        ...over,
      },
    });
    assert.equal(r.status, 200, await r.clone().text());
    const s = (await r.json()).session;
    sessions.push(s.id);
    return s;
  }
  const path = (s) => `/api/registrations/${s.slug}`;
  const join = async (s, who, seats = 1) => {
    const r = await request(path(s), who, {
      operationKey: crypto.randomUUID(),
      version: s.version,
      seats,
      guestName: seats === 2 ? "Synthetic guest" : "",
      consent: true,
    });
    assert.equal(r.status, 200, await r.clone().text());
    return (await r.json()).registration.own;
  };
  const guest = (s, who, partyId, body, operationKey = crypto.randomUUID()) =>
    request(`${path(s)}/guest`, who, { operationKey, partyId, ...body });
  const party = (id) =>
    sql(`select state||'|'||seats from app.parties where id='${id}';`);
  const fee = (id) =>
    sql(
      `select charged_seats||'|'||liability_state||'|'||marked_paid from app.fee_obligations where party_id='${id}';`,
    );
  // Booked sessions can't be edited through the app, so setup skips the guard.
  const shift = (s, key, ms) =>
    sql(`begin; set local session_replication_role=replica;
      update app.sessions set details=jsonb_set(details,'{${key}}',to_jsonb((now()+interval '${ms} milliseconds')::text)) where id='${s.id}';
      commit;`);
  return { person, organizer, session, join, guest, party, fee, shift, path };
}

test("dropping a confirmed guest frees one place for the next in line, once", async (t) => {
  const w = await world(t);
  const [a, b, c] = await Promise.all(["a", "b", "c"].map(w.person));
  const s = await w.session();
  const pa = await w.join(s, a, 2);
  await w.join(s, b);
  const pc = await w.join(s, c);
  assert.equal(pc.state, "waitlisted");
  const key = crypto.randomUUID();
  for (let i = 0; i < 2; i++) {
    const r = await w.guest(s, a, pa.id, { action: "drop" }, key);
    assert.equal(r.status, 200, `attempt ${i + 1}: ${await r.clone().text()}`);
    const own = (await r.json()).registration.own;
    assert.equal(own.seats, 1, `attempt ${i + 1}`);
    assert.equal(own.state, "confirmed");
  }
  assert.equal(w.party(pa.id), "confirmed|1");
  assert.equal(w.party(pc.id), "confirmed|1");
  assert.equal(
    sql(
      `select count(*) from app.registration_events where party_id='${pc.id}' and kind='promoted';`,
    ),
    "1",
  );
  // Before the cutoff the guest's unpaid fee goes.
  assert.equal(w.fee(pa.id), "1|due|false");
  // Nothing left to drop.
  const again = await w.guest(s, a, pa.id, { action: "drop" });
  assert.equal(again.status, 409);
  assert.equal((await again.json()).error.code, "no_guest");
});

test("a waiting two-seat party that drops its guest keeps its place and moves in if it fits", async (t) => {
  const w = await world(t);
  const [a, b] = await Promise.all(["a", "b"].map(w.person));
  const s = await w.session({ capacity: "2" });
  await w.join(s, a);
  const pb = await w.join(s, b, 2);
  assert.equal(pb.state, "waitlisted");
  assert.equal(
    (await w.guest(s, b, pb.id, { action: "drop" })).status,
    200,
  );
  assert.equal(w.party(pb.id), "confirmed|1");
});

test("after the cutoff the guest's fee stays; a paid marker never changes", async (t) => {
  const w = await world(t);
  const [a, b] = await Promise.all(["a", "b"].map(w.person));
  const s = await w.session({ capacity: "4" });
  const pa = await w.join(s, a, 2);
  const pb = await w.join(s, b, 2);
  // b is marked paid, then drops their guest before the cutoff.
  const roster = (
    await (await request(w.path(s), w.organizer)).json()
  ).registration.roster;
  const fb = roster.find((p) => p.id === pb.id).fee;
  assert.equal(
    (
      await request(`${w.path(s)}/payments`, w.organizer, {
        operationKey: crypto.randomUUID(),
        partyId: pb.id,
        action: "mark_paid",
        revision: fb.revision,
      })
    ).status,
    200,
  );
  assert.equal((await w.guest(s, b, pb.id, { action: "drop" })).status, 200);
  assert.equal(w.fee(pb.id), "2|due|true");
  // a drops after the cutoff: the guest's place goes, the fee stays.
  w.shift(s, "cutoffAt", -60000);
  assert.equal((await w.guest(s, a, pa.id, { action: "drop" })).status, 200);
  assert.equal(w.party(pa.id), "confirmed|1");
  assert.equal(w.fee(pa.id), "2|due|false");
});

test("a checked-in guest can't be dropped, and only the booker can drop", async (t) => {
  const w = await world(t);
  const [a, b] = await Promise.all(["a", "b"].map(w.person));
  const s = await w.session();
  const pa = await w.join(s, a, 2);
  await w.join(s, b);
  assert.equal(
    (await w.guest(s, b, pa.id, { action: "drop" })).status,
    403,
  );
  assert.equal(
    (
      await request(`${w.path(s)}/attendance`, w.organizer, {
        operationKey: crypto.randomUUID(),
        partyId: pa.id,
        seat: 2,
        state: "checked_in",
        revision: 0,
      })
    ).status,
    200,
  );
  const r = await w.guest(s, a, pa.id, { action: "drop" });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error.code, "guest_checked_in");
  assert.equal(w.party(pa.id), "confirmed|2");
});

test("a guest can be added only with a free place and nobody waiting", async (t) => {
  const w = await world(t);
  const [a, b, c] = await Promise.all(["a", "b", "c"].map(w.person));
  const s = await w.session();
  const pa = await w.join(s, a);
  const add = (who, id, over = {}) =>
    w.guest(s, who, id, {
      action: "add",
      guestName: "Synthetic plus one",
      version: s.version,
      consent: true,
      ...over,
    });
  // Consent is needed, on the current terms.
  assert.equal((await add(a, pa.id, { consent: false })).status, 422);
  const stale = await add(a, pa.id, { version: s.version + 1 });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).error.code, "stale_terms");
  const key = crypto.randomUUID();
  for (let i = 0; i < 2; i++) {
    const r = await w.guest(
      s,
      a,
      pa.id,
      {
        action: "add",
        guestName: "Synthetic plus one",
        version: s.version,
        consent: true,
      },
      key,
    );
    assert.equal(r.status, 200, await r.clone().text());
    assert.equal((await r.json()).registration.own.seats, 2);
  }
  assert.equal(w.fee(pa.id), "2|due|false");
  assert.equal((await add(a, pa.id)).status, 409, "already has a guest");
  // Now full (2 + 1): someone joins the waitlist.
  const pb = await w.join(s, b);
  assert.equal(pb.state, "confirmed");
  const pc = await w.join(s, c);
  assert.equal(pc.state, "waitlisted");
  const full = await add(b, pb.id);
  assert.equal(full.status, 409);
  assert.equal((await full.json()).error.code, "guest_no_place");
  // Guests off: refused.
  const off = await w.session({ guests: false });
  const po = await w.join(off, b);
  const r = await w.guest(off, b, po.id, {
    action: "add",
    guestName: "",
    version: off.version,
    consent: true,
  });
  assert.equal(r.status, 422);
});

test("two people adding a guest for the last place get one place between them", async (t) => {
  const w = await world(t);
  const [a, b] = await Promise.all(["a", "b"].map(w.person));
  const s = await w.session();
  const pa = await w.join(s, a);
  const pb = await w.join(s, b);
  const body = {
    action: "add",
    guestName: "",
    version: s.version,
    consent: true,
  };
  const results = await Promise.all([
    w.guest(s, a, pa.id, body),
    w.guest(s, b, pb.id, body),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal(
    sql(
      `select sum(seats) from app.parties where session_id='${s.id}' and state='confirmed';`,
    ),
    "3",
  );
});

test("in a split session, a guest's share stays once the cutoff passes", async (t) => {
  const w = await world(t);
  const [a] = await Promise.all(["a"].map(w.person));
  const s = await w.session({ feeMode: "split", fee: "30.00" });
  const pa = await w.join(s, a, 2);
  w.shift(s, "cutoffAt", -60000);
  const r = await w.guest(s, a, pa.id, { action: "drop" });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error.code, "guest_share_stays");
  assert.equal(w.party(pa.id), "confirmed|2");
});

test("review fixes: request sessions, consent, waived shares and repeat adds", async (t) => {
  const w = await world(t);
  const [a, b] = await Promise.all(["a", "b"].map(w.person));
  const add = (s, who, id) =>
    w.guest(s, who, id, {
      action: "add",
      guestName: "",
      version: s.version,
      consent: true,
    });
  // Where the organizer accepts each person, a guest isn't added without them.
  const asked = await w.session();
  const pa = await w.join(asked, a);
  sql(`begin; set local session_replication_role=replica;
    update app.sessions set details=details||'{"joinMode":"request"}' where id='${asked.id}'; commit;`);
  const r = await add(asked, a, pa.id);
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error.code, "guest_needs_organizer");
  // Adding keeps the booker's original terms (and any free withdrawal).
  const s = await w.session();
  const pb = await w.join(s, b);
  const before = sql(`select consent_version||'|'||consent_at from app.parties where id='${pb.id}';`);
  assert.equal((await add(s, b, pb.id)).status, 200);
  assert.equal(
    sql(`select consent_version||'|'||consent_at from app.parties where id='${pb.id}';`),
    before,
  );
  // Dropped after the cutoff, then added back: the fee already covers the guest.
  w.shift(s, "cutoffAt", -60000);
  assert.equal((await w.guest(s, b, pb.id, { action: "drop" })).status, 200);
  const revision = sql(`select revision from app.fee_obligations where party_id='${pb.id}';`);
  assert.equal((await add(s, b, pb.id)).status, 200);
  assert.equal(sql(`select revision from app.fee_obligations where party_id='${pb.id}';`), revision);
  // A waived split share can't take a guest.
  const split = await w.session({ feeMode: "split", fee: "30.00" });
  const pc = await w.join(split, a);
  sql(`update app.split_claims set waived=true where party_id='${pc.id}';`);
  const waived = await add(split, a, pc.id);
  assert.equal(waived.status, 409);
  assert.equal((await waived.json()).error.code, "guest_fee_settled");
});
