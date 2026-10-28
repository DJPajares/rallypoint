import test from "node:test";
import assert from "node:assert/strict";
import { splitFixture } from "./helpers/split-fixtures.mjs";
const lockedCopy =
  "People have booked, so the fee and booking rules can't change. Cancel this session and publish a new one.";
const edit = (f, changes = {}, extra = {}) =>
  f.post(f.organizer, `/api/sessions/${f.session.id}`, {
    operationKey: crypto.randomUUID(),
    groupId: f.firstGroup,
    intent: "update",
    version: f.session.version,
    details: { ...f.session.details, ...changes },
    ...extra,
  });
const save = async (f, changes = {}) => {
  const r = await edit(f, changes);
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  f.session = (await r.json()).session;
  return f.session;
};
const view = async (f, a) =>
  (await (await f.get(a, `/api/registrations/${f.session.slug}`)).json())
    .registration;
const withdraw = (f, a, p) =>
  f.post(a, `/api/registrations/${f.session.slug}/withdraw`, {
    operationKey: crypto.randomUUID(),
    partyId: p.id,
  });
const rows = (f, q) =>
  JSON.parse(f.sql(`select coalesce(jsonb_agg(x),'[]') from (${q}) x;`));

test("booked descriptive edits retain seats and fees; exact retry and stale join stay safe", async (t) => {
  const f = await splitFixture(t, {
    feeMode: "fixed",
    seats: [1],
    capacity: 2,
  });
  const before = f.sql(
    `select row_to_json(x) from app.fee_obligations x where party_id='${f.parties[0].id}';`,
  );
  const body = {
    operationKey: crypto.randomUUID(),
    groupId: f.firstGroup,
    intent: "update",
    version: f.session.version,
    details: {
      ...f.session.details,
      title: "Corrected title",
      activity: "Practice",
      instructions: "Bring water",
    },
  };
  const r = await edit(f, {}, body);
  assert.equal(r.status, 200);
  f.session = (await r.json()).session;
  assert.equal(f.session.version, body.version + 1);
  assert.equal(
    f.sql(
      `select row_to_json(x) from app.fee_obligations x where party_id='${f.parties[0].id}';`,
    ),
    before,
  );
  assert.equal((await edit(f, {}, body)).status, 200);
  assert.equal(
    f.sql(
      `select count(*) from app.session_changes where session_id='${f.session.id}' and material;`,
    ),
    "0",
  );
  const stale = await f.post(
    f.actors[1],
    `/api/registrations/${f.session.slug}`,
    {
      operationKey: crypto.randomUUID(),
      version: body.version,
      seats: 1,
      guestName: "",
      consent: true,
    },
  );
  assert.equal((await stale.json()).error.code, "stale_terms");
  assert.equal(
    (await edit(f, { title: "stale" }, { version: body.version })).status,
    409,
  );
});

test("booked money, guest, opening, timezone and cutoff-only changes are refused atomically", async (t) => {
  const f = await splitFixture(t, { feeMode: "fixed", seats: [1] });
  for (const change of [
    { fee: "121" },
    { currency: "PHP" },
    { feeMode: "split" },
    { guests: false },
    {
      openLocal: new Date(Date.parse(f.session.details.opensAt) - 60000)
        .toISOString()
        .slice(0, 16),
    },
    { cutoffLocal: f.session.details.startLocal },
    { paymentMode: "untracked" },
    { releaseUnpaid: true },
  ]) {
    const r = await edit(f, change);
    assert.equal(r.status, 409, JSON.stringify(change));
    const b = await r.json();
    assert.equal(b.error.code, "booked_event_locked");
    assert.equal(b.error.message, lockedCopy);
  }
  assert.equal(
    f.sql(`select version from app.sessions where id='${f.session.id}';`),
    String(f.session.version),
  );
  // A service caller cannot remove locked properties or erase the first-booking marker.
  for (const expr of [
    "details-'guests'",
    'details||\'{"currency":"PHP"}\'::jsonb',
  ]) {
    assert.throws(() =>
      f.sql(
        `update app.sessions set details=${expr} where id='${f.session.id}';`,
      ),
    );
  }
  assert.throws(() =>
    f.sql(
      `update app.sessions set bookings_started_at=null where id='${f.session.id}';`,
    ),
  );
});

