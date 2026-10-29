import { test } from "node:test";
import assert from "node:assert/strict";
import { cohostFixture, request } from "./helpers/cohost-fixtures.mjs";

// P-28: an organizer or co-host removes someone from an upcoming session
// (D-07, owner 2026-10-29). An unpaid fee is dropped, a paid marker stays, no
// email is sent, and the person can't rejoin from the link; an invite from the
// organizer lets them back in. Synthetic accounts only.

async function setup(t) {
  const f = await cohostFixture(t);
  const path = `/api/registrations/${f.session.slug}`;
  // Two places, both taken: the outsider waits.
  const waiting = await request(path, f.outsider, {
    operationKey: crypto.randomUUID(),
    version: f.session.version,
    seats: 1,
    guestName: "",
    consent: true,
  });
  assert.equal(waiting.status, 200);
  const view = async (actor = f.owner) => {
    const r = await request(path, actor);
    assert.equal(r.status, 200);
    return (await r.json()).registration;
  };
  const party = async (who) => {
    const id = f.sql(
      `select id from app.parties where session_id='${f.session.id}' and user_id='${who.id}' order by queue_sequence desc limit 1;`,
    );
    return (await view()).roster.find((p) => p.id === id);
  };
  const remove = (actor, partyId, operationKey = crypto.randomUUID()) =>
    request(`${path}/remove`, actor, { operationKey, partyId });
  const state = (who) =>
    f.sql(
      `select state from app.parties where session_id='${f.session.id}' and user_id='${who.id}' order by queue_sequence desc limit 1;`,
    );
  const join = (who) =>
    request(path, who, {
      operationKey: crypto.randomUUID(),
      version: f.session.version,
      seats: 1,
      guestName: "",
      consent: true,
    });
  return { ...f, path, view, party, remove, state, join };
}

test("only the session's organizers can remove someone", async (t) => {
  const f = await setup(t);
  const target = await f.party(f.member);
  for (const actor of [f.member, f.newcomer, f.outsider]) {
    const r = await f.remove(actor, target.id);
    assert.equal(r.status, 403, await r.clone().text());
  }
  assert.equal((await f.remove(null, target.id)).status, 401);
  assert.equal(f.state(f.member), "confirmed");
});

test("removing a confirmed party frees the place for the next in line, once", async (t) => {
  const f = await setup(t);
  const target = await f.party(f.member);
  const key = crypto.randomUUID();
  const jobs = () =>
    f.sql(`select count(*) from app.email_jobs where party_id='${target.id}';`);
  const before = jobs();
  for (let i = 0; i < 2; i++) {
    const r = await f.remove(f.owner, target.id, key);
    assert.equal(r.status, 200, await r.clone().text());
    const removed = (await r.json()).registration.roster.find(
      (p) => p.id === target.id,
    );
    assert.equal(removed.state, "removed", `attempt ${i + 1}`);
    assert.equal(removed.removal.by, f.owner.displayName);
    assert.ok(removed.removal.at);
  }
  assert.equal(f.state(f.outsider), "confirmed");
  assert.equal(
    f.sql(
      `select count(*) from app.registration_events e join app.parties p on p.id=e.party_id where p.session_id='${f.session.id}' and e.kind='promoted';`,
    ),
    "1",
  );
  // The unpaid fee is dropped, with who did it.
  const fee = (await f.view()).roster.find((p) => p.id === target.id).fee;
  assert.equal(fee.liabilityState, "removed_by_organizer");
  assert.equal(fee.history[0].action, "removed_by_organizer");
  // No email about the removal (no new emails from 2026-10-28).
  assert.equal(jobs(), before);
  // Recovery by key answers the same.
  const recovered = await request(`/api/operations/${key}`, f.owner);
  assert.equal(recovered.status, 200);
  // Already removed, under a new key: refused.
  assert.equal((await f.remove(f.owner, target.id)).status, 409);
});

test("a waitlisted party can be removed; nobody moves up", async (t) => {
  const f = await setup(t);
  const target = await f.party(f.outsider);
  assert.equal((await f.remove(f.owner, target.id)).status, 200);
  assert.equal(f.state(f.outsider), "removed");
  assert.equal(f.state(f.member), "confirmed");
  assert.equal(f.state(f.newcomer), "confirmed");
});

test("a co-host can remove; a paid marker stays exactly as it was", async (t) => {
  const f = await setup(t);
  assert.equal(
    (await f.change(f.owner, f.member.profileId, "add", "0")).status,
    200,
  );
  const target = await f.party(f.newcomer);
  const paid = await request(`${f.path}/payments`, f.owner, {
    operationKey: crypto.randomUUID(),
    partyId: target.id,
    action: "mark_paid",
    revision: target.fee.revision,
  });
  assert.equal(paid.status, 200);
  const fee = () =>
    f.sql(
      `select marked_paid||'|'||liability_state||'|'||revision from app.fee_obligations where party_id='${target.id}';`,
    );
  const before = fee();
  assert.equal((await f.remove(f.member, target.id)).status, 200);
  assert.equal(fee(), before);
  const removed = (await f.view()).roster.find((p) => p.id === target.id);
  assert.equal(removed.removal.by, f.member.displayName);
});

