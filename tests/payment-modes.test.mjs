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
const row = (query) =>
  JSON.parse(sql(`select row_to_json(t) from (${query}) t;`));
const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const client = () =>
  createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
async function login(email) {
  const { data, error } = await client().auth.signInWithPassword({
    email,
    password: fixturePassword,
  });
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
const local = (ms) => new Date(ms).toISOString().slice(0, 16);
function details() {
  const now = Date.now();
  return {
    title: "Synthetic payment mode test",
    activity: "Workshop",
    startLocal: local(now + 86400000),
    endLocal: local(now + 93600000),
    timeZone: "UTC",
    location: "Synthetic room",
    instructions: "Test only",
    capacity: "4",
    openLocal: local(now - 3600000),
    cutoffLocal: local(now + 43200000),
    fee: "12.50",
    currency: "SGD",
    guests: true,
  };
}

test("Not tracked here sessions carry no money records", async () => {
  const organizer = await login("organizer@rallypoint.test");
  const email = `modes-${crypto.randomUUID().slice(0, 8)}@rallypoint.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: fixturePassword,
    email_confirm: true,
    user_metadata: { full_name: "Synthetic Player" },
  });
  assert.ok(!error && data.user);
  const player = await login(email);
  let sessionId;
  try {
    const published = await request(
      `/api/groups/${firstGroup}/sessions`,
      organizer,
      {
        operationKey: crypto.randomUUID(),
        groupId: firstGroup,
        intent: "publish",
        details: { ...details(), paymentMode: "untracked", fee: "0.00" },
      },
    );
    assert.equal(published.status, 200, await published.clone().text());
    const s = (await published.json()).session;
    sessionId = s.id;
    assert.equal(s.details.paymentMode, "untracked");
    const joined = await request(`/api/registrations/${s.slug}`, player, {
      operationKey: crypto.randomUUID(),
      version: s.version,
      seats: 2,
      guestName: "Guest",
      consent: true,
    });
    assert.equal(joined.status, 200);
    const own = (await joined.json()).registration.own;
    assert.equal(own.state, "confirmed");
    assert.equal(own.fee, null);
    assert.equal(
      sql(
        `select count(*) from app.fee_obligations where party_id='${own.id}';`,
      ),
      "0",
    );
    const dues = (await (await request("/api/dues", player)).json()).dues;
    assert.ok(dues.every((d) => d.session.slug !== s.slug));
    const pay = await request(
      `/api/registrations/${s.slug}/payments`,
      organizer,
      {
        operationKey: crypto.randomUUID(),
        partyId: own.id,
        action: "mark_paid",
        revision: 1,
      },
    );
    assert.equal(pay.status, 409);
    assert.equal((await pay.json()).error.code, "fee_not_found");
    const note = await request(
      `/api/sessions/${s.id}/payment-instructions`,
      organizer,
      {
        operationKey: crypto.randomUUID(),
        revision: 0,
        action: "save",
        text: "Pay at the door",
      },
    );
    assert.equal(note.status, 409);
    assert.equal((await note.json()).error.code, "payment_not_tracked");
  } finally {
    if (sessionId) {
      const ids = `'${sessionId}'`;
      const parties = `select id from app.parties where session_id=${ids}`;
      sql(
        `begin;delete from app.operation_receipts where resource_id in(${parties}) or resource_id=${ids};delete from app.registration_events where party_id in(${parties});delete from app.parties where session_id=${ids};delete from app.session_changes where session_id=${ids};delete from app.sessions where id=${ids};commit;`,
      );
    }
    await admin.auth.admin.deleteUser(player.id);
  }
});