test("capacity save promotes strict queue in its transaction and cannot undercut confirmed seats", async (t) => {
  const f = await splitFixture(t, {
    feeMode: "fixed",
    seats: [2],
    capacity: 2,
  });
  const head = await f.join(f.actors[1], 2),
    tail = await f.join(f.actors[2]);
  await save(f, { capacity: "3" });
  assert.equal((await view(f, f.actors[2])).own.state, "waitlisted");
  await save(f, { capacity: "4" });
  assert.equal((await view(f, f.actors[1])).own.state, "confirmed");
  assert.equal((await view(f, f.actors[2])).own.state, "waitlisted");
  const r = await edit(f, { capacity: "3" });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error.code, "capacity_below_confirmed");
  assert.equal(
    f.sql(
      `select count(*) from app.registration_events where party_id='${head.id}' and kind='promoted';`,
    ),
    "1",
  );
  assert.equal(
    f.sql(
      `select count(*) from app.fee_obligations where party_id='${tail.id}';`,
    ),
    "0",
  );
});

test("venue change produces one private durable signal, frees original and promoted consent after cutoff, but not new joins", async (t) => {
  const f = await splitFixture(t, {
    feeMode: "fixed",
    seats: [2],
    capacity: 2,
    cutoffPast: true,
  });
  const wait = await f.join(f.actors[1]);
  const body = {
    operationKey: crypto.randomUUID(),
    groupId: f.firstGroup,
    intent: "update",
    version: f.session.version,
    details: { ...f.session.details, location: "New room" },
  };
  const r = await edit(f, {}, body);
  assert.equal(r.status, 200);
  f.session = (await r.json()).session;
  assert.equal((await edit(f, {}, body)).status, 200);
  const signals = rows(
    f,
    `select * from app.session_change_signals where session_id='${f.session.id}'`,
  );
  assert.equal(signals.length, 1);
  assert.equal(signals[0].version, f.session.version);
  assert.deepEqual(
    new Set(signals[0].party_ids),
    new Set([f.parties[0].id, wait.id]),
  );
  assert.equal(signals[0].changes.location, "New room");
  assert.equal(signals[0].previous.location, "Synthetic room");
  assert.equal(
    f.sql(
      `select material from app.session_changes where session_id='${f.session.id}' and version=${f.session.version};`,
    ),
    "t",
  );
  assert.equal(
    (await view(f, f.actors[0])).own.freeWithdrawalAfterChange,
    true,
  );
  assert.equal((await withdraw(f, f.actors[0], f.parties[0])).status, 200);
  let own = (await view(f, f.actors[0])).own;
  assert.equal(own.fee.liabilityState, "removed_after_change");
  assert.equal(
    f.sql(
      `select action from app.fee_changes where party_id='${own.id}' order by revision desc limit 1;`,
    ),
    "removed_after_change",
  );
  assert.ok(own.fee.removedAt);
  assert.equal(
    f.sql(
      `select removed_by from app.fee_obligations where party_id='${own.id}';`,
    ),
    f.actors[0].id,
  );
  own = (await view(f, f.actors[1])).own;
  assert.equal(own.state, "confirmed");
  assert.equal(own.freeWithdrawalAfterChange, true);
  const nr = await f.post(f.actors[2], `/api/registrations/${f.session.slug}`, {
    operationKey: crypto.randomUUID(),
    version: f.session.version,
    seats: 1,
    guestName: "",
    consent: true,
  });
  assert.equal(nr.status, 200);
  const newcomer = (await nr.json()).registration.own;
  assert.equal(
    (await view(f, f.actors[2])).own.freeWithdrawalAfterChange,
    false,
  );
  assert.equal((await withdraw(f, f.actors[2], newcomer)).status, 200);
  assert.equal((await view(f, f.actors[2])).own.fee.liabilityState, "due");
  assert.equal((await withdraw(f, f.actors[1], wait)).status, 200);
  assert.equal(
    (await view(f, f.actors[1])).own.fee.liabilityState,
    "removed_after_change",
  );
  assert.equal(
    f.sql(
      "select has_table_privilege('anon','app.session_change_signals','select') or has_table_privilege('authenticated','app.session_change_signals','select');",
    ),
    "f",
  );
});

