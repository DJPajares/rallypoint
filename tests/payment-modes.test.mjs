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

// A 1x1 image with a real PNG signature, so the QR upload's content checks pass.
const png = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

test("instructions saved before switching to Not tracked here stay stored but are never shown", async () => {
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
  const registration = async (actor, slug) =>
    (await (await request(`/api/registrations/${slug}`, actor)).json())
      .registration;
  const qr = (actor, slug) =>
    request(`/api/registrations/${slug}/payment-qr`, actor);
  try {
    const published = await request(
      `/api/groups/${firstGroup}/sessions`,
      organizer,
      {
        operationKey: crypto.randomUUID(),
        groupId: firstGroup,
        intent: "publish",
        details: { ...details(), paymentMode: "organizer" },
      },
    );
    assert.equal(published.status, 200, await published.clone().text());
    let s = (await published.json()).session;
    sessionId = s.id;
    const path = `/api/sessions/${s.id}/payment-instructions`;
    const saved = await request(path, organizer, {
      operationKey: crypto.randomUUID(),
      revision: 0,
      action: "save",
      text: "Pay the organizer at the door",
    });
    assert.equal(saved.status, 200, await saved.clone().text());
    const uploaded = await fetch(
      `${base}${path}/qr?operationKey=${crypto.randomUUID()}&revision=1`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${organizer.token}`,
          "Content-Type": "image/png",
        },
        body: png,
      },
    );
    assert.equal(uploaded.status, 200, await uploaded.clone().text());
    const edit = async (mode) => {
      const r = await request(`/api/sessions/${s.id}`, organizer, {
        operationKey: crypto.randomUUID(),
        groupId: firstGroup,
        intent: "update",
        version: s.version,
        details: {
          ...details(),
          paymentMode: mode,
          ...(mode === "untracked" ? { fee: "0.00" } : {}),
        },
      });
      assert.equal(r.status, 200, await r.clone().text());
      s = (await r.json()).session;
      assert.equal(s.details.paymentMode, mode);
    };

    // Entitled while tracked: the organizer sees the text and the image.
    const tracked = await registration(organizer, s.slug);
    assert.equal(
      tracked.paymentInstructions.text,
      "Pay the organizer at the door",
    );
    assert.equal(tracked.paymentInstructions.hasImage, true);
    assert.equal((await qr(organizer, s.slug)).status, 200);

    // Switched before anyone books: nothing is readable, nothing is deleted.
    await edit("untracked");
    assert.equal(
      "paymentInstructions" in (await registration(organizer, s.slug)),
      false,
    );
    const hidden = await qr(organizer, s.slug);
    assert.equal(hidden.status, 403);
    assert.equal(
      (await hidden.json()).error.code,
      "payment_instructions_unavailable",
    );
    assert.equal(
      sql(
        `select count(*) from app.payment_instructions where session_id='${s.id}' and body is not null and image_path is not null;`,
      ),
      "1",
    );

    // Switching back shows the same instructions again.
    await edit("organizer");
    const back = await registration(organizer, s.slug);
    assert.equal(
      back.paymentInstructions.text,
      "Pay the organizer at the door",
    );
    assert.equal((await qr(organizer, s.slug)).status, 200);

    // A booked player of an untracked session gets neither the text nor the image.
    await edit("untracked");
    const joined = await request(`/api/registrations/${s.slug}`, player, {
      operationKey: crypto.randomUUID(),
      version: s.version,
      seats: 1,
      guestName: "",
      consent: true,
    });
    assert.equal(joined.status, 200, await joined.clone().text());
    const own = (await joined.json()).registration;
    assert.equal(own.own.state, "confirmed");
    assert.equal("paymentInstructions" in own, false);
    const view = await registration(player, s.slug);
    assert.equal(
      JSON.stringify(view).includes("Pay the organizer at the door"),
      false,
    );
    assert.equal("paymentInstructions" in view, false);
    assert.equal((await qr(player, s.slug)).status, 403);
    assert.equal(
      "paymentInstructions" in (await registration(organizer, s.slug)),
      false,
    );
  } finally {
    if (sessionId) {
      const qrBucket = admin.storage.from("payment-qr");
      const { data: stored } = await qrBucket.list(sessionId);
      if (stored?.length)
        await qrBucket.remove(stored.map((o) => `${sessionId}/${o.name}`));
      const ids = `'${sessionId}'`;
      const parties = `select id from app.parties where session_id=${ids}`;
      sql(
        `begin;delete from app.operation_receipts where resource_id in(${parties}) or resource_id=${ids};delete from app.registration_events where party_id in(${parties});delete from app.parties where session_id=${ids};delete from app.session_changes where session_id=${ids};delete from app.sessions where id=${ids};commit;`,
      );
    }
    await admin.auth.admin.deleteUser(player.id);
  }
});

test("a session that releases unpaid spots needs a cutoff before its start", async () => {
  const organizer = await login("organizer@rallypoint.test");
  const publish = (extra) =>
    request(`/api/groups/${firstGroup}/sessions`, organizer, {
      operationKey: crypto.randomUUID(),
      groupId: firstGroup,
      intent: "publish",
      details: {
        ...details(),
        paymentMode: "organizer",
        feeMode: "fixed",
        releaseUnpaid: true,
        ...extra,
      },
    });
  // A cutoff at the start leaves no window to release in: refused before
  // anything is saved.
  const atStart = details().startLocal;
  const refused = await publish({ cutoffLocal: atStart });
  assert.equal(refused.status, 422, await refused.clone().text());
  assert.equal(
    (await refused.json()).error.message,
    "Set the cutoff before the start so unpaid spots can go to the waitlist.",
  );

  // The database refuses it too, whatever calls it. The same call with the
  // cutoff a minute earlier goes through (rolled back here), so the cutoff is
  // what is being refused.
  const call = (cutoffAt) => `select app.save_session_before_cancellation(
    '${organizer.id}','${crypto.randomUUID()}','${firstGroup}',null,'publish',null,
    '${JSON.stringify({
      title: "Synthetic release window",
      activity: "Workshop",
      location: "Synthetic room",
      capacity: "4",
      startsAt: "2031-05-09T10:00:00Z",
      endsAt: "2031-05-09T12:00:00Z",
      opensAt: "2031-05-01T09:00:00Z",
      cutoffAt,
      currency: "SGD",
      guests: false,
      paymentMode: "organizer",
      feeMode: "fixed",
      feeMinor: 1250,
      releaseUnpaid: true,
    })}'::jsonb);`;
  assert.throws(
    () => sql(`begin;${call("2031-05-09T10:00:00Z")}rollback;`),
    /invalid_input/,
  );
  assert.doesNotThrow(() =>
    sql(`begin;${call("2031-05-09T09:59:00Z")}rollback;`),
  );
  assert.equal(
    sql(
      `select count(*) from app.sessions where details->>'title'='Synthetic release window';`,
    ),
    "0",
  );
});
