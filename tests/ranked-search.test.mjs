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
async function person(label) {
  const email = `rs-${nonce}-${label}@rallypoint.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: fixturePassword,
    email_confirm: true,
    user_metadata: { full_name: `Search ${label} ${nonce}` },
  });
  assert.ok(!error && data.user);
  const me = await login(email);
  const profileId = sql(
    `select api.ensure_my_profile('${me.id}','Search ${label} ${nonce}')->>'profileId';`,
  );
  return { ...me, profileId, name: `Search ${label} ${nonce}` };
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
const start = (actor, choices) =>
  request("/api/ranked/search", actor, {
    operationKey: key(),
    format: "singles",
    areas: ["pasir-ris"],
    courts: [],
    windows: [],
    ...choices,
  });
async function mine(actor) {
  const r = await request("/api/ranked/search", actor);
  assert.equal(r.status, 200);
  return r.json();
}
const code = async (r) => (await r.json()).error?.code;
const cancel = (actor, id) =>
  request(`/api/ranked/search/${id}/cancel`, actor, { operationKey: key() });
const answer = (actor, token, accept) =>
  request(`/api/ranked/invites/${token}`, actor, {
    operationKey: key(),
    accept,
  });

// Two people checked in at the same session: the organizer records both.
async function playTogether(a, b) {
  const organizer = await login("organizer@rallypoint.test");
  const local = (ms) => new Date(ms).toISOString().slice(0, 16);
  const now = Date.now();
  const created = await request(
    `/api/groups/${firstGroup}/sessions`,
    organizer,
    {
      operationKey: key(),
      groupId: firstGroup,
      intent: "publish",
      details: {
        title: `Search fixture ${nonce}`,
        activity: "Pickleball",
        startLocal: local(now + 86400000),
        endLocal: local(now + 93600000),
        timeZone: "UTC",
        location: "Synthetic court",
        instructions: "Test only",
        capacity: "4",
        openLocal: local(now - 3600000),
        cutoffLocal: local(now + 43200000),
        fee: "0",
        currency: "SGD",
        guests: false,
      },
    },
  );
  assert.equal(created.status, 200);
  const s = (await created.json()).session;
  for (const p of [a, b]) {
    const joined = await request(`/api/registrations/${s.slug}`, p, {
      operationKey: key(),
      version: s.version,
      seats: 1,
      guestName: "",
      consent: true,
    });
    assert.equal(joined.status, 200);
    const party = (await joined.json()).registration.own;
    const marked = await request(
      `/api/registrations/${s.slug}/attendance`,
      organizer,
      {
        operationKey: key(),
        partyId: party.id,
        seat: 1,
        state: "checked_in",
        revision: 0,
      },
    );
    assert.equal(marked.status, 200);
  }
}

test("a singles search takes 1 to 3 areas and starts searching", async () => {
  const me = await person("singles");
  for (const areas of [[], ["bedok", "tampines", "yishun", "clementi"]]) {
    const r = await start(me, { areas });
    assert.equal(r.status, 422, JSON.stringify(areas));
  }
  assert.equal((await start(me, { areas: ["atlantis"] })).status, 422);
  const r = await start(me, {
    areas: ["pasir-ris", "tampines", "downtown-core"],
    windows: ["weekday-evenings", "weekend-mornings"],
  });
  assert.equal(r.status, 200);
  const { search } = await mine(me);
  assert.equal(search.state, "searching");
  assert.equal(search.format, "singles");
  assert.deepEqual(
    search.areas.map((a) => a.label),
    ["Pasir Ris", "Tampines", "CBD (Downtown Core)"],
  );
  assert.deepEqual(search.windows, ["weekday-evenings", "weekend-mornings"]);
  const days = (Date.parse(search.endsAt) - Date.now()) / 86400000;
  assert.ok(days > 6.9 && days <= 7, String(days));
});

test("preferred courts must be in the chosen areas, at most 5", async () => {
  const me = await person("courts");
  const court = (area, label) =>
    sql(
      `insert into app.courts(area_key,name) values ('${area}','${label} ${nonce}') returning id;`,
    );
  const inside = court("bedok", "Bedok A");
  const outside = court("yishun", "Yishun A");
  assert.equal(
    (await start(me, { areas: ["bedok"], courts: [outside] })).status,
    422,
  );
  const many = ["B", "C", "D", "E", "F", "G"].map((x) =>
    court("bedok", `Bedok ${x}`),
  );
  assert.equal(
    (await start(me, { areas: ["bedok"], courts: many })).status,
    422,
  );
  assert.equal(
    (await start(me, { areas: ["bedok"], courts: [inside] })).status,
    200,
  );
  const { search } = await mine(me);
  assert.deepEqual(
    search.courts.map((c) => c.id),
    [inside],
  );
});

test("one search at a time", async () => {
  const me = await person("one");
  assert.equal((await start(me)).status, 200);
  const again = await start(me, { format: "doubles", partner: { link: true } });
  assert.equal(again.status, 409);
  assert.equal(await code(again), "search_active");
});

test("doubles waits for the partner, who accepts or declines", async () => {
  const [a, b, c] = [await person("a"), await person("b"), await person("c")];
  await playTogether(a, b);
  await playTogether(a, c);
  const r = await start(a, {
    format: "doubles",
    partner: { profileId: b.profileId },
  });
  assert.equal(r.status, 200);
  const waiting = (await mine(a)).search;
  assert.equal(waiting.state, "waiting_partner");
  assert.equal(waiting.partner.name, b.name);
  const { invites } = await mine(b);
  assert.equal(invites.length, 1);
  assert.equal(invites[0].starterName, a.name);
  assert.equal(invites[0].format, "doubles");
  assert.equal((await answer(b, invites[0].token, true)).status, 200);
  for (const p of [a, b]) {
    const { search } = await mine(p);
    assert.equal(search.state, "searching", p.name);
    assert.equal(search.id, waiting.id);
  }
  assert.equal((await mine(b)).search.partner.name, a.name);
  // B is in a search now, so starting another is refused.
  assert.equal(await code(await start(b)), "search_active");

  // Declining ends a waiting search, and the starter is free again.
  await cancel(a, waiting.id);
  assert.equal(
    (await start(a, { format: "doubles", partner: { profileId: c.profileId } }))
      .status,
    200,
  );
  const invite = (await mine(c)).invites[0];
  assert.equal((await answer(c, invite.token, false)).status, 200);
  const declined = (await mine(a)).search;
  assert.equal(declined.state, "ended");
  assert.equal(declined.endReason, "declined");
  assert.equal((await start(a)).status, 200);
});

test("partners are people you've played with, or anyone with your link", async () => {
  const [a, met, stranger, linked] = [
    await person("pa"),
    await person("met"),
    await person("stranger"),
    await person("linked"),
  ];
  await playTogether(a, met);
  const partners = await (await request("/api/ranked/partners", a)).json();
  const ids = partners.people.map((p) => p.profileId);
  assert.ok(ids.includes(met.profileId));
  assert.ok(!ids.includes(stranger.profileId));
  assert.deepEqual(Object.keys(partners.people[0]).sort(), [
    "name",
    "profileId",
  ]);
  const direct = await start(a, {
    format: "doubles",
    partner: { profileId: stranger.profileId },
  });
  assert.equal(direct.status, 409);
  assert.equal(await code(direct), "not_known");

  assert.equal(
    (await start(a, { format: "doubles", partner: { link: true } })).status,
    200,
  );
  const { search } = await mine(a);
  assert.equal(search.state, "waiting_partner");
  assert.equal(search.partner, null);
  assert.match(search.inviteToken, /^[0-9a-f-]{36}$/);
  // The link shows only what the invitee needs.
  const opened = await request(
    `/api/ranked/invites/${search.inviteToken}`,
    linked,
  );
  assert.equal(opened.status, 200);
  const { invite } = await opened.json();
  assert.equal(invite.starterName, a.name);
  assert.equal((await answer(a, search.inviteToken, true)).status, 409);
  assert.equal((await answer(linked, search.inviteToken, true)).status, 200);
  assert.equal((await mine(a)).search.partner.name, linked.name);
  assert.equal((await mine(a)).search.inviteToken, null);
  // Used up: nobody else can take the spot.
  assert.equal((await answer(stranger, search.inviteToken, true)).status, 409);
});

test("a search ends after 7 days and restarts with the same choices", async () => {
  const me = await person("expire");
  await start(me, {
    areas: ["bedok", "tampines"],
    windows: ["weekend-evenings"],
  });
  const first = (await mine(me)).search;
  sql(
    `update app.ranked_searches set ends_at=now()-interval '1 minute' where id='${first.id}';`,
  );
  const ended = (await mine(me)).search;
  assert.equal(ended.state, "ended");
  assert.equal(ended.endReason, "expired");
  const r = await request(`/api/ranked/search/${first.id}/restart`, me, {
    operationKey: key(),
  });
  assert.equal(r.status, 200);
  const again = (await mine(me)).search;
  assert.notEqual(again.id, first.id);
  assert.equal(again.state, "searching");
  assert.deepEqual(again.areas, ended.areas);
  assert.deepEqual(again.windows, ["weekend-evenings"]);
});

test("only the searchers can see or cancel a search", async () => {
  const [a, b, outsider] = [
    await person("sa"),
    await person("sb"),
    await person("outsider"),
  ];
  await playTogether(a, b);
  await start(a, { format: "doubles", partner: { profileId: b.profileId } });
  const { search } = await mine(a);
  assert.equal((await mine(outsider)).search, null);
  assert.equal((await cancel(outsider, search.id)).status, 404);
  assert.equal(
    (await answer(outsider, (await mine(b)).invites[0].token, true)).status,
    404,
  );
  assert.equal((await request("/api/ranked/search", null)).status, 401);
  // Either searcher can cancel; it ends for both.
  await answer(b, (await mine(b)).invites[0].token, true);
  assert.equal((await cancel(b, search.id)).status, 200);
  for (const p of [a, b]) {
    const s = (await mine(p)).search;
    assert.equal(s.state, "ended");
    assert.equal(s.endReason, "cancelled");
  }
});
