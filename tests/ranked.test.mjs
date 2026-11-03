import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";

import { createClient } from "@supabase/supabase-js";
import { localEnv, fixturePassword } from "../scripts/local-env.mjs";
const env = localEnv();
const psql = [
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
];
const sql = (query) =>
  execFileSync("docker", psql, {
    input: query,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
// The same statement on its own connection, so two can run at once.
const sqlAsync = (query) => {
  const child = execFile("docker", psql, { encoding: "utf8" });
  child.stdin.end(query);
  return new Promise((resolve, reject) => {
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("close", (status) =>
      status === 0 ? resolve(out.trim()) : reject(new Error(`psql ${status}`)),
    );
  });
};
const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const nonce = crypto.randomUUID().slice(0, 8);
async function player(label) {
  const { data, error } = await admin.auth.admin.createUser({
    email: `rk-${nonce}-${label}@rallypoint.test`,
    password: fixturePassword,
    email_confirm: true,
    user_metadata: { full_name: `Ranked ${label} ${nonce}` },
  });
  assert.ok(!error && data.user);
  return data.user.id;
}
const ids = (list) => `array[${list.map((id) => `'${id}'::uuid`).join(",")}]`;
const apply = (format, winners, losers, resultId = crypto.randomUUID()) =>
  sql(
    `select app.apply_ranked_result('${resultId}','pickleball','${format}',${ids(winners)},${ids(losers)},now());`,
  );
// The display scale of the hidden skill, as the standing's target reads it.
function rating(user, format = "singles") {
  const row = sql(
    `select round((173.7178*mu+1500)::numeric,4),round((173.7178*phi)::numeric,4),matches from app.ranked_ratings where user_id='${user}' and activity_key='pickleball' and format='${format}';`,
  );
  if (!row) return null;
  const [r, rd, matches] = row.split("|").map(Number);
  return { r, rd, matches };
}
// Fixtures set a starting point directly, on the display scale.
const preset = (user, format, r, rd = 100, lastPlayed = "now()") =>
  sql(
    `insert into app.ranked_ratings(user_id,activity_key,format,mu,phi,sigma,matches,last_played_at) values ('${user}','pickleball','${format}',(${r}-1500)/173.7178,${rd}/173.7178,0.06,10,${lastPlayed}) on conflict (user_id,activity_key,format) do update set mu=excluded.mu,phi=excluded.phi,sigma=excluded.sigma,matches=excluded.matches,last_played_at=excluded.last_played_at;`,
  );
const refused = (fn) =>
  assert.throws(fn, (e) => /ranked_invalid_result/.test(String(e.stderr)));

test("a win raises the winner and lowers the loser", async () => {
  const [a, b] = [await player("a"), await player("b")];
  assert.equal(apply("singles", [a], [b]), "t");
  const [ra, rb] = [rating(a), rating(b)];
  assert.ok(ra.r > 1500 && rb.r < 1500, JSON.stringify({ ra, rb }));
  assert.equal(ra.matches, 1);
  assert.ok(ra.rd < 350, "confidence grows after a match");
});

test("an upset moves both more than an expected result", async () => {
  const [fav1, dog1, fav2, dog2] = [
    await player("fav1"),
    await player("dog1"),
    await player("fav2"),
    await player("dog2"),
  ];
  for (const [f, d] of [
    [fav1, dog1],
    [fav2, dog2],
  ]) {
    preset(f, "singles", 1800);
    preset(d, "singles", 1400);
  }
  apply("singles", [fav1], [dog1]); // expected
  apply("singles", [dog2], [fav2]); // upset
  const expectedGain = rating(fav1).r - 1800,
    upsetGain = rating(dog2).r - 1400;
  const expectedLoss = 1400 - rating(dog1).r,
    upsetLoss = 1800 - rating(fav2).r;
  assert.ok(upsetGain > expectedGain && upsetLoss > expectedLoss);
});

test("doubles moves all four and uses the team average", async () => {
  const p = {};
  for (const k of ["me1", "strong", "me2", "weak", "o1", "o2", "o3", "o4"])
    p[k] = await player(k);
  for (const k of ["me1", "me2", "o1", "o2", "o3", "o4"])
    preset(p[k], "doubles", 1500);
  preset(p.strong, "doubles", 1900);
  preset(p.weak, "doubles", 1100);
  apply("doubles", [p.me1, p.strong], [p.o1, p.o2]);
  apply("doubles", [p.me2, p.weak], [p.o3, p.o4]);
  for (const k of ["me1", "strong", "o1", "o2"])
    assert.notEqual(rating(p[k], "doubles").r, k === "strong" ? 1900 : 1500);
  // Beside a stronger partner the same win was expected, so it earns less.
  assert.ok(
    rating(p.me1, "doubles").r - 1500 < rating(p.me2, "doubles").r - 1500,
  );
  assert.equal(rating(p.me1, "singles"), null, "doubles never touches singles");
});

test("a retry of the same result changes ratings once", async () => {
  const [a, b] = [await player("ra"), await player("rb")];
  const id = crypto.randomUUID();
  assert.equal(apply("singles", [a], [b], id), "t");
  const once = rating(a);
  assert.equal(apply("singles", [a], [b], id), "f");
  assert.deepEqual(rating(a), once);
});

test("wrong team size, overlap and unknown format are refused and change nothing", async () => {
  const [a, b, c] = [
    await player("va"),
    await player("vb"),
    await player("vc"),
  ];
  refused(() => apply("singles", [a, c], [b]));
  refused(() => apply("doubles", [a, b], [b, c]));
  refused(() => apply("singles", [a], [a]));
  refused(() =>
    sql(
      `select app.apply_ranked_result('${crypto.randomUUID()}','pickleball','triples',${ids([a])},${ids([b])},now());`,
    ),
  );
  refused(() =>
    sql(
      `select app.apply_ranked_result('${crypto.randomUUID()}','basketball','singles',${ids([a])},${ids([b])},now());`,
    ),
  );
  for (const u of [a, b, c]) assert.equal(rating(u), null);
});

test("idle time makes the next match move more", async () => {
  const [idle, busy, o1, o2] = [
    await player("idle"),
    await player("busy"),
    await player("io1"),
    await player("io2"),
  ];
  preset(idle, "singles", 1600, 80, "now() - interval '120 days'");
  preset(busy, "singles", 1600, 80);
  preset(o1, "singles", 1600, 80);
  preset(o2, "singles", 1600, 80);
  apply("singles", [idle], [o1]);
  apply("singles", [busy], [o2]);
  assert.ok(rating(idle).r - 1600 > rating(busy).r - 1600);
});

test("concurrent results for a shared player both apply", async () => {
  // Rows exist already, so the second call waits on the row lock rather than
  // the first insert. Identical opponents make the order irrelevant, so the
  // concurrent outcome must equal applying them one after the other.
  const [shared, x, y, alone, x2, y2] = [
    await player("cs"),
    await player("cx"),
    await player("cy"),
    await player("cs2"),
    await player("cx2"),
    await player("cy2"),
  ];
  for (const u of [shared, alone]) {
    preset(u, "singles", 1600, 120);
    setStanding(u, 1000);
  }
  for (const u of [x, y, x2, y2]) preset(u, "singles", 1500, 150);
  const run = (opponent) =>
    sqlAsync(
      `select app.apply_ranked_result('${crypto.randomUUID()}','pickleball','singles',${ids([shared])},${ids([opponent])},now());`,
    );
  assert.deepEqual(await Promise.all([run(x), run(y)]), ["t", "t"]);
  apply("singles", [alone], [x2]);
  apply("singles", [alone], [y2]);
  const state = (u) =>
    sql(
      `select round(mu::numeric,9),round(phi::numeric,9),round(sigma::numeric,9),matches,standing from app.ranked_ratings where user_id='${u}' and format='singles';`,
    );
  assert.equal(state(shared), state(alone));
});

const base = process.env.RALLYPOINT_TEST_URL ?? "http://127.0.0.1:3000";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
async function login(email) {
  const { data, error } = await createClient(
    env.SUPABASE_URL,
    env.SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  ).auth.signInWithPassword({ email, password: fixturePassword });
  assert.ok(!error && data.session, "Synthetic sign-in must succeed");
  return { id: data.user.id, token: data.session.access_token };
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
const ensureProfile = (user, activities = "[]") =>
  sql(
    `select api.save_my_profile('${user}','Ranked ${nonce}','Ranked ${nonce}','${activities}'::jsonb)->>'profileId';`,
  );
const profileOf = (profileId) =>
  JSON.parse(sql(`select api.read_profile('${profileId}');`));
const medalAt = (standing) =>
  JSON.parse(sql(`select app.ranked_medal(${standing});`));
const standingOf = (user, format = "singles") =>
  sql(
    `select coalesce(standing::text,'') from app.ranked_ratings where user_id='${user}' and format='${format}';`,
  );
const setStanding = (user, standing) =>
  sql(
    `update app.ranked_ratings set standing=${standing} where user_id='${user}' and format='singles';`,
  );
async function winMany(user, format, times) {
  for (let i = 0; i < times; i++) {
    const others = [];
    for (let j = 0; j < (format === "doubles" ? 3 : 1); j++)
      others.push(await player(`w${crypto.randomUUID().slice(0, 8)}`));
    if (format === "doubles")
      apply(format, [user, others[0]], [others[1], others[2]]);
    else apply(format, [user], others);
  }
}

test("nothing public until calibrated, and singles separate from doubles", async () => {
  const p = await player("u5");
  await winMany(p, "singles", 4);
  assert.equal(sql(`select app.visible_ranks('${p}')::text;`), "[]");
  assert.equal(standingOf(p), "", "no standing while calibrating");
  await winMany(p, "singles", 1);
  const ranks = JSON.parse(sql(`select app.visible_ranks('${p}');`));
  assert.equal(ranks.length, 1);
  assert.deepEqual(Object.keys(ranks[0]).sort(), [
    "activity",
    "format",
    "medal",
    "stars",
  ]);
  assert.equal(ranks[0].activity, "pickleball");
  assert.equal(ranks[0].format, "singles");
});

test("medals and stars follow the standing", () => {
  assert.deepEqual(medalAt(0), { medal: "Rookie", stars: 1 });
  assert.deepEqual(medalAt(499), { medal: "Rookie", stars: 5 });
  assert.deepEqual(medalAt(500), { medal: "Contender", stars: 1 });
  assert.deepEqual(medalAt(1499), { medal: "Challenger", stars: 5 });
  assert.deepEqual(medalAt(1500), { medal: "Veteran", stars: 1 });
  assert.deepEqual(medalAt(2499), { medal: "Elite", stars: 5 });
  assert.deepEqual(medalAt(2500), { medal: "Master", stars: null });
});

test("calibration places no higher than Challenger 5", async () => {
  const [streak, slump] = [await player("cal-w"), await player("cal-l")];
  await winMany(streak, "singles", 5);
  assert.equal(standingOf(streak), "1499");
  for (let i = 0; i < 5; i++)
    apply(
      "singles",
      [await player(`cl${crypto.randomUUID().slice(0, 8)}`)],
      [slump],
    );
  const placed = medalAt(Number(standingOf(slump)));
  assert.equal(placed.medal, "Rookie");
});

test("after calibration a match moves about 25, leaning toward skill", async () => {
  const at = async (label, skill, standing, won) => {
    const [me, them] = [await player(label), await player(`${label}-o`)];
    preset(me, "singles", skill, 100);
    preset(them, "singles", skill, 100);
    setStanding(me, standing);
    if (won) apply("singles", [me], [them]);
    else apply("singles", [them], [me]);
    return Number(standingOf(me));
  };
  // Skill 1500 points at standing 1250: a plain ±25.
  assert.equal(await at("even-w", 1500, 1250, true), 1275);
  assert.equal(await at("even-l", 1500, 1250, false), 1225);
  // A standing well below the skill climbs faster and falls slower.
  assert.equal(await at("low-w", 1500, 500, true), 535);
  assert.equal(await at("low-l", 1500, 500, false), 485);
  // Never below 0.
  assert.equal(await at("floor", 1000, 10, false), 0);
});

test("the owner sees calibration and nobody else does", async () => {
  const p = await player("calib");
  const profileId = ensureProfile(p);
  await winMany(p, "doubles", 3);
  assert.deepEqual(profileOf(profileId).ranks, []);
  const mine = JSON.parse(sql(`select api.read_my_badges('${p}');`));
  assert.deepEqual(mine.ranks, [
    { activity: "pickleball", format: "doubles", calibrating: 3 },
  ]);
});

test("public profile shows calibrated categories only and no numbers", async () => {
  const p = await player("pp");
  const profileId = ensureProfile(p);
  await winMany(p, "doubles", 5);
  const raw = sql(`select api.read_profile('${profileId}')::text;`);
  const profile = JSON.parse(raw);
  assert.equal(profile.ranks.length, 1);
  assert.equal(profile.ranks[0].format, "doubles");
  assert.match(
    profile.ranks[0].medal,
    /^(Rookie|Contender|Challenger|Veteran|Elite|Master)$/,
  );
  for (const secret of [
    '"mu"',
    '"phi"',
    '"sigma"',
    '"rating"',
    '"matches"',
    '"standing"',
  ])
    assert.ok(!raw.includes(secret), `profile leaks ${secret}`);
  const mine = JSON.parse(sql(`select api.read_my_badges('${p}');`));
  assert.deepEqual(mine.ranks, profile.ranks);
});

test("roster shows ranks for the session's activity only", async () => {
  const organizer = await login("organizer@rallypoint.test");
  const email = `rk-${nonce}-roster@rallypoint.test`;
  const { data } = await admin.auth.admin.createUser({
    email,
    password: fixturePassword,
    email_confirm: true,
    user_metadata: { full_name: `Ranked roster ${nonce}` },
  });
  ensureProfile(data.user.id);
  await winMany(data.user.id, "singles", 5);
  const me = await login(email);
  const local = (ms) => new Date(ms).toISOString().slice(0, 16);
  async function rosterFor(activity) {
    const now = Date.now();
    const created = await request(
      "/api/groups/11111111-1111-4111-8111-111111111111/sessions",
      organizer,
      {
        operationKey: crypto.randomUUID(),
        groupId: "11111111-1111-4111-8111-111111111111",
        intent: "publish",
        details: {
          title: `Ranked roster ${activity}`,
          activity,
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
    const joined = await request(`/api/registrations/${s.slug}`, me, {
      operationKey: crypto.randomUUID(),
      version: s.version,
      seats: 1,
      guestName: "",
      consent: true,
    });
    assert.equal(joined.status, 200);
    const view = (
      await (await request(`/api/registrations/${s.slug}`, organizer)).json()
    ).registration;
    return view.roster.find((r) => r.primaryName === `Ranked ${nonce}`);
  }
  const pickleball = await rosterFor("Pickleball");
  assert.equal(pickleball.ranks.length, 1);
  assert.equal(pickleball.ranks[0].format, "singles");
  assert.equal(pickleball.ranks[0].medal, "Challenger");
  const workshop = await rosterFor("Workshop");
  assert.deepEqual(workshop.ranks, []);
});

test("seed rating follows the self-rated level only before the first match", async () => {
  const seed = (u) =>
    Number(
      sql(`select app.ranked_seed_rating('${u}','pickleball','singles');`),
    );
  const none = await player("sn");
  assert.equal(seed(none), 1550);
  for (const [level, expected] of [
    ["beginner", 1325],
    ["intermediate", 1550],
    ["advanced", 1775],
  ]) {
    const u = await player(`s${level}`);
    ensureProfile(u, JSON.stringify([{ name: "Pickleball", level }]));
    assert.equal(seed(u), expected);
  }
  const played = await player("splayed");
  ensureProfile(
    played,
    JSON.stringify([{ name: "Pickleball", level: "advanced" }]),
  );
  await winMany(played, "singles", 1);
  assert.ok(Math.abs(seed(played) - rating(played).r) < 0.001);
});

test("self-rated levels and badges are unchanged by results", async () => {
  const p = await player("unch");
  const profileId = ensureProfile(
    p,
    JSON.stringify([{ name: "Pickleball", level: "beginner" }]),
  );
  const before = profileOf(profileId);
  const badgesBefore = JSON.parse(sql(`select api.read_my_badges('${p}');`));
  await winMany(p, "singles", 5);
  const after = profileOf(profileId);
  assert.deepEqual(after.activities, before.activities);
  assert.deepEqual(after.badges, before.badges);
  assert.deepEqual(
    JSON.parse(sql(`select api.read_my_badges('${p}');`)).badges,
    badgesBefore.badges,
  );
});
