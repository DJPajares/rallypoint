import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { splitFixture } from "./helpers/split-fixtures.mjs";

// Fresh synthetic accounts (full_name "Split person {i}") per test; their
// profile rows are removed explicitly as well as by the account delete cascade.
async function fixture(t) {
  const f = await splitFixture(t);
  t.after(() => {
    f.sql(
      `delete from app.profiles where user_id in (${f.actors.map((a) => `'${a.id}'`).join(",")});`,
    );
  });
  return f;
}
const save = (f, actor, body) => f.post(actor, "/api/me/profile", body);
const mine = async (f, actor) =>
  (await (await f.get(actor, "/api/me/profile")).json()).profile;

test("my profile starts from my account name", async (t) => {
  const f = await fixture(t);
  const [actor] = f.actors;
  const response = await f.get(actor, "/api/me/profile");
  assert.equal(response.status, 200);
  const { profile } = await response.json();
  assert.equal(profile.nameIsCustom, false);
  assert.equal(profile.name, "Split person 0");
  assert.deepEqual(profile.activities, []);
  assert.match(profile.profileId, /^[0-9a-f-]{36}$/);
  assert.notEqual(profile.profileId, actor.id);
  // Asking again keeps the same public handle.
  assert.equal((await mine(f, actor)).profileId, profile.profileId);
});

test("saving a name and activities", async (t) => {
  const f = await fixture(t);
  const [actor] = f.actors;
  const response = await save(f, actor, {
    name: "Sam 🏓",
    activities: [{ name: "pickleball", level: "advanced" }],
  });
  assert.equal(response.status, 200);
  const { profile } = await response.json();
  assert.equal(profile.name, "Sam 🏓");
  assert.equal(profile.nameIsCustom, true);
  assert.deepEqual(profile.activities, [
    { name: "Pickleball", level: "advanced" },
  ]);
  assert.deepEqual(await mine(f, actor), profile);
  const me = await (await f.get(actor, "/api/me")).json();
  assert.equal(me.displayName, "Sam 🏓");
  assert.equal(me.profileId, profile.profileId);
  // The account's own sign-in details are not touched.
  assert.equal(
    f.sql(
      `select raw_user_meta_data->>'full_name' from auth.users where id='${actor.id}';`,
    ),
    "Split person 0",
  );
});

test("a blank name clears the override", async (t) => {
  const f = await fixture(t);
  const [actor] = f.actors;
  assert.equal(
    (await save(f, actor, { name: "Sam", activities: [] })).status,
    200,
  );
  const response = await save(f, actor, { name: "   ", activities: [] });
  assert.equal(response.status, 200);
  const { profile } = await response.json();
  assert.equal(profile.nameIsCustom, false);
  assert.equal(profile.name, "Split person 0");
  assert.equal(
    f.sql(
      `select display_name is null from app.profiles where user_id='${actor.id}';`,
    ),
    "t",
  );
  assert.equal(
    (await (await f.get(actor, "/api/me")).json()).displayName,
    "Split person 0",
  );
});

test("80 code points pass and 81 fail", async (t) => {
  const f = await fixture(t);
  const [actor] = f.actors;
  const ok = await save(f, actor, { name: "🏓".repeat(80), activities: [] });
  assert.equal(ok.status, 200);
  assert.equal([...(await ok.json()).profile.name].length, 80);
  const tooLong = await save(f, actor, {
    name: "é".repeat(81),
    activities: [],
  });
  assert.equal(tooLong.status, 400);
  const body = await tooLong.json();
  assert.equal(body.error.code, "invalid_input");
  assert.equal(body.errors[0].field, "name");
  assert.equal([...(await mine(f, actor)).name].length, 80);
});

