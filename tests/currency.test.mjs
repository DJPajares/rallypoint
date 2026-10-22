import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import {
  localEnv,
  fixturePassword,
  firstGroup,
} from "../scripts/local-env.mjs";
const env = localEnv(),
  base = process.env.RALLYPOINT_TEST_URL ?? "http://127.0.0.1:3000";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
async function login(email) {
  const { data, error } = await createClient(
    env.SUPABASE_URL,
    env.SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  ).auth.signInWithPassword({ email, password: fixturePassword });
  assert.ok(!error && data.session, "Synthetic sign-in must succeed");
  return { id: data.user.id, token: data.session.access_token };
}
const post = (path, actor, body) =>
  fetch(base + path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${actor.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
const local = (ms) => new Date(ms).toISOString().slice(0, 16);
function details(fee) {
  const now = Date.now();
  return {
    title: "Synthetic peso session",
    activity: "Pickleball",
    startLocal: local(now + 86400000),
    endLocal: local(now + 93600000),
    timeZone: "Asia/Manila",
    location: "Synthetic court",
    instructions: "",
    capacity: "4",
    openLocal: local(now - 3600000),
    cutoffLocal: local(now + 43200000),
    fee,
    currency: "PHP",
    guests: false,
  };
}

test("a PHP session publishes and its fee is owed in pesos", async () => {
  const organizer = await login("organizer@rallypoint.test");
  const email = `php-${crypto.randomUUID().slice(0, 8)}@rallypoint.test`;
  const { error } = await admin.auth.admin.createUser({
    email,
    password: fixturePassword,
    email_confirm: true,
  });
  assert.ok(!error);
  const player = await login(email);
  const publish = (fee) =>
    post(`/api/groups/${firstGroup}/sessions`, organizer, {
      operationKey: crypto.randomUUID(),
      groupId: firstGroup,
      intent: "publish",
      details: details(fee),
    });
  assert.equal((await publish("200.005")).status, 422);
  const r = await publish("200.00");
  assert.equal(r.status, 200);
  const session = (await r.json()).session;
  assert.equal(session.details.currency, "PHP");
  const joined = await post(`/api/registrations/${session.slug}`, player, {
    operationKey: crypto.randomUUID(),
    version: session.version,
    seats: 1,
    guestName: "",
    consent: true,
  });
  assert.equal(joined.status, 200);
  const fee = (await joined.json()).registration.own.fee;
  assert.equal(fee.currency, "PHP");
  assert.equal(fee.totalMinor, 20000);
});
