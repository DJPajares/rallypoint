import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { localEnv, fixturePassword } from "../scripts/local-env.mjs";
const env = localEnv(),
  base = process.env.RALLYPOINT_TEST_URL ?? "http://127.0.0.1:3000";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
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
const sqlAsync = (query) =>
  promisify(execFile)("docker", [...psql, "-c", query], { encoding: "utf8" });
const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const nonce = crypto.randomUUID().slice(0, 8);
let count = 0;
async function person() {
  const label = `p${++count}`;
  const email = `rm-${nonce}-${label}@rallypoint.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: fixturePassword,
    email_confirm: true,
    user_metadata: { full_name: `Match ${label} ${nonce}` },
  });
  assert.ok(!error && data.user);
  const signedIn = await createClient(
    env.SUPABASE_URL,
    env.SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  ).auth.signInWithPassword({ email, password: fixturePassword });
  assert.ok(!signedIn.error && signedIn.data.session);
  const id = data.user.id;
  const profileId = sql(
    `select api.ensure_my_profile('${id}','Match ${label} ${nonce}')->>'profileId';`,
  );
  return {
    id,
    token: signedIn.data.session.access_token,
    profileId,
    name: `Match ${label} ${nonce}`,
  };
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
const code = async (r) => (await r.json()).error?.code;
const list = (values, type) =>
  `array[${values.map((v) => `'${v}'`).join(",")}]::${type}[]`;

// A search already looking, seeded directly; `age` backdates its wait.
function search(
  people,
  {
    format = "singles",
    areas = ["tampines"],
    courts = [],
    windows = [],
    age = "0 seconds",
  } = {},
) {
  return sql(`insert into app.ranked_searches(format, starter_id, partner_id, state, areas, courts,
      windows, started_at, ends_at)
    values ('${format}', '${people[0].id}', ${people[1] ? `'${people[1].id}'` : "null"}, 'searching',
      ${list(areas, "text")}, ${list(courts, "uuid")}, ${list(windows, "text")},
      now() - interval '${age}', now() + interval '7 days' - interval '${age}')
    returning id;`);
}
const run = (limit = 50) =>
  JSON.parse(sql(`select api.run_matchmaking(${limit});`));
const matchOf = (p) =>
  sql(`select match_id from app.ranked_match_players
    where user_id = '${p.id}' and released_at is null;`);
const stateOf = (searchId) =>
  sql(`select state from app.ranked_searches where id = '${searchId}';`);

// The local database is shared: nothing else may be searching while a test runs.
beforeEach(() => {
  sql(`update app.ranked_match_players set released_at = now() where released_at is null;
    update app.ranked_matches set state = 'cancelled', ended_at = now()
      where state in ('proposed', 'confirmed');
    update app.ranked_searches set state = 'cancelled', ended_at = now()
      where state in ('searching', 'waiting_partner', 'matched');
    update app.ranked_engine set cursor_started_at = null, cursor_id = null;`);
});

test("two compatible singles searches make one proposal", async () => {
  const [a, b] = [await person(), await person()];
  const sa = search([a], { age: "1 hour" }),
    sb = search([b]);
  const result = run();
  assert.equal(result.ran, true);
  assert.equal(result.proposed, 1);
  const id = matchOf(a);
  assert.ok(id);
  assert.equal(matchOf(b), id);
  const [state, area, window, hours, sides] = sql(`select m.state, m.area_key,
      coalesce(m.time_window, '-'), round(extract(epoch from m.respond_by - m.created_at) / 3600),
      (select string_agg(user_id::text || ':' || side, ',' order by side) from app.ranked_match_players
        where match_id = m.id)
    from app.ranked_matches m where m.id = '${id}';`).split("|");
  assert.equal(state, "proposed");
  assert.equal(area, "tampines");
  assert.equal(window, "-");
  assert.equal(hours, "48");
  assert.equal(sides, `${a.id}:1,${b.id}:2`);
  assert.equal(stateOf(sa), "matched");
  assert.equal(stateOf(sb), "matched");
});

test("different areas, formats or windows never pair", async () => {
  const [a, b, c, d, e, f, g] = [
    await person(),
    await person(),
    await person(),
    await person(),
    await person(),
    await person(),
    await person(),
  ];
  search([a], { areas: ["tampines"] });
  search([b], { areas: ["bishan"] });
  assert.equal(run().proposed, 0);
  sql(`update app.ranked_searches set state = 'cancelled' where state = 'searching';`);
  search([c], { windows: ["weekday-mornings"] });
  search([d], { windows: ["weekend-evenings"] });
  assert.equal(run().proposed, 0);
  sql(`update app.ranked_searches set state = 'cancelled' where state = 'searching';`);
  search([e]);
  search([f, g], { format: "doubles" });
  assert.equal(run().proposed, 0);
});

test("one side choosing times still pairs, on that side's first time", async () => {
  const [a, b] = [await person(), await person()];
  search([a], { windows: ["weekend-mornings", "weekday-evenings"], age: "1 hour" });
  search([b]);
  assert.equal(run().proposed, 1);
  assert.equal(
    sql(`select time_window from app.ranked_matches where id = '${matchOf(a)}';`),
    "weekday-evenings",
  );
});

test("the skill band starts at 100 and widens to 300 after a day", async () => {
  const [a, b] = [await person(), await person()];
  sql(`insert into app.ranked_ratings(user_id, activity_key, format, mu, matches)
    values ('${a.id}', 'pickleball', 'singles', (1750 - 1500) / 173.7178, 6);`);
  const sa = search([a]);
  search([b]);
  assert.equal(run().proposed, 0);
  sql(`update app.ranked_searches set started_at = started_at - interval '25 hours'
    where id = '${sa}';`);
  assert.equal(run().proposed, 1);
});

test("the longest-waiting compatible search is paired first", async () => {
  const [a, b, c] = [await person(), await person(), await person()];
  search([a], { age: "2 hours" });
  search([b], { age: "1 hour" });
  const sc = search([c]);
  assert.equal(run().proposed, 1);
  assert.ok(matchOf(a));
  assert.equal(matchOf(a), matchOf(b));
  assert.equal(matchOf(c), "");
  assert.equal(stateOf(sc), "searching");
});

test("players who met in the last 7 days are not paired", async () => {
  const [a, b] = [await person(), await person()];
  const result = crypto.randomUUID();
  sql(`insert into app.ranked_results(result_id, activity_key, format, winners, losers, played_at)
    values ('${result}', 'pickleball', 'singles', array['${a.id}']::uuid[], array['${b.id}']::uuid[],
      now() - interval '2 days');`);
  search([a]);
  search([b]);
  assert.equal(run().proposed, 0);
  sql(`update app.ranked_results set played_at = now() - interval '8 days'
    where result_id = '${result}';`);
  assert.equal(run().proposed, 1);
});

test("the region is only searched after the player widens", async () => {
  const [a, b] = [await person(), await person()];
  const sa = search([a], { areas: ["tampines"], age: "4 days" });
  search([b], { areas: ["bedok"] });
  assert.equal(run().proposed, 0);
  sql(`update app.ranked_searches set wide = true where id = '${sa}';`);
  assert.equal(run().proposed, 1);
  assert.equal(
    sql(`select area_key from app.ranked_matches where id = '${matchOf(a)}';`),
    "bedok",
  );
});

test("a court both sides chose picks the court and its area", async () => {
  const [a, b] = [await person(), await person()];
  const court = sql(`insert into app.courts(area_key, name, created_by)
    values ('tampines', 'Shared court ${nonce}', '${a.id}') returning id;`);
  search([a], { areas: ["bedok", "tampines"], courts: [court], age: "1 hour" });
  search([b], { areas: ["bedok", "tampines"], courts: [court] });
  assert.equal(run().proposed, 1);
  assert.equal(
    sql(`select area_key || '|' || court_id from app.ranked_matches
      where id = '${matchOf(a)}';`),
    `tampines|${court}`,
  );
});

test("each pass handles at most its limit and the next pass resumes", async () => {
  const people = [];
  for (let i = 0; i < 8; i++) {
    const p = await person();
    people.push(p);
    search([p], { age: `${10 - i} minutes` });
  }
  assert.equal(run(2).proposed, 1);
  let passes = 1;
  while (people.some((p) => !matchOf(p)) && passes < 8) {
    assert.ok(run(2).proposed <= 1);
    passes++;
  }
  assert.ok(people.every((p) => matchOf(p)));
});

test("two passes at once never place anyone twice", async () => {
  const people = [];
  for (let i = 0; i < 6; i++) {
    const p = await person();
    people.push(p);
    search([p], { age: `${10 - i} minutes` });
  }
  await Promise.all([
    sqlAsync("select api.run_matchmaking(50);"),
    sqlAsync("select api.run_matchmaking(50);"),
  ]);
  assert.equal(
    sql(`select count(*) from (select user_id from app.ranked_match_players
      where released_at is null group by user_id having count(*) > 1) x;`),
    "0",
  );
  assert.equal(
    sql(`select count(*) from app.ranked_matches where state = 'proposed';`),
    "3",
  );
  assert.ok(people.every((p) => matchOf(p)));
});

test("a matched search can't be cancelled or replaced", async () => {
  const [a, b] = [await person(), await person()];
  for (const p of [a, b]) {
    const r = await request("/api/ranked/search", p, {
      operationKey: key(),
      format: "singles",
      areas: ["tampines"],
      courts: [],
      windows: [],
    });
    assert.equal(r.status, 200);
  }
  assert.equal(run().proposed, 1);
  const id = sql(`select id from app.ranked_searches where starter_id = '${a.id}'
    and state = 'matched';`);
  const cancelled = await request(`/api/ranked/search/${id}/cancel`, a, {
    operationKey: key(),
  });
  assert.equal(cancelled.status, 409);
  assert.equal(await code(cancelled), "search_matched");
  const again = await request("/api/ranked/search", a, {
    operationKey: key(),
    format: "singles",
    areas: ["bedok"],
    courts: [],
    windows: [],
  });
  assert.equal(again.status, 409);
  assert.equal(await code(again), "search_active");
});