test("unknown and forbidden fields are refused and nothing changes", async (t) => {
  const f = await fixture(t);
  const [actor] = f.actors;
  assert.equal(
    (await save(f, actor, { name: "Kept", activities: [] })).status,
    200,
  );
  const before = await mine(f, actor);
  for (const extra of [
    { email: "a@b.c" },
    { role: "owner" },
    { profileId: randomUUID() },
  ]) {
    const response = await save(f, actor, {
      name: "X",
      activities: [],
      ...extra,
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "invalid_input");
  }
  const wrongKind = await save(f, actor, { name: 5, activities: [] });
  assert.equal(wrongKind.status, 400);
  const badActivity = await save(f, actor, {
    name: "X",
    activities: [{ name: "Tennis", level: "expert" }],
  });
  assert.equal(badActivity.status, 400);
  assert.deepEqual(await mine(f, actor), before);
});

test("activity rules are enforced with field errors", async (t) => {
  const f = await fixture(t);
  const [actor] = f.actors;
  const response = await save(f, actor, {
    name: "",
    activities: ["a", "b", "c", "d"].map((name) => ({ name, level: null })),
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).errors[0].field, "activities");
  // The database re-checks on its own; a caller skipping the API is still held to the limits.
  assert.throws(
    () =>
      f.sql(
        `select api.save_my_profile('${actor.id}','x','n','[{"name":"a","level":null},{"name":"A ","level":null}]'::jsonb);`,
      ),
    /invalid_profile/,
  );
});

test("signed out cannot read or save my profile", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.get(null, "/api/me/profile")).status, 401);
  assert.equal(
    (await save(f, null, { name: "X", activities: [] })).status,
    401,
  );
});

test("one person cannot change another person's profile", async (t) => {
  const f = await fixture(t);
  const [a, b] = f.actors;
  const theirs = await mine(f, b);
  // The target is always the signed-in person, whatever the body says.
  assert.equal(
    (await save(f, a, { name: "Mine", activities: [], userId: b.id })).status,
    400,
  );
  assert.equal(
    (await save(f, a, { name: "Mine", activities: [] })).status,
    200,
  );
  assert.deepEqual(await mine(f, b), theirs);
});

test("a public profile shows only its page fields", async (t) => {
  const f = await fixture(t);
  const [actor] = f.actors;
  // Owning the seed group earns a badge that names it; choose it as the title.
  f.sql(
    `insert into app.group_roles(group_id,user_id,role) values ('${f.firstGroup}','${actor.id}','owner') on conflict do nothing;`,
  );
  const { profile } = await (
    await save(f, actor, {
      name: "Sam",
      activities: [{ name: "Tennis", level: null }],
    })
  ).json();
  const badgeId = `founder:${f.firstGroup}`;
  f.sql(
    `insert into app.user_titles(user_id,badge_id) values ('${actor.id}','${badgeId}');`,
  );

  const response = await f.get(null, `/api/people/${profile.profileId}`);
  assert.equal(response.status, 200);
  const { profile: shown } = await response.json();
  assert.deepEqual(Object.keys(shown).sort(), [
    "activities",
    "badges",
    "name",
    "profileId",
    "stats",
    "title",
  ]);
  assert.equal(shown.name, "Sam");
  assert.deepEqual(shown.activities, [{ name: "Tennis", level: null }]);
  assert.deepEqual(shown.title, { key: "founder" });
  assert.ok(shown.badges.length >= 1);
  for (const badge of shown.badges)
    assert.deepEqual(Object.keys(badge).sort(), ["earnedAt", "key"]);
  assert.deepEqual(Object.keys(shown.stats).sort(), [
    "groups",
    "hosted",
    "played",
  ]);
  const email = f.sql(`select email from auth.users where id='${actor.id}';`);
  const text = JSON.stringify(shown);
  assert.ok(email.includes("@"));
  for (const secret of [email, actor.id, "Sunday Social Club", f.firstGroup])
    assert.ok(
      !text.includes(secret),
      `public profile must not contain ${secret}`,
    );
  // Case of the link does not matter; it is the same profile.
  assert.equal(
    (await f.get(null, `/api/people/${profile.profileId.toUpperCase()}`))
      .status,
    200,
  );
});

test("an unknown profile id is not found", async (t) => {
  const f = await fixture(t);
  for (const id of [randomUUID(), "not-a-uuid"]) {
    const response = await f.get(null, `/api/people/${id}`);
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.error.code, "not_found");
    assert.equal(body.error.message, "Profile not found");
  }
});

