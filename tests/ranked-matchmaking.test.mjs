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
  sql(
    `update app.ranked_searches set state = 'cancelled' where state = 'searching';`,
  );
  search([c], { windows: ["weekday-mornings"] });
  search([d], { windows: ["weekend-evenings"] });
  assert.equal(run().proposed, 0);
  sql(
    `update app.ranked_searches set state = 'cancelled' where state = 'searching';`,
  );
  search([e]);
  search([f, g], { format: "doubles" });
  assert.equal(run().proposed, 0);
});

test("one side choosing times still pairs, on that side's first time", async () => {
  const [a, b] = [await person(), await person()];
  search([a], {
    windows: ["weekend-mornings", "weekday-evenings"],
    age: "1 hour",
  });
  search([b]);
  assert.equal(run().proposed, 1);
  assert.equal(
    sql(
      `select time_window from app.ranked_matches where id = '${matchOf(a)}';`,
    ),
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
  const id =
    sql(`select id from app.ranked_searches where starter_id = '${a.id}'
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

const answer = (actor, match, accept, operationKey = key()) =>
  request(`/api/ranked/matches/${match}/answer`, actor, {
    operationKey,
    accept,
  });
const widen = (actor, searchId) =>
  request(`/api/ranked/search/${searchId}/widen`, actor, {
    operationKey: key(),
  });
async function mine(actor) {
  const r = await request("/api/ranked/search", actor);
  assert.equal(r.status, 200);
  return r.json();
}
async function paired() {
  const [a, b] = [await person(), await person()];
  const sa = search([a], { age: "3 hours" }),
    sb = search([b]);
  assert.equal(run().proposed, 1);
  return { a, b, sa, sb, id: matchOf(a) };
}

test("everyone accepting confirms the match", async () => {
  const { a, b, sa, sb, id } = await paired();
  let r = await answer(a, id, true);
  assert.equal(r.status, 200);
  let body = await r.json();
  assert.equal(body.match.id, id);
  assert.equal(body.match.state, "proposed");
  assert.equal(body.match.myAnswer, "accepted");
  assert.equal(body.match.area.key, "tampines");
  assert.equal(body.search.state, "matched");
  r = await answer(b, id, true);
  assert.equal(r.status, 200);
  body = await r.json();
  assert.equal(body.match.state, "confirmed");
  assert.deepEqual(
    body.match.players.map((p) => [p.name, p.side, p.accepted, p.you]),
    [
      [b.name, "yours", true, true],
      [a.name, "theirs", true, false],
    ],
  );
  assert.ok(
    sql(`select confirmed_at from app.ranked_matches where id = '${id}';`),
  );
  assert.equal(stateOf(sa), "matched");
  assert.equal(stateOf(sb), "matched");
});

test("a decline cancels and puts the other side back first with its wait", async () => {
  const { a, b, sa, sb, id } = await paired();
  const waited = sql(
    `select started_at from app.ranked_searches where id = '${sa}';`,
  );
  const r = await answer(b, id, false);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.match, null);
  assert.equal(body.search.state, "ended");
  assert.equal(stateOf(sb), "cancelled");
  assert.equal(stateOf(sa), "searching");
  assert.equal(
    sql(`select started_at from app.ranked_searches where id = '${sa}';`),
    waited,
  );
  assert.equal(
    sql(
      `select state || '|' || end_reason from app.ranked_matches where id = '${id}';`,
    ),
    "cancelled|declined",
  );
  assert.equal(matchOf(a), "");
  const [c, d] = [await person(), await person()];
  search([c]);
  search([d], { age: "1 hour" });
  assert.equal(run().proposed, 1);
  assert.ok(matchOf(a));
  assert.equal(matchOf(a), matchOf(d));
  assert.equal(matchOf(c), "");
});

test("going back to the queue gives back the time spent waiting on answers", async () => {
  const { b, sa, id } = await paired();
  sql(`update app.ranked_searches set matched_at = matched_at - interval '47 hours'
    where match_id = '${id}';`);
  const before = Number(
    sql(
      `select extract(epoch from ends_at) from app.ranked_searches where id = '${sa}';`,
    ),
  );
  assert.equal((await answer(b, id, false)).status, 200);
  const after = Number(
    sql(
      `select extract(epoch from ends_at) from app.ranked_searches where id = '${sa}';`,
    ),
  );
  assert.ok(Math.abs(after - before - 47 * 3600) < 120, `${after - before}`);
});

test("48 hours without every answer lets the proposal lapse", async () => {
  const { a, b, sa, sb, id } = await paired();
  assert.equal((await answer(a, id, true)).status, 200);
  sql(
    `update app.ranked_matches set respond_by = now() - interval '1 minute' where id = '${id}';`,
  );
  assert.equal((await mine(a)).match.state, "expired");
  const late = await answer(b, id, true);
  assert.equal(late.status, 409);
  assert.equal(await code(late), "proposal_closed");
  assert.equal(run().expired, 1);
  assert.equal(stateOf(sa), "searching");
  assert.equal(stateOf(sb), "cancelled");
  assert.equal(
    sql(
      `select state || '|' || end_reason from app.ranked_matches where id = '${id}';`,
    ),
    "cancelled|expired",
  );
  assert.equal(matchOf(a), "");
  assert.equal((await mine(a)).match, null);
});

test("a retried accept with the same key changes nothing", async () => {
  const { a, id } = await paired();
  const operationKey = key();
  const first = await answer(a, id, true, operationKey);
  const second = await answer(a, id, true, operationKey);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.deepEqual((await second.json()).match, (await first.json()).match);
});

test("only the players can read or answer a match, and no numbers show", async () => {
  const { a, id } = await paired();
  const outsider = await person();
  const r = await answer(outsider, id, true);
  assert.equal(r.status, 404);
  assert.equal((await mine(outsider)).match, null);
  const text = JSON.stringify(await mine(a));
  assert.doesNotMatch(text, /"(mu|phi|sigma|skill|rating|standing|band)"/);
});

test("widening needs three days and only happens on request", async () => {
  const a = await person();
  const sa = search([a], { areas: ["tampines"], age: "2 days" });
  let view = (await mine(a)).search;
  assert.equal(view.canWiden, false);
  assert.equal(view.wide, false);
  let r = await widen(a, sa);
  assert.equal(r.status, 409);
  assert.equal(await code(r), "cannot_widen");
  sql(
    `update app.ranked_searches set started_at = started_at - interval '1 day' where id = '${sa}';`,
  );
  view = (await mine(a)).search;
  assert.equal(view.canWiden, true);
  assert.deepEqual(view.regions, ["East"]);
  const outsider = await person();
  assert.equal((await widen(outsider, sa)).status, 404);
  r = await widen(a, sa);
  assert.equal(r.status, 200);
  view = (await r.json()).search;
  assert.equal(view.wide, true);
  assert.equal(view.canWiden, false);
});

test("a declined opponent isn't proposed again within 7 days", async () => {
  const { a, b, id } = await paired();
  assert.equal((await answer(b, id, false)).status, 200);
  search([b]);
  assert.equal(run().proposed, 0);
  assert.equal(matchOf(a), "");
});

test("everyone left out of a match is told what happened", async () => {
  const [a, b, partner] = [await person(), await person(), await person()];
  search([a, partner], { format: "doubles", age: "1 hour" });
  const [c, d] = [await person(), await person()];
  search([c, d], { format: "doubles" });
  assert.equal(run().proposed, 1);
  const id = matchOf(a);
  assert.equal((await answer(a, id, false)).status, 200);
  assert.equal((await mine(a)).search.endReason, "declined_match");
  assert.equal((await mine(partner)).search.endReason, "partner_declined_match");
  for (const p of [c, d]) {
    const view = (await mine(p)).search;
    assert.equal(view.state, "searching");
    assert.equal(view.returned, "declined");
    assert.equal(matchOf(p), "");
  }
  assert.equal(matchOf(partner), "");
  // A lapse: the side that accepted searches again, the other is told it ran out.
  const [e, f] = [await person(), await person()];
  search([e], { age: "1 hour" });
  search([f]);
  sql(`update app.ranked_searches set state = 'cancelled' where starter_id in ('${c.id}', '${b.id}');`);
  assert.equal(run().proposed, 1);
  const lapse = matchOf(e);
  assert.equal((await answer(e, lapse, true)).status, 200);
  sql(`update app.ranked_matches set respond_by = now() - interval '1 minute' where id = '${lapse}';`);
  assert.equal(run().expired, 1);
  assert.equal((await mine(e)).search.returned, "lapsed");
  assert.equal((await mine(f)).search.endReason, "match_lapsed");
});

test("a confirmed match nobody books in 4 days lets everyone search again", async () => {
  const { a, b, sa, sb, id } = await paired();
  assert.equal((await answer(a, id, true)).status, 200);
  assert.equal((await answer(b, id, true)).status, 200);
  run();
  assert.equal(stateOf(sa), "matched");
  sql(`update app.ranked_matches set confirmed_at = now() - interval '4 days 1 minute' where id = '${id}';`);
  run();
  assert.equal(stateOf(sa), "searching");
  assert.equal(stateOf(sb), "searching");
  assert.equal(
    sql(`select state || '|' || end_reason from app.ranked_matches where id = '${id}';`),
    "cancelled|unbooked",
  );
  assert.equal((await mine(a)).search.returned, "unbooked");
  assert.equal(matchOf(a), "");
  assert.equal(matchOf(b), "");
});
