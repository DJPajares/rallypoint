import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { localEnv } from "../scripts/local-env.mjs";
import { splitFixture } from "./helpers/split-fixtures.mjs";

// Only a draft can be deleted, its payment details go with it, and a delete
// racing a publish leaves one outcome. Deleting anything that is booked,
// published or cancelled, letting a non-manager delete, or leaving payment
// details behind must fail these real HTTP/database/storage assertions.
const env = localEnv();
const storage = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
}).storage.from("payment-qr");
const png = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);
const base = process.env.RALLYPOINT_TEST_URL ?? "http://127.0.0.1:3000";
const local = (ms) => new Date(ms).toISOString().slice(0, 16);
const MESSAGE =
  "Only a draft can be deleted. Cancel a published session instead.";
const fixture = (t) => splitFixture(t, { seats: [], capacity: 1 });

function drafts(t, f) {
  const made = [];
  t.after(async () => {
    for (const id of made) {
      const { data } = await storage.list(id);
      if (data?.length)
        await storage.remove(data.map((o) => `${id}/${o.name}`));
      f.sql(
        `begin;delete from app.operation_receipts where resource_id='${id}';delete from app.payment_instruction_notices where session_id='${id}';delete from app.payment_instructions where session_id='${id}';delete from app.session_cancellations where session_id='${id}';delete from app.session_changes where session_id='${id}';delete from app.sessions where id='${id}';commit;`,
      );
    }
  });
  const now = Date.now();
  const details = {
    title: "Synthetic draft",
    activity: "Workshop",
    location: "Synthetic room",
    instructions: "",
    startLocal: local(now + 86400000),
    endLocal: local(now + 93600000),
    openLocal: local(now - 3600000),
    cutoffLocal: local(now + 43200000),
    timeZone: "UTC",
    capacity: "4",
    currency: "SGD",
    fee: "0",
    feeMode: "fixed",
    guests: true,
  };
  return async (intent = "draft") => {
    const r = await f.post(
      f.organizer,
      `/api/groups/${f.firstGroup}/sessions`,
      {
        operationKey: crypto.randomUUID(),
        groupId: f.firstGroup,
        intent,
        details,
      },
    );
    assert.equal(r.status, 200, "Synthetic session must save");
    const session = (await r.json()).session;
    made.push(session.id);
    return { session, details };
  };
}
const del = (f, actor, id, operationKey = crypto.randomUUID()) =>
  f.post(actor, `/api/sessions/${id}/delete`, { operationKey });
const count = (f, id) =>
  Number(f.sql(`select count(*) from app.sessions where id='${id}';`));
const objects = async (id) => (await storage.list(id)).data ?? [];

