import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { localEnv, secondGroup } from "../scripts/local-env.mjs";
import { cohostFixture, request } from "./helpers/cohost-fixtures.mjs";

test("only the current owner can read or change co-hosts; direct role spoofing changes nothing", async (t) => {
  const f = await cohostFixture(t);
  const before = f.sql(
    `select jsonb_agg(to_jsonb(r) order by user_id) from app.group_roles r where group_id='${f.group.id}';`,
  );
  const state = await f.read();
  assert.equal(state.group.role, "owner");
  assert.equal(state.revision, "0");
  assert.deepEqual(
    new Set(state.candidates.map((p) => p.profileId)),
    new Set([f.member.profileId, f.newcomer.profileId]),
  );
  for (const actor of [null, f.member, f.newcomer, f.outsider]) {
    const expected = actor ? 403 : 401;
    const read = await request(f.path, actor);
    assert.equal(read.status, expected);
    assert.equal(read.headers.get("cache-control"), "no-store");
    assert.equal(
      (await f.change(actor, f.member.profileId, "add", "0")).status,
      expected,
    );
  }
  f.sql(
    `insert into app.group_roles values('${f.group.id}','${f.outsider.id}','organizer');`,
  );
  assert.equal((await request(f.path, f.outsider)).status, 403);
  assert.equal(
    (await f.change(f.outsider, f.member.profileId, "add", "0")).status,
    403,
  );
  f.sql(
    `delete from app.group_roles where group_id='${f.group.id}' and user_id='${f.outsider.id}';`,
  );
  assert.ok(
    !(
      await f.member.client.auth.updateUser({
        data: { role: "owner", group_id: f.group.id },
      })
    ).error,
  );
  assert.equal(
    (await f.change(f.member, f.newcomer.profileId, "add", "0")).status,
    403,
  );
  assert.equal(
    (
      await request(f.path, f.member, {
        operationKey: crypto.randomUUID(),
        profileId: f.newcomer.profileId,
        action: "add",
        revision: "0",
        actorId: f.owner.id,
        role: "owner",
      })
    ).status,
    422,
  );
  assert.equal(
    f.sql(
      `select jsonb_agg(to_jsonb(r) order by user_id) from app.group_roles r where group_id='${f.group.id}';`,
    ),
    before,
  );
  assert.equal(
    f.sql(
      `select count(*) from app.group_cohost_changes where group_id='${f.group.id}';`,
    ),
    "0",
  );
});

