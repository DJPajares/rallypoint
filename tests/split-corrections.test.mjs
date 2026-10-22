import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { localEnv } from "../scripts/local-env.mjs";
import { splitFixture } from "./helpers/split-fixtures.mjs";
const route = (f) => `/api/splits/${f.session.slug}`;
const registration = async (f, a = f.organizer) =>
  (await (await f.get(a, `/api/registrations/${f.session.slug}`)).json())
    .registration;
const view = async (f) =>
  (await (await f.get(f.organizer, route(f))).json()).split;
const count = (f) =>
  Number(
    f.sql(
      `select count(*) from app.split_runs where session_id='${f.session.id}'`,
    ),
  );
async function preview(f, totalMinor, undoWaiverPartyId) {
  const r = await f.post(
    f.organizer,
    `${route(f)}/preview`,
    totalMinor === undefined
      ? { intent: "finalize" }
      : {
          intent: "correct",
          totalMinor,
          ...(undoWaiverPartyId ? { undoWaiverPartyId } : {}),
        },
  );
  assert.equal(r.status, 200, await r.clone().text());
  return (await r.json()).preview;
}
async function finalize(f) {
  f.moveStart(-1000);
  const p = await preview(f),
    key = crypto.randomUUID();
  const r = await f.post(f.organizer, `${route(f)}/finalize`, {
    operationKey: key,
    basis: p.basis,
  });
  assert.equal(r.status, 200);
  return { ...(await r.json()), key };
}
async function payment(f, index, action, revision) {
  const m = await registration(f),
    row = m.roster.find((x) => x.id === f.parties[index].id);
  return f.post(f.organizer, `/api/registrations/${f.session.slug}/payments`, {
    operationKey: crypto.randomUUID(),
    partyId: row.id,
    action,
    revision: revision ?? row.fee?.revision ?? row.splitClaim.revision,
  });
}
async function correct(
  f,
  p,
  totalMinor,
  {
    key = crypto.randomUUID(),
    reason = "Private note about another payer",
    undoWaiverPartyId,
    actor = f.organizer,
  } = {},
) {
  return f.post(actor, `${route(f)}/correct`, {
    operationKey: key,
    basis: p.basis,
    totalMinor,
    reason,
    ...(undoWaiverPartyId ? { undoWaiverPartyId } : {}),
  });
}
async function code(r, want) {
  assert.equal(r.status, 409, await r.clone().text());
  assert.equal((await r.json()).error.code, want);
}
const amounts = async (f) =>
  (await registration(f)).roster.map((x) => x.fee?.totalMinor);
