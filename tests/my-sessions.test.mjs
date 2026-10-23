import { test } from "node:test";
import assert from "node:assert/strict";
import { splitFixture } from "./helpers/split-fixtures.mjs";

// The Sessions tab reads this list. Widening the inclusion rule, dropping the
// one-row-per-session guarantee or returning money/roster fields must fail here.
const KEYS = [
  "endsAt",
  "groupName",
  "id",
  "slug",
  "startLocal",
  "startsAt",
  "state",
  "status",
  "timeZone",
  "title",
  "waitPosition",
];
const fixture = (t) =>
  splitFixture(t, {
    feeMode: "fixed",
    total: "10.00",
    seats: [1],
    capacity: 1,
  });
const mine = async (f, a) => (await f.get(a, "/api/me/sessions")).json();
const find = (list, slug) => list.find((r) => r.slug === slug);
const withdraw = (f, actor, partyId, slug = f.session.slug) =>
  f.post(actor, `/api/registrations/${slug}/withdraw`, {
    operationKey: crypto.randomUUID(),
    partyId,
  });
const rejoin = (f, actor) =>
  f.post(actor, `/api/registrations/${f.session.slug}`, {
    operationKey: crypto.randomUUID(),
    version: f.session.version,
    seats: 1,
    guestName: "",
    consent: true,
  });
const local = (ms) => new Date(ms).toISOString().slice(0, 16);

async function ownGroup(t, f, owner) {
  const made = await f.post(owner, "/api/groups", {
    operationKey: crypto.randomUUID(),
    name: "Synthetic my-sessions group",
  });
  assert.equal(made.status, 200, "Synthetic group must be created");
  const group = (await made.json()).group;
  t.after(() =>
    f.sql(
      `begin;delete from app.operation_receipts where resource_id='${group.id}' or resource_id in(select id from app.sessions where group_id='${group.id}');delete from app.session_changes where session_id in(select id from app.sessions where group_id='${group.id}');delete from app.sessions where group_id='${group.id}';delete from app.group_roles where group_id='${group.id}';delete from app.groups where id='${group.id}';commit;`,
    ),
  );
  const save = async (intent, details) => {
    const r = await f.post(owner, `/api/groups/${group.id}/sessions`, {
      operationKey: crypto.randomUUID(),
      groupId: group.id,
      intent,
      details,
    });
    assert.equal(r.status, 200, `Synthetic ${intent} must save`);
    return (await r.json()).session;
  };
  const now = Date.now();
  const base = {
    title: "Synthetic managed session",
    activity: "Workshop",
    location: "Synthetic room",
    instructions: "",
    startLocal: local(now + 86400000),
    endLocal: local(now + 93600000),
    openLocal: local(now - 3600000),
    cutoffLocal: local(now + 43200000),
    timeZone: "UTC",
    capacity: "4",
    currency: "SGD",
    fee: "0",
    feeMode: "fixed",
    guests: true,
  };
  return {
    group,
    published: await save("publish", base),
    draft: await save("draft", {
      ...base,
      title: "Synthetic undated draft",
      startLocal: "",
      endLocal: "",
      openLocal: "",
      cutoffLocal: "",
    }),
  };
}

test("signed out is refused", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.get(null, "/api/me/sessions")).status, 401);
});

test("a player sees only sessions they're in or waiting for", async (t) => {
  const f = await fixture(t);
  const [a0, a1, a2] = f.actors;
  await f.join(a1);
  const slug = f.session.slug;

  const in0 = find((await mine(f, a0)).upcoming, slug);
  assert.equal(in0.status, "in");
  assert.equal(in0.waitPosition, null);
  assert.equal(in0.state, "published");
  assert.equal(in0.title, "Synthetic split session");
  assert.equal(in0.id, null, "only drafts expose their id");
  assert.deepEqual(Object.keys(in0).sort(), KEYS);

  const wait1 = find((await mine(f, a1)).upcoming, slug);
  assert.equal(wait1.status, "waitlisted");
  assert.equal(wait1.waitPosition, 1);

  const outsider = await mine(f, a2);
  const all = [...outsider.upcoming, ...outsider.past];
  assert.equal(find(all, slug), undefined);
  const groupName = in0.groupName;
  assert.deepEqual(
    all.filter((r) => r.groupName === groupName),
    [],
    "an outsider sees nothing from a group they have no part in",
  );
  assert.equal(outsider.pastTotal, outsider.past.length);
});

