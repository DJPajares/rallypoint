import { test } from "node:test";
import assert from "node:assert/strict";
import { splitFixture } from "./helpers/split-fixtures.mjs";

// Rename and remove are owner-only, remove keeps history, and a group with an
// upcoming session stays put. Letting any manager through, deleting history,
// ignoring a booking-less published session or keeping an archived group
// listed must fail these real HTTP/database assertions.
const fixture = (t) => splitFixture(t, { seats: [], capacity: 1 });
const local = (ms) => new Date(ms).toISOString().slice(0, 16);
const KEEP = "Cancel its upcoming sessions first.";
const NAME_MESSAGE = "Use a group name of 1 to 100 characters.";

async function ownGroup(t, f, owner, name) {
  const groupName =
    name ?? `Synthetic groups ${crypto.randomUUID().slice(0, 8)}`;
  const made = await f.post(owner, "/api/groups", {
    operationKey: crypto.randomUUID(),
    name: groupName,
  });
  assert.equal(made.status, 200, "Synthetic group must be created");
  const group = (await made.json()).group;
  // Independent of hook order: everything is found by this group's id.
  t.after(() => {
    const sessions = `select id from app.sessions where group_id in (select id from app.groups where origin_group_id='${group.id}' or id='${group.id}')`;
    const parties = `select id from app.parties where session_id in(${sessions})`;
    const gone = (table, col, ids) =>
      `do $c$ begin if to_regclass('app.${table}') is not null then execute 'delete from app.${table} where ${col} in(${ids.replaceAll("'", "''")})'; end if; end $c$;`;
    f.sql(
      `begin;delete from app.operation_receipts where resource_id='${group.id}' or resource_id in(${sessions}) or resource_id in(${parties});` +
        ["fee_changes", "attendance_changes", "split_claim_changes"]
          .map((tb) => gone(tb, "party_id", parties))
          .join("") +
        [
          "fee_obligations",
          "registration_events",
          "seat_attendance",
          "split_claims",
          "split_allocations",
          "payment_notes",
          "email_jobs",
        ]
          .map((tb) => gone(tb, "party_id", parties))
          .join("") +
        [
          "email_jobs",
          "email_suppressions",
          "payment_instructions",
          "payment_instruction_notices",
          "session_cancellations",
          "session_changes",
        ]
          .map((tb) => gone(tb, "session_id", sessions))
          .join("") +
        `update app.sessions set current_split_run_id=null where group_id='${group.id}';` +
        gone("split_runs", "session_id", sessions) +
        `delete from app.parties where session_id in(${sessions});delete from app.sessions where group_id in (select id from app.groups where origin_group_id='${group.id}' or id='${group.id}');delete from app.group_roles where group_id='${group.id}';delete from app.groups where id='${group.id}';commit;`,
    );
  });
  const now = Date.now();
  const base = {
    title: "Synthetic group session",
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
  const saveAs = (actor, intent, details = base) =>
    f.post(actor, `/api/groups/${group.id}/sessions`, {
      operationKey: crypto.randomUUID(),
      groupId: group.id,
      intent,
      details,
    });
  const save = async (intent, details) => {
    const r = await saveAs(owner, intent, details);
    assert.equal(r.status, 200, `Synthetic ${intent} must save`);
    return (await r.json()).session;
  };
  return { group, groupName, base, save, saveAs };
}
const rename = (f, actor, id, name, operationKey = crypto.randomUUID()) =>
  f.post(actor, `/api/groups/${id}/rename`, { operationKey, name });
const archive = (f, actor, id, operationKey = crypto.randomUUID()) =>
  f.post(actor, `/api/groups/${id}/archive`, { operationKey });
const cancel = (f, actor, id) =>
  f.post(actor, `/api/sessions/${id}/cancel`, {
    operationKey: crypto.randomUUID(),
  });
const stored = (f, id) =>
  f.sql(
    `select name||'|'||coalesce(archived_at::text,'') from app.groups where id='${id}';`,
  );

test("the owner renames their group; sessions keep showing who hosts them", async (t) => {
  const f = await fixture(t);
  const [owner] = f.actors;
  const g = await ownGroup(t, f, owner);
  const session = await g.save("publish");
  const name = `Synthetic renamed ${crypto.randomUUID().slice(0, 8)}`;

  const r = await rename(f, owner, g.group.id, `  ${name}  `);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.group.id, g.group.id);
  assert.equal(body.group.name, name);

  const listed = (await (await f.get(owner, "/api/workspace")).json()).groups;
  assert.equal(listed.find((x) => x.id === g.group.id).name, name);
  // Sessions stand alone (P-35): a group's name isn't what a session shows.
  const shared = await (
    await f.get(null, `/api/shared/${session.slug}`)
  ).json();
  assert.notEqual(shared.session.groupName, name);
});

