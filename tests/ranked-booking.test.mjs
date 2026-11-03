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
  const email = `rb-${nonce}-${label}@rallypoint.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: fixturePassword,
    email_confirm: true,
    user_metadata: { full_name: `Booker ${label} ${nonce}` },
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
    `select api.ensure_my_profile('${id}','Booker ${label} ${nonce}')->>'profileId';`,
  );
  return {
    id,
    token: signedIn.data.session.access_token,
    profileId,
    name: `Booker ${label} ${nonce}`,
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
    location: `Synthetic court ${nonce}`,
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

test("two claims at once: exactly one booker", async () => {
  const { a, b, id } = await confirmed();
  const [ra, rb] = await Promise.all([claim(a, id), claim(b, id)]);
  const statuses = [ra.status, rb.status].sort();
  assert.deepEqual(statuses, [200, 409]);
  const lost = ra.status === 409 ? ra : rb;
  assert.equal(await code(lost), "booking_taken");
  const [booker] = matchRow(id);
  assert.ok([a.id, b.id].includes(booker));
});

test("hand-back and a lapsed claim reopen booking", async () => {
  const { a, b, id } = await confirmed();
  assert.equal((await claim(a, id)).status, 200);
  assert.equal(await code(await claim(b, id)), "booking_taken");
  assert.equal(await code(await release(b, id)), "not_booker");
  assert.equal((await release(a, id)).status, 200);
  assert.equal((await claim(b, id)).status, 200);
  sql(
    `update app.ranked_matches set claim_until = now() - interval '1 minute' where id = '${id}';`,
  );
  const late = await book(b, id);
  assert.equal(late.status, 409);
  assert.equal(await code(late), "not_booker");
  assert.equal((await claim(a, id)).status, 200);
  assert.equal(matchRow(id)[0], a.id);
});

test("booking creates one private split session for exactly the players", async () => {
  const { a, b, id } = await confirmed();
  assert.equal((await claim(a, id)).status, 200);
  const body = booking();
  const first = await book(a, id, body);
  assert.equal(first.status, 200, await first.clone().text());
  const [, sessionId, state] = matchRow(id);
  assert.notEqual(sessionId, "-");
  assert.equal(state, "confirmed");
  const [
    sessionState,
    access,
    feeMode,
    total,
    payment,
    capacity,
    cutoffGap,
    manager,
  ] = sql(`
    select s.state, s.details->>'access', s.details->>'feeMode', s.details->>'totalMinor',
      s.details->>'paymentMode', s.details->>'capacity',
      extract(epoch from (s.details->>'startsAt')::timestamptz - (s.details->>'cutoffAt')::timestamptz) / 3600,
      app.is_session_manager('${a.id}', s.group_id)
    from app.sessions s where s.id = '${sessionId}';`).split("|");
  assert.equal(sessionState, "published");
  assert.equal(access, "private");
  assert.equal(feeMode, "split");
  assert.equal(total, "2400");
  assert.equal(payment, "organizer");
  assert.equal(capacity, "2");
  assert.equal(Number(cutoffGap), 24);
  assert.equal(manager, "t");
  const parties = () =>
    sql(`select string_agg(user_id::text || ':' || state, ',' order by user_id)
      from app.parties where session_id = '${sessionId}';`);
  assert.equal(
    parties(),
    [a.id, b.id]
      .sort()
      .map((u) => `${u}:confirmed`)
      .join(","),
  );
  const again = await book(a, id, body);
  assert.equal(again.status, 200);
  assert.equal(matchRow(id)[1], sessionId);
  assert.equal(
    sql(
      `select count(*) from app.sessions s where s.details->>'location' = 'Synthetic court ${nonce}';`,
    ),
    "1",
  );
  assert.equal(parties().split(",").length, 2);
});

test("only the players can see the claim and the session", async () => {
  const { a, b, id } = await confirmed();
  const outsider = await person();
  assert.equal((await claim(outsider, id)).status, 404);
  assert.equal((await claim(a, id)).status, 200);
  assert.equal((await book(a, id)).status, 200);
  const slug =
    sql(`select s.slug from app.sessions s join app.ranked_matches m on m.session_id = s.id
    where m.id = '${id}';`);
  const shown = async (who) =>
    JSON.stringify(await (await request(`/api/shared/${slug}`, who)).json());
  assert.match(await shown(b), new RegExp(`Synthetic court ${nonce}`));
  assert.doesNotMatch(
    await shown(outsider),
    new RegExp(`Synthetic court ${nonce}`),
  );
  assert.equal((await mine(outsider)).match, null);
});

test("a booked match isn't let go at 4 days", async () => {
  const { a, id } = await confirmed();
  assert.equal((await claim(a, id)).status, 200);
  assert.equal((await book(a, id)).status, 200);
  sql(
    `update app.ranked_matches set confirmed_at = now() - interval '5 days' where id = '${id}';`,
  );
  run();
  assert.equal(matchRow(id)[2], "confirmed");
});

test("booking needs a confirmed match and the booker's claim", async () => {
  const [a, b] = [await person(), await person()];
  search([a], { age: "1 hour" });
  search([b]);
  run();
  const id = matchOf(a);
  assert.equal(await code(await claim(a, id)), "booking_closed");
  assert.equal((await answer(a, id, true)).status, 200);
  assert.equal((await answer(b, id, true)).status, 200);
  assert.equal(await code(await book(a, id)), "not_booker");
  assert.equal((await claim(a, id)).status, 200);
  const bad = await book(a, id, booking({ endLocal: booking().startLocal }));
  assert.equal(bad.status, 422);
});

// A singles match booked by its first player.
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

test("players check themselves in only inside the window", async () => {
  const { a, id, sessionId } = await booked();
  moveStart(sessionId, "31 minutes");
  let r = await checkIn(a, id);
  assert.equal(r.status, 409);
  assert.equal(await code(r), "check_in_closed");
  moveStart(sessionId, "29 minutes");
  assert.equal((await checkIn(a, id)).status, 200);
  const party = partyOf(a, sessionId);
  assert.equal(seat(party), `checked_in|${a.id}|1`);
  assert.equal((await checkIn(a, id)).status, 200);
  assert.equal(seat(party), `checked_in|${a.id}|1`);
  moveStart(sessionId, "-31 minutes");
  r = await checkIn(a, id);
  assert.equal(r.status, 409);
  assert.equal(await code(r), "check_in_closed");
});

test("nobody checks in someone else", async () => {
  const { a, b, slug, sessionId } = await booked();
  moveStart(sessionId, "10 minutes");
  const r = await attend(a, slug, partyOf(b, sessionId));
  assert.equal(r.status, 409);
  assert.equal(await code(r), "ranked_match_session");
  assert.equal(seat(partyOf(b, sessionId)), "");
});

test("withdrawing before the cutoff ends the ranked match and keeps the session", async () => {
  const { a, b, id, slug, sessionId } = await booked();
  const operationKey = key();
  const r = await withdraw(b, slug, partyOf(b, sessionId), operationKey);
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal(
    sql(`select state from app.sessions where id = '${sessionId}';`),
    "published",
  );
  assert.equal(
    sql(`select state from app.parties where id = '${partyOf(b, sessionId)}';`),
    "withdrawn",
  );
  assert.equal(
    sql(
      `select state || '|' || end_reason || '|' || ended_by from app.ranked_matches where id = '${id}';`,
    ),
    `cancelled|withdrawn|${b.id}`,
  );
  assert.equal((await mine(b)).search.endReason, "withdrew_match");
  const back = (await mine(a)).search;
  assert.equal(back.state, "searching");
  assert.equal(back.returned, "withdrawn");
  const endsAt = back.endsAt;
  assert.equal(
    (await withdraw(b, slug, partyOf(b, sessionId), operationKey)).status,
    200,
  );
  assert.equal((await mine(a)).search.endsAt, endsAt);
  // An unranked session again: the organizer records attendance as usual.
  assert.equal((await attend(a, slug, partyOf(a, sessionId))).status, 200);
});

test("withdrawing after the cutoff is kept for Results as a no-show", async () => {
  const { b, id, slug, sessionId } = await booked();
  editDetails(sessionId, "cutoffAt", "-1 minute");
  assert.equal((await withdraw(b, slug, partyOf(b, sessionId))).status, 200);
  assert.equal(
    sql(`select state from app.ranked_matches where id = '${id}';`),
    "confirmed",
  );
  assert.notEqual(
    sql(`select coalesce(no_show_at::text, '') from app.ranked_match_players
      where match_id = '${id}' and user_id = '${b.id}';`),
    "",
  );
});

test("the booker can't cancel or remove players while the match is on", async () => {
  const { a, b, slug, sessionId } = await booked();
  const cancelled = await request(`/api/sessions/${sessionId}/cancel`, a, {
    operationKey: key(),
  });
  assert.equal(cancelled.status, 409);
  assert.equal(await code(cancelled), "ranked_match_session");
  const removed = await request(`/api/registrations/${slug}/remove`, a, {
    operationKey: key(),
    partyId: partyOf(b, sessionId),
  });
  assert.equal(removed.status, 409);
  assert.equal(await code(removed), "ranked_match_session");
});

test("the match card shows who is booking, then the session and check-in times", async () => {
  const { a, b, id } = await confirmed();
  let view = (await mine(b)).match;
  assert.equal(view.booking.state, "open");
  assert.equal(view.checkIn, null);
  assert.equal((await claim(a, id)).status, 200);
  view = (await mine(b)).match;
  assert.equal(view.booking.state, "claimed");
  assert.equal(view.booking.bookerName, a.name);
  assert.equal(view.booking.you, false);
  assert.ok(view.booking.claimUntil);
  assert.equal((await mine(a)).match.booking.you, true);
  assert.equal((await book(a, id)).status, 200);
  view = (await mine(b)).match;
  assert.equal(view.booking.state, "booked");
  assert.ok(view.booking.session.slug);
  assert.equal(view.booking.session.location, `Synthetic court ${nonce}`);
  const start = Date.parse(view.booking.session.startsAt);
  assert.equal(Date.parse(view.checkIn.opensAt), start - 30 * 60000);
  assert.equal(Date.parse(view.checkIn.closesAt), start + 30 * 60000);
  assert.equal(view.checkIn.you, false);
  assert.deepEqual(
    view.players.map((p) => p.checkedIn),
    [false, false],
  );
});
