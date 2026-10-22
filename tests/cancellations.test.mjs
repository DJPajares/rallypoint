import { test } from "node:test";
import assert from "node:assert/strict";
import { localEnv } from "../scripts/local-env.mjs";
import { splitFixture } from "./helpers/split-fixtures.mjs";

const cancel = (
  f,
  actor = f.organizer,
  operationKey = crypto.randomUUID(),
  id = f.session.id,
) => f.post(actor, `/api/sessions/${id}/cancel`, { operationKey });
const row = (f, query) =>
  JSON.parse(f.sql(`select row_to_json(t) from (${query}) t;`));
const parties = (f) =>
  f.sql(
    `select jsonb_agg(to_jsonb(p) order by queue_sequence) from app.parties p where session_id='${f.session.id}';`,
  );
const fee = (f, partyId) =>
  row(f, `select * from app.fee_obligations where party_id='${partyId}'`);

// Removing the state/fee transition, authorization, receipt deduplication or
// session lock must fail these real HTTP/database assertions.
test("cancellation preserves reservations and paid history, removes unpaid liability once", async (t) => {
  const f = await splitFixture(t, {
    feeMode: "fixed",
    seats: [1, 1],
    capacity: 2,
    cutoffPast: true,
  });
  const waiting = await f.join(f.actors[2]);
  const paid = f.parties[0],
    unpaid = f.parties[1];
  let r = await f.post(
    f.organizer,
    `/api/registrations/${f.session.slug}/payments`,
    {
      operationKey: crypto.randomUUID(),
      partyId: paid.id,
      action: "mark_paid",
      revision: 1,
    },
  );
  assert.equal(r.status, 200);
  const beforePaid = fee(f, paid.id),
    beforeParties = parties(f);
  const key = crypto.randomUUID();
  const responses = await Promise.all([
    cancel(f, f.organizer, key),
    cancel(f, f.organizer, key),
  ]);
  for (const response of responses) {
    assert.equal(response.status, 200, "Organizer cancellation succeeds");
    assert.equal((await response.json()).session.state, "cancelled");
  }
  assert.equal(parties(f), beforeParties);
  assert.deepEqual(fee(f, paid.id), beforePaid);
  const removed = fee(f, unpaid.id);
  assert.equal(removed.liability_state, "removed_session_cancelled");
  assert.equal(removed.removed_by, f.organizer.id);
  assert.ok(removed.removed_at);
  assert.equal(removed.total_minor, 12000);
  assert.equal(removed.revision, 2);
  assert.equal(
    f.sql(
      `select count(*) from app.fee_changes where party_id='${unpaid.id}' and action='removed_session_cancelled';`,
    ),
    "1",
  );
  assert.equal(
    f.sql(
      `select count(*) from app.session_cancellations where session_id='${f.session.id}';`,
    ),
    "1",
  );
  assert.equal(
    (await cancel(f)).status,
    200,
    "Fresh-key repeat is also harmless",
  );
  assert.deepEqual(fee(f, unpaid.id), removed);
  const recovered = await f.get(f.organizer, `/api/operations/${key}`);
  assert.equal(recovered.status, 200);
  assert.equal((await recovered.json()).session.state, "cancelled");
  r = await f.get(null, `/api/shared/${f.session.slug}`);
  const shared = (await r.json()).session;
  assert.equal(shared.state, "cancelled");
  assert.equal(shared.registrationWindow, "closed");
  assert.deepEqual(Object.keys(shared).sort(), [
    "counts",
    "details",
    "groupName",
    "registrationWindow",
    "slug",
    "state",
    "version",
  ]);
  const own = (
    await (
      await f.get(f.actors[1], `/api/registrations/${f.session.slug}`)
    ).json()
  ).registration;
  assert.equal(own.own.fee.liabilityState, "removed_session_cancelled");
  assert.equal(
    own.own.state,
    "confirmed",
    "Historical party state is preserved",
  );
  r = await f.post(f.actors[3], `/api/registrations/${f.session.slug}`, {
    operationKey: crypto.randomUUID(),
    version: f.session.version,
    seats: 1,
    guestName: "",
    consent: true,
  });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error.code, "registration_closed");
  for (const [actor, party] of [
    [f.actors[0], paid],
    [f.actors[2], waiting],
  ]) {
    r = await f.post(actor, `/api/registrations/${f.session.slug}/withdraw`, {
      operationKey: crypto.randomUUID(),
      partyId: party.id,
    });
    assert.equal(r.status, 409);
    assert.equal((await r.json()).error.code, "withdrawal_closed");
  }
  f.sql(`select app.fill_waitlist('${f.session.id}');`);
  assert.equal(parties(f), beforeParties);
  for (const intent of ["update", "publish", "draft"]) {
    r = await f.post(f.organizer, `/api/sessions/${f.session.id}`, {
      operationKey: crypto.randomUUID(),
      groupId: f.firstGroup,
      version: shared.version,
      intent,
      details: f.session.details,
    });
    assert.equal(r.status, 409);
    assert.equal((await r.json()).error.code, "session_closed");
  }
});

