import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { localEnv } from "../scripts/local-env.mjs";
import { splitFixture } from "./helpers/split-fixtures.mjs";

const env = localEnv();
const base = process.env.RALLYPOINT_TEST_URL ?? "http://127.0.0.1:3000";
const storage = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
}).storage.from("payment-qr");
// 1x1 images with real signatures; content checks read these bytes.
const png = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);
const otherPng = Uint8Array.from([...png, 0]);
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]);
const svg = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
);

const path = (f) => `/api/sessions/${f.session.id}/payment-instructions`;
const save = (f, actor, body, operationKey = crypto.randomUUID()) =>
  f.post(actor, path(f), { operationKey, ...body });
const upload = (
  f,
  actor,
  bytes,
  type,
  revision,
  operationKey = crypto.randomUUID(),
) =>
  fetch(
    `${base}${path(f)}/qr?operationKey=${operationKey}&revision=${revision}`,
    {
      method: "POST",
      headers: {
        ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}),
        "Content-Type": type,
      },
      body: bytes,
    },
  );
const qr = (f, actor) =>
  f.get(actor, `/api/registrations/${f.session.slug}/payment-qr`);
const registration = async (f, actor) =>
  (await (await f.get(actor, `/api/registrations/${f.session.slug}`)).json())
    .registration;
const objects = async (f) => {
  const { data, error } = await storage.list(f.session.id);
  assert.ifError(error);
  return data.map((o) => o.name);
};
const ok = async (response) => {
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  return body;
};
const snapshot = (f) =>
  f.sql(
    `select jsonb_build_object('session',(select jsonb_build_object('version',version,'details',details,'updated',updated_at) from app.sessions where id='${f.session.id}'),
      'parties',(select jsonb_agg(to_jsonb(p) order by queue_sequence) from app.parties p where session_id='${f.session.id}'),
      'fees',(select jsonb_agg(to_jsonb(o) order by party_id) from app.fee_obligations o join app.parties p on p.id=o.party_id where p.session_id='${f.session.id}'));`,
  );

// Writing to app.sessions, skipping the role check or leaking the row into
// registration/share projections must fail these real HTTP assertions.
test("organizers save, correct and remove instructions and one QR without changing bookings", async (t) => {
  const f = await splitFixture(t, { feeMode: "fixed", seats: [1, 1] });
  await ok(
    await f.post(f.organizer, `/api/registrations/${f.session.slug}/payments`, {
      operationKey: crypto.randomUUID(),
      partyId: f.parties[0].id,
      action: "mark_paid",
      revision: 1,
    }),
  );
  const before = snapshot(f);
  let r = await ok(
    await save(f, f.organizer, {
      revision: 0,
      action: "save",
      text: "  PayNow 9000 0000  ",
    }),
  );
  assert.equal(r.paymentInstructions.text, "PayNow 9000 0000");
  assert.equal(r.paymentInstructions.revision, 1);
  assert.equal(r.paymentInstructions.hasImage, false);
  r = await ok(
    await save(f, f.organizer, {
      revision: 1,
      action: "save",
      text: "PayNow 9000 1111\nReference: your name",
    }),
  );
  assert.equal(r.paymentInstructions.revision, 2);
  r = await ok(await upload(f, f.organizer, png, "image/png", 2));
  assert.equal(r.paymentInstructions.hasImage, true);
  assert.equal(r.paymentInstructions.revision, 3);
  r = await ok(await upload(f, f.organizer, otherPng, "image/png", 3));
  assert.equal(r.paymentInstructions.revision, 4);
  assert.equal((await objects(f)).length, 1, "Replacing keeps one image");

  const managed = await ok(await f.get(f.organizer, path(f)));
  assert.equal(managed.paymentInstructions.revision, 4);
  assert.equal(managed.paymentInstructions.updatedBy, "Mika");
  assert.ok(!("imagePath" in managed), "Storage paths never reach a browser");
  const view = await registration(f, f.actors[0]);
  assert.deepEqual(view.paymentInstructions, {
    text: "PayNow 9000 1111\nReference: your name",
    hasImage: true,
    imageRevision: 4,
  });
  const image = await qr(f, f.actors[0]);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/png");
  assert.equal(image.headers.get("cache-control"), "no-store");
  assert.equal(image.headers.get("x-content-type-options"), "nosniff");
  assert.match(image.headers.get("content-security-policy"), /sandbox/);
  assert.deepEqual(new Uint8Array(await image.arrayBuffer()), otherPng);
  assert.equal(snapshot(f), before, "Seats, fees and paid markers unchanged");

  r = await ok(
    await save(f, f.organizer, { revision: 4, action: "remove_image" }),
  );
  assert.equal(r.paymentInstructions.hasImage, false);
  assert.equal(
    r.paymentInstructions.text,
    "PayNow 9000 1111\nReference: your name",
  );
  assert.deepEqual(await objects(f), []);
  assert.equal((await qr(f, f.actors[0])).status, 404);
  assert.equal(
    (await registration(f, f.actors[0])).paymentInstructions.hasImage,
    false,
  );
  r = await ok(await save(f, f.organizer, { revision: 5, action: "remove" }));
  assert.equal(r.paymentInstructions, null);
  assert.equal(
    "paymentInstructions" in (await registration(f, f.actors[0])),
    false,
  );
  assert.equal(snapshot(f), before);
});