test("a blank or 101-character name is refused and nothing changes", async (t) => {
  const f = await fixture(t);
  const [owner] = f.actors;
  const g = await ownGroup(t, f, owner);
  for (const name of ["   ", "", "x".repeat(101)]) {
    const r = await rename(f, owner, g.group.id, name);
    assert.equal(r.status, 422, "same status as creating a group");
    assert.equal((await r.json()).error.message, NAME_MESSAGE);
  }
  assert.equal(stored(f, g.group.id), `${g.groupName}|`);
  const edge = await rename(f, owner, g.group.id, "y".repeat(100));
  assert.equal(edge.status, 200, "100 characters is allowed");
});

test("only the owner can rename or remove", async (t) => {
  const f = await fixture(t);
  const [owner, stranger] = f.actors;
  const g = await ownGroup(t, f, owner);
  f.sql(
    `insert into app.group_roles(group_id,user_id,role) values('${g.group.id}','${f.organizer.id}','organizer');`,
  );
  for (const actor of [f.organizer, stranger]) {
    assert.equal((await rename(f, actor, g.group.id, "Hijacked")).status, 403);
    assert.equal((await archive(f, actor, g.group.id)).status, 403);
  }
  assert.equal(stored(f, g.group.id), `${g.groupName}|`);
  assert.equal(
    (await rename(f, null, g.group.id, "Anonymous")).status,
    401,
    "signed out is refused",
  );
});

test("removing a group leaves its sessions running", async (t) => {
  const f = await fixture(t);
  const [owner] = f.actors;
  const g = await ownGroup(t, f, owner);
  const session = await g.save("publish");
  // Sessions stand alone (P-35): an upcoming session no longer blocks removal.
  assert.equal((await archive(f, owner, g.group.id)).status, 200);
  assert.notEqual(stored(f, g.group.id), `${g.groupName}|`);
  assert.equal(
    f.sql(`select state from app.sessions where id='${session.id}';`),
    "published",
  );
  assert.equal((await f.get(owner, `/api/sessions/${session.id}`)).status, 200);
});

test("a removed group disappears but keeps its history", async (t) => {
  const f = await fixture(t);
  const [owner, player] = f.actors;
  const g = await ownGroup(t, f, owner);
  const session = await g.save("publish");
  const draft = await g.save("draft", {
    ...g.base,
    title: "Synthetic leftover draft",
    startLocal: "",
    endLocal: "",
    openLocal: "",
    cutoffLocal: "",
  });
  const joined = await f.post(player, `/api/registrations/${session.slug}`, {
    operationKey: crypto.randomUUID(),
    version: session.version,
    seats: 1,
    guestName: "",
    consent: true,
  });
  assert.equal(joined.status, 200);
  const mine = async () =>
    [...(await (await f.get(owner, "/api/me/sessions")).json()).upcoming].map(
      (r) => r.slug,
    );
  assert.ok((await mine()).includes(draft.slug), "the draft is listed first");

  assert.equal((await cancel(f, owner, session.id)).status, 200);
  assert.equal((await archive(f, owner, g.group.id)).status, 200);

  const listed = (await (await f.get(owner, "/api/workspace")).json()).groups;
  assert.equal(
    listed.find((x) => x.id === g.group.id),
    undefined,
  );
  assert.equal(
    (await f.get(owner, `/api/groups/${g.group.id}/setup`)).status,
    403,
  );
  assert.equal(
    f.sql(`select state from app.sessions where id='${session.id}';`),
    "cancelled",
  );
  assert.equal(
    f.sql(`select count(*) from app.parties where session_id='${session.id}';`),
    "1",
  );
  assert.equal(
    f.sql(
      `select count(*) from app.group_roles where group_id='${g.group.id}';`,
    ),
    "1",
    "roles are kept too",
  );
  // The draft belongs to its organizer, not the group (P-35).
  assert.ok((await mine()).includes(draft.slug), "the draft stays in Sessions");
  assert.equal(
    f.sql(`select count(*) from app.sessions where id='${draft.id}';`),
    "1",
    "the draft row itself is not deleted",
  );
});