test("cancellation requires a current manager and rechecks roles on replay and recovery", async (t) => {
  const f = await splitFixture(t, {
    feeMode: "fixed",
    seats: [1],
    capacity: 2,
  });
  for (const actor of [null, ...f.actors]) {
    const r = await cancel(f, actor);
    assert.equal(r.status, actor ? 403 : 401);
  }
  assert.equal(
    (await (await f.get(null, `/api/shared/${f.session.slug}`)).json()).session
      .state,
    "published",
  );
  const cohost = f.actors[1],
    key = crypto.randomUUID();
  f.sql(
    `insert into app.group_roles(group_id,user_id,role) values('${f.firstGroup}','${cohost.id}','cohost');`,
  );
  assert.equal((await cancel(f, cohost, key)).status, 200);
  f.sql(
    `delete from app.group_roles where group_id='${f.firstGroup}' and user_id='${cohost.id}';`,
  );
  assert.equal((await cancel(f, cohost, key)).status, 403);
  assert.equal((await f.get(cohost, `/api/operations/${key}`)).status, 403);
});

test("cancelling a draft never publishes its details", async (t) => {
  const f = await splitFixture(t);
  const r = await f.post(f.organizer, `/api/groups/${f.firstGroup}/sessions`, {
    operationKey: crypto.randomUUID(),
    groupId: f.firstGroup,
    intent: "draft",
    details: { ...f.session.details, title: "Private draft" },
  });
  assert.equal(r.status, 200);
  const draft = (await r.json()).session;
  t.after(() =>
    f.sql(
      `delete from app.operation_receipts where resource_id='${draft.id}';delete from app.session_changes where session_id='${draft.id}';delete from app.sessions where id='${draft.id}';`,
    ),
  );
  assert.equal(
    (await cancel(f, f.organizer, crypto.randomUUID(), draft.id)).status,
    200,
  );
  assert.equal((await f.get(null, `/api/shared/${draft.slug}`)).status, 404);
  assert.equal(
    (await (await f.get(f.organizer, `/api/sessions/${draft.id}`)).json())
      .session.cancelledFrom,
    "draft",
  );
  assert.equal(
    (await (await f.get(f.organizer, `/api/sessions/${draft.id}`)).json())
      .session.state,
    "cancelled",
  );
});

test("cancellation removes retained withdrawal fees and pending split claims", async (t) => {
  for (const feeMode of ["fixed", "split"]) {
    const f = await splitFixture(t, {
      feeMode,
      seats: [1, 1],
      capacity: 2,
      cutoffPast: true,
    });
    const p = f.parties[0];
    assert.equal(
      (
        await f.post(
          f.actors[0],
          `/api/registrations/${f.session.slug}/withdraw`,
          { operationKey: crypto.randomUUID(), partyId: p.id },
        )
      ).status,
      200,
    );
    assert.equal((await cancel(f)).status, 200);
    if (feeMode === "fixed") {
      assert.equal(fee(f, p.id).liability_state, "removed_session_cancelled");
    } else {
      assert.equal(
        f.sql(
          `select count(*) from app.split_claims c join app.parties p on p.id=c.party_id where p.session_id='${f.session.id}' and c.eligible;`,
        ),
        "0",
      );
      const own = (
        await (
          await f.get(f.actors[0], `/api/registrations/${f.session.slug}`)
        ).json()
      ).registration.own;
      assert.equal(own.splitClaim.eligible, false);
      assert.equal(own.splitClaim.estimateMinor, null);
      assert.equal(
        f.sql(
          `select count(*) from app.split_claim_changes c join app.parties p on p.id=c.party_id where p.session_id='${f.session.id}' and c.action='removed_session_cancelled';`,
        ),
        "2",
      );
    }
  }
});

test("join and cancellation serialize without surviving unpaid fees or half-applied parties", async (t) => {
  for (let n = 0; n < 3; n++) {
    const f = await splitFixture(t, { feeMode: "fixed", capacity: 1 });
    const lock = await f.lockStart(null, 500);
    const joining = f.post(
      f.actors[0],
      `/api/registrations/${f.session.slug}`,
      {
        operationKey: crypto.randomUUID(),
        version: f.session.version,
        seats: 1,
        guestName: "",
        consent: true,
      },
    );
    const cancelling = cancel(f);
    const [joinResponse, cancelResponse] = await Promise.all([
      joining,
      cancelling,
      lock.finished,
    ]);
    assert.equal(cancelResponse.status, 200);
    assert.ok([200, 409].includes(joinResponse.status));
    const count = f.sql(
      `select count(*) from app.parties where session_id='${f.session.id}';`,
    );
    assert.equal(count, joinResponse.status === 200 ? "1" : "0");
    assert.equal(
      f.sql(
        `select count(*) from app.fee_obligations f join app.parties p on p.id=f.party_id where p.session_id='${f.session.id}' and f.liability_state='due' and not f.marked_paid;`,
      ),
      "0",
    );
    assert.equal(
      f.sql(
        `select count(*) from app.session_cancellations where session_id='${f.session.id}';`,
      ),
      "1",
    );
  }
});

