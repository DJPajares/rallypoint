import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import {
  localEnv,
  fixturePassword,
  firstGroup,
} from "../scripts/local-env.mjs";
// The shared activity catalog (D-23): what it serves, and the per-activity
// limits a session save must respect.
const env = localEnv(),
  base = process.env.RALLYPOINT_TEST_URL ?? "http://127.0.0.1:3000";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const sql = (q) =>
  execFileSync("pnpm", ["exec", "supabase", "db", "query", "--local", q], {
    stdio: "pipe",
  });
async function login(name) {
  const c = createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await c.auth.signInWithPassword({
    email: `${name}@rallypoint.test`,
    password: fixturePassword,
  });
  assert.ok(!error && data.session);
  return { token: data.session.access_token, id: data.user.id };
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
const day = 86400000;
const form = (patch = {}) => {
  const start = Date.now() + 5 * day;
  return {
    title: "Synthetic activity limits",
    activity: "Pickleball",
    startLocal: local(start),
    endLocal: local(start + 2 * 3600000),
    timeZone: "UTC",
    location: "Synthetic Court",
    instructions: "",
    capacity: "8",
    openLocal: local(Date.now() - 3600000),
    cutoffLocal: local(start - day),
    fee: "0.00",
    currency: "USD",
    guests: false,
    paymentMode: "untracked",
    ...patch,
  };
};
const create = (actor, details, intent = "publish") =>
  request(`/api/groups/${firstGroup}/sessions`, actor, {
    operationKey: crypto.randomUUID(),
    intent,
    groupId: firstGroup,
    details,
  });
const update = (actor, session, details) =>
  request(`/api/sessions/${session.id}`, actor, {
    operationKey: crypto.randomUUID(),
    intent: "update",
    groupId: firstGroup,
    version: session.version,
    details,
  });

test("the catalog is public, ordered and cacheable", async () => {
  const response = await request("/api/activities");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /max-age=300/);
  const { activities } = await response.json();
  assert.deepEqual(
    activities.map((a) => a.key),
    ["pickleball", "badminton", "tennis", "basketball", "general"],
  );
  const pickleball = activities[0];
  assert.deepEqual(pickleball.limits, {
    minCapacity: 4,
    maxCapacity: 24,
    minDurationMinutes: 30,
    maxDurationMinutes: 240,
  });
  assert.equal(pickleball.defaults.capacity, 8);
  assert.equal(typeof pickleball.levels.beginner, "string");
  assert.equal(activities.at(-1).listed, false);
});

test("session saves respect the activity's limits", async (t) => {
  const organizer = await login("organizer");
  // Like the other session suites, these synthetic sessions stay in the local
  // database: their history rows keep them from being deleted.
  const publish = async (patch) => {
    const response = await create(organizer, form(patch));
    return { response, body: await response.json() };
  };

  await t.test("out-of-range spots are refused on publish", async () => {
    const { response, body } = await publish({ capacity: "30" });
    assert.equal(response.status, 422);
    assert.equal(
      body.error.message,
      "Pickleball sessions can have 4 to 24 spots.",
    );
    assert.equal((await publish({ capacity: "24" })).response.status, 200);
  });

  await t.test("out-of-range length is refused on publish", async () => {
    const start = Date.now() + 5 * day;
    const { response, body } = await publish({
      startLocal: local(start),
      endLocal: local(start + 5 * 3600000),
    });
    assert.equal(response.status, 422);
    assert.equal(
      body.error.message,
      "Pickleball sessions can run 30 minutes to 4 hours.",
    );
  });

  await t.test("unchanged out-of-range spots still save", async () => {
    const { body } = await publish({ capacity: "20" });
    const session = body.session;
    sql(
      `update app.sessions set details=jsonb_set(details,'{capacity}','30') where id='${session.id}';`,
    );
    const response = await update(
      organizer,
      session,
      form({ capacity: "30", title: "Renamed" }),
    );
    assert.equal(response.status, 200, await response.clone().text());
  });

  await t.test(
    "moving an old over-length session keeps its length and saves",
    async () => {
      const { body } = await publish({});
      const session = body.session;
      // Five hours, as a session saved before the 4-hour Pickleball limit.
      sql(
        `update app.sessions set details=jsonb_set(details,'{endsAt}',to_jsonb(((details->>'startsAt')::timestamptz + interval '5 hours')::text)) where id='${session.id}';`,
      );
      const start = Date.now() + 12 * day;
      const response = await update(
        organizer,
        session,
        form({
          startLocal: local(start),
          endLocal: local(start + 5 * 3600000),
          cutoffLocal: local(start - day),
        }),
      );
      assert.equal(response.status, 200, await response.clone().text());
    },
  );

  await t.test("switching sport rechecks spots", async () => {
    const { body } = await publish({ activity: "Basketball", capacity: "30" });
    const response = await update(
      organizer,
      body.session,
      form({ activity: "Tennis", capacity: "30" }),
    );
    assert.equal(response.status, 422);
    assert.equal(
      (await response.json()).error.message,
      "Tennis sessions can have 2 to 16 spots.",
    );
  });

  await t.test("a typed activity uses the common limits", async () => {
    const refused = await publish({ activity: "Pottery", capacity: "250" });
    assert.equal(refused.response.status, 422);
    assert.equal(
      refused.body.error.message,
      "These sessions can have 1 to 200 spots.",
    );
    const kept = await publish({ activity: "Pottery", capacity: "40" });
    assert.equal(kept.response.status, 200);
    assert.equal(kept.body.session.details.activity, "Pottery");
    const key = sql(
      `select coalesce(activity_key,'none') k from app.sessions where id='${kept.body.session.id}';`,
    ).toString();
    assert.match(key, /"k": "none"/);
  });

  await t.test("a listed activity is linked by name", async () => {
    const { body } = await publish({ activity: "  badminton " });
    const key = sql(
      `select activity_key k from app.sessions where id='${body.session.id}';`,
    ).toString();
    assert.match(key, /"k": "badminton"/);
  });

  await t.test("drafts are never limited", async () => {
    const response = await create(
      organizer,
      form({ capacity: "999" }),
      "draft",
    );
    assert.equal(response.status, 200);
  });
});

test("profile activities keep order, levels and typed names", async (t) => {
  const actor = await login("newcomer");
  t.after(() =>
    request("/api/me/profile", actor, { name: "", activities: [] }),
  );
  const response = await request("/api/me/profile", actor, {
    name: "",
    activities: [
      { name: "badminton", level: "intermediate" },
      { name: "Pottery", level: null },
      { name: "Chess", level: "beginner" },
    ],
  });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).profile.activities, [
    { name: "Badminton", level: "intermediate", key: "badminton" },
    { name: "Pottery", level: null, key: null },
    { name: "Chess", level: "beginner", key: null },
  ]);
});