test("leaving removes the session; rejoining lists it once", async (t) => {
  const f = await fixture(t);
  const [a0, a1] = f.actors;
  await f.join(a1);
  const slug = f.session.slug;

  assert.equal((await withdraw(f, a0, f.parties[0].id)).status, 200);
  const after = await mine(f, a0);
  assert.equal(find([...after.upcoming, ...after.past], slug), undefined);
  assert.equal(find((await mine(f, a1)).upcoming, slug).status, "in");

  assert.equal((await rejoin(f, a0)).status, 200);
  const again = await mine(f, a0);
  const rows = [...again.upcoming, ...again.past].filter(
    (r) => r.slug === slug,
  );
  assert.equal(rows.length, 1, "two party rows still list one session");
  assert.equal(rows[0].status, "waitlisted");
  assert.equal(rows[0].waitPosition, 1);
});

test("waitlist position counts only parties still ahead", async (t) => {
  const f = await fixture(t);
  const [, a1, a2] = f.actors;
  const own1 = await f.join(a1);
  await f.join(a2);
  const slug = f.session.slug;
  assert.equal(find((await mine(f, a1)).upcoming, slug).waitPosition, 1);
  assert.equal(find((await mine(f, a2)).upcoming, slug).waitPosition, 2);

  assert.equal((await withdraw(f, a1, own1.id)).status, 200);
  const moved = find((await mine(f, a2)).upcoming, slug);
  assert.equal(moved.status, "waitlisted");
  assert.equal(moved.waitPosition, 1);
});

test("managers see their group's sessions and drafts, outsiders don't", async (t) => {
  const f = await fixture(t);
  const [a0, , a2] = f.actors;
  const g = await ownGroup(t, f, a2);

  const { upcoming } = await mine(f, a2);
  const pub = find(upcoming, g.published.slug);
  assert.equal(pub.status, "organizing");
  assert.equal(pub.groupName, "Synthetic my-sessions group");
  const draft = find(upcoming, g.draft.slug);
  assert.equal(draft.status, "draft");
  assert.equal(draft.id, g.draft.id);
  assert.equal(draft.startLocal, "");
  assert.equal(draft.startsAt, null);
  assert.equal(
    upcoming.findIndex((r) => r.slug === g.draft.slug),
    upcoming.length - 1,
    "an undated draft sorts last",
  );
  assert.deepEqual(Object.keys(draft).sort(), KEYS);

  const outsider = await mine(f, a0);
  const seen = [...outsider.upcoming, ...outsider.past].map((r) => r.slug);
  assert.ok(!seen.includes(g.published.slug));
  assert.ok(!seen.includes(g.draft.slug));
});

test("cancelled stays in coming up until start, then moves to past", async (t) => {
  const f = await fixture(t);
  const [a0] = f.actors;
  const slug = f.session.slug;
  const cancelled = await f.post(
    f.organizer,
    `/api/sessions/${f.session.id}/cancel`,
    { operationKey: crypto.randomUUID() },
  );
  assert.equal(cancelled.status, 200);

  const before = await mine(f, a0);
  const row = find(before.upcoming, slug);
  assert.equal(row.status, "cancelled");
  assert.equal(row.state, "cancelled");
  assert.equal(find(before.past, slug), undefined);

  f.moveStart(-60000);
  const after = await mine(f, a0);
  assert.equal(find(after.upcoming, slug), undefined);
  assert.equal(find(after.past, slug).status, "cancelled");
  assert.ok(after.pastTotal >= 1);
  assert.ok(after.past.length <= 20);
});

test("a session moves to past exactly at its end", async (t) => {
  const f = await fixture(t);
  const [a0] = f.actors;
  const slug = f.session.slug;
  assert.ok(find((await mine(f, a0)).upcoming, slug));

  f.sql(
    `begin;alter table app.sessions disable trigger protect_booked_session;update app.sessions set details=jsonb_set(jsonb_set(details,'{startsAt}',to_jsonb((clock_timestamp()-interval '2 hours')::text)),'{endsAt}',to_jsonb(clock_timestamp()::text)) where id='${f.session.id}';alter table app.sessions enable trigger protect_booked_session;commit;`,
  );
  const after = await mine(f, a0);
  assert.equal(find(after.upcoming, slug), undefined);
  assert.equal(find(after.past, slug).status, "in");
  assert.ok(after.pastTotal >= 1);
});