test("grant and removal preserve previous membership and participation, while immediately changing manager access", async (t) => {
  const f = await cohostFixture(t);
  const registrationPath = `/api/registrations/${f.session.slug}`;
  const managerView = (await (await request(registrationPath, f.owner)).json())
    .registration;
  const primary = managerView.roster.find(
    (p) => p.profileId === f.member.profileId,
  );
  assert.equal(
    (
      await request(`${registrationPath}/payments`, f.owner, {
        operationKey: crypto.randomUUID(),
        partyId: primary.id,
        action: "mark_paid",
        revision: primary.fee.revision,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request(`${registrationPath}/attendance`, f.owner, {
        operationKey: crypto.randomUUID(),
        partyId: primary.id,
        seat: 1,
        state: "checked_in",
        revision: 0,
      })
    ).status,
    200,
  );
  const snapshot = () =>
    f.sql(`select jsonb_build_object(
    'parties',(select jsonb_agg(to_jsonb(p) order by id) from app.parties p where session_id='${f.session.id}'),
    'fees',(select jsonb_agg(to_jsonb(f) order by party_id) from app.fee_obligations f where party_id in(select id from app.parties where session_id='${f.session.id}')),
    'attendance',(select jsonb_agg(to_jsonb(a) order by party_id,seat) from app.seat_attendance a where party_id in(select id from app.parties where session_id='${f.session.id}')));`);
  const before = snapshot();
  for (const [actor, restored] of [
    [f.member, ""],
    [f.newcomer, ""],
  ]) {
    const prior = await f.read();
    const granted = await f.change(
      f.owner,
      actor.profileId,
      "add",
      prior.revision,
    );
    assert.equal(granted.status, 200);
    // Co-hosts run the session, not a group (P-35): no group setup access.
    assert.equal(
      (await request(`/api/groups/${f.group.id}/setup`, actor)).status,
      403,
    );
    assert.equal(
      (await request(`/api/groups/${secondGroup}/setup`, actor)).status,
      403,
    );
    const view = (await (await request(registrationPath, actor)).json())
      .registration;
    assert.equal(view.canManage, true);
    assert.ok(view.roster.some((p) => p.fee?.history));
    assert.equal((await request(f.path, actor)).status, 403);
    assert.equal(
      (
        await f.change(
          actor,
          f.outsider.profileId,
          "add",
          (await f.read()).revision,
        )
      ).status,
      403,
    );
    const receiptKey = crypto.randomUUID();
    assert.equal(
      (
        await request(`${registrationPath}/attendance`, actor, {
          operationKey: receiptKey,
          partyId: primary.id,
          seat: 1,
          state: "unrecorded",
          revision: 1,
        })
      ).status,
      actor === f.member ? 200 : 409,
    );
    if (actor === f.member) {
      assert.equal(
        (
          await request(`${registrationPath}/attendance`, f.owner, {
            operationKey: crypto.randomUUID(),
            partyId: primary.id,
            seat: 1,
            state: "checked_in",
            revision: 2,
          })
        ).status,
        200,
      );
    }
    const removed = await f.change(
      f.owner,
      actor.profileId,
      "remove",
      (await f.read()).revision,
    );
    assert.equal(removed.status, 200);
    assert.equal(
      f.sql(
        `select role from app.group_roles where group_id='${f.group.id}' and user_id='${actor.id}';`,
      ),
      restored,
    );
    assert.equal(
      (await request(`/api/groups/${f.group.id}/setup`, actor)).status,
      403,
    );
    const afterView = (await (await request(registrationPath, actor)).json())
      .registration;
    assert.equal(afterView.canManage, false);
    assert.ok(afterView.own);
    assert.ok(
      afterView.roster.every(
        (p) => !Object.hasOwn(p, "fee") && !Object.hasOwn(p, "attendance"),
      ),
    );
    assert.equal(
      (
        await request(`${registrationPath}/attendance`, actor, {
          operationKey: crypto.randomUUID(),
          partyId: primary.id,
          seat: 1,
          state: "unrecorded",
          revision: 3,
        })
      ).status,
      403,
    );
    if (actor === f.member)
      assert.equal(
        (await request(`/api/operations/${receiptKey}`, actor)).status,
        403,
      );
  }
  // Attendance was deliberately corrected while testing revocation; everything
  // else must be byte-for-byte identical, and its final standing is checked in.
  const after = JSON.parse(snapshot()),
    original = JSON.parse(before);
  assert.deepEqual(after.parties, original.parties);
  assert.deepEqual(after.fees, original.fees);
  assert.equal(after.attendance[0].state, "checked_in");
  assert.equal(
    f.sql(
      `select count(*) from app.group_cohost_changes where group_id='${f.group.id}' and actor_id='${f.owner.id}' and created_at is not null;`,
    ),
    "4",
  );
});

test("concurrent retries are audited once; stale grants and old receipts cannot restore removed access", async (t) => {
  const f = await cohostFixture(t);
  const key = crypto.randomUUID();
  const before = await f.read();
  const responses = await Promise.all(
    [1, 2].map(() =>
      f.change(f.owner, f.member.profileId, "add", before.revision, key),
    ),
  );
  for (const r of responses) assert.equal(r.status, 200);
  const granted = await f.read();
  assert.equal(granted.assigned.length, 1);
  assert.equal(
    f.sql(
      `select count(*) from app.group_cohost_changes where group_id='${f.group.id}';`,
    ),
    "1",
  );
  assert.equal(
    (
      await f.change(
        f.owner,
        f.newcomer.profileId,
        "add",
        granted.revision,
        key,
      )
    ).status,
    409,
  );
  assert.equal(
    (await f.change(f.owner, f.member.profileId, "add", granted.revision))
      .status,
    409,
  );
  assert.equal(
    (await f.change(f.owner, f.member.profileId, "remove", granted.revision))
      .status,
    200,
  );
  const replay = await f.change(
    f.owner,
    f.member.profileId,
    "add",
    before.revision,
    key,
  );
  assert.equal(replay.status, 200);
  assert.deepEqual((await replay.json()).cohosts.assigned, []);
  const recovered = await request(`/api/operations/${key}`, f.owner);
  assert.equal(recovered.status, 200);
  assert.deepEqual((await recovered.json()).cohosts.assigned, []);
  const stale = await f.change(
    f.owner,
    f.member.profileId,
    "add",
    granted.revision,
  );
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).error.code, "stale_cohosts");
  assert.equal((await request(`/api/operations/${key}`, f.member)).status, 404);
  f.sql(
    `update app.group_roles set role='organizer' where group_id='${f.group.id}' and user_id='${f.owner.id}';`,
  );
  assert.equal((await request(`/api/operations/${key}`, f.owner)).status, 403);
  assert.equal(
    (await f.change(f.owner, f.member.profileId, "add", before.revision, key))
      .status,
    403,
  );
  assert.equal(
    f.sql(
      `select count(*) from app.group_cohost_changes where group_id='${f.group.id}';`,
    ),
    "2",
  );
});