test("retrying a rename or removal returns the same result", async (t) => {
  const f = await fixture(t);
  const [owner] = f.actors;
  const g = await ownGroup(t, f, owner);
  const name = `Synthetic retry ${crypto.randomUUID().slice(0, 8)}`;
  const renameKey = crypto.randomUUID();
  const first = await rename(f, owner, g.group.id, name, renameKey);
  const second = await rename(f, owner, g.group.id, name, renameKey);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.deepEqual(await second.json(), await first.json());
  const clash = await rename(f, owner, g.group.id, "Other name", renameKey);
  assert.equal(clash.status, 409, "same key, different name is a conflict");

  const archiveKey = crypto.randomUUID();
  const a = await archive(f, owner, g.group.id, archiveKey);
  const when = stored(f, g.group.id);
  const b = await archive(f, owner, g.group.id, archiveKey);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.deepEqual(await b.json(), await a.json());
  assert.equal(stored(f, g.group.id), when, "the first removal time is kept");
});

test("a removed group can't be renamed or removed again with a new key", async (t) => {
  const f = await fixture(t);
  const [owner] = f.actors;
  const g = await ownGroup(t, f, owner);
  assert.equal((await archive(f, owner, g.group.id)).status, 200);
  assert.equal((await rename(f, owner, g.group.id, "Back again")).status, 403);
  assert.equal((await archive(f, owner, g.group.id)).status, 403);
});

const moveTimes = (f, id, startsAgo, endsIn) =>
  f.sql(
    `begin;alter table app.sessions disable trigger protect_booked_session;update app.sessions set details=jsonb_set(jsonb_set(details,'{startsAt}',to_jsonb((clock_timestamp()-interval '${startsAgo} minutes')::text)),'{endsAt}',to_jsonb((clock_timestamp()+interval '${endsIn} minutes')::text)) where id='${id}';alter table app.sessions enable trigger protect_booked_session;commit;`,
  );

test("after removing a group, the owner can still settle its past sessions", async (t) => {
  const f = await fixture(t);
  const [owner, player] = f.actors;
  const g = await ownGroup(t, f, owner);
  const session = await g.save("publish", { ...g.base, fee: "10.00" });
  const joined = await f.post(player, `/api/registrations/${session.slug}`, {
    operationKey: crypto.randomUUID(),
    version: session.version,
    seats: 1,
    guestName: "",
    consent: true,
  });
  assert.equal(joined.status, 200);
  const party = (await joined.json()).registration.own;
  moveTimes(f, session.id, 180, -60);

  assert.equal((await archive(f, owner, g.group.id)).status, 200);
  const paid = await f.post(
    owner,
    `/api/registrations/${session.slug}/payments`,
    {
      operationKey: crypto.randomUUID(),
      partyId: party.id,
      action: "mark_paid",
      revision: 1,
    },
  );
  assert.equal(paid.status, 200, "the owner can still mark a fee paid");
  assert.equal((await f.get(owner, `/api/sessions/${session.id}`)).status, 200);
});

test("a session in progress doesn't block removal", async (t) => {
  const f = await fixture(t);
  const [owner] = f.actors;
  const g = await ownGroup(t, f, owner);
  const session = await g.save("publish");
  moveTimes(f, session.id, 30, 30);
  assert.equal((await archive(f, owner, g.group.id)).status, 200);
});