test("material change preserves paid markers and never retroactively releases a withdrawn late fee", async (t) => {
  const f = await splitFixture(t, {
    feeMode: "fixed",
    seats: [1, 1],
    cutoffPast: true,
  });
  assert.equal((await withdraw(f, f.actors[1], f.parties[1])).status, 200);
  f.sql(
    `update app.fee_obligations set marked_paid=true,payment_marked_at=clock_timestamp(),payment_marked_by='${f.organizer.id}' where party_id='${f.parties[0].id}';`,
  );
  const before = f.sql(
    `select row_to_json(x) from app.fee_obligations x where party_id='${f.parties[0].id}';`,
  );
  await save(f, { location: "Other venue" });
  assert.equal((await withdraw(f, f.actors[0], f.parties[0])).status, 200);
  assert.equal(
    f.sql(
      `select row_to_json(x) from app.fee_obligations x where party_id='${f.parties[0].id}';`,
    ),
    before,
  );
  assert.equal((await view(f, f.actors[1])).own.fee.liabilityState, "due");
});

test("end-only change frees a split claim with separate audit actor and time", async (t) => {
  const f = await splitFixture(t, { seats: [1], cutoffPast: true });
  const end = new Date(Date.parse(f.session.details.endsAt) + 3600000)
    .toISOString()
    .slice(0, 16);
  await save(f, { endLocal: end });
  assert.equal((await withdraw(f, f.actors[0], f.parties[0])).status, 200);
  const claim = rows(
    f,
    `select * from app.split_claims where party_id='${f.parties[0].id}'`,
  )[0];
  assert.equal(claim.eligible, false);
  assert.equal(claim.changed_by, f.actors[0].id);
  assert.ok(claim.changed_at);
  assert.equal(
    f.sql(
      `select action from app.split_claim_changes where party_id='${claim.party_id}' order by revision desc limit 1;`,
    ),
    "removed_after_change",
  );
});

test("start/cutoff coupling, future start and old-start closure are authoritative", async (t) => {
  const f = await splitFixture(t, { feeMode: "fixed", seats: [1] });
  const start = new Date(Date.parse(f.session.details.startsAt) + 3600000)
    .toISOString()
    .slice(0, 16);
  await save(f, { startLocal: start, cutoffLocal: start });
  assert.equal(
    (
      await edit(f, {
        startLocal: new Date(Date.now() - 60000).toISOString().slice(0, 16),
        cutoffLocal: f.session.details.openLocal,
      })
    ).status,
    409,
  );
  const held = await f.lockStart(250, 650);
  const r = await edit(f, { title: "Too late" });
  await held.finished;
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error.code, "session_started");
  const now = (
    await (await f.get(f.organizer, `/api/sessions/${f.session.id}`)).json()
  ).session;
  assert.equal(
    (await edit(f, {}, { version: now.version, details: now.details })).status,
    409,
    "fresh no-op after start is refused",
  );
});