test("a removed person sees it, can't rejoin from the link, and an invite lets them back", async (t) => {
  const f = await setup(t);
  const target = await f.party(f.newcomer);
  assert.equal((await f.remove(f.owner, target.id)).status, 200);
  const own = (await f.view(f.newcomer)).own;
  assert.equal(own.state, "removed");
  assert.equal(own.removedByOrganizer, true);
  const mine = await (await request("/api/me/sessions", f.newcomer)).json();
  assert.equal(
    mine.upcoming.find((x) => x.slug === f.session.slug)?.status,
    "removed",
  );
  const again = await f.join(f.newcomer);
  assert.equal(again.status, 409);
  assert.equal((await again.json()).error.code, "removed_from_session");
  // The organizer can invite them back, and then they can join.
  const invited = await request("/api/invites", f.owner, {
    operationKey: crypto.randomUUID(),
    kind: "session",
    target: f.session.id,
    profileId: f.newcomer.profileId,
  });
  assert.equal(invited.status, 200, await invited.clone().text());
  const back = await f.join(f.newcomer);
  assert.equal(back.status, 200, await back.clone().text());
  assert.ok(["confirmed", "waitlisted"].includes(f.state(f.newcomer)));
});

test("removal and the person's own withdrawal racing have one result", async (t) => {
  const f = await setup(t);
  const target = await f.party(f.member);
  const [removed, withdrawn] = await Promise.all([
    f.remove(f.owner, target.id),
    request(`${f.path}/withdraw`, f.member, {
      operationKey: crypto.randomUUID(),
      partyId: target.id,
    }),
  ]);
  const final = f.state(f.member);
  assert.ok(["removed", "withdrawn"].includes(final), final);
  if (final === "removed") assert.equal(removed.status, 200);
  else assert.equal(removed.status, 409);
  assert.equal(withdrawn.status, 200);
  assert.equal(f.state(f.outsider), "confirmed");
  assert.equal(
    f.sql(
      `select coalesce(sum(seats),0) from app.parties where session_id='${f.session.id}' and state='confirmed';`,
    ),
    "2",
  );
});

test("nobody can be removed once the session starts", async (t) => {
  const f = await setup(t);
  const target = await f.party(f.member);
  f.sql(
    // Booked sessions can't be edited, so the guard is skipped for this setup.
    `begin; set local session_replication_role=replica;
      update app.sessions set details=jsonb_set(details,'{startsAt}',to_jsonb((now()-interval '1 minute')::text)) where id='${f.session.id}';
      commit;`,
  );
  const r = await f.remove(f.owner, target.id);
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error.code, "removal_closed");
  assert.equal(f.state(f.member), "confirmed");
});

test("organizers and co-hosts can't be removed; they withdraw instead", async (t) => {
  const f = await setup(t);
  assert.equal(
    (await f.change(f.owner, f.member.profileId, "add", "0")).status,
    200,
  );
  const roster = (await f.view()).roster;
  const cohost = await f.party(f.member);
  assert.equal(cohost.removable, false);
  assert.equal((await f.party(f.newcomer)).removable, true);
  const r = await f.remove(f.owner, cohost.id);
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error.code, "removal_not_allowed");
  assert.equal(f.state(f.member), "confirmed");
  assert.ok(roster.length > 0);
});

test("a removed party's fee never becomes due again", async (t) => {
  const f = await setup(t);
  const target = await f.party(f.newcomer);
  assert.equal(
    (
      await request(`${f.path}/payments`, f.owner, {
        operationKey: crypto.randomUUID(),
        partyId: target.id,
        action: "mark_paid",
        revision: target.fee.revision,
      })
    ).status,
    200,
  );
  assert.equal((await f.remove(f.owner, target.id)).status, 200);
  const paid = (await f.party(f.newcomer)).fee;
  // Marked paid by mistake: taking the mark back drops the fee, as removal would have.
  const r = await request(`${f.path}/payments`, f.owner, {
    operationKey: crypto.randomUUID(),
    partyId: target.id,
    action: "mark_unpaid",
    revision: paid.revision,
  });
  assert.equal(r.status, 200, await r.clone().text());
  const fee = (await f.party(f.newcomer)).fee;
  assert.equal(fee.liabilityState, "removed_by_organizer");
  assert.equal(fee.markedPaid, false);
});

test("a removal closes the person's waiting request", async (t) => {
  const f = await setup(t);
  const target = await f.party(f.newcomer);
  const requestId = f.sql(`insert into app.join_requests(session_id,user_id,primary_name,guest_name,seats,consent_version,consent_at,state,asked_at)
    values('${f.session.id}','${f.newcomer.id}','Synthetic newcomer','',1,1,now(),'pending',now()) returning id;`);
  assert.equal((await f.remove(f.owner, target.id)).status, 200);
  assert.equal(
    f.sql(`select state from app.join_requests where id='${requestId}';`),
    "cancelled",
  );
});

test("someone who once declined an invite can still be invited back after a removal", async (t) => {
  const f = await setup(t);
  f.sql(`insert into app.invites(session_id,invitee_id,inviter_id,inviter_name,state,decided_at)
    values('${f.session.id}','${f.newcomer.id}','${f.owner.id}','Synthetic organizer','declined',now());`);
  const target = await f.party(f.newcomer);
  assert.equal((await f.remove(f.owner, target.id)).status, 200);
  const invited = await request("/api/invites", f.owner, {
    operationKey: crypto.randomUUID(),
    kind: "session",
    target: f.session.id,
    profileId: f.newcomer.profileId,
  });
  assert.equal(invited.status, 200, await invited.clone().text());
});
