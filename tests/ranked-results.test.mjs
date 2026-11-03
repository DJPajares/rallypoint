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
  const email = `rr-${nonce}-${label}@rallypoint.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: fixturePassword,
    email_confirm: true,
    user_metadata: { full_name: `Result ${label} ${nonce}` },
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
    `select api.ensure_my_profile('${id}','Result ${label} ${nonce}')->>'profileId';`,
  );
  return {
    id,
    token: signedIn.data.session.access_token,
    profileId,
    name: `Result ${label} ${nonce}`,
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

const answer = (actor, match, accept) =>
  request(`/api/ranked/matches/${match}/answer`, actor, {
    operationKey: key(),
    accept,
  });
const claim = (actor, match) =>
  request(`/api/ranked/matches/${match}/claim`, actor, { operationKey: key() });
const release = (actor, match) =>
  request(`/api/ranked/matches/${match}/release`, actor, {
    operationKey: key(),
  });
// Singapore has no clock changes: local time is UTC+8.
const sgLocal = (ms) => new Date(ms + 8 * 3600000).toISOString().slice(0, 16);
const booking = (over = {}) => {
  const start = Date.now() + 3 * 86400000;
  return {
    operationKey: key(),
    location: `Result court ${nonce}`,
    mapsLink: "",
    startLocal: sgLocal(start),
    endLocal: sgLocal(start + 90 * 60000),
    cost: "24",
    timeZone: "Asia/Singapore",
    ...over,
  };
};
const book = (actor, match, body = booking()) =>
  request(`/api/ranked/matches/${match}/book`, actor, body);
async function mine(actor) {
  const r = await request("/api/ranked/search", actor);
  assert.equal(r.status, 200);
  return r.json();
}
// A singles match both players have accepted.
async function confirmed() {
  const [a, b] = [await person(), await person()];
  search([a], { age: "1 hour" });
  search([b]);
  assert.equal(run().proposed, 1);
  const id = matchOf(a);
  assert.equal((await answer(a, id, true)).status, 200);
  assert.equal((await answer(b, id, true)).status, 200);
  return { a, b, id };
}
const matchRow = (id) =>
  sql(`select coalesce(booker_id::text, '-') || '|' || coalesce(session_id::text, '-') || '|' || state
    from app.ranked_matches where id = '${id}';`).split("|");

async function booked() {
  const { a, b, id } = await confirmed();
  assert.equal((await claim(a, id)).status, 200);
  assert.equal((await book(a, id)).status, 200);
  const [sessionId, slug] =
    sql(`select s.id || '|' || s.slug from app.sessions s
    join app.ranked_matches m on m.session_id = s.id where m.id = '${id}';`).split(
      "|",
    );
  return { a, b, id, sessionId, slug };
}
const partyOf = (p, sessionId) =>
  sql(
    `select id from app.parties where session_id = '${sessionId}' and user_id = '${p.id}';`,
  );
// Booked sessions are guarded against edits; tests move times past the guard.
const editDetails = (sessionId, field, offset) =>
  sql(`begin; alter table app.sessions disable trigger protect_booked_session;
    update app.sessions set details = jsonb_set(details, '{${field}}', to_jsonb(now() + interval '${offset}'))
      where id = '${sessionId}';
    alter table app.sessions enable trigger protect_booked_session; commit;`);
const moveStart = (sessionId, offset) =>
  editDetails(sessionId, "startsAt", offset);
const checkIn = (actor, id) =>
  request(`/api/ranked/matches/${id}/check-in`, actor, { operationKey: key() });
const withdraw = (actor, slug, partyId, operationKey = key()) =>
  request(`/api/registrations/${slug}/withdraw`, actor, {
    operationKey,
    partyId,
  });
const attend = (actor, slug, partyId) =>
  request(`/api/registrations/${slug}/attendance`, actor, {
    operationKey: key(),
    partyId,
    seat: 1,
    state: "checked_in",
    revision: 0,
  });
const seat = (partyId) =>
  sql(`select state || '|' || changed_by || '|' || revision from app.seat_attendance
    where party_id = '${partyId}' and seat = 1;`);

// Bookings for doubles: the four players of two teams, both accepted and booked.
async function bookedDoubles() {
  const [a, b, c, d] = [
    await person(),
    await person(),
    await person(),
    await person(),
  ];
  search([a, b], { format: "doubles", age: "1 hour" });
  search([c, d], { format: "doubles" });
  assert.equal(run().proposed, 1);
  const id = matchOf(a);
  for (const p of [a, b, c, d])
    assert.equal((await answer(p, id, true)).status, 200);
  assert.equal((await claim(a, id)).status, 200);
  assert.equal((await book(a, id)).status, 200);
  const [sessionId] =
    sql(`select s.id from app.sessions s join app.ranked_matches m on m.session_id = s.id
    where m.id = '${id}';`).split("|");
  return { a, b, c, d, id, sessionId };
}
// Open check-in, check these players in, then close check-in.
async function played(id, sessionId, present) {
  moveStart(sessionId, "10 minutes");
  for (const p of present) assert.equal((await checkIn(p, id)).status, 200);
  moveStart(sessionId, "-31 minutes");
}
const report = (actor, id, won, operationKey = key()) =>
  request(`/api/ranked/matches/${id}/report`, actor, { operationKey, won });
const answerResult = (actor, id, agree, operationKey = key()) =>
  request(`/api/ranked/matches/${id}/answer-result`, actor, {
    operationKey,
    agree,
  });
const rating = (p, format = "singles") =>
  sql(`select coalesce((select matches || '|' || round(mu::numeric, 6) from app.ranked_ratings
    where user_id = '${p.id}' and activity_key = 'pickleball' and format = '${format}'), '0|-');`);
const results = (id) =>
  sql(`select count(*) from app.ranked_results where result_id = '${id}';`);
const outcome = (id) =>
  sql(`select state || '|' || coalesce(end_reason, '-') || '|' || coalesce(winner_side::text, '-')
    from app.ranked_matches where id = '${id}';`);

test("a report and a confirmation finish the match and move ratings once", async () => {
  const { a, b, id, sessionId } = await booked();
  await played(id, sessionId, [a, b]);
  const r = await report(a, id, true);
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal((await mine(b)).match.result.state, "reported");
  assert.equal((await mine(b)).match.result.reportedWinner, "theirs");
  const confirmKey = key();
  assert.equal((await answerResult(b, id, true, confirmKey)).status, 200);
  assert.equal(outcome(id), "completed|-|1");
  assert.equal(results(id), "1");
  assert.equal(rating(a).split("|")[0], "1");
  assert.equal(rating(b).split("|")[0], "1");
  const after = [rating(a), rating(b)];
  assert.equal((await answerResult(b, id, true, confirmKey)).status, 200);
  run();
  assert.deepEqual([rating(a), rating(b)], after);
  assert.equal((await mine(a)).search.endReason, "match_won");
  assert.equal((await mine(b)).search.endReason, "match_lost");
  assert.equal((await mine(a)).match, null);
  // Free to search again.
  const again = await request("/api/ranked/search", a, {
    operationKey: key(),
    format: "singles",
    areas: ["bedok"],
    courts: [],
    windows: [],
  });
  assert.equal(again.status, 200);
});

test("48 hours of silence confirms a report", async () => {
  const { a, b, id, sessionId } = await booked();
  await played(id, sessionId, [a, b]);
  assert.equal((await report(b, id, true)).status, 200);
  run();
  assert.equal(outcome(id).split("|")[0], "confirmed");
  sql(
    `update app.ranked_matches set confirm_by = now() - interval '1 minute' where id = '${id}';`,
  );
  run();
  assert.equal(outcome(id), "completed|-|2");
  run();
  assert.equal(results(id), "1");
  assert.equal(rating(b).split("|")[0], "1");
});

test("a dispute voids the match with no rating change", async () => {
  const { a, b, id, sessionId } = await booked();
  await played(id, sessionId, [a, b]);
  assert.equal((await report(a, id, true)).status, 200);
  assert.equal((await answerResult(b, id, false)).status, 200);
  assert.equal(outcome(id), "void|disputed|-");
  assert.equal(results(id), "0");
  assert.equal(rating(a), "0|-");
  assert.equal((await mine(a)).search.endReason, "match_void");
});

test("the other side reporting a different winner is a dispute; the same winner confirms", async () => {
  const first = await booked();
  await played(first.id, first.sessionId, [first.a, first.b]);
  assert.equal((await report(first.a, first.id, true)).status, 200);
  assert.equal((await report(first.b, first.id, true)).status, 200);
  assert.equal(outcome(first.id), "void|disputed|-");
  const second = await booked();
  await played(second.id, second.sessionId, [second.a, second.b]);
  assert.equal((await report(second.a, second.id, true)).status, 200);
  assert.equal((await report(second.b, second.id, false)).status, 200);
  assert.equal(outcome(second.id), "completed|-|1");
});

test("a player who didn't check in loses and can't report it away", async () => {
  const { a, b, id, sessionId } = await booked();
  await played(id, sessionId, [a]);
  const r = await report(b, id, true);
  assert.equal(r.status, 409);
  assert.equal(await code(r), "result_settled");
  assert.equal(outcome(id), "completed|absent|1");
  assert.equal((await mine(b)).search.endReason, "match_missed");
  run();
  assert.equal(results(id), "1");
});

test("in doubles one absent partner loses the match for both", async () => {
  const { a, b, c, d, id, sessionId } = await bookedDoubles();
  await played(id, sessionId, [a, b, c]);
  run();
  assert.equal(outcome(id), "completed|absent|1");
  for (const p of [a, b, c, d])
    assert.equal(rating(p, "doubles").split("|")[0], "1");
  const [cMu, dMu] = [rating(c, "doubles"), rating(d, "doubles")].map((x) =>
    Number(x.split("|")[1]),
  );
  assert.ok(cMu < 0 && dMu < 0, `${cMu} ${dMu}`);
});

test("nobody checking in, or nobody reporting, voids the match", async () => {
  const quiet = await booked();
  await played(quiet.id, quiet.sessionId, []);
  run();
  assert.equal(outcome(quiet.id), "void|absent|-");
  const silent = await booked();
  await played(silent.id, silent.sessionId, [silent.a, silent.b]);
  run();
  assert.equal(outcome(silent.id).split("|")[0], "confirmed");
  editDetails(silent.sessionId, "endsAt", "-48 hours -1 minute");
  run();
  assert.equal(outcome(silent.id), "void|unreported|-");
  assert.equal(results(silent.id), "0");
});

test("a finished result can't be changed, and nothing can be reported early", async () => {
  const { a, b, id, sessionId } = await booked();
  moveStart(sessionId, "10 minutes");
  assert.equal((await checkIn(a, id)).status, 200);
  assert.equal((await checkIn(b, id)).status, 200);
  const early = await report(a, id, true);
  assert.equal(early.status, 409);
  assert.equal(await code(early), "result_not_open");
  moveStart(sessionId, "-31 minutes");
  assert.equal((await report(a, id, true)).status, 200);
  assert.equal(await code(await report(a, id, false)), "already_reported");
  assert.equal(
    await code(await answerResult(a, id, true)),
    "nothing_to_answer",
  );
  assert.equal((await answerResult(b, id, true)).status, 200);
  assert.equal(await code(await answerResult(b, id, false)), "result_settled");
  assert.equal(await code(await report(b, id, true)), "result_settled");
  assert.equal(outcome(id), "completed|-|1");
});

test("a loss by absence shows publicly only as a rank", async () => {
  const { a, b, id, sessionId } = await booked();
  await played(id, sessionId, [a]);
  run();
  const text = sql(`select api.read_profile('${b.profileId}')::text;`);
  assert.doesNotMatch(text, /no[-_ ]?show|absent|missed/i);
});
