import test from "node:test";
import assert from "node:assert/strict";
import { splitFixture } from "./helpers/split-fixtures.mjs";
const share = "https://maps.app.goo.gl/AbC123";
const place = "https://www.google.com/maps/place/Synthetic+Court";
const edit = (f, changes = {}, actor = f.organizer) =>
  f.post(actor, `/api/sessions/${f.session.id}`, {
    operationKey: crypto.randomUUID(),
    groupId: f.firstGroup,
    intent: "update",
    version: f.session.version,
    details: { ...f.session.details, ...changes },
  });
const save = async (f, changes = {}) => {
  const r = await edit(f, changes);
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  f.session = (await r.json()).session;
  return f.session;
};
const shared = async (f) =>
  (await (await f.get(null, `/api/shared/${f.session.slug}`)).json()).session
    .details;
const stored = (f) =>
  f.sql(
    `select coalesce(details->>'mapsLink','') from app.sessions where id='${f.session.id}';`,
  );
const latestChange = (f) =>
  f.sql(
    `select material from app.session_changes where session_id='${f.session.id}' order by version desc limit 1;`,
  );

test("organizer adds, replaces and removes a link on an unbooked session", async (t) => {
  const f = await splitFixture(t, { feeMode: "fixed" });
  await save(f, { mapsLink: share });
  assert.equal((await shared(f)).mapsLink, share);
  await save(f, { mapsLink: place });
  assert.equal((await shared(f)).mapsLink, place);
  await save(f, { mapsLink: "" });
  assert.equal("mapsLink" in (await shared(f)), false);
  assert.equal(stored(f), "");
});

test("direct API save rejects a bad link and a non-manager", async (t) => {
  const f = await splitFixture(t, { feeMode: "fixed" });
  const bad = await edit(f, {
    mapsLink: "https://www.google.com.evil.example/maps/place/test",
  });
  assert.equal(bad.status, 422);
  assert.equal(
    (await bad.json()).error.message,
    "Use a link copied from Google Maps.",
  );
  const outsider = await edit(f, { mapsLink: share }, f.actors.at(-1));
  assert.equal(outsider.status, 403);
  assert.equal(stored(f), "");
});

test("database refuses a stored link outside the allowed hosts", async (t) => {
  const f = await splitFixture(t, { feeMode: "fixed" });
  const write = (value) =>
    f.sql(
      `begin;alter table app.sessions disable trigger protect_booked_session;update app.sessions set details=jsonb_set(details,'{mapsLink}',to_jsonb('${value}'::text)) where id='${f.session.id}';alter table app.sessions enable trigger protect_booked_session;commit;`,
    );
  assert.throws(
    () => write("https://example.com/"),
    /sessions_maps_link_check/,
  );
  assert.throws(
    () => write("https://www.google.com.evil.example/maps/x"),
    /sessions_maps_link_check/,
  );
  write(share);
  assert.equal(stored(f), share);
});

test("link-only change on a booked session is a material venue change", async (t) => {
  const f = await splitFixture(t, {
    feeMode: "fixed",
    seats: [1],
    capacity: 2,
  });
  const location = f.session.details.location;
  await save(f, { mapsLink: share });
  assert.equal(f.session.details.location, location);
  assert.equal(latestChange(f), "t");
  const signal = JSON.parse(
    f.sql(
      `select json_build_object('changes',changes,'previous',previous) from app.session_change_signals where session_id='${f.session.id}' order by version desc limit 1;`,
    ),
  );
  assert.deepEqual(signal.changes, { mapsLink: share });
  assert.equal("mapsLink" in signal.previous, true);
  assert.equal(signal.previous.mapsLink, null);
  const view = await (
    await f.get(f.actors[0], `/api/registrations/${f.session.slug}`)
  ).json();
  assert.equal(view.registration.own.freeWithdrawalAfterChange, true);
  // Removing it is a venue change too.
  await save(f, { mapsLink: "" });
  assert.equal(latestChange(f), "t");
});

test("booked session without a link keeps descriptive edits non-material", async (t) => {
  const f = await splitFixture(t, {
    feeMode: "fixed",
    seats: [1],
    capacity: 2,
  });
  assert.equal("mapsLink" in f.session.details, false);
  await save(f, { title: "Corrected title" });
  assert.equal(latestChange(f), "f");
});
