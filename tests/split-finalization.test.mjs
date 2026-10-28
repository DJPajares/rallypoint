import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { localEnv } from "../scripts/local-env.mjs";
import { splitFixture } from "./helpers/split-fixtures.mjs";
import { allocateSplit } from "../packages/domain/src/fees.ts";
const route = (f) => `/api/splits/${f.session.slug}`;
const own = async (f, a) =>
  (await (await f.get(a, `/api/registrations/${f.session.slug}`)).json())
    .registration;
export async function preview(f, input = { intent: "finalize" }) {
  const r = await f.post(f.organizer, `${route(f)}/preview`, input);
  assert.equal(r.status, 200);
  return (await r.json()).preview;
}
async function finalize(f, p, key = crypto.randomUUID(), actor = f.organizer) {
  return f.post(actor, `${route(f)}/finalize`, {
    operationKey: key,
    basis: p.basis,
  });
}
test("organizer split finalization", async (t) => {
  await t.test(
    "exact guest-party amounts are finalized only at or after start",
    async (t) => {
      const f = await splitFixture(t, { total: "100.00", seats: [2, 1] });
      let p = await preview(f);
      assert.deepEqual(
        p.parties.map((x) => x.totalMinor),
        [6667, 3333],
      );
      const early = await finalize(f, p);
      assert.equal(early.status, 409);
      assert.equal((await early.json()).error.code, "split_too_early");
      assert.throws(() =>
        f.sql(
          `select app.require_split_start(s,(s.details->>'startsAt')::timestamptz-interval '1 microsecond') from app.sessions s where id='${f.session.id}';`,
        ),
      );
      f.sql(
        `select app.require_split_start(s,(s.details->>'startsAt')::timestamptz) from app.sessions s where id='${f.session.id}';`,
      );
      f.moveStart(-1000);
      p = await preview(f);
      const result = await finalize(f, p);
      assert.equal(result.status, 200);
      const saved = await result.json();
      assert.ok(saved.committedRunId);
      assert.equal(saved.split.currentRunId, saved.committedRunId);
      for (const [i, want] of [
        [0, 6667],
        [1, 3333],
      ]) {
        const v = await own(f, f.actors[i]);
        assert.equal(v.own.fee.totalMinor, want);
        assert.equal(v.own.fee.unitMinor, null);
        assert.equal(v.own.splitClaim.estimateMinor, null);
      }
      assert.equal(
        Number(
          f.sql(
            `select count(*) from app.split_runs where session_id='${f.session.id}';`,
          ),
        ),
        1,
      );
      assert.equal(
        Number(
          f.sql(
            `select count(*) from app.split_allocations where run_id='${saved.committedRunId}';`,
          ),
        ),
        3,
      );
      assert.equal(saved.split.history[0].by, "Mika");
      assert.ok(saved.split.history[0].at);
      assert.deepEqual(
        saved.split.history[0].parties.map((x) => x.currentMinor),
        [6667, 3333],
      );
      const due = await (await f.get(f.actors[0], "/api/dues")).json();
      assert.equal(
        due.dues.find((x) => x.partyId === f.parties[0].id).fee.totalMinor,
        6667,
      );
      assert.equal(
        due.splitClaims.some((x) => x.partyId === f.parties[0].id),
        false,
      );
    },
  );
  await t.test(
    "empty and tiny totals preserve unallocated cost and zero shares",
    async (t) => {
      const empty = await splitFixture(t, { seats: [] });
      empty.moveStart(-1000);
      const zeroResult = await finalize(empty, await preview(empty));
      assert.equal(zeroResult.status, 200);
      const zero = await zeroResult.json();
      assert.equal(zero.split.summary.phase, "unallocated");
      assert.equal(zero.split.uncoveredMinor, 12000);
      assert.equal(
        Number(
          empty.sql(
            `select count(*) from app.fee_obligations f join app.parties p on p.id=f.party_id where p.session_id='${empty.session.id}';`,
          ),
        ),
        0,
      );
      const f = await splitFixture(t, { total: "0.01", seats: [1, 1, 1] });
      f.moveStart(-1000);
      assert.equal((await finalize(f, await preview(f))).status, 200);
      const m = await own(f, f.organizer);
      assert.deepEqual(
        m.roster.map((x) => x.fee.totalMinor),
        [1, 0, 0],
      );
      const fee = m.roster[1].fee;
      const paid = await f.post(
        f.organizer,
        `/api/registrations/${f.session.slug}/payments`,
        {
          operationKey: crypto.randomUUID(),
          partyId: f.parties[1].id,
          revision: fee.revision,
          action: "mark_paid",
        },
      );
      assert.equal(paid.status, 409);
    },
  );
  await t.test(
    "stale previews and simultaneous finalizers do not create extra runs",
    async (t) => {
      const f = await splitFixture(t, { seats: [1, 1] });
      f.moveStart(-1000);
      const before = await preview(f),
        m = await own(f, f.organizer);
      assert.equal(
        (
          await f.post(
            f.organizer,
            `/api/registrations/${f.session.slug}/payments`,
            {
              operationKey: crypto.randomUUID(),
              partyId: f.parties[0].id,
              revision: m.roster[0].splitClaim.revision,
              action: "waive",
            },
          )
        ).status,
        200,
      );
      const stale = await finalize(f, before);
      assert.equal(stale.status, 409);
      assert.equal((await stale.json()).error.code, "stale_split");
      const p = await preview(f),
        keys = [crypto.randomUUID(), crypto.randomUUID()];
      const results = await Promise.all([
        finalize(f, p, keys[0]),
        finalize(f, p, keys[1]),
      ]);
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
      const winningIndex = results[0].status === 200 ? 0 : 1;
      const winner = await results[winningIndex].json();
      const key = keys[winningIndex];
      assert.equal(
        Number(
          f.sql(
            `select count(*) from app.split_runs where session_id='${f.session.id}';`,
          ),
        ),
        1,
      );
      {
        assert.equal((await finalize(f, p, key)).status, 200);
        const recovered = await f.get(f.organizer, `/api/operations/${key}`);
        assert.equal(
          (await recovered.json()).committedRunId,
          winner.committedRunId,
        );
        const conflict = await finalize(f, { basis: "0".repeat(64) }, key);
        assert.equal(conflict.status, 409);
        assert.equal(
          (await conflict.json()).error.code,
          "idempotency_conflict",
        );
      }
      const waived = (
        await (await f.get(f.actors[0], "/api/dues")).json()
      ).splitClaims.find((x) => x.partyId === f.parties[0].id);
      assert.equal(waived.splitClaim.waived, true);
      assert.equal(waived.splitClaim.estimateMinor, null);
    },
  );
  await t.test(
    "post-lock clock allows finalization after waiting across start",
    async (t) => {
      const f = await splitFixture(t, { seats: [1] });
      f.moveStart(1500);
      const p = await preview(f);
      const hold = await f.lockStart(null, 2200);
      const result = await finalize(f, p);
      await hold.finished;
      assert.equal(result.status, 200);
    },
  );
  await t.test(
    "attendance is independent while cancellation blocks a new split",
    async (t) => {
      const f = await splitFixture(t, { seats: [1] });
      f.moveStart(-1000);
      const p = await preview(f);
      const r = await f.post(
        f.organizer,
        `/api/registrations/${f.session.slug}/attendance`,
        {
          operationKey: crypto.randomUUID(),
          partyId: f.parties[0].id,
          seat: 1,
          state: "checked_in",
          revision: 0,
        },
      );
      assert.equal(r.status, 200);
      assert.equal((await finalize(f, p)).status, 200);
      assert.equal(
        (await own(f, f.organizer)).roster[0].attendance[0].state,
        "checked_in",
      );
      const cancelled = await splitFixture(t, { seats: [1] });
      cancelled.moveStart(-1000);
      const cp = await preview(cancelled);
      cancelled.sql(
        `update app.sessions set state='cancelled' where id='${cancelled.session.id}';`,
      );
      assert.equal((await finalize(cancelled, cp)).status, 409);
    },
  );
  await t.test(
    "completed sessions can finalize without changing attendance",
    async (t) => {
      const f = await splitFixture(t, { seats: [1] });
      f.moveStart(-1000);
      f.sql(
        `update app.sessions set state='completed' where id='${f.session.id}'`,
      );
      assert.equal((await finalize(f, await preview(f))).status, 200);
      assert.equal((await own(f, f.actors[0])).own.fee.totalMinor, 12000);
    },
  );
  await t.test(
    "only a current manager can preview, apply or recover",
    async (t) => {
      const f = await splitFixture(t, { seats: [1] });
      f.moveStart(-1000);
      const p = await preview(f);
      for (const a of [null, ...f.actors]) {
        assert.equal(
          (await f.post(a, `${route(f)}/preview`, { intent: "finalize" }))
            .status,
          a ? 403 : 401,
        );
        assert.equal(
          (await finalize(f, p, crypto.randomUUID(), a)).status,
          a ? 403 : 401,
        );
      }
      const e = localEnv();
      const browser = createClient(e.SUPABASE_URL, e.SUPABASE_PUBLISHABLE_KEY, {
        auth: { persistSession: false },
        global: { headers: { Authorization: `Bearer ${f.actors[0].token}` } },
      });
      assert.ok(
        (
          await browser.schema("api").rpc("finalize_split", {
            p_actor_id: f.organizer.id,
            p_actor_name: "Fake",
            p_key: crypto.randomUUID(),
            p_slug: f.session.slug,
            p_basis: p.basis,
          })
        ).error,
      );
      f.sql(
        `insert into app.group_roles(group_id,user_id,role) select id,'${f.actors[1].id}','cohost' from app.groups where origin_group_id='${f.firstGroup}' on conflict do nothing;`,
      );
      const key = crypto.randomUUID();
      assert.equal((await finalize(f, p, key, f.actors[1])).status, 200);
      f.sql(
        `delete from app.group_roles where group_id in (select id from app.groups where origin_group_id='${f.firstGroup}') and user_id='${f.actors[1].id}';`,
      );
      assert.equal(
        (await f.get(f.actors[1], `/api/operations/${key}`)).status,
        403,
      );
      const publicView = await f.get(null, `/api/shared/${f.session.slug}`);
      assert.match(publicView.headers.get("cache-control"), /no-store/);
      assert.equal(
        JSON.stringify(await publicView.json()).includes("history"),
        false,
      );
    },
  );
  await t.test(
    "SQL and browser-safe arithmetic agree at the safe integer boundary",
    async (t) => {
      const f = await splitFixture(t, {
        total: "90071992547409.91",
        seats: [2, 1],
      });
      const p = await preview(f);
      const rows = JSON.parse(
        f.sql(
          `select json_agg(json_build_object('partyId',id,'queueSequence',queue_sequence::text,'seats',seats) order by queue_sequence) from app.parties where session_id='${f.session.id}';`,
        ),
      );
      assert.deepEqual(
        p.seats,
        allocateSplit(Number.MAX_SAFE_INTEGER, rows).seats,
      );
    },
  );
});
