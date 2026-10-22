import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
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
function details(capacity, extra = {}) {
  const now = Date.now();
  return {
    title: "Synthetic release test",
    activity: "Workshop",
    startLocal: local(now + 86400000),
    endLocal: local(now + 93600000),
    timeZone: "UTC",
    location: "Synthetic room",
    instructions: "Test only",
    capacity,
    openLocal: local(now - 3600000),
    cutoffLocal: local(now + 43200000),
    fee: "12.50",
    currency: "SGD",
    guests: true,
    paymentMode: "organizer",
    releaseUnpaid: true,
    ...extra,
  };
}
/**
 * Synthetic fixtures move a booked time to cross a boundary; the trigger that
 * freezes booked details is switched off only for that one update.
 */
function shift(id, field, interval) {
  sql(`alter table app.sessions disable trigger protect_booked_session;`);
  try {
    sql(
      `update app.sessions set details=jsonb_set(details,'{${field}}',to_jsonb((clock_timestamp()+interval ${interval})::text)) where id='${id}';`,
    );
  } finally {
    sql(`alter table app.sessions enable trigger protect_booked_session;`);
  }
}

/** The cutoff is now: everyone booked so far booked before it, and anyone joining next is after it. */
const cutoffPassed = (id) => shift(id, "cutoffAt", "'0 seconds'");

/**
 * Holds the group and session locks while moving one booked time to just ahead
 * of now, so a request made during the hold is judged only after it gets the locks.
 */
async function lockedWindow(id, field, delayMs = 700) {
  const proc = spawn(
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
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  let output = "";
  const finished = new Promise((resolve, reject) => {
    proc.on("close", (code) =>
      code === 0 ? resolve() : reject(Error("Synthetic lock fixture failed")),
    );
    proc.on("error", reject);
  });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("Lock fixture was not ready")),
      5000,
    );
    proc.stdout.on("data", (chunk) => {
      output += chunk.toString();
      if (output.includes("REL_LOCKED")) {
        clearTimeout(timer);
        resolve();
      }
    });
    proc.on("exit", () => {
      clearTimeout(timer);
      if (!output.includes("REL_LOCKED"))
        reject(Error("Lock fixture exited early"));
    });
  });
  proc.stdin.end(
    `begin;\nselect id from app.groups where id='${firstGroup}' for update;\nselect id from app.sessions where id='${id}' for update;\nupdate app.sessions set details=jsonb_set(details,'{${field}}',to_jsonb((clock_timestamp()+interval '${delayMs} milliseconds')::text)) where id='${id}';\n\\echo REL_LOCKED\nselect pg_sleep(1.2);\ncommit;\n`,
  );
  await ready;
  return { finished };
}