test("candidates are scoped, historical, named from profiles, and existing co-hosts can be removed without registrations", async (t) => {
  const f = await cohostFixture(t);
  f.sql(`update app.parties set state='withdrawn' where session_id='${f.session.id}' and user_id='${f.member.id}';
    insert into app.group_roles values('${f.group.id}','${f.outsider.id}','cohost');`);
  const state = await f.read();
  assert.ok(state.candidates.some((p) => p.profileId === f.member.profileId));
  assert.ok(state.candidates.some((p) => p.profileId === f.newcomer.profileId));
  assert.deepEqual(state.assigned, [
    { name: f.outsider.displayName, profileId: f.outsider.profileId },
  ]);
  assert.ok(!JSON.stringify(state).includes("@"));
  for (const p of [...state.assigned, ...state.candidates])
    assert.deepEqual(Object.keys(p).sort(), ["name", "profileId"]);
  assert.equal(
    (await f.change(f.owner, f.outsider.profileId, "remove", state.revision))
      .status,
    200,
  );
  assert.equal(
    f.sql(
      `select role from app.group_roles where group_id='${f.group.id}' and user_id='${f.outsider.id}';`,
    ),
    "",
  );
  for (const action of ["add", "remove"]) {
    assert.equal(
      (
        await f.change(
          f.owner,
          f.owner.profileId,
          action,
          (await f.read()).revision,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await f.change(
          f.owner,
          f.outsider.profileId,
          action,
          (await f.read()).revision,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await f.change(
          f.owner,
          crypto.randomUUID(),
          action,
          (await f.read()).revision,
        )
      ).status,
      409,
    );
  }
  f.sql(
    `insert into app.group_roles values('${f.group.id}','${f.outsider.id}','organizer');`,
  );
  assert.equal(
    (
      await f.change(
        f.owner,
        f.outsider.profileId,
        "add",
        (await f.read()).revision,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await f.change(
        f.owner,
        f.outsider.profileId,
        "remove",
        (await f.read()).revision,
      )
    ).status,
    409,
  );
  assert.equal(
    f.sql(
      `select role from app.group_roles where group_id='${f.group.id}' and user_id='${f.owner.id}';`,
    ),
    "owner",
  );
});

test("candidate paging reaches each stable profile once, even when names match or change", async (t) => {
  const f = await cohostFixture(t, { join: false });
  // Members of a group the organizer admins are candidates too (P-35); this
  // test pages only through people who joined the session.
  f.sql(
    `delete from app.group_roles where group_id='${f.community.id}' and role='member';`,
  );
  assert.deepEqual((await f.read()).candidates, []);
  const ids = Array.from({ length: 53 }, () => crypto.randomUUID());
  f.extraUsers.push(...ids);
  f.sql(`insert into auth.users(id) values ${ids.map((id) => `('${id}')`).join(",")};
    insert into app.profiles(user_id,account_name) values ${ids.map((id) => `('${id}','Same name')`).join(",")};
    insert into app.parties(session_id,user_id,primary_name,seats,state,queue_sequence,consent_version,consent_at)
      values ${ids.map((id, i) => `('${f.session.id}','${id}','Old name',1,'withdrawn',${i + 1},1,now())`).join(",")};`);
  const a = await f.read();
  assert.equal(a.candidates.length, 50);
  assert.ok(a.nextCursor);
  const b = await f.read(f.owner, `?after=${a.nextCursor}`);
  assert.equal(b.candidates.length, 3);
  assert.equal(b.nextCursor, null);
  assert.equal(
    new Set([...a.candidates, ...b.candidates].map((p) => p.profileId)).size,
    53,
  );
  const chosen = a.candidates[0];
  f.sql(
    `update app.profiles set display_name='New name' where profile_id='${chosen.profileId}';`,
  );
  const refreshed = await f.read();
  assert.equal(refreshed.candidates[0].name, "New name");
  assert.equal(refreshed.candidates[1].name, "Same name");
  assert.equal(
    (await f.change(f.owner, chosen.profileId, "add", refreshed.revision))
      .status,
    200,
  );
  assert.deepEqual((await f.read()).assigned, [
    { ...chosen, name: "New name" },
  ]);
});

test("browser credentials cannot read audit/roles or forge a backend RPC actor; malformed writes do not mutate", async (t) => {
  const f = await cohostFixture(t);
  const env = localEnv();
  for (const key of [env.SUPABASE_PUBLISHABLE_KEY]) {
    const client = createClient(env.SUPABASE_URL, key, {
      auth: { persistSession: false },
    });
    for (const table of ["group_roles", "group_cohost_changes"]) {
      const result = await client.schema("app").from(table).select("*");
      assert.ok(result.error);
    }
  }
  for (const role of ["anon", "authenticated"]) {
    assert.equal(
      f.sql(
        `select has_function_privilege('${role}','api.read_group_cohosts(uuid,uuid,uuid)','execute') or has_function_privilege('${role}','api.update_group_cohost(uuid,uuid,uuid,uuid,text,text)','execute') or has_table_privilege('${role}','app.group_cohost_changes','select,insert,update,delete');`,
      ),
      "f",
    );
  }
  const rpc = await fetch(
    env.SUPABASE_URL + "/rest/v1/rpc/update_group_cohost",
    {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${f.member.token}`,
        "Content-Type": "application/json",
        "Content-Profile": "api",
      },
      body: JSON.stringify({
        p_actor_id: f.owner.id,
        p_key: crypto.randomUUID(),
        p_group_id: f.group.id,
        p_profile_id: f.member.profileId,
        p_action: "add",
        p_revision: "0",
      }),
    },
  );
  assert.ok([401, 403, 404].includes(rpc.status));
  for (const patch of [
    { profileId: "bad" },
    { action: "owner" },
    { revision: 0 },
    { revision: "-1" },
    { role: "owner" },
    { operationKey: "bad" },
  ]) {
    assert.equal(
      (
        await request(f.path, f.owner, {
          operationKey: crypto.randomUUID(),
          profileId: f.member.profileId,
          action: "add",
          revision: "0",
          ...patch,
        })
      ).status,
      422,
    );
  }
  assert.equal((await request(f.path + "?after=bad", f.owner)).status, 422);
  const unsupported = await fetch(baseURL(f.path), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${f.owner.token}` },
  });
  assert.equal(unsupported.status, 405);
  assert.equal((await f.read()).revision, "0");
});

function baseURL(path) {
  return (process.env.RALLYPOINT_TEST_URL ?? "http://127.0.0.1:3000") + path;
}

test("revoking a co-host also denies deleted-draft receipt recovery and same-key POST replay", async (t) => {
  const f = await cohostFixture(t);
  assert.equal(
    (await f.change(f.owner, f.member.profileId, "add", "0")).status,
    200,
  );
  const draftResponse = await request("/api/sessions", f.owner, {
    operationKey: crypto.randomUUID(),
    intent: "draft",
    fromSession: f.session.id,
    details: { ...f.session.details, title: "Synthetic draft to delete" },
  });
  assert.equal(draftResponse.status, 200);
  const draft = (await draftResponse.json()).session;
  // Run again copied the co-host; this draft's team is managed on its own.
  const draftTeam = f.sql(
    `select group_id from app.sessions where id='${draft.id}';`,
  );
  const operationKey = crypto.randomUUID();
  const path = `/api/sessions/${draft.id}/delete`;
  assert.equal((await request(path, f.member, { operationKey })).status, 200);
  assert.equal(
    (await request(`/api/operations/${operationKey}`, f.member)).status,
    200,
  );
  assert.equal((await request(path, f.member, { operationKey })).status, 200);
  // The draft is gone, so its co-host is removed through its team.
  const teamPath = `/api/groups/${draftTeam}/cohosts`;
  const teamState = (await (await request(teamPath, f.owner)).json()).cohosts;
  assert.equal(
    (
      await request(teamPath, f.owner, {
        operationKey: crypto.randomUUID(),
        profileId: f.member.profileId,
        action: "remove",
        revision: teamState.revision,
      })
    ).status,
    200,
  );
  assert.equal(
    (await request(`/api/operations/${operationKey}`, f.member)).status,
    403,
  );
  assert.equal((await request(path, f.member, { operationKey })).status, 403);
  assert.equal(
    f.sql(`select count(*) from app.sessions where id='${draft.id}';`),
    "0",
  );
});

test("an owner can revoke co-host access to retained session history after removing the group", async (t) => {
  const f = await cohostFixture(t);
  assert.equal(
    (await f.change(f.owner, f.member.profileId, "add", "0")).status,
    200,
  );
  const granted = await f.read();
  f.sql(
    `update app.sessions set state='completed' where id='${f.session.id}';`,
  );
  assert.equal(
    // Removing the group its people belong to (P-35); the session keeps its own co-hosts.
    (
      await request(`/api/groups/${f.community.id}/archive`, f.owner, {
        operationKey: crypto.randomUUID(),
      })
    ).status,
    200,
  );
  const removed = await f.change(
    f.owner,
    f.member.profileId,
    "remove",
    granted.revision,
  );
  assert.equal(removed.status, 200);
  const view = (
    await (
      await request(`/api/registrations/${f.session.slug}`, f.member)
    ).json()
  ).registration;
  assert.equal(view.canManage, false);
  assert.ok(view.own);
  assert.equal((await f.read()).assigned.length, 0);
});

test("a manager mutation waiting behind removal rechecks the co-host role under the shared group lock", async (t) => {
  const f = await cohostFixture(t);
  assert.equal(
    (await f.change(f.owner, f.member.profileId, "add", "0")).status,
    200,
  );
  const current = await f.read();
  // Hold the same lock as normal management operations, then perform the real
  // removal within that transaction before letting the queued write continue.
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
  const done = new Promise((resolve, reject) => {
    proc.on("close", (code) =>
      code === 0 ? resolve() : reject(Error("Synthetic removal lock failed")),
    );
    proc.on("error", reject);
  });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("Synthetic lock not ready")),
      5000,
    );
    proc.stdout.on("data", (v) => {
      output += v.toString();
      if (output.includes("COHOST_LOCKED")) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  proc.stderr.resume();
  proc.stdin.end(
    `begin;select id from app.groups where id='${f.group.id}' for update;\n\\echo COHOST_LOCKED\nselect pg_sleep(0.7);select api.update_group_cohost('${f.owner.id}','${crypto.randomUUID()}','${f.group.id}','${f.member.profileId}','remove','${current.revision}');commit;`,
  );
  await ready;
  const saved = await request(`/api/sessions/${f.session.id}`, f.member, {
    operationKey: crypto.randomUUID(),
    groupId: f.group.id,
    intent: "update",
    version: f.session.version,
    details: { ...f.session.details, title: "Should never be saved" },
  });
  await done;
  assert.equal(saved.status, 403);
  assert.equal((await f.read()).assigned.length, 0);
  assert.equal(
    (await (await request(`/api/sessions/${f.session.id}`, f.owner)).json())
      .session.details.title,
    "Synthetic co-host session",
  );
});

test("group roles grant nothing on new sessions; run again copies co-hosts; co-hosts can't add co-hosts", async (t) => {
  const f = await cohostFixture(t);
  const before = await f.read();
  assert.equal(
    (await f.change(f.owner, f.member.profileId, "add", before.revision))
      .status,
    200,
  );
  // A role in the group people belong to gives nothing on a session.
  f.sql(
    `update app.group_roles set role='cohost' where group_id='${f.community.id}' and user_id='${f.newcomer.id}';`,
  );
  assert.equal(
    (await request(`/api/sessions/${f.session.id}`, f.newcomer)).status,
    403,
  );
  assert.equal(
    (await request(`/api/groups/${f.community.id}/cohosts`, f.owner)).status,
    403,
  );
  // A co-host manages the session but can't change co-hosts.
  assert.equal(
    (await request(`/api/sessions/${f.session.id}`, f.member)).status,
    200,
  );
  const current = await f.read();
  assert.equal(
    (await f.change(f.member, f.newcomer.profileId, "add", current.revision))
      .status,
    403,
  );
  // Run again copies the co-hosts, never the people booked.
  const local = (offset) =>
    new Date(Date.now() + offset).toISOString().slice(0, 16);
  const again = await request("/api/sessions", f.owner, {
    operationKey: crypto.randomUUID(),
    intent: "publish",
    fromSession: f.session.id,
    details: {
      ...f.session.details,
      startLocal: local(172800000),
      endLocal: local(180000000),
      openLocal: local(-3600000),
      cutoffLocal: local(129600000),
    },
  });
  assert.equal(again.status, 200, await again.clone().text());
  const next = (await again.json()).session;
  assert.equal(
    (await request(`/api/sessions/${next.id}`, f.member)).status,
    200,
  );
  assert.equal(
    f.sql(`select count(*) from app.parties where session_id='${next.id}';`),
    "0",
  );
  f.sql(
    `delete from app.group_roles where group_id=(select group_id from app.sessions where id='${next.id}');delete from app.operation_receipts where resource_id='${next.id}';delete from app.session_changes where session_id='${next.id}';delete from app.sessions where id='${next.id}';`,
  );
});
