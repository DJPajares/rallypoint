import { execFileSync, spawn } from "node:child_process";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import {
  localEnv,
  fixturePassword,
  firstGroup,
} from "../../scripts/local-env.mjs";
const env = localEnv();
const base = process.env.RALLYPOINT_TEST_URL ?? "http://127.0.0.1:5173";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const args = [
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
export const sql = (query) =>
  execFileSync("docker", args, {
    input: query,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
const client = (key) =>
  createClient(env.SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
const admin = client(env.SUPABASE_SECRET_KEY);
async function login(email) {
  const { data, error } = await client(
    env.SUPABASE_PUBLISHABLE_KEY,
  ).auth.signInWithPassword({ email, password: fixturePassword });
  assert.ok(!error && data.session, "Synthetic sign-in must succeed");
  return { id: data.user.id, token: data.session.access_token };
}
const request = (actor, path, body) =>
  fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
export async function splitFixture(
  t,
  {
    total = "120.00",
    seats = [],
    capacity = Math.max(
      1,
      seats.reduce((a, b) => a + b, 0),
    ),
    currency = "SGD",
    cutoffPast = false,
  } = {},
) {
  assert.ok(capacity >= seats.reduce((a, b) => a + b, 0));
  const actors = [],
    parties = [];
  const organizer = await login("organizer@rallypoint.test");
  let session;
  t.after(async () => {
    if (session) {
      const id = session.id;
      // New dependent objects are discovered by name, so RED tests can clean up
      // before their migration exists; SQL identifiers here are fixed constants.
      if (sql("select to_regclass('app.split_runs') is not null;") === "t") {
        sql(
          `begin;delete from app.operation_receipts where resource_id in(select id from app.split_runs where session_id='${id}');update app.sessions set current_split_run_id=null where id='${id}';delete from app.fee_changes where party_id in(select id from app.parties where session_id='${id}');delete from app.fee_obligations where party_id in(select id from app.parties where session_id='${id}');delete from app.split_allocations where run_id in(select id from app.split_runs where session_id='${id}');delete from app.split_runs where session_id='${id}';commit;`,
        );
      }
      const statements = [
        [
          "split_claim_changes",
          `party_id in(select id from app.parties where session_id='${id}')`,
        ],
        [
          "split_claims",
          `party_id in(select id from app.parties where session_id='${id}')`,
        ],
      ];
      sql(
        `begin;delete from app.operation_receipts where resource_id in(select id from app.parties where session_id='${id}') or resource_id='${id}';delete from app.attendance_changes where party_id in(select id from app.parties where session_id='${id}');delete from app.seat_attendance where party_id in(select id from app.parties where session_id='${id}');delete from app.fee_changes where party_id in(select id from app.parties where session_id='${id}');delete from app.fee_obligations where party_id in(select id from app.parties where session_id='${id}');${statements.map(([table, where]) => `do $clean$ begin if to_regclass('app.${table}') is not null then execute 'delete from app.${table} where ${where.replaceAll("'", "''")}';end if;end $clean$;`).join("")}delete from app.registration_events where party_id in(select id from app.parties where session_id='${id}');delete from app.parties where session_id='${id}';delete from app.session_changes where session_id='${id}';delete from app.sessions where id='${id}';commit;`,
      );
    }
    for (const a of actors) {
      sql(`delete from app.group_roles where user_id='${a.id}';`);
      await admin.auth.admin.deleteUser(a.id);
    }
  });
  const nonce = crypto.randomUUID().slice(0, 8);
  for (let i = 0; i < seats.length + 2; i++) {
    const email = `split-${nonce}-${i}@rallypoint.test`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: fixturePassword,
      email_confirm: true,
      user_metadata: { full_name: `Split person ${i}` },
    });
    assert.ok(!error && data.user, "Synthetic identity must be created");
    actors.push(await login(email));
  }
  const now = Date.now(),
    local = (ms) => new Date(ms).toISOString().slice(0, 16);
  const response = await request(
    organizer,
    `/api/groups/${firstGroup}/sessions`,
    {
      operationKey: crypto.randomUUID(),
      groupId: firstGroup,
      intent: "publish",
      details: {
        title: "Synthetic split session",
        activity: "Workshop",
        location: "Synthetic room",
        instructions: "",
        startLocal: local(now + 86400000),
        endLocal: local(now + 93600000),
        openLocal: local(now - 3600000),
        cutoffLocal: local(cutoffPast ? now - 60000 : now + 43200000),
        timeZone: "UTC",
        capacity: String(capacity),
        currency,
        fee: total,
        feeMode: "split",
        guests: true,
      },
    },
  );
  assert.equal(response.status, 200, "Total-cost session must publish");
  session = (await response.json()).session;
  async function join(actor, count = 1) {
    const r = await request(actor, `/api/registrations/${session.slug}`, {
      operationKey: crypto.randomUUID(),
      version: session.version,
      seats: count,
      guestName: count === 2 ? "Synthetic guest" : "",
      consent: true,
    });
    assert.equal(r.status, 200, "Synthetic party join must succeed");
    return (await r.json()).registration.own;
  }
  for (let i = 0; i < seats.length; i++)
    parties.push(await join(actors[i], seats[i]));
  const moveStart = (offset) =>
    sql(
      `begin;alter table app.sessions disable trigger protect_booked_session;update app.sessions set details=jsonb_set(details,'{startsAt}',to_jsonb((clock_timestamp()+interval '${Number(offset)} milliseconds')::text)) where id='${session.id}';alter table app.sessions enable trigger protect_booked_session;commit;`,
    );
  async function lockStart(offset, hold) {
    const proc = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    const finished = new Promise((resolve, reject) => {
      proc.on("close", (code) =>
        code === 0 ? resolve() : reject(Error("Synthetic lock failed")),
      );
      proc.on("error", reject);
    });
    const ready = new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error("Synthetic lock not ready")),
        5000,
      );
      proc.stdout.on("data", (v) => {
        out += v.toString();
        if (out.includes("SPLIT_LOCKED")) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    proc.stderr.resume();
    const change =
      offset === null
        ? ""
        : `alter table app.sessions disable trigger protect_booked_session;update app.sessions set details=jsonb_set(details,'{startsAt}',to_jsonb((clock_timestamp()+interval '${Number(offset)} milliseconds')::text)) where id='${session.id}';alter table app.sessions enable trigger protect_booked_session;`;
    proc.stdin.end(
      `begin;select id from app.groups where id='${firstGroup}' for update;select id from app.sessions where id='${session.id}' for update;${change}\n\\echo SPLIT_LOCKED\nselect pg_sleep(${Number(hold) / 1000});commit;`,
    );
    await ready;
    return { finished };
  }
  return {
    session,
    organizer,
    actors,
    parties,
    get: (actor, path) => request(actor, path),
    post: request,
    sql,
    moveStart,
    lockStart,
    join,
    firstGroup,
  };
}