test("giving unpaid spots to the waitlist after the cutoff", async (t) => {
  const organizer = await login("organizer@rallypoint.test"),
    member = await login("member@rallypoint.test"),
    outsider = await login("outsider@rallypoint.test"),
    actors = [],
    events = [];
  const nonce = crypto.randomUUID().slice(0, 8);
  const organizerName = (await admin.auth.admin.getUserById(organizer.id)).data
    .user.user_metadata.full_name;
  async function event(capacity = "2", extra = {}) {
    const r = await request(`/api/groups/${firstGroup}/sessions`, organizer, {
      operationKey: crypto.randomUUID(),
      groupId: firstGroup,
      intent: "publish",
      details: details(capacity, extra),
    });
    assert.equal(r.status, 200, await r.clone().text());
    const s = (await r.json()).session;
    events.push(s.id);
    return s;
  }
  const view = async (s, a) =>
    (await (await request(`/api/registrations/${s.slug}`, a)).json())
      .registration;
  const entry = async (s, id) =>
    (await view(s, organizer)).roster.find((p) => p.id === id);
  async function join(s, a, seats = 1) {
    const r = await request(`/api/registrations/${s.slug}`, a, {
      operationKey: crypto.randomUUID(),
      version: s.version,
      seats,
      guestName: seats === 2 ? "Guest" : "",
      consent: true,
    });
    assert.equal(r.status, 200, await r.clone().text());
    return (await r.json()).registration.own;
  }
  const release = (s, a, partyId, revision, extra = {}) =>
    request(`/api/registrations/${s.slug}/release`, a, {
      operationKey: crypto.randomUUID(),
      partyId,
      revision,
      ...extra,
    });
  const pay = (s, partyId, action, revision) =>
    request(`/api/registrations/${s.slug}/payments`, organizer, {
      operationKey: crypto.randomUUID(),
      partyId,
      action,
      revision,
    });
  const copy = {
    release_not_enabled:
      "This session doesn’t give unpaid spots to the waitlist.",
    release_too_early:
      "Unpaid spots can go to the waitlist once the cutoff passes.",
    release_closed: "Spots can’t be given away once the session starts.",
    release_not_eligible:
      "Only spots booked before the cutoff and still unpaid can go to the waitlist. Refresh to see the latest record.",
  };
  const conflict = async (r, expected) => {
    assert.equal(r.status, 409, expected);
    const { error } = await r.json();
    assert.equal(error.code, expected);
    if (copy[expected]) assert.equal(error.message, copy[expected]);
  };
  const count = (table, where) =>
    Number(sql(`select count(*) from app.${table} where ${where};`));
  const releasedIn = (s) =>
    count(
      "registration_events",
      `kind='released' and party_id in(select id from app.parties where session_id='${s.id}')`,
    );
  try {
    for (let i = 0; i < 6; i++) {
      const email = `rel-${nonce}-${i}@rallypoint.test`;
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: fixturePassword,
        email_confirm: true,
        user_metadata: { full_name: `Synthetic ${i}` },
      });
      assert.ok(!error && data.user);
      actors.push(await login(email));
    }

    await t.test(
      "only current organizers and co-hosts can release",
      async () => {
        const s = await event("3"),
          a = await join(s, actors[0]),
          b = await join(s, actors[1]);
        cutoffPassed(s.id);
        assert.equal((await release(s, null, a.id, 1)).status, 401);
        for (const who of [member, outsider, actors[0]]) {
          const r = await release(s, who, a.id, 1);
          assert.equal(r.status, 403);
          const { error } = await r.json();
          assert.equal(error.code, "group_access_denied");
          assert.equal(
            error.message,
            "Only this session’s organizers can release spots.",
          );
        }
        assert.equal(
          (await release(s, organizer, a.id, 0)).status,
          422,
          "A revision below 1 is not a record",
        );
        assert.equal((await release(s, organizer, "not-an-id", 1)).status, 422);
        assert.equal(
          (await request(`/api/registrations/${s.slug}/release`, organizer))
            .status,
          405,
        );
        assert.ok(
          (
            await client().schema("api").rpc("release_unpaid_party", {
              p_actor_id: organizer.id,
              p_actor_name: "Forged",
              p_key: crypto.randomUUID(),
              p_slug: s.slug,
              p_party_id: a.id,
              p_revision: 1,
            })
          ).error,
          "A browser client cannot call the database function",
        );
        assert.equal((await entry(s, a.id)).state, "confirmed");
        assert.equal(releasedIn(s), 0);
        // A co-host may release; once the role is revoked the next request is refused.
        sql(
          `insert into app.group_roles(group_id,user_id,role) values('${firstGroup}','${actors[2].id}','cohost');`,
        );
        try {
          assert.equal((await release(s, actors[2], a.id, 1)).status, 200);
        } finally {
          sql(
            `delete from app.group_roles where group_id='${firstGroup}' and user_id='${actors[2].id}';`,
          );
        }
        assert.equal((await release(s, actors[2], b.id, 1)).status, 403);
        assert.equal((await entry(s, a.id)).state, "removed");
        assert.equal((await entry(s, b.id)).state, "confirmed");
      },
    );

    await t.test(
      "release waits for the cutoff and closes at start",
      async () => {
        const s = await event("3"),
          a = await join(s, actors[0]),
          b = await join(s, actors[1]);
        const early = await release(s, organizer, a.id, 1);
        await conflict(early, "release_too_early");
        assert.equal((await entry(s, a.id)).releasable, false);
        cutoffPassed(s.id);
        assert.equal((await entry(s, a.id)).releasable, true);
        assert.equal((await release(s, organizer, a.id, 1)).status, 200);
        shift(s.id, "startsAt", "'-1 second'");
        assert.equal((await entry(s, b.id)).releasable, false);
        const late = await release(s, organizer, b.id, 1);
        await conflict(late, "release_closed");
        assert.equal((await entry(s, b.id)).state, "confirmed");
      },
    );

    await t.test(
      "the cutoff is inclusive, the start is exclusive, and a later confirmation is never releasable",
      async () => {
        const s = await event("3"),
          a = await join(s, actors[0]);
        cutoffPassed(s.id);
        const at = (sqlInstant) =>
          sql(`select app.party_releasable('${a.id}',${sqlInstant});`);
        const cutoff = `(select (details->>'cutoffAt')::timestamptz from app.sessions where id='${s.id}')`,
          start = `(select (details->>'startsAt')::timestamptz from app.sessions where id='${s.id}')`;
        assert.equal(at(cutoff), "t", "exactly at the cutoff");
        assert.equal(at(`${cutoff}-interval '1 microsecond'`), "f");
        assert.equal(at(`${start}-interval '1 microsecond'`), "t");
        assert.equal(at(start), "f", "exactly at the start");
        for (const [offset, expected] of [
          ["-1 second", "t"],
          ["0 seconds", "f"],
          ["+1 second", "f"],
        ]) {
          sql(
            `update app.registration_events set created_at=${cutoff}+interval '${offset}' where party_id='${a.id}';`,
          );
          assert.equal(
            at(cutoff),
            expected,
            `confirmed ${offset} from the cutoff`,
          );
        }
      },
    );

    await t.test(
      "a confirmation is stamped when it happens, not when its transaction began",
      async () => {
        const s = await event("2"),
          a = await join(s, actors[0]);
        // A lock wait can run past the cutoff; the stamp must be the post-wait instant.
        assert.equal(
          sql(
            `begin;select pg_sleep(0.3);insert into app.registration_events(party_id,kind) values('${a.id}','released') returning created_at>now()+interval '200 milliseconds';rollback;`,
          ),
          "t",
        );
      },
    );

    await t.test("release is judged after it gets the locks", async () => {
      // The cutoff arrives while the request waits, so the request is not too early.
      const s = await event("2"),
        a = await join(s, actors[0]);
      sql(`alter table app.sessions disable trigger protect_booked_session;`);
      try {
        const hold = await lockedWindow(s.id, "cutoffAt");
        const r = await release(s, organizer, a.id, 1);
        await hold.finished;
        assert.equal(r.status, 200, await r.clone().text());
        // The start arrives while the request waits, so the request is too late.
        const late = await event("2"),
          b = await join(late, actors[1]);
        cutoffPassed(late.id);
        sql(`alter table app.sessions disable trigger protect_booked_session;`);
        const hold2 = await lockedWindow(late.id, "startsAt");
        const r2 = await release(late, organizer, b.id, 1);
        await hold2.finished;
        await conflict(r2, "release_closed");
        assert.equal((await entry(late, b.id)).state, "confirmed");
      } finally {
        sql(`alter table app.sessions enable trigger protect_booked_session;`);
      }
    });

    await t.test(
      "only unpaid parties booked before the cutoff are releasable",
      async () => {
        const s = await event("4"),
          paid = await join(s, actors[0]),
          waived = await join(s, actors[1]),
          open = await join(s, actors[2]);
        assert.equal((await pay(s, paid.id, "mark_paid", 1)).status, 200);
        assert.equal((await pay(s, waived.id, "waive", 1)).status, 200);
        cutoffPassed(s.id);
        const late = await join(s, actors[3]);
        assert.equal(late.state, "confirmed");
        const entries = {};
        for (const [name, p] of Object.entries({ paid, waived, open, late }))
          entries[name] = await entry(s, p.id);
        assert.deepEqual(
          Object.fromEntries(
            Object.entries(entries).map(([k, v]) => [k, v.releasable]),
          ),
          { paid: false, waived: false, open: true, late: false },
        );
        for (const name of ["paid", "waived", "late"]) {
          const r = await release(
            s,
            organizer,
            entries[name].id,
            entries[name].fee.revision,
          );
          await conflict(r, "release_not_eligible");
          assert.equal((await entry(s, entries[name].id)).state, "confirmed");
        }
        assert.equal(releasedIn(s), 0);
        // A waitlisted party has no fee to drop.
        const full = await event("1");
        await join(full, actors[0]);
        const waiting = await join(full, actors[1]);
        cutoffPassed(full.id);
        const r = await release(full, organizer, waiting.id, 1);
        await conflict(r, "fee_not_found");
      },
    );

    await t.test("a session without the switch refuses release", async () => {
      const off = await event("2", { releaseUnpaid: false }),
        a = await join(off, actors[0]);
      cutoffPassed(off.id);
      const r = await release(off, organizer, a.id, 1);
      await conflict(r, "release_not_enabled");
      assert.equal((await entry(off, a.id)).releasable, false);
      const untracked = await event("2", {
        paymentMode: "untracked",
        releaseUnpaid: false,
        fee: "0.00",
      });
      const u = await join(untracked, actors[1]);
      cutoffPassed(untracked.id);
      const r2 = await release(untracked, organizer, u.id, 1);
      await conflict(r2, "release_not_enabled");
      assert.equal((await entry(untracked, u.id)).state, "confirmed");
    });

    await t.test(
      "release cancels the party, drops the fee and promotes in order",
      async () => {
        const s = await event("3"),
          a = await join(s, actors[0], 2),
          x = await join(s, actors[1]);
        const b = await join(s, actors[2]),
          c = await join(s, actors[3]),
          d = await join(s, actors[4]);
        for (const w of [b, c, d]) assert.equal(w.state, "waitlisted");
        cutoffPassed(s.id);
        const before = await entry(s, a.id);
        assert.equal(before.releasable, true);
        const key = crypto.randomUUID();
        const r = await release(s, organizer, a.id, before.fee.revision, {
          operationKey: key,
        });
        assert.equal(r.status, 200, await r.clone().text());
        const body = await r.json();
        assert.equal(body.operationKey, key);
        const view2 = body.registration;
        const released = view2.roster.find((p) => p.id === a.id);
        assert.equal(released.state, "removed");
        assert.equal(released.seats, 2);
        assert.equal(released.fee.liabilityState, "released_unpaid");
        assert.equal(released.fee.markedPaid, false);
        assert.equal(released.releasable, false);
        assert.equal(released.fee.revision, before.fee.revision + 1);
        assert.deepEqual(
          {
            action: released.fee.history[0].action,
            by: released.fee.history[0].by,
          },
          { action: "released_unpaid", by: organizerName },
        );
        assert.ok(released.fee.history[0].at);
        assert.equal(
          sql(
            `select removed_by||'/'||(removed_at is not null) from app.fee_obligations where party_id='${a.id}';`,
          ),
          `${organizer.id}/true`,
        );
        assert.equal(
          count(
            "registration_events",
            `party_id='${a.id}' and kind='released'`,
          ),
          1,
        );
        // The primary seat and the guest seat both open; the next two in line fill them.
        const byId = Object.fromEntries(view2.roster.map((p) => [p.id, p]));
        assert.equal(byId[b.id].state, "confirmed");
        assert.equal(byId[c.id].state, "confirmed");
        assert.equal(byId[d.id].state, "waitlisted");
        assert.equal(byId[x.id].state, "confirmed");
        assert.deepEqual(view2.counts, {
          confirmedSeats: 3,
          waitingParties: 1,
        });
        for (const p of [b, c]) {
          assert.equal(byId[p.id].fee.liabilityState, "due");
          assert.equal(byId[p.id].fee.markedPaid, false);
          assert.equal(byId[p.id].fee.totalMinor, 1250);
          // Confirmed after the cutoff, so these two cannot be released this way.
          assert.equal(byId[p.id].releasable, false);
        }
        assert.equal(byId[x.id].releasable, true);
        assert.equal((await view(s, actors[4])).own.queuePosition, 1);
        const own = (await view(s, actors[0])).own;
        assert.equal(own.state, "removed");
        assert.equal(own.fee.liabilityState, "released_unpaid");
        assert.equal(own.fee.history, undefined);
        const dues = (await (await request("/api/dues", actors[0])).json())
          .dues;
        assert.equal(
          dues.filter(
            (item) =>
              item.session.slug === s.slug && item.fee.liabilityState === "due",
          ).length,
          0,
        );
      },
    );

    await t.test("a two-seat head party is never bypassed", async () => {
      const s = await event("2"),
        a = await join(s, actors[0]),
        x = await join(s, actors[1]);
      const head = await join(s, actors[2], 2),
        later = await join(s, actors[3]);
      assert.equal(head.state, "waitlisted");
      assert.equal(later.state, "waitlisted");
      cutoffPassed(s.id);
      const r = await release(s, organizer, a.id, 1);
      assert.equal(r.status, 200);
      const v = (await r.json()).registration;
      const byId = Object.fromEntries(v.roster.map((p) => [p.id, p]));
      assert.equal(byId[a.id].state, "removed");
      assert.equal(byId[x.id].state, "confirmed");
      assert.equal(byId[head.id].state, "waitlisted");
      assert.equal(byId[later.id].state, "waitlisted");
      assert.deepEqual(v.counts, { confirmedSeats: 1, waitingParties: 2 });
      assert.equal(
        count(
          "registration_events",
          `kind='promoted' and party_id in('${head.id}','${later.id}')`,
        ),
        0,
      );
    });

    await t.test(
      "a stale revision never releases a party marked paid meanwhile",
      async () => {
        const s = await event("2"),
          a = await join(s, actors[0]);
        const seen = (await entry(s, a.id)).fee.revision;
        assert.equal((await pay(s, a.id, "mark_paid", seen)).status, 200);
        cutoffPassed(s.id);
        const r = await release(s, organizer, a.id, seen);
        await conflict(r, "stale_payment");
        const after = await entry(s, a.id);
        assert.equal(after.state, "confirmed");
        assert.equal(after.fee.markedPaid, true);
        assert.equal(after.fee.liabilityState, "due");
        assert.equal(releasedIn(s), 0);
      },
    );

    await t.test("a replay returns the first result", async () => {
      const s = await event("1"),
        a = await join(s, actors[0]),
        b = await join(s, actors[1]);
      assert.equal(b.state, "waitlisted");
      cutoffPassed(s.id);
      const key = crypto.randomUUID();
      const first = await release(s, organizer, a.id, 1, { operationKey: key });
      assert.equal(first.status, 200);
      const second = await release(s, organizer, a.id, 1, {
        operationKey: key,
      });
      assert.equal(second.status, 200);
      const one = await first.json(),
        two = await second.json();
      assert.deepEqual(two.registration, one.registration);
      assert.equal(
        one.registration.roster.find((p) => p.id === b.id).state,
        "confirmed",
      );
      assert.equal(
        count("registration_events", `party_id='${a.id}' and kind='released'`),
        1,
      );
      assert.equal(
        count("registration_events", `party_id='${b.id}' and kind='promoted'`),
        1,
      );
      assert.equal(
        count("fee_changes", `party_id='${a.id}' and action='released_unpaid'`),
        1,
      );
      const clash = await release(s, organizer, b.id, 1, { operationKey: key });
      await conflict(clash, "idempotency_conflict");
      const recovered = await request(`/api/operations/${key}`, organizer);
      assert.equal(recovered.status, 200);
      const found = await recovered.json();
      assert.equal(found.operationKey, key);
      assert.equal(
        found.registration.roster.find((p) => p.id === a.id).state,
        "removed",
      );
      assert.equal(
        (await request(`/api/operations/${key}`, member)).status,
        404,
      );
    });

    await t.test(
      "the released player can rejoin at the end of the line",
      async () => {
        const s = await event("1"),
          a = await join(s, actors[0]),
          b = await join(s, actors[1]);
        cutoffPassed(s.id);
        assert.equal((await release(s, organizer, a.id, 1)).status, 200);
        const again = await join(s, actors[0]);
        assert.equal(again.state, "waitlisted");
        assert.notEqual(again.id, a.id);
        assert.equal(again.queuePosition, 1);
        const roster = (await view(s, organizer)).roster;
        assert.equal(roster.find((p) => p.id === a.id).state, "removed");
        assert.equal(roster.find((p) => p.id === b.id).state, "confirmed");
        assert.equal(roster.find((p) => p.id === again.id).state, "waitlisted");
        // With room, the same player is confirmed again with a new fee.
        const roomy = await event("3"),
          r1 = await join(roomy, actors[2]);
        cutoffPassed(roomy.id);
        assert.equal((await release(roomy, organizer, r1.id, 1)).status, 200);
        const back = await join(roomy, actors[2]);
        assert.equal(back.state, "confirmed");
        assert.equal(back.fee.liabilityState, "due");
      },
    );

    await t.test("split sessions can't turn release on", async () => {
      const r = await request(`/api/groups/${firstGroup}/sessions`, organizer, {
        operationKey: crypto.randomUUID(),
        groupId: firstGroup,
        intent: "publish",
        details: details("2", { feeMode: "split", fee: "120.00" }),
      });
      assert.equal(r.status, 422);
      const direct = await request(
        `/api/groups/${firstGroup}/sessions`,
        organizer,
        {
          operationKey: crypto.randomUUID(),
          groupId: firstGroup,
          intent: "publish",
          details: details("2", { fee: "0.00" }),
        },
      );
      assert.equal(direct.status, 422);
    });
  } finally {
    if (events.length) {
      const ids = events.map((id) => `'${id}'`).join(",");
      const parties = `select id from app.parties where session_id in(${ids})`;
      sql(
        `begin;delete from app.operation_receipts where resource_id in(${parties}) or resource_id in(${ids});delete from app.fee_changes where party_id in(${parties});delete from app.registration_events where party_id in(${parties});delete from app.fee_obligations where party_id in(${parties});delete from app.parties where session_id in(${ids});delete from app.session_changes where session_id in(${ids});delete from app.sessions where id in(${ids});commit;`,
      );
    }
    sql(
      `delete from app.group_roles where group_id='${firstGroup}' and role='cohost' and user_id in(${actors.map((a) => `'${a.id}'`).join(",") || "null"});`,
    );
    for (const a of actors) await admin.auth.admin.deleteUser(a.id);
  }
});