test("a failed fee transition rolls back cancellation, signal and receipt together", async (t) => {
  const f = await splitFixture(t, { feeMode: "fixed", seats: [1] });
  const key = crypto.randomUUID();
  // Fail one synthetic session only; no real identities or other sessions affected.
  f.sql(
    `create function app.test_cancel_failure() returns trigger language plpgsql as $$begin if new.party_id='${f.parties[0].id}' and new.liability_state='removed_session_cancelled' then raise exception 'synthetic_cancel_failure';end if;return new;end;$$;create trigger test_cancel_failure before update on app.fee_obligations for each row execute function app.test_cancel_failure();`,
  );
  try {
    assert.equal((await cancel(f, f.organizer, key)).status, 503);
    assert.equal(
      f.sql(`select state from app.sessions where id='${f.session.id}';`),
      "published",
    );
    assert.equal(
      f.sql(
        `select count(*) from app.session_cancellations where session_id='${f.session.id}';`,
      ),
      "0",
    );
    assert.equal(
      f.sql(
        `select count(*) from app.operation_receipts where request_key='${key}';`,
      ),
      "0",
    );
    assert.equal(fee(f, f.parties[0].id).liability_state, "due");
  } finally {
    f.sql(
      "drop trigger test_cancel_failure on app.fee_obligations;drop function app.test_cancel_failure();",
    );
  }
  assert.equal((await cancel(f, f.organizer, key)).status, 200);
});

test("finalized split cancellation keeps paid allocations and cannot restore unpaid dues", async (t) => {
  const f = await splitFixture(t, { seats: [1, 1], total: "101.01" });
  f.moveStart(-1000);
  const previewResponse = await f.post(
    f.organizer,
    `/api/splits/${f.session.slug}/preview`,
    { intent: "finalize" },
  );
  assert.equal(previewResponse.status, 200);
  const preview = (await previewResponse.json()).preview;
  const finalResponse = await f.post(
    f.organizer,
    `/api/splits/${f.session.slug}/finalize`,
    { operationKey: crypto.randomUUID(), basis: preview.basis },
  );
  assert.equal(finalResponse.status, 200);
  const paidId = f.parties[0].id,
    unpaidId = f.parties[1].id;
  assert.equal(
    (
      await f.post(
        f.organizer,
        `/api/registrations/${f.session.slug}/payments`,
        {
          operationKey: crypto.randomUUID(),
          partyId: paidId,
          action: "mark_paid",
          revision: fee(f, paidId).revision,
        },
      )
    ).status,
    200,
  );
  const paid = fee(f, paidId);
  assert.equal((await cancel(f)).status, 200);
  assert.deepEqual(fee(f, paidId), paid);
  assert.equal(fee(f, unpaidId).liability_state, "removed_session_cancelled");
  const response = await f.post(
    f.organizer,
    `/api/registrations/${f.session.slug}/payments`,
    {
      operationKey: crypto.randomUUID(),
      partyId: paidId,
      action: "mark_unpaid",
      revision: paid.revision,
    },
  );
  assert.equal(
    response.status,
    409,
    "A correction cannot revive debt after cancellation",
  );
  assert.deepEqual(fee(f, paidId), paid);
});

test("cancellation validates requests, denies other roles and protects direct RPC access", async (t) => {
  const f = await splitFixture(t, { feeMode: "fixed" });
  const g = await splitFixture(t, { feeMode: "fixed" });
  const key = crypto.randomUUID();
  f.sql(
    `insert into app.group_roles(group_id,user_id,role) values('${f.firstGroup}','${f.actors[0].id}','member');insert into app.group_roles(group_id,user_id,role) select id,'${f.actors[1].id}','organizer' from app.groups where id<>'${f.firstGroup}' limit 1;`,
  );
  for (const actor of f.actors)
    assert.equal((await cancel(f, actor)).status, 403);
  assert.equal(
    (
      await f.post(f.organizer, `/api/sessions/${f.session.id}/cancel`, {
        operationKey: "bad",
      })
    ).status,
    422,
  );
  assert.equal(
    (await f.get(f.organizer, `/api/sessions/${f.session.id}/cancel`)).status,
    405,
  );
  const env = localEnv();
  const direct = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/cancel_session`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${f.actors[0].token}`,
      "Content-Type": "application/json",
      "Content-Profile": "api",
    },
    body: JSON.stringify({
      p_actor_id: f.organizer.id,
      p_actor_name: "Forged organizer",
      p_key: key,
      p_session_id: f.session.id,
    }),
  });
  assert.equal(direct.status, 403);
  assert.equal(
    f.sql(`select state from app.sessions where id='${f.session.id}';`),
    "published",
  );
  assert.equal((await cancel(f, f.organizer, key)).status, 200);
  const conflict = await cancel(g, g.organizer, key);
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error.code, "idempotency_conflict");
  assert.equal(
    (await f.get(f.actors[0], `/api/operations/${key}`)).status,
    404,
  );
  assert.equal(
    f.sql(
      "select has_table_privilege('anon','app.session_cancellations','select') or has_table_privilege('authenticated','app.session_cancellations','select');",
    ),
    "f",
  );
});