test("reviewed split corrections", async (t) => {
  await t.test(
    "paid changes block; audited unpaid permits reduction and private history",
    async (t) => {
      const f = await splitFixture(t, { seats: [1, 1, 1] });
      const initial = await finalize(f);
      const originalSnapshot = f.sql(
        `select snapshot from app.split_runs where id='${initial.committedRunId}'`,
      );
      assert.equal((await payment(f, 0, "mark_paid")).status, 200);
      let p = await preview(f, 9000);
      assert.deepEqual(p.blockedPaidPartyIds, [f.parties[0].id]);
      await code(await correct(f, p, 9000), "split_paid_allocation");
      assert.equal(count(f), 1);
      assert.deepEqual(await amounts(f), [4000, 4000, 4000]);
      assert.equal((await payment(f, 0, "mark_unpaid")).status, 200);
      const oldRev = (await registration(f)).roster[0].fee.revision;
      p = await preview(f, 9000);
      const r = await correct(f, p, 9000);
      assert.equal(r.status, 200, await r.clone().text());
      const saved = await r.json();
      assert.deepEqual(await amounts(f), [3000, 3000, 3000]);
      assert.equal(count(f), 2);
      const m = await registration(f);
      assert.ok(
        m.roster[0].fee.history.some(
          (x) =>
            x.action === "marked_paid" &&
            x.by === "Mika" &&
            x.at &&
            x.currentMinor === 4000,
        ),
      );
      assert.ok(
        m.roster[0].fee.history.some(
          (x) =>
            x.action === "split_corrected" &&
            x.previousMinor === 4000 &&
            x.currentMinor === 3000,
        ),
      );
      await code(await payment(f, 0, "mark_paid", oldRev), "stale_payment");
      const increased = await f.post(f.organizer, `${route(f)}/preview`, {
        intent: "correct",
        totalMinor: 9001,
      });
      await code(increased, "split_total_increase");
      const own = await registration(f, f.actors[0]);
      assert.deepEqual(
        own.own.splitHistory.map((x) => [
          x.previousMinor,
          x.currentMinor,
          x.kind,
        ]),
        [[4000, 3000, "total_reduced"]],
      );
      assert.equal(JSON.stringify(own).includes("Private note"), false);
      assert.equal(JSON.stringify(own).includes(f.parties[1].id), false);
      assert.equal(
        JSON.stringify(own.own.splitHistory).includes("actor"),
        false,
      );
      for (const a of [null, ...f.actors]) {
        const publicR = await (
          await f.get(a, `/api/shared/${f.session.slug}`)
        ).json();
        assert.equal(JSON.stringify(publicR).includes("Private note"), false);
      }
      const due = await (await f.get(f.actors[0], "/api/dues")).json();
      assert.equal(JSON.stringify(due).includes("Private note"), false);
      assert.equal(
        due.dues.find((x) => x.partyId === f.parties[0].id).fee.totalMinor,
        3000,
      );
      assert.equal(
        saved.split.history[0].reason,
        "Private note about another payer",
      );
      const recovered = await (
        await f.get(f.organizer, `/api/operations/${initial.key}`)
      ).json();
      assert.equal(recovered.committedRunId, initial.committedRunId);
      assert.equal(recovered.split.currentRunId, saved.committedRunId);
      assert.equal(count(f), 2);
      assert.equal(
        f.sql(
          `select snapshot from app.split_runs where id='${initial.committedRunId}'`,
        ),
        originalSnapshot,
      );
    },
  );
  await t.test(
    "ordinary waiver preserves allocation; redistribution requires reviewed restoration",
    async (t) => {
      const f = await splitFixture(t, { seats: [1, 1, 1] });
      await finalize(f);
      assert.equal((await payment(f, 0, "waive")).status, 200);
      assert.deepEqual(await amounts(f), [4000, 4000, 4000]);
      assert.equal((await view(f)).uncoveredMinor, 4000);
      assert.equal((await payment(f, 0, "undo_waiver")).status, 200);
      assert.equal(count(f), 1);
      assert.equal(
        (await registration(f)).roster[0].splitUndoRequiresReview,
        false,
      );
      assert.equal((await view(f)).uncoveredMinor, 0);
      assert.equal((await payment(f, 0, "waive")).status, 200);
      assert.equal(
        (await correct(f, await preview(f, 12000), 12000)).status,
        200,
      );
      assert.deepEqual(await amounts(f), [4000, 6000, 6000]);
      assert.equal((await view(f)).uncoveredMinor, 0);
      await code(
        await payment(f, 0, "undo_waiver"),
        "split_undo_requires_review",
      );
      const id = f.parties[0].id;
      const p = await preview(f, 12000, id);
      assert.equal(
        (await correct(f, p, 12000, { undoWaiverPartyId: id })).status,
        200,
      );
      assert.deepEqual(await amounts(f), [4000, 4000, 4000]);
      assert.equal((await registration(f)).roster[0].splitClaim.waived, false);
      assert.equal((await view(f)).uncoveredMinor, 0);
      const own = await registration(f, f.actors[1]);
      assert.ok(
        own.own.splitHistory.some(
          (x) =>
            x.kind === "waiver_redistributed" &&
            x.previousMinor === 4000 &&
            x.currentMinor === 6000,
        ),
      );
      assert.ok(
        own.own.splitHistory.some(
          (x) =>
            x.kind === "waiver_restored" &&
            x.previousMinor === 6000 &&
            x.currentMinor === 4000,
        ),
      );
      assert.equal(
        f.sql(
          `select bool_and(ok) from(select r.id,sum(a.amount_minor)=r.total_minor ok from app.split_runs r join app.split_allocations a on a.run_id=r.id where r.session_id='${f.session.id}' group by r.id) x`,
        ),
        "t",
      );
    },
  );
  await t.test(
    "pre-final waiver and unallocated run restoration never invent a bill",
    async (t) => {
      const f = await splitFixture(t, { seats: [1, 1, 1] });
      assert.equal((await payment(f, 0, "waive")).status, 200);
      await finalize(f);
      await code(
        await payment(f, 0, "undo_waiver"),
        "split_undo_requires_review",
      );
      const d = await (await f.get(f.actors[0], "/api/dues")).json();
      const claim = d.splitClaims.find((x) => x.partyId === f.parties[0].id);
      assert.equal(claim.splitClaim.waived, true);
      assert.equal(
        (await registration(f)).roster[0].splitUndoRequiresReview,
        true,
      );
      assert.equal(claim.splitClaim.estimateMinor, null);
      assert.equal(
        d.dues.some((x) => x.partyId === f.parties[0].id),
        false,
      );
      const id = f.parties[0].id;
      assert.equal(
        (
          await correct(f, await preview(f, 12000, id), 12000, {
            undoWaiverPartyId: id,
          })
        ).status,
        200,
      );
      assert.deepEqual(await amounts(f), [4000, 4000, 4000]);
      const empty = await splitFixture(t, { seats: [1] });
      assert.equal((await payment(empty, 0, "waive")).status, 200);
      await finalize(empty);
      const eid = empty.parties[0].id;
      assert.equal(
        (
          await correct(empty, await preview(empty, 12000, eid), 12000, {
            undoWaiverPartyId: eid,
          })
        ).status,
        200,
      );
      assert.deepEqual(await amounts(empty), [12000]);
    },
  );
  await t.test(
    "permanent exclusions cannot be restored; unchanged paid amounts keep their basis",
    async (t) => {
      const f = await splitFixture(t, { seats: [1, 1], capacity: 2 });
      const wait = await f.join(f.actors[2]);
      assert.equal(
        (
          await f.post(
            f.actors[0],
            `/api/registrations/${f.session.slug}/withdraw`,
            { operationKey: crypto.randomUUID(), partyId: f.parties[0].id },
          )
        ).status,
        200,
      );
      await finalize(f);
      for (const id of [f.parties[0].id, wait.id]) {
        const r = await f.post(f.organizer, `${route(f)}/preview`, {
          intent: "correct",
          totalMinor: 12000,
          undoWaiverPartyId: id,
        });
        assert.equal(r.status, 409);
      }
      const waiting = await splitFixture(t, { seats: [1], capacity: 1 });
      const w = await waiting.join(waiting.actors[1]);
      assert.equal(w.state, "waitlisted");
      await finalize(waiting);
      assert.equal(
        (
          await waiting.post(waiting.organizer, `${route(waiting)}/preview`, {
            intent: "correct",
            totalMinor: 12000,
            undoWaiverPartyId: w.id,
          })
        ).status,
        409,
      );
      const g = await splitFixture(t, { total: "0.02", seats: [1, 1, 1] });
      const first = await finalize(g);
      assert.equal((await payment(g, 0, "mark_paid")).status, 200);
      const p = await preview(g, 1);
      assert.deepEqual(p.blockedPaidPartyIds, []);
      assert.equal((await correct(g, p, 1)).status, 200);
      const m = await registration(g);
      assert.equal(m.roster[0].fee.markedPaid, true);
      assert.equal(m.roster[0].fee.splitRunId, first.committedRunId);
      assert.equal(m.roster[0].fee.history.length, 1);
      assert.equal((await payment(g, 0, "mark_unpaid")).status, 200);
      assert.equal((await payment(g, 0, "waive")).status, 200);
      assert.equal((await payment(g, 0, "undo_waiver")).status, 200);
    },
  );
  await t.test(
    "payment and waiver races stale previews; concurrent keys and retries are atomic",
    async (t) => {
      const f = await splitFixture(t, { seats: [1, 1, 1] });
      await finalize(f);
      let p = await preview(f, 9000);
      assert.equal((await payment(f, 0, "mark_paid")).status, 200);
      await code(await correct(f, p, 9000), "stale_split");
      assert.equal(count(f), 1);
      assert.equal((await payment(f, 0, "mark_unpaid")).status, 200);
      p = await preview(f, 9000);
      assert.equal((await payment(f, 0, "waive")).status, 200);
      await code(await correct(f, p, 9000), "stale_split");
      assert.equal(count(f), 1);
      p = await preview(f, 9000);
      const keys = [crypto.randomUUID(), crypto.randomUUID()];
      const rs = await Promise.all(
        keys.map((key) => correct(f, p, 9000, { key })),
      );
      assert.deepEqual(rs.map((x) => x.status).sort(), [200, 409]);
      const key = keys[rs[0].status === 200 ? 0 : 1];
      assert.equal((await correct(f, p, 9000, { key })).status, 200);
      assert.equal(count(f), 2);
      await code(
        await correct(f, p, 9000, { key, reason: "Changed reason" }),
        "idempotency_conflict",
      );
      await code(await correct(f, p, 8999, { key }), "idempotency_conflict");
    },
  );
  await t.test(
    "current roles, direct RPC denial and malformed input protect corrections",
    async (t) => {
      const f = await splitFixture(t, { seats: [1] });
      await finalize(f);
      const p = await preview(f, 9000);
      for (const a of [null, ...f.actors])
        assert.equal(
          (await correct(f, p, 9000, { actor: a })).status,
          a ? 403 : 401,
        );
      const e = localEnv(),
        browser = createClient(e.SUPABASE_URL, e.SUPABASE_PUBLISHABLE_KEY, {
          auth: { persistSession: false },
          global: { headers: { Authorization: `Bearer ${f.actors[0].token}` } },
        });
      assert.ok(
        (
          await browser.schema("api").rpc("correct_split", {
            p_actor_id: f.organizer.id,
            p_actor_name: "Fake",
            p_key: crypto.randomUUID(),
            p_slug: f.session.slug,
            p_basis: p.basis,
            p_total_minor: 9000,
            p_reason: "Fake",
          })
        ).error,
      );
      for (const input of [
        { totalMinor: -1 },
        { totalMinor: 1.5 },
        { totalMinor: "100" },
        { totalMinor: 9000, undoWaiverPartyId: "bad" },
      ])
        assert.equal(
          (
            await f.post(f.organizer, `${route(f)}/preview`, {
              intent: "correct",
              ...input,
            })
          ).status,
          422,
        );
      const co = f.actors[1];
      f.sql(
        `insert into app.group_roles values('${f.firstGroup}','${co.id}','cohost')`,
      );
      const key = crypto.randomUUID();
      assert.equal((await correct(f, p, 9000, { actor: co, key })).status, 200);
      f.sql(
        `delete from app.group_roles where group_id='${f.firstGroup}' and user_id='${co.id}'`,
      );
      assert.equal((await f.get(co, `/api/operations/${key}`)).status, 403);
      assert.equal((await correct(f, p, 9000, { actor: co, key })).status, 403);
    },
  );
});
