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
const nonce = crypto.randomUUID().slice(0, 8);
async function login(email) {
  const { data, error } = await createClient(
    env.SUPABASE_URL,
    env.SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  ).auth.signInWithPassword({ email, password: fixturePassword });
  assert.ok(!error && data.session, "Synthetic sign-in must succeed");
  return { id: data.user.id, token: data.session.access_token };
}
let count = 0;
async function person(name) {
  const email = `sd-${nonce}-${++count}@rallypoint.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: fixturePassword,
    email_confirm: true,
    user_metadata: { full_name: name },
  });
  assert.ok(!error && data.user);
  const me = await login(email);
  const profileId = sql(
    `select api.ensure_my_profile('${me.id}','${name}')->>'profileId';`,
  );
  return { ...me, profileId, email, name };
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
const key = () => crypto.randomUUID();
// Singapore has no clock changes: local time is UTC+8.
const sgLocal = (ms) => new Date(ms + 8 * 3600000).toISOString().slice(0, 16);
const sgMidnight = () => {
  const d = new Date(Date.now() + 8 * 3600000);
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - 8 * 3600000,
  ).toISOString();
};
// A published session `days` from now at local `hour`:00 in Singapore.
async function publish(host, title, { days = 1, hour = 19, access } = {}) {
  const startMs = Date.parse(sgMidnight()) + days * 86400000 + hour * 3600000;
  const r = await request(`/api/groups/${firstGroup}/sessions`, host, {
    operationKey: key(),
    groupId: firstGroup,
    intent: "publish",
    details: {
      title,
      activity: "Pickleball",
      startLocal: sgLocal(startMs),
      endLocal: sgLocal(startMs + 90 * 60000),
      timeZone: "Asia/Singapore",
      location: `Court ${nonce}`,
      instructions: "Test only",
      capacity: "8",
      openLocal: sgLocal(Date.now() - 3600000),
      cutoffLocal: sgLocal(Math.max(Date.now(), startMs - 86400000)),
      fee: "0",
      currency: "SGD",
      guests: false,
      ...(access ? { access } : {}),
    },
  });
  assert.equal(r.status, 200, await r.clone().text());
  return (await r.json()).session;
}
const unguarded = (statement) =>
  sql(`begin; alter table app.sessions disable trigger protect_booked_session;
    ${statement};
    alter table app.sessions enable trigger protect_booked_session; commit;`);
const sessions = async (actor, q) => {
  const params = new URLSearchParams({
    from: sgMidnight(),
    tz: "Asia/Singapore",
  });
  if (q) params.set("q", q);
  const r = await request(`/api/search/sessions?${params}`, actor);
  assert.equal(r.status, 200, await r.clone().text());
  return (await r.json()).sessions;
};
const titles = (rows) => rows.map((r) => r.title).sort();

test("public sessions in the next 14 days come by day; private, draft, cancelled and ended ones never do", async () => {
  const host = await login("organizer@rallypoint.test");
  const shown = await publish(host, `Shown ${nonce}`, { days: 2 });
  const legacy = await publish(host, `Legacy ${nonce}`, { days: 3 });
  unguarded(
    `update app.sessions set details = details - 'access' where id = '${legacy.id}'`,
  );
  await publish(host, `Hidden ${nonce}`, { access: "private" });
  const ended = await publish(host, `Ended ${nonce}`, { days: 1 });
  unguarded(`update app.sessions set details = jsonb_set(jsonb_set(details, '{startsAt}',
    to_jsonb(now() - interval '3 hours')), '{endsAt}', to_jsonb(now() - interval '1 hour'))
    where id = '${ended.id}'`);
  const far = await publish(host, `Far ${nonce}`, { days: 15 });
  const cancelled = await publish(host, `Cancelled ${nonce}`, { days: 4 });
  const c = await request(`/api/sessions/${cancelled.id}/cancel`, host, {
    operationKey: key(),
  });
  assert.equal(c.status, 200);
  const rows = await sessions(host, nonce);
  assert.deepEqual(titles(rows), [`Legacy ${nonce}`, `Shown ${nonce}`]);
  const row = rows.find((r) => r.title === `Shown ${nonce}`);
  const day = new Date(Date.parse(sgMidnight()) + 2 * 86400000 + 8 * 3600000)
    .toISOString()
    .slice(0, 10);
  assert.equal(row.day, day);
  assert.equal(row.slug, shown.slug);
  assert.equal(row.activity, "Pickleball");
  assert.equal(row.capacity, 8);
  assert.equal(row.takenSeats, 0);
  assert.equal(row.happeningNow, false);
  assert.equal(typeof row.hostName, "string");
  assert.ok(!JSON.stringify(rows).includes(far.slug));
});

test("a session that started and hasn't ended shows today as happening now", async () => {
  const host = await login("organizer@rallypoint.test");
  const live = await publish(host, `Live ${nonce}`, { days: 1 });
  unguarded(`update app.sessions set details = jsonb_set(jsonb_set(details, '{startsAt}',
    to_jsonb(now() - interval '20 minutes')), '{endsAt}', to_jsonb(now() + interval '1 hour'))
    where id = '${live.id}'`);
  const [row] = await sessions(host, `Live ${nonce}`);
  assert.equal(row.happeningNow, true);
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  assert.equal(row.day, today);
});

test("typing matches title, place and a public host's name, but not a private host's", async () => {
  const shy = await person(`Shyhost ${nonce}`);
  const open = await person(`Openhost ${nonce}`);
  const byShy = await publish(shy, `Plain one ${nonce}`, { days: 5 });
  const byOpen = await publish(open, `Plain two ${nonce}`, { days: 5 });
  const viewer = await person(`Viewer ${nonce}`);
  assert.equal(
    (
      await request("/api/me/profile/discoverable", shy, {
        discoverable: false,
      })
    ).status,
    200,
  );
  assert.deepEqual(
    (await sessions(viewer, `Openhost ${nonce}`)).map((r) => r.slug),
    [byOpen.slug],
  );
  assert.deepEqual(await sessions(viewer, `Shyhost ${nonce}`), []);
  assert.equal(
    (await sessions(viewer, `Court ${nonce}`)).some(
      (r) => r.slug === byShy.slug,
    ),
    true,
  );
  const shown = (await sessions(viewer, `Plain one ${nonce}`))[0];
  assert.equal(shown.hostName.includes("Shyhost"), true);
});

test("each day holds at most 50 sessions", async () => {
  const host = await login("organizer@rallypoint.test");
  const seed = await publish(host, `Crowd ${nonce} seed`, { days: 6 });
  sql(`insert into app.sessions(id, group_id, slug, state, version, details, activity_key)
    select gen_random_uuid(), s.group_id, gen_random_uuid(), s.state, s.version,
      jsonb_set(s.details, '{title}', to_jsonb('Crowd ${nonce} ' || n)), s.activity_key
    from app.sessions s, generate_series(1, 50) n where s.id = '${seed.id}';`);
  const rows = await sessions(host, `Crowd ${nonce}`);
  assert.equal(rows.length, 50);
});

test("a bad time zone or query is refused with 422", async () => {
  const host = await login("organizer@rallypoint.test");
  const bad = (params) =>
    request(`/api/search/sessions?${new URLSearchParams(params)}`, host);
  assert.equal(
    (await bad({ from: sgMidnight(), tz: "Mars/Olympus" })).status,
    422,
  );
  assert.equal(
    (await bad({ from: "yesterday", tz: "Asia/Singapore" })).status,
    422,
  );
  assert.equal(
    (await bad({ from: sgMidnight(), tz: "Asia/Singapore", q: "x" })).status,
    422,
  );
  assert.equal((await request("/api/search/sessions")).status, 401);
});

test("people search finds public profiles by shown name and nothing private", async () => {
  const found = await person(`Findable ${nonce}`);
  const hidden = await person(`Findable hidden ${nonce}`);
  sql(
    `update app.profiles set discoverable = false where user_id = '${hidden.id}';`,
  );
  sql(`insert into app.profile_activities(user_id, position, activity_key, level)
    values ('${found.id}', 1, 'pickleball', 'intermediate');`);
  const viewer = await person(`Seeker ${nonce}`);
  const r = await request(
    `/api/search/people?q=${encodeURIComponent(`findable ${nonce}`)}`,
    viewer,
  );
  assert.equal(r.status, 200);
  const { people } = await r.json();
  assert.deepEqual(
    people.map((p) => p.profileId),
    [found.profileId],
  );
  assert.equal(people[0].name, found.name);
  assert.deepEqual(people[0].activities, [
    { name: "Pickleball", level: "intermediate" },
  ]);
  const text = JSON.stringify(people);
  assert.ok(!text.includes("@rallypoint.test"));
  assert.ok(!text.includes(found.id));
  assert.equal((await request("/api/search/people?q=a", viewer)).status, 422);
});

test("a profile is public by default and can be made private", async () => {
  const me = await person(`Toggler ${nonce}`);
  const viewer = await person(`Watcher ${nonce}`);
  const mine = async () =>
    (await (await request("/api/me/profile", me)).json()).profile;
  const find = async () =>
    (
      await (
        await request(
          `/api/search/people?q=${encodeURIComponent(`Toggler ${nonce}`)}`,
          viewer,
        )
      ).json()
    ).people.length;
  assert.equal((await mine()).discoverable, true);
  assert.equal(await find(), 1);
  const r = await request("/api/me/profile/discoverable", me, {
    discoverable: false,
  });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).discoverable, false);
  assert.equal((await mine()).discoverable, false);
  assert.equal(await find(), 0);
});

test("clubs: browsing lists public groups by size; a search shows a private group's name only", async () => {
  const owner = await person(`Clubber ${nonce}`);
  const make = (name, visibility) =>
    sql(`with g as (insert into app.groups(name, kind, visibility) values ('${name}', 'community', '${visibility}')
      returning id) insert into app.group_roles(group_id, user_id, role) select id, '${owner.id}', 'owner' from g
      returning group_id;`);
  const open = make(`Open club ${nonce}`, "public");
  const closed = make(`Closed club ${nonce}`, "private");
  const viewer = await person(`Browser ${nonce}`);
  const browse = await (await request("/api/search/clubs", viewer)).json();
  assert.ok(browse.clubs.length <= 30);
  assert.ok(browse.clubs.every((c) => c.visibility === "public"));
  for (let i = 1; i < browse.clubs.length; i++)
    assert.ok(browse.clubs[i - 1].members >= browse.clubs[i].members);
  const found = await (
    await request(
      `/api/search/clubs?q=${encodeURIComponent(`club ${nonce}`)}`,
      viewer,
    )
  ).json();
  const openRow = found.clubs.find((c) => c.name === `Open club ${nonce}`);
  const closedRow = found.clubs.find((c) => c.name === `Closed club ${nonce}`);
  assert.equal(openRow.id, open);
  assert.equal(openRow.members, 1);
  assert.deepEqual(Object.keys(closedRow).sort(), ["name", "visibility"]);
  assert.ok(!JSON.stringify(found).includes(closed));
});