// One name everywhere: a fixed-fee session with actor 0 booked, so there is a
// party, a fee and a payment history to rename.
async function booked(t) {
  const f = await splitFixture(t, {
    feeMode: "fixed",
    total: "10.00",
    seats: [1],
    capacity: 2,
  });
  t.after(() => {
    f.sql(
      `delete from app.profiles where user_id in (${f.actors.map((a) => `'${a.id}'`).join(",")});`,
    );
  });
  return f;
}
const entryFor = async (f, index) => {
  const response = await f.get(
    f.organizer,
    `/api/registrations/${f.session.slug}`,
  );
  const { registration } = await response.json();
  return registration.roster.find((p) => p.id === f.parties[index].id);
};

test("a rename shows on a roster made before it", async (t) => {
  const f = await booked(t);
  const [actor] = f.actors;
  const { profile } = await (
    await save(f, actor, { name: "Renamed Sam", activities: [] })
  ).json();
  const entry = await entryFor(f, 0);
  assert.equal(entry.primaryName, "Renamed Sam");
  assert.equal(entry.profileId, profile.profileId);
  assert.equal(
    f.sql(
      `select primary_name from app.parties where id='${f.parties[0].id}';`,
    ),
    "Renamed Sam",
  );
});

test("a rename shows on a new booking", async (t) => {
  const f = await booked(t);
  const actor = f.actors[1];
  assert.equal(
    (await save(f, actor, { name: "Fresh Name", activities: [] })).status,
    200,
  );
  assert.equal((await f.join(actor)).primaryName, "Fresh Name");
});

test("organizer actions carry the organizer's current name", async (t) => {
  const f = await booked(t);
  t.after(async () => {
    // The organizer account is shared; put their profile back.
    await save(f, f.organizer, { name: "", activities: [] });
  });
  const before = (await entryFor(f, 0)).fee;
  const paid = await f.post(
    f.organizer,
    `/api/registrations/${f.session.slug}/payments`,
    {
      operationKey: randomUUID(),
      partyId: f.parties[0].id,
      action: "mark_paid",
      revision: before.revision,
    },
  );
  assert.equal(paid.status, 200);
  assert.equal(
    (await save(f, f.organizer, { name: "Org Renamed", activities: [] }))
      .status,
    200,
  );
  assert.equal(
    f.sql(
      `select string_agg(distinct actor_name,',') from app.fee_changes where party_id='${f.parties[0].id}' and actor_id='${f.organizer.id}';`,
    ),
    "Org Renamed",
  );
  // Only the name moved: the payment itself is as the organizer left it.
  assert.equal((await entryFor(f, 0)).fee.revision, before.revision + 1);
});

test("clearing a name puts the account name back on old records", async (t) => {
  const f = await booked(t);
  const [actor] = f.actors;
  await save(f, actor, { name: "Renamed Sam", activities: [] });
  assert.equal((await entryFor(f, 0)).primaryName, "Renamed Sam");
  assert.equal(
    (await save(f, actor, { name: "", activities: [] })).status,
    200,
  );
  assert.equal((await entryFor(f, 0)).primaryName, "Split person 0");
});

test("a roster person without a profile row stays readable", async (t) => {
  const f = await booked(t);
  const [actor] = f.actors;
  f.sql(`delete from app.profiles where user_id='${actor.id}';`);
  const entry = await entryFor(f, 0);
  assert.equal(entry.profileId, null);
  assert.ok(entry.primaryName.length > 0);
});

test("a rename changes names only and sends no email", async (t) => {
  const f = await booked(t);
  const [actor] = f.actors;
  const rows = () =>
    f.sql(
      `select coalesce(jsonb_agg(to_jsonb(p) - 'primary_name' order by p.id),'[]') from app.parties p where p.session_id='${f.session.id}';`,
    );
  const jobs = () => f.sql("select count(*) from app.email_jobs;");
  const before = { rows: rows(), jobs: jobs() };
  await save(f, actor, { name: "Only A Name", activities: [] });
  assert.equal(rows(), before.rows);
  assert.equal(jobs(), before.jobs);
});
