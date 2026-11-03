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
// The display scale: what rank thresholds are measured on.
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
  const [shared, x, y] = [
    await player("cs"),
    await player("cx"),
    await player("cy"),
  ];
  const run = (opponent) =>
    sqlAsync(
      `select app.apply_ranked_result('${crypto.randomUUID()}','pickleball','singles',${ids([shared])},${ids([opponent])},now());`,
    );
  assert.deepEqual(await Promise.all([run(x), run(y)]), ["t", "t"]);
  assert.equal(rating(shared).matches, 2);
});