test("an organizer deletes a draft and its payment details go with it", async (t) => {
  const f = await fixture(t);
  const { session } = await drafts(t, f)();
  const path = `/api/sessions/${session.id}/payment-instructions`;
  const saved = await f.post(f.organizer, path, {
    operationKey: crypto.randomUUID(),
    revision: 0,
    action: "save",
    text: "PayNow 9000 0000",
  });
  assert.equal(saved.status, 200, "Instructions must save on a draft");
  const up = await fetch(
    `${base}${path}/qr?operationKey=${crypto.randomUUID()}&revision=1`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${f.organizer.token}`,
        "Content-Type": "image/png",
      },
      body: png,
    },
  );
  assert.equal(up.status, 200, "QR must upload to a draft");
  assert.equal((await objects(session.id)).length, 1);
  const team = f.sql(
    `select g.id from app.groups g join app.sessions s on s.group_id=g.id where s.id='${session.id}' and g.kind='host';`,
  );
  assert.ok(team, "A draft is run by its own hosting team");

  const r = await del(f, f.organizer, session.id);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).deleted, true);

  assert.equal(count(f, session.id), 0);
  // P-39: the draft's hidden hosting team goes with it.
  assert.equal(
    f.sql(`select count(*) from app.groups where id='${team}';`),
    "0",
    "The hosting team is removed",
  );
  for (const table of [
    "payment_instructions",
    "payment_instruction_notices",
    "session_changes",
  ])
    assert.equal(
      f.sql(
        `select count(*) from app.${table} where session_id='${session.id}';`,
      ),
      "0",
      table,
    );
  assert.equal(
    f.sql(
      `select count(*) from app.operation_receipts where resource_id='${session.id}' and action<>'delete_draft';`,
    ),
    "0",
    "Earlier receipts for the draft go with it",
  );
  assert.deepEqual(await objects(session.id), [], "The QR image is removed");
  const read = await f.get(f.organizer, `/api/sessions/${session.id}`);
  assert.ok([403, 404].includes(read.status), `read gave ${read.status}`);
});

test("a published session can't be deleted", async (t) => {
  const f = await fixture(t);
  const { session } = await drafts(t, f)("publish");
  const before = f.sql(
    `select version||'|'||state from app.sessions where id='${session.id}';`,
  );
  const r = await del(f, f.organizer, session.id);
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error.message, MESSAGE);
  assert.equal(
    f.sql(
      `select version||'|'||state from app.sessions where id='${session.id}';`,
    ),
    before,
  );
  // The fixture's own booked-free published session is equally protected.
  assert.equal((await del(f, f.organizer, f.session.id)).status, 409);
  assert.equal(count(f, f.session.id), 1);
});

test("a cancelled session can't be deleted either", async (t) => {
  const f = await fixture(t);
  const { session } = await drafts(t, f)("publish");
  const c = await f.post(f.organizer, `/api/sessions/${session.id}/cancel`, {
    operationKey: crypto.randomUUID(),
  });
  assert.equal(c.status, 200);
  const r = await del(f, f.organizer, session.id);
  assert.equal(r.status, 409);
  assert.equal(count(f, session.id), 1);
});

test("a non-manager can't delete a draft", async (t) => {
  const f = await fixture(t);
  const { session } = await drafts(t, f)();
  const [stranger] = f.actors;
  assert.equal((await del(f, stranger, session.id)).status, 403);
  assert.equal((await del(f, null, session.id)).status, 401);
  assert.equal(count(f, session.id), 1);
});

test("a delete racing a publish leaves one outcome", async (t) => {
  const f = await fixture(t);
  const make = drafts(t, f);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 12; i++) {
    const { session, details } = await make();
    const publish = async (delay) => {
      await wait(delay);
      return f.post(f.organizer, `/api/sessions/${session.id}`, {
        operationKey: crypto.randomUUID(),
        groupId: f.firstGroup,
        intent: "publish",
        version: session.version,
        details,
      });
    };
    const remove = async (delay) => {
      await wait(delay);
      return del(f, f.organizer, session.id);
    };
    // Alternate who goes first and by how much, so both orders are exercised.
    const lead = (i >> 1) * 8;
    const [published, deleted] = await Promise.all(
      i % 2 ? [publish(lead), remove(0)] : [publish(0), remove(lead)],
    );
    const state = f.sql(
      `select coalesce((select state from app.sessions where id='${session.id}'),'missing');`,
    );
    const note = `${i}: publish ${published.status}, delete ${deleted.status}, ${state}`;
    t.diagnostic(note);
    if (state === "published") {
      assert.equal(published.status, 200, note);
      assert.equal(deleted.status, 409, note);
    } else {
      assert.equal(state, "missing", note);
      assert.equal(deleted.status, 200, note);
      assert.ok([403, 404].includes(published.status), note);
    }
  }
});

test("retrying a delete returns the same result", async (t) => {
  const f = await fixture(t);
  const { session } = await drafts(t, f)();
  const operationKey = crypto.randomUUID();
  const first = await del(f, f.organizer, session.id, operationKey);
  const again = await del(f, f.organizer, session.id, operationKey);
  assert.equal(first.status, 200);
  assert.equal(again.status, 200);
  assert.deepEqual(await again.json(), await first.json());
  // An interrupted delete can be checked afterwards by its key.
  const checked = await f.get(f.organizer, `/api/operations/${operationKey}`);
  assert.equal(checked.status, 200);
  assert.deepEqual((await checked.json()).deleted, true);
  // The same key for a different session is a different request.
  const other = await drafts(t, f)();
  const reused = await del(f, f.organizer, other.session.id, operationKey);
  assert.equal(reused.status, 409);
  assert.equal(count(f, other.session.id), 1);
  // A new key for a session that is already gone is unavailable, not a success.
  assert.equal((await del(f, f.organizer, session.id)).status, 403);
});

test("the backend role can't delete history tables directly", async (t) => {
  const f = await fixture(t);
  for (const table of [
    "sessions",
    "session_changes",
    "operation_receipts",
    "payment_instructions",
    "payment_instruction_notices",
  ])
    assert.equal(
      f.sql(
        `select has_table_privilege('service_role','app.${table}','DELETE');`,
      ),
      "f",
      table,
    );
  // The narrow helper refuses anything that isn't a draft, deleting nothing.
  const refused = f.sql(
    `do $$ begin perform app.delete_draft_rows('${f.session.id}'); exception when sqlstate 'P0001' then raise notice 'refused'; end $$; select count(*) from app.sessions where id='${f.session.id}';`,
  );
  assert.equal(refused, "1");
});
