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
    title: "Synthetic payment note test",
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
    ...extra,
  };
}

test("saying you have sent payment, as a hint for organizers", async (t) => {
  const organizer = await login("organizer@rallypoint.test"),
    member = await login("member@rallypoint.test"),
    actors = [],
    events = [];
  async function event(capacity = "3", extra = {}) {
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
  const note = (s, a, partyId, action = "mark", reference = "", extra = {}) =>
    request(`/api/registrations/${s.slug}/payment-note`, a, {
      operationKey: crypto.randomUUID(),
      partyId,
      action,
      reference,
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
    note_not_allowed:
      "You can only say you’ve paid for your own booking in a session paid to the organizer.",
    note_already_paid: "The organizer has already marked this paid.",
    invalid_payment_note: "Use a payment reference of up to 60 characters.",
  };
  const refused = async (r, status, code) => {
    assert.equal(r.status, status, code);
    const { error } = await r.json();
    assert.equal(error.code, code);
    if (copy[code]) assert.equal(error.message, copy[code]);
  };
  const notesFor = (partyId) =>
    Number(
      sql(
        `select count(*) from app.payment_notes where party_id='${partyId}';`,
      ),
    );
  const notesIn = (s) =>
    Number(
      sql(
        `select count(*) from app.payment_notes where party_id in(select id from app.parties where session_id='${s.id}');`,
      ),
    );
  try {
    const nonce = crypto.randomUUID().slice(0, 8);
    for (let i = 0; i < 4; i++) {
      const email = `note-${nonce}-${i}@rallypoint.test`;
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
      "a player can say they sent it, with or without a reference",
      async () => {
        const s = await event(),
          a = await join(s, actors[0]);
        assert.equal(
          a.paymentNote,
          null,
          "Nothing is said until the player says it",
        );
        const first = await note(s, actors[0], a.id, "mark", "  ABC 123  ");
        assert.equal(first.status, 200, await first.clone().text());
        const sent = (await first.json()).registration.own.paymentNote;
        assert.equal(sent.reference, "ABC 123", "The reference is trimmed");
        assert.ok(!Number.isNaN(Date.parse(sent.sentAt)));
        assert.deepEqual((await view(s, actors[0])).own.paymentNote, sent);
        // Marking again replaces it.
        const again = await note(s, actors[0], a.id, "mark", "XYZ 9");
        assert.equal(again.status, 200);
        const replaced = (await again.json()).registration.own.paymentNote;
        assert.equal(replaced.reference, "XYZ 9");
        assert.ok(Date.parse(replaced.sentAt) >= Date.parse(sent.sentAt));
        assert.equal(notesFor(a.id), 1, "One note per party");
        // A blank reference is a note without one.
        const blank = await note(s, actors[0], a.id, "mark", "   ");
        assert.equal(blank.status, 200);
        assert.equal(
          (await blank.json()).registration.own.paymentNote.reference,
          null,
        );
        assert.equal(
          sql(
            `select reference is null from app.payment_notes where party_id='${a.id}';`,
          ),
          "t",
        );
        assert.equal(notesFor(a.id), 1);
      },
    );

    await t.test("undo works until the organizer marks paid", async () => {
      const s = await event(),
        a = await join(s, actors[0]);
      assert.equal(
        (await note(s, actors[0], a.id, "mark", "ABC 123")).status,
        200,
      );
      const undone = await note(s, actors[0], a.id, "undo");
      assert.equal(undone.status, 200, await undone.clone().text());
      assert.equal((await undone.json()).registration.own.paymentNote, null);
      assert.equal(notesFor(a.id), 0);
      // Undo with nothing to undo is still fine.
      assert.equal((await note(s, actors[0], a.id, "undo")).status, 200);
      assert.equal(
        (await note(s, actors[0], a.id, "mark", "ABC 123")).status,
        200,
      );
      const fee = (await entry(s, a.id)).fee;
      assert.equal((await pay(s, a.id, "mark_paid", fee.revision)).status, 200);
      await refused(
        await note(s, actors[0], a.id, "mark", "NEW 1"),
        409,
        "note_already_paid",
      );
      await refused(
        await note(s, actors[0], a.id, "undo"),
        409,
        "note_already_paid",
      );
      assert.equal(notesFor(a.id), 1, "A paid party's note stays as it was");
      // If the organizer takes the paid mark back, the player can change it again.
      const paid = (await entry(s, a.id)).fee;
      assert.equal(
        (await pay(s, a.id, "mark_unpaid", paid.revision)).status,
        200,
      );
      assert.equal((await note(s, actors[0], a.id, "undo")).status, 200);
      assert.equal(notesFor(a.id), 0);
    });

    await t.test("a waiting player can say they sent it", async () => {
      const s = await event("1");
      await join(s, actors[0]);
      const waiting = await join(s, actors[1]);
      assert.equal(waiting.state, "waitlisted");
      const r = await note(s, actors[1], waiting.id, "mark", "WAIT 1");
      assert.equal(r.status, 200, await r.clone().text());
      const own = (await r.json()).registration.own;
      assert.equal(own.state, "waitlisted");
      assert.equal(own.queuePosition, 1);
      assert.equal(own.paymentNote.reference, "WAIT 1");
    });

    await t.test(
      "only the party's own primary, in Pay the organizer, while booked",
      async () => {
        const s = await event(),
          a = await join(s, actors[0]);
        assert.equal(
          (await note(s, null, a.id, "mark", "ABC 123")).status,
          401,
        );
        for (const who of [actors[1], organizer, member]) {
          await refused(
            await note(s, who, a.id, "mark", "ABC 123"),
            403,
            "session_unavailable",
          );
        }
        assert.equal(notesIn(s), 0, "No other account can write a note");
        assert.equal(
          (await note(s, actors[0], crypto.randomUUID(), "mark")).status,
          403,
          "A party that is not in this session is not theirs",
        );
        assert.equal(
          (
            await request(
              `/api/registrations/${s.slug}/payment-note`,
              actors[0],
            )
          ).status,
          405,
        );
        for (const bad of [
          { action: "paid" },
          { partyId: "not-an-id" },
          { operationKey: "not-a-key" },
          { reference: 7 },
        ]) {
          const r = await note(s, actors[0], a.id, "mark", "ABC 123", bad);
          assert.equal(r.status, 422, JSON.stringify(bad));
        }
        assert.ok(
          (
            await client().schema("api").rpc("update_payment_note", {
              p_actor_id: actors[0].id,
              p_key: crypto.randomUUID(),
              p_slug: s.slug,
              p_party_id: a.id,
              p_action: "mark",
              p_reference: "FORGED",
            })
          ).error,
          "A browser client cannot call the database function",
        );
        assert.equal(notesIn(s), 0);

        // Not tracked here: nothing is owed, so there is nothing to say.
        const untracked = await event("3", {
          paymentMode: "untracked",
          fee: "0.00",
        });
        const u = await join(untracked, actors[0]);
        await refused(
          await note(untracked, actors[0], u.id, "mark", "ABC 123"),
          409,
          "note_not_allowed",
        );
        assert.equal(notesIn(untracked), 0);

        // A withdrawn party is no longer booked.
        const withdrawn = await join(s, actors[1]);
        const left = await request(
          `/api/registrations/${s.slug}/withdraw`,
          actors[1],
          { operationKey: crypto.randomUUID(), partyId: withdrawn.id },
        );
        assert.equal(left.status, 200);
        await refused(
          await note(s, actors[1], withdrawn.id, "mark", "ABC 123"),
          409,
          "note_not_allowed",
        );

        // Nor is a party an organizer removed.
        const removed = await join(s, actors[2]);
        sql(`update app.parties set state='removed' where id='${removed.id}';`);
        await refused(
          await note(s, actors[2], removed.id, "mark", "ABC 123"),
          409,
          "note_not_allowed",
        );
        await refused(
          await note(s, actors[2], removed.id, "undo"),
          409,
          "note_not_allowed",
        );

        // Nor is anything in a cancelled session.
        const cancelled = await event();
        const c = await join(cancelled, actors[0]);
        const gone = await request(
          `/api/sessions/${cancelled.id}/cancel`,
          organizer,
          {
            operationKey: crypto.randomUUID(),
          },
        );
        assert.equal(gone.status, 200, await gone.clone().text());
        await refused(
          await note(cancelled, actors[0], c.id, "mark", "ABC 123"),
          409,
          "note_not_allowed",
        );
        for (const id of [u.id, withdrawn.id, removed.id, c.id])
          assert.equal(notesFor(id), 0);
        assert.equal(notesIn(s), 0);
        assert.equal(notesIn(untracked), 0);
        assert.equal(notesIn(cancelled), 0);
      },
    );

    await t.test(
      "organizers see the note and confirmed participants don't",
      async () => {
        const s = await event("2"),
          a = await join(s, actors[0]),
          b = await join(s, actors[1]),
          waiting = await join(s, actors[2]);
        assert.equal(waiting.state, "waitlisted");
        assert.equal(
          (await note(s, actors[0], a.id, "mark", "ABC 123")).status,
          200,
        );
        assert.equal(
          (await note(s, actors[2], waiting.id, "mark", "WAIT 2")).status,
          200,
        );

        const managed = (await view(s, organizer)).roster;
        assert.equal(
          managed.find((p) => p.id === a.id).paymentNote.reference,
          "ABC 123",
        );
        assert.equal(
          managed.find((p) => p.id === waiting.id).paymentNote.reference,
          "WAIT 2",
        );
        assert.equal(
          managed.find((p) => p.id === b.id).paymentNote,
          null,
          "Organizers see who has not said it",
        );

        // A co-host is an organizer for this; once revoked, they are not.
        sql(
          `insert into app.group_roles(group_id,user_id,role) values('${firstGroup}','${actors[3].id}','cohost');`,
        );
        try {
          const co = (await view(s, actors[3])).roster;
          assert.equal(
            co.find((p) => p.id === a.id).paymentNote.reference,
            "ABC 123",
          );
        } finally {
          sql(
            `delete from app.group_roles where group_id='${firstGroup}' and user_id='${actors[3].id}';`,
          );
        }
        const revoked = await view(s, actors[3]);
        assert.ok(!JSON.stringify(revoked).includes("ABC 123"));

        // Another confirmed participant sees the roster, but nothing about notes.
        const other = await view(s, actors[1]);
        assert.equal(other.rosterAllowed, true);
        assert.equal(other.roster.length, 2);
        assert.equal(JSON.stringify(other.roster).includes("ABC 123"), false);
        assert.equal(
          JSON.stringify(other.roster).includes("paymentNote"),
          false,
        );
        assert.equal(JSON.stringify(other).includes("ABC 123"), false);
        assert.equal(other.own.paymentNote, null, "Their own is theirs alone");
        // The player sees their own, a waiting player sees no roster, and a bystander sees nothing.
        assert.equal(
          (await view(s, actors[0])).own.paymentNote.reference,
          "ABC 123",
        );
        const waitingView = await view(s, actors[2]);
        assert.equal(waitingView.rosterAllowed, false);
        assert.equal(
          JSON.stringify(waitingView.roster).includes("paymentNote"),
          false,
        );
        const bystander = await view(s, member);
        assert.equal(JSON.stringify(bystander).includes("ABC 123"), false);
        assert.equal(JSON.stringify(bystander).includes("WAIT 2"), false);
        // The note stays with a booked party; once removed it is not shown to anyone.
        sql(`update app.parties set state='removed' where id='${waiting.id}';`);
        assert.equal(
          (await entry(s, waiting.id)).paymentNote,
          null,
          "A removed party's note is not shown",
        );
      },
    );

    await t.test(
      "the note never changes the spot or the paid mark",
      async () => {
        const s = await event("2"),
          a = await join(s, actors[0], 2),
          waiting = await join(s, actors[1]);
        assert.equal(waiting.state, "waitlisted");
        assert.equal(a.fee.markedPaid, false);
        // Everything a note could wrongly touch, for both parties.
        const snapshot = async () => {
          const roster = (await view(s, organizer)).roster,
            ownWaiting = (await view(s, actors[1])).own;
          return JSON.stringify([
            ...[a.id, waiting.id].map((id) => {
              const p = roster.find((x) => x.id === id);
              // A waiting party has no fee yet; a booked one has its paid mark.
              return [
                p.state,
                p.fee?.markedPaid ?? null,
                p.fee?.revision ?? null,
                p.fee?.totalMinor ?? null,
              ];
            }),
            [ownWaiting.state, ownWaiting.queuePosition],
          ]);
        };
        const history = () =>
          sql(
            `select (select count(*) from app.registration_events where party_id in('${a.id}','${waiting.id}'))||'/'||(select count(*) from app.fee_changes where party_id in('${a.id}','${waiting.id}'));`,
          );
        const before = await snapshot(),
          recorded = history();
        for (const [who, party] of [
          [actors[0], a],
          [actors[1], waiting],
        ]) {
          assert.equal(
            (await note(s, who, party.id, "mark", "SENT 1")).status,
            200,
          );
          assert.equal(await snapshot(), before);
          assert.equal((await note(s, who, party.id, "undo")).status, 200);
          assert.equal(await snapshot(), before);
        }
        assert.equal(
          history(),
          recorded,
          "No registration or fee history is written",
        );
      },
    );

    await t.test("references over 60 characters are refused", async () => {
      const s = await event(),
        a = await join(s, actors[0]);
      const long = await note(s, actors[0], a.id, "mark", "x".repeat(61));
      await refused(long, 422, "invalid_payment_note");
      assert.equal(notesFor(a.id), 0);
      const exact = await note(s, actors[0], a.id, "mark", "y".repeat(60));
      assert.equal(exact.status, 200, await exact.clone().text());
      assert.equal(
        (await exact.json()).registration.own.paymentNote.reference.length,
        60,
      );
      const padded = await note(
        s,
        actors[0],
        a.id,
        "mark",
        ` ${"z".repeat(60)} `,
      );
      assert.equal(
        padded.status,
        200,
        "Spaces around the reference don't count",
      );
      // The database holds the same line when called directly.
      for (const reference of ["", "x".repeat(61)]) {
        const direct = await admin.schema("api").rpc("update_payment_note", {
          p_actor_id: actors[0].id,
          p_key: crypto.randomUUID(),
          p_slug: s.slug,
          p_party_id: a.id,
          p_action: "mark",
          p_reference: reference,
        });
        assert.equal(direct.error?.code, "23514", reference.length.toString());
      }
      assert.equal(
        sql(
          `select reference from app.payment_notes where party_id='${a.id}';`,
        ),
        "z".repeat(60),
      );
    });

    await t.test("a replay returns the first result", async () => {
      const s = await event(),
        a = await join(s, actors[0]);
      const operationKey = crypto.randomUUID();
      const send = (reference) =>
        note(s, actors[0], a.id, "mark", reference, { operationKey });
      const first = await send("ABC 123");
      assert.equal(first.status, 200, await first.clone().text());
      const sentAt = (await first.json()).registration.own.paymentNote.sentAt;
      const replay = await send("ABC 123");
      assert.equal(replay.status, 200);
      assert.equal(
        (await replay.json()).registration.own.paymentNote.sentAt,
        sentAt,
        "A replay does not send it again",
      );
      assert.equal(notesFor(a.id), 1);
      await refused(await send("OTHER 1"), 409, "idempotency_conflict");
      // The same key for another action is not a replay either.
      await refused(
        await note(s, actors[0], a.id, "undo", "ABC 123", { operationKey }),
        409,
        "idempotency_conflict",
      );
      assert.equal(
        sql(
          `select reference from app.payment_notes where party_id='${a.id}';`,
        ),
        "ABC 123",
      );
      // A replay after a later change still succeeds and writes nothing.
      assert.equal((await note(s, actors[0], a.id, "undo")).status, 200);
      const later = await send("ABC 123");
      assert.equal(later.status, 200);
      assert.equal(notesFor(a.id), 0, "A replay never writes again");
      // Recovery after an interrupted request reads what the key committed.
      const recovered = await request(
        `/api/operations/${operationKey}`,
        actors[0],
      );
      assert.equal(recovered.status, 200, await recovered.clone().text());
      const body = await recovered.json();
      assert.equal(body.operationKey, operationKey);
      assert.equal(body.registration.own.id, a.id);
      assert.equal(
        (await request(`/api/operations/${operationKey}`, actors[1])).status,
        404,
        "Another account's key resolves to nothing",
      );
    });

    await t.test(
      "a note racing the paid mark leaves one consistent record",
      async () => {
        for (let i = 0; i < 4; i++) {
          const s = await event(),
            a = await join(s, actors[0]);
          const { revision } = (await entry(s, a.id)).fee;
          const [sent, paid] = await Promise.all([
            note(s, actors[0], a.id, "mark", `RACE ${i}`),
            pay(s, a.id, "mark_paid", revision),
          ]);
          assert.equal(paid.status, 200, await paid.clone().text());
          if (sent.status === 200) assert.equal(notesFor(a.id), 1);
          else {
            await refused(sent, 409, "note_already_paid");
            assert.equal(notesFor(a.id), 0);
          }
          assert.equal(
            (await entry(s, a.id)).fee.markedPaid,
            true,
            "The note never undoes the organizer's mark",
          );
        }
      },
    );
  } finally {
    if (events.length) {
      const ids = events.map((id) => `'${id}'`).join(",");
      const parties = `select id from app.parties where session_id in(${ids})`;
      sql(
        `begin;delete from app.payment_notes where party_id in(${parties});delete from app.operation_receipts where resource_id in(${parties}) or resource_id in(${ids});delete from app.fee_changes where party_id in(${parties});delete from app.registration_events where party_id in(${parties});delete from app.fee_obligations where party_id in(${parties});delete from app.parties where session_id in(${ids});delete from app.session_changes where session_id in(${ids});delete from app.sessions where id in(${ids});commit;`,
      );
    }
    sql(
      `delete from app.group_roles where group_id='${firstGroup}' and role='cohost' and user_id in(${actors.map((a) => `'${a.id}'`).join(",") || "null"});`,
    );
    for (const a of actors) await admin.auth.admin.deleteUser(a.id);
  }
});
