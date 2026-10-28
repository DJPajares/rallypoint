import { test } from "node:test";
import assert from "node:assert/strict";
import { splitFixture } from "./helpers/split-fixtures.mjs";
const view = async (f, a) =>
  (await (await f.get(a, `/api/registrations/${f.session.slug}`)).json())
    .registration;
const pay = (f, a, p, action, revision) =>
  f.post(a, `/api/registrations/${f.session.slug}/payments`, {
    operationKey: crypto.randomUUID(),
    partyId: p,
    action,
    revision,
  });
const withdraw = (f, a, p) =>
  f.post(a, `/api/registrations/${f.session.slug}/withdraw`, {
    operationKey: crypto.randomUUID(),
    partyId: p,
  });
test("split claims and live estimates", async (t) => {
  await t.test(
    "confirmation creates a pending share rather than a payable amount",
    async (t) => {
      const f = await splitFixture(t, { seats: [1, 1, 1, 1, 1, 1] });
      assert.equal(f.session.details.totalMinor, 12000);
      assert.equal(f.session.details.feeMinor, undefined);
      const own = await view(f, f.actors[0]);
      assert.equal(own.own.fee, null);
      assert.equal(own.own.splitClaim.estimateMinor, 2000);
      const m = await view(f, f.organizer),
        claim = m.roster.find((p) => p.id === f.parties[0].id).splitClaim;
      for (const action of ["mark_paid", "mark_unpaid"]) {
        const r = await pay(
          f,
          f.organizer,
          f.parties[0].id,
          action,
          claim.revision,
        );
        assert.equal(r.status, 409);
        assert.equal((await r.json()).error.code, "split_not_finalized");
      }
      const shared = (
        await (await f.get(null, `/api/shared/${f.session.slug}`)).json()
      ).session;
      assert.equal(shared.split.payingSeats, 6);
      assert.equal(shared.split.totalMinor, 12000);
      assert.equal(JSON.stringify(shared).includes(f.parties[0].id), false);
      assert.equal(JSON.stringify(own.roster).includes("splitClaim"), false);
      const edit = await f.post(f.organizer, `/api/sessions/${f.session.id}`, {
        operationKey: crypto.randomUUID(),
        groupId: f.firstGroup,
        intent: "update",
        version: f.session.version,
        details: { ...f.session.details, fee: "150.00" },
      });
      assert.equal(edit.status, 409);
    },
  );
  await t.test(
    "early withdrawal stays excluded after waiver undo",
    async (t) => {
      const f = await splitFixture(t, { seats: [2, 1] });
      let m = await view(f, f.organizer),
        p = f.parties[0].id;
      assert.equal(
        (await pay(f, f.organizer, p, "waive", m.roster[0].splitClaim.revision))
          .status,
        200,
      );
      assert.equal((await view(f, f.actors[1])).split.payingSeats, 1);
      assert.equal((await withdraw(f, f.actors[0], p)).status, 200);
      m = await view(f, f.organizer);
      assert.equal(
        (
          await pay(
            f,
            f.organizer,
            p,
            "undo_waiver",
            m.roster[0].splitClaim.revision,
          )
        ).status,
        200,
      );
      const own = (await view(f, f.actors[0])).own;
      assert.equal(own.splitClaim.eligible, false);
      assert.equal(own.splitClaim.waived, false);
      assert.equal(own.splitClaim.estimateMinor, null);
      assert.equal((await view(f, f.organizer)).split.payingSeats, 1);
    },
  );
  await t.test(
    "late replacement and same-person rejoin retain separate claims",
    async (t) => {
      const f = await splitFixture(t, {
        seats: [1],
        capacity: 1,
        cutoffPast: true,
      });
      const waiting = await f.join(f.actors[1]);
      assert.equal(waiting.state, "waitlisted");
      assert.equal(waiting.splitClaim, undefined);
      assert.equal(
        (await withdraw(f, f.actors[0], f.parties[0].id)).status,
        200,
      );
      assert.equal((await view(f, f.actors[1])).own.state, "confirmed");
      assert.equal((await view(f, f.organizer)).split.payingSeats, 2);
      await withdraw(f, f.actors[1], waiting.id);
      const rejoin = await f.join(f.actors[0]);
      assert.equal(rejoin.state, "confirmed");
      assert.equal((await view(f, f.organizer)).split.payingSeats, 3);
      assert.equal(
        Number(
          f.sql(
            `select count(*) from app.split_claims c join app.parties p on p.id=c.party_id where p.session_id='${f.session.id}';`,
          ),
        ),
        3,
      );
    },
  );
  await t.test(
    "pending waivers require current authority and a fresh claim revision",
    async (t) => {
      const f = await splitFixture(t, { seats: [1] });
      const p = f.parties[0].id;
      const c = (await view(f, f.organizer)).roster[0].splitClaim;
      assert.equal(
        (await pay(f, f.actors[0], p, "waive", c.revision)).status,
        403,
      );
      const r = await pay(f, f.organizer, p, "waive", c.revision);
      assert.equal(r.status, 200);
      assert.equal(
        (await pay(f, f.organizer, p, "undo_waiver", c.revision)).status,
        409,
      );
      const own = (await view(f, f.actors[0])).own;
      assert.equal(own.splitClaim.waived, true);
      assert.equal(own.splitClaim.revision, undefined);
    },
  );
  await t.test("claim removal uses the strict cutoff boundary", async (t) => {
    const f = await splitFixture(t, { seats: [1, 1, 1] });
    const cutoff = "2027-01-02T00:00:00Z";
    for (const [i, offset, want] of [
      [0, "-1 microsecond", false],
      [1, "0 microseconds", true],
      [2, "1 microsecond", true],
    ]) {
      f.sql(
        `select app.release_withdrawal_fee('${f.parties[i].id}','${f.actors[i].id}','${cutoff}'::timestamptz+interval '${offset}','${cutoff}');`,
      );
      assert.equal((await view(f, f.actors[i])).own.splitClaim.eligible, want);
    }
  });
  await t.test(
    "pending waiver receipts replay once and revoked co-hosts cannot replay",
    async (t) => {
      const f = await splitFixture(t, { seats: [1] });
      const p = f.parties[0].id;
      const c = (await view(f, f.organizer)).roster[0].splitClaim;
      f.sql(
        `insert into app.group_roles(group_id,user_id,role) select id,'${f.actors[1].id}','cohost' from app.groups where origin_group_id='${f.firstGroup}' on conflict do nothing;`,
      );
      const body = {
        operationKey: crypto.randomUUID(),
        partyId: p,
        action: "waive",
        revision: c.revision,
      };
      for (let i = 0; i < 2; i++)
        assert.equal(
          (
            await f.post(
              f.actors[1],
              `/api/registrations/${f.session.slug}/payments`,
              body,
            )
          ).status,
          200,
        );
      assert.equal(
        Number(
          f.sql(
            `select count(*) from app.split_claim_changes where party_id='${p}';`,
          ),
        ),
        2,
      );
      f.sql(
        `delete from app.group_roles where group_id in (select id from app.groups where origin_group_id='${f.firstGroup}') and user_id='${f.actors[1].id}';`,
      );
      assert.equal(
        (
          await f.post(
            f.actors[1],
            `/api/registrations/${f.session.slug}/payments`,
            body,
          )
        ).status,
        403,
      );
    },
  );
});