test("only current organizers write and only booked people read", async (t) => {
  const f = await splitFixture(t, {
    feeMode: "fixed",
    seats: [1, 1],
    capacity: 2,
  });
  const waiting = await f.join(f.actors[2]);
  assert.equal(waiting.state, "waitlisted");
  const [confirmed, , waiter, other] = f.actors;
  const secret = "PayNow 9123 4567 to Synthetic Payee";
  for (const actor of [confirmed, waiter, other])
    assert.equal(
      (await save(f, actor, { revision: 0, action: "save", text: secret }))
        .status,
      403,
    );
  assert.equal(
    (await save(f, null, { revision: 0, action: "save", text: secret })).status,
    401,
  );
  assert.equal((await f.get(confirmed, path(f))).status, 403);
  f.sql(
    `insert into app.group_roles(group_id,user_id,role) values('${f.firstGroup}','${other.id}','cohost');`,
  );
  await ok(await save(f, other, { revision: 0, action: "save", text: secret }));
  await ok(await upload(f, other, png, "image/png", 1));
  f.sql(`delete from app.group_roles where user_id='${other.id}';`);
  assert.equal(
    (await save(f, other, { revision: 2, action: "remove" })).status,
    403,
    "A revoked co-host loses write access",
  );
  assert.equal((await upload(f, confirmed, png, "image/png", 2)).status, 403);

  for (const actor of [confirmed, waiter]) {
    assert.equal(
      (await registration(f, actor)).paymentInstructions.text,
      secret,
    );
    assert.equal((await qr(f, actor)).status, 200);
  }
  const outsider = JSON.stringify(await registration(f, other));
  assert.ok(
    !outsider.includes("PayNow") && !outsider.includes(f.session.id + "/"),
  );
  assert.equal((await qr(f, other)).status, 403);
  assert.equal((await qr(f, null)).status, 401);
  const shared = await (
    await f.get(null, `/api/shared/${f.session.slug}`)
  ).text();
  assert.ok(!shared.includes("PayNow") && !shared.includes("payment"));

  await ok(
    await f.post(confirmed, `/api/registrations/${f.session.slug}/withdraw`, {
      operationKey: crypto.randomUUID(),
      partyId: f.parties[0].id,
    }),
  );
  assert.equal(
    "paymentInstructions" in (await registration(f, confirmed)),
    false,
  );
  assert.equal(
    (await qr(f, confirmed)).status,
    403,
    "Withdrawn people lose access",
  );
  assert.equal(
    f.sql(
      "select has_table_privilege('anon','app.payment_instructions','select') or has_table_privilege('authenticated','app.payment_instructions','select');",
    ),
    "f",
  );
  const direct = await fetch(
    `${env.SUPABASE_URL}/rest/v1/rpc/read_payment_qr`,
    {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${other.token}`,
        "Content-Type": "application/json",
        "Content-Profile": "api",
      },
      body: JSON.stringify({
        p_actor_id: f.organizer.id,
        p_slug: f.session.slug,
      }),
    },
  );
  assert.equal(direct.status, 403);
  const { error } = await createClient(
    env.SUPABASE_URL,
    env.SUPABASE_PUBLISHABLE_KEY,
    {
      auth: { persistSession: false },
    },
  )
    .storage.from("payment-qr")
    .download(`${f.session.id}/${(await objects(f))[0]}`);
  assert.ok(error, "The bucket is private");
});

test("uploads refuse unsafe, mismatched, oversized or text-less images", async (t) => {
  const f = await splitFixture(t, { feeMode: "fixed", seats: [1] });
  let r = await upload(f, f.organizer, png, "image/png", 0);
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error.code, "instructions_required");
  await ok(
    await save(f, f.organizer, {
      revision: 0,
      action: "save",
      text: "Cash at the door",
    }),
  );
  for (const [bytes, type] of [
    [svg, "image/svg+xml"],
    [svg, "image/png"],
    [png, "image/jpeg"],
    [jpeg, "image/png"],
    [new TextEncoder().encode("plain"), "text/plain"],
    [new Uint8Array(), "image/png"],
  ]) {
    r = await upload(f, f.organizer, bytes, type, 1);
    assert.equal(r.status, 422, type);
    const { error } = await r.json();
    assert.equal(error.code, "invalid_image");
    assert.match(error.message, /PNG, JPEG or WebP/);
  }
  const big = new Uint8Array(1024 * 1024 + 1);
  big.set(png);
  r = await upload(f, f.organizer, big, "image/png", 1);
  assert.equal(r.status, 413);
  assert.match((await r.json()).error.message, /1 MB/);
  assert.deepEqual(await objects(f), [], "Rejected uploads store nothing");
  await ok(await upload(f, f.organizer, jpeg, "image/jpeg", 1));
  const image = await qr(f, f.organizer);
  assert.equal(image.headers.get("content-type"), "image/jpeg");
  for (const [body, status] of [
    [{ revision: 2, action: "save", text: "   " }, 422],
    [{ revision: 2, action: "save", text: "x".repeat(1001) }, 422],
    [{ revision: 2, action: "publish", text: "x" }, 422],
    [{ revision: -1, action: "remove" }, 422],
  ])
    assert.equal((await save(f, f.organizer, body)).status, status);
  assert.equal(
    (await upload(f, f.organizer, png, "image/png", "x")).status,
    422,
  );
});

test("stale revisions and replays never overwrite or leave extra images", async (t) => {
  const f = await splitFixture(t, { feeMode: "fixed", seats: [1] });
  const key = crypto.randomUUID();
  await ok(
    await save(
      f,
      f.organizer,
      { revision: 0, action: "save", text: "First" },
      key,
    ),
  );
  const replay = await ok(
    await save(
      f,
      f.organizer,
      { revision: 0, action: "save", text: "First" },
      key,
    ),
  );
  assert.equal(replay.paymentInstructions.revision, 1);
  let r = await save(
    f,
    f.organizer,
    { revision: 0, action: "save", text: "Other" },
    key,
  );
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error.code, "idempotency_conflict");
  r = await save(f, f.organizer, {
    revision: 0,
    action: "save",
    text: "Stale tab",
  });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error.code, "stale_payment_instructions");
  const recovered = await ok(
    await f.get(f.organizer, `/api/operations/${key}`),
  );
  assert.equal(recovered.paymentInstructions.text, "First");
  assert.ok(!("imagePath" in recovered) && !("removedPath" in recovered));
  assert.equal(
    (await f.get(f.actors[0], `/api/operations/${key}`)).status,
    404,
  );

  const uploadKey = crypto.randomUUID();
  const both = await Promise.all([
    upload(f, f.organizer, png, "image/png", 1, uploadKey),
    upload(f, f.organizer, png, "image/png", 1, uploadKey),
  ]);
  const results = await Promise.all(both.map(ok));
  assert.equal(results[0].paymentInstructions.revision, 2);
  assert.equal(results[1].paymentInstructions.revision, 2);
  r = await upload(f, f.organizer, otherPng, "image/png", 1, uploadKey);
  assert.equal(r.status, 409, "A different file under the same key is refused");
  assert.equal((await r.json()).error.code, "idempotency_conflict");
  r = await upload(f, f.organizer, png, "image/png", 1);
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error.code, "stale_payment_instructions");
  assert.equal((await objects(f)).length, 1, "Replays leave one stored image");
  assert.equal(
    f.sql(
      `select revision from app.payment_instructions where session_id='${f.session.id}';`,
    ),
    "2",
  );
});

test("cancelled sessions refuse changes and hide instructions from participants", async (t) => {
  const f = await splitFixture(t, { feeMode: "fixed", seats: [1] });
  await ok(
    await save(f, f.organizer, {
      revision: 0,
      action: "save",
      text: "Bank 123",
    }),
  );
  await ok(await upload(f, f.organizer, png, "image/png", 1));
  await ok(
    await f.post(f.organizer, `/api/sessions/${f.session.id}/cancel`, {
      operationKey: crypto.randomUUID(),
    }),
  );
  assert.equal(
    "paymentInstructions" in (await registration(f, f.actors[0])),
    false,
  );
  assert.equal((await qr(f, f.actors[0])).status, 403);
  const r = await save(f, f.organizer, { revision: 2, action: "remove" });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error.code, "session_closed");
  assert.equal((await upload(f, f.organizer, png, "image/png", 2)).status, 409);
  assert.equal(
    (await ok(await f.get(f.organizer, path(f)))).paymentInstructions.text,
    "Bank 123",
  );
});