test("non-manager and revoked co-host cannot edit or replay; committed replay after start remains recoverable", async (t) => {
  const f = await splitFixture(t, { feeMode: "fixed", seats: [1] });
  const body = {
    operationKey: crypto.randomUUID(),
    groupId: f.firstGroup,
    intent: "update",
    version: f.session.version,
    details: { ...f.session.details, title: "Host correction" },
  };
  assert.equal(
    (await f.post(f.actors[1], `/api/sessions/${f.session.id}`, body)).status,
    403,
  );
  f.sql(
    `insert into app.group_roles(group_id,user_id,role) select id,'${f.actors[1].id}','cohost' from app.groups where origin_group_id='${f.firstGroup}' on conflict do nothing;`,
  );
  assert.equal(
    (await f.post(f.actors[1], `/api/sessions/${f.session.id}`, body)).status,
    200,
  );
  f.sql(
    `delete from app.group_roles where group_id in (select id from app.groups where origin_group_id='${f.firstGroup}') and user_id='${f.actors[1].id}';`,
  );
  assert.equal(
    (await f.post(f.actors[1], `/api/sessions/${f.session.id}`, body)).status,
    403,
  );
  const now = (
    await (await f.get(f.organizer, `/api/sessions/${f.session.id}`)).json()
  ).session;
  f.session = now;
  const ownBody = {
    ...body,
    operationKey: crypto.randomUUID(),
    version: now.version,
    details: { ...now.details, title: "Second correction" },
  };
  assert.equal((await edit(f, {}, ownBody)).status, 200);
  f.moveStart(-1000);
  assert.equal((await edit(f, {}, ownBody)).status, 200);
});

test("concurrent capacity edit, new join and withdrawal preserve queue/seat/fee integrity", async (t) => {
  const f = await splitFixture(t, {
    feeMode: "fixed",
    seats: [1],
    capacity: 1,
    cutoffPast: true,
  });
  const waiting = await f.join(f.actors[1]);
  const results = await Promise.all([
    edit(f, { capacity: "2", location: "Moved venue" }),
    withdraw(f, f.actors[0], f.parties[0]),
    f.post(f.actors[2], `/api/registrations/${f.session.slug}`, {
      operationKey: crypto.randomUUID(),
      version: f.session.version,
      seats: 1,
      guestName: "",
      consent: true,
    }),
  ]);
  assert.equal(results[0].status, 200);
  assert.equal(results[1].status, 200);
  assert.ok([200, 409].includes(results[2].status));
  assert.equal((await view(f, f.actors[1])).own.state, "confirmed");
  assert.equal(
    f.sql(
      `select count(*) from app.registration_events where party_id='${waiting.id}' and kind='promoted';`,
    ),
    "1",
  );
  assert.equal(
    f.sql(
      `select coalesce(sum(seats),0)<=(select (details->>'capacity')::int from app.sessions where id='${f.session.id}') from app.parties where session_id='${f.session.id}' and state='confirmed';`,
    ),
    "t",
  );
});

test("legacy organizer-payment defaults do not lock a harmless title correction", async (t) => {
  const f = await splitFixture(t, { feeMode: "fixed", seats: [1] });
  f.sql(
    `begin;alter table app.sessions disable trigger protect_booked_session;update app.sessions set details=details-'paymentMode'-'releaseUnpaid' where id='${f.session.id}';alter table app.sessions enable trigger protect_booked_session;commit;`,
  );
  f.session = (
    await (await f.get(f.organizer, `/api/sessions/${f.session.id}`)).json()
  ).session;
  const r = await edit(f, { title: "Legacy title corrected" });
  assert.equal(r.status, 200);
});

test("raw booked detail writes cannot skip material history or delete required times", async (t) => {
  const f = await splitFixture(t, {
    feeMode: "fixed",
    seats: [1],
    cutoffPast: true,
  });
  for (const value of [
    'details||\'{"location":"Unaudited venue"}\'::jsonb',
    "details-'startsAt'",
    "jsonb_set(details,'{startsAt}','null')",
    'details||\'{"capacity":"3"}\'::jsonb',
  ]) {
    assert.throws(
      () =>
        f.sql(
          `update app.sessions set details=${value},version=version+1 where id='${f.session.id}';`,
        ),
      "Use the complete save pipeline for booked details",
    );
  }
  assert.equal(
    f.sql(
      `select details->>'location' from app.sessions where id='${f.session.id}';`,
    ),
    "Synthetic room",
  );
  assert.equal(
    f.sql(
      `select count(*) from app.session_changes where session_id='${f.session.id}';`,
    ),
    "0",
  );
});
