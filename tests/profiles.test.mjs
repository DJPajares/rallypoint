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
