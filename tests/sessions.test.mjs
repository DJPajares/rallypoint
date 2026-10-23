import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { localEnv, fixturePassword } from "../scripts/local-env.mjs";
import { normalizeSession, feeLabel } from "../packages/domain/src/session.ts";
const env = localEnv(),
  base = process.env.RALLYPOINT_TEST_URL ?? "http://127.0.0.1:3000";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const sql = (q) =>
  execFileSync("pnpm", ["exec", "supabase", "db", "query", "--local", q], {
    stdio: "pipe",
  });
const valid = () => ({
  title: "Twelve-seat test session",
  activity: "Badminton",
  startLocal: "2027-05-09T10:00",
  endLocal: "2027-05-09T12:00",
  timeZone: "Asia/Singapore",
  location: "Synthetic Court 1",
  instructions: "Bring water",
  capacity: "12",
  openLocal: "2027-05-01T09:00",
  cutoffLocal: "2027-05-08T10:00",
  fee: "12.50",
  currency: "SGD",
  guests: true,
});
async function login(name) {
  const c = createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await c.auth.signInWithPassword({
    email: `${name}@rallypoint.test`,
    password: fixturePassword,
  });
  assert.ok(!error && data.session);
  return { token: data.session.access_token, id: data.user.id };
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
test("session input rules preserve precision and reject ambiguous local times", () => {
  assert.equal(normalizeSession(valid(), true).feeMinor, 1250);
  assert.ok(
    feeLabel({ ...valid(), feeMinor: 9007199254740991 }).endsWith("409.91"),
  );
  assert.ok(
    feeLabel({ ...valid(), currency: "KWD", feeMinor: 1234 }).endsWith("1.234"),
  );
  assert.equal(
    normalizeSession({ ...valid(), fee: "1.234", currency: "KWD" }, true)
      .feeMinor,
    1234,
  );
  for (const patch of [
    { capacity: "0" },
    { capacity: "1.2" },
    { endLocal: "2027-05-09T09:00" },
    { openLocal: "2027-05-09T11:00" },
    { cutoffLocal: "2027-04-30T09:00" },
    { fee: "1.001" },
    { fee: "-1" },
    { fee: "1.1", currency: "JPY" },
    { currency: "ZZZ" },
    { timeZone: "Invalid/Zone" },
    { timeZone: "America/New_York", startLocal: "2027-03-14T02:30" },
    { timeZone: "America/New_York", startLocal: "2027-11-07T01:30" },
  ])
    assert.throws(() => normalizeSession({ ...valid(), ...patch }, true));
});
test("session publication and current-role boundary", async (t) => {
  const organizer = await login("organizer"),
    member = await login("member"),
    outsider = await login("outsider");
  let groupId;
  const createBody = {
    operationKey: crypto.randomUUID(),
    name: "Synthetic P-02 owner group",
  };
  try {
    await t.test(
      "verified creator becomes owner and concurrent retries create one group",
      async () => {
        assert.equal(
          (await request("/api/groups", null, createBody)).status,
          401,
        );
        const responses = await Promise.all([
          request("/api/groups", organizer, createBody),
          request("/api/groups", organizer, createBody),
        ]);
        for (const r of responses) assert.equal(r.status, 200);
        const a = await responses[0].json(),
          b = await responses[1].json();
        groupId = a.group.id;
        assert.equal(groupId, b.group.id);
        assert.equal(a.group.role, "owner");
      },
    );
    let draft;
    await t.test(
      "incomplete drafts stay private and failed publication is atomic",
      async () => {
        const body = {
          operationKey: crypto.randomUUID(),
          groupId,
          intent: "draft",
          details: { ...valid(), title: "", capacity: "0" },
        };
        const r = await request(
          `/api/groups/${groupId}/sessions`,
          organizer,
          body,
        );
        assert.equal(r.status, 200);
        draft = (await r.json()).session;
        assert.equal((await request(`/api/shared/${draft.slug}`)).status, 404);
        const publish = {
          operationKey: crypto.randomUUID(),
          groupId,
          intent: "publish",
          version: draft.version,
          details: body.details,
        };
        assert.equal(
          (await request(`/api/sessions/${draft.id}`, organizer, publish))
            .status,
          422,
        );
        const after = (
          await (await request(`/api/sessions/${draft.id}`, organizer)).json()
        ).session;
        assert.equal(after.state, "draft");
        assert.equal(after.details.capacity, "0");
        assert.equal(after.version, 1);
      },
    );
    await t.test(
      "direct API publication rejects invalid times and currency precision",
      async () => {
        for (const patch of [
          { endLocal: "2027-05-09T09:00" },
          { openLocal: "2027-05-09T11:00" },
          { cutoffLocal: "2027-04-30T09:00" },
          { fee: "1.001" },
          { fee: "1.1", currency: "JPY" },
        ]) {
          const response = await request(
            `/api/sessions/${draft.id}`,
            organizer,
            {
              operationKey: crypto.randomUUID(),
              groupId,
              intent: "publish",
              version: draft.version,
              details: { ...valid(), ...patch },
            },
          );
          assert.equal(response.status, 422);
        }
        assert.equal(
          (await (await request(`/api/sessions/${draft.id}`, organizer)).json())
            .session.state,
          "draft",
        );
      },
    );
    let event, publish;
    await t.test(
      "concurrent publication and a lost-response retry return one stable session",
      async () => {
        publish = {
          operationKey: crypto.randomUUID(),
          groupId,
          intent: "publish",
          version: draft.version,
          details: valid(),
        };
        const rs = await Promise.all([
          request(`/api/sessions/${draft.id}`, organizer, publish),
          request(`/api/sessions/${draft.id}`, organizer, publish),
        ]);
        for (const r of rs) assert.equal(r.status, 200);
        event = (await rs[0].json()).session;
        const replay = (await rs[1].json()).session;
        assert.equal(event.id, replay.id);
        assert.equal(event.slug, replay.slug);
        assert.equal(event.version, 2);
        assert.equal(
          (
            await request(`/api/sessions/${draft.id}`, organizer, {
              ...publish,
              details: { ...valid(), title: "Different" },
            })
          ).status,
          409,
        );
        const result = await request(
          `/api/operations/${publish.operationKey}`,
          organizer,
        );
        assert.equal((await result.json()).session.id, event.id);
        assert.equal(
          (await request(`/api/operations/${publish.operationKey}`, outsider))
            .status,
          404,
        );
      },
    );
    await t.test(
      "unsigned shared projection excludes organizer and operation records",
      async () => {
        const r = await request(`/api/shared/${event.slug}`);
        assert.equal(r.status, 200);
        assert.equal(r.headers.get("cache-control"), "no-store");
        const { session } = await r.json();
        assert.deepEqual(Object.keys(session).sort(), [
          "counts",
          "details",
          "groupName",
          "registrationWindow",
          "slug",
          "state",
          "version",
        ]);
        assert.equal(session.details.capacity, "12");
        assert.equal(session.details.feeMinor, 1250);
      },
    );
    await t.test(
      "members, unrelated organizers and browser RPC callers cannot edit",
      async () => {
        for (const actor of [member, outsider]) {
          assert.equal(
            (await request(`/api/sessions/${event.id}`, actor)).status,
            403,
          );
          assert.equal(
            (
              await request(`/api/sessions/${event.id}`, actor, {
                operationKey: crypto.randomUUID(),
                groupId,
                intent: "update",
                version: event.version,
                details: valid(),
              })
            ).status,
            403,
          );
        }
        const browser = createClient(
          env.SUPABASE_URL,
          env.SUPABASE_PUBLISHABLE_KEY,
          { auth: { persistSession: false, autoRefreshToken: false } },
        );
        assert.ok(
          (
            await browser.schema("api").rpc("create_group", {
              p_actor_id: organizer.id,
              p_key: crypto.randomUUID(),
              p_name: "Forged",
            })
          ).error,
        );
      },
    );
    await t.test(
      "competing versioned edits have one winner and one material-change signal",
      async () => {
        const rs = await Promise.all(
          ["North court", "South court"].map((location) =>
            request(`/api/sessions/${event.id}`, organizer, {
              operationKey: crypto.randomUUID(),
              groupId,
              intent: "update",
              version: event.version,
              details: { ...valid(), location },
            }),
          ),
        );
        assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
        event = (
          await (await request(`/api/sessions/${event.id}`, organizer)).json()
        ).session;
        assert.equal(event.version, 3);
        const changes = JSON.parse(
          sql(
            `select count(*)::integer as total from app.session_changes where session_id='${event.id}';`,
          ).toString(),
        );
        assert.equal(changes.rows[0].total, 1);
        const replay = (
          await (
            await request(`/api/sessions/${event.id}`, organizer, publish)
          ).json()
        ).session;
        assert.equal(replay.version, 3);
      },
    );
    await t.test(
      "booked-session guard and revoked roles apply to valid existing tokens",
      async () => {
        sql(
          `update app.sessions set bookings_started_at=now() where id='${event.id}';`,
        );
        assert.equal(
          (
            await request(`/api/sessions/${event.id}`, organizer, {
              operationKey: crypto.randomUUID(),
              groupId,
              intent: "update",
              version: event.version,
              details: { ...valid(), fee: "13.00" },
            })
          ).status,
          409,
        );
        sql(
          `delete from app.group_roles where group_id='${groupId}' and user_id='${organizer.id}';`,
        );
        assert.equal(
          (await request(`/api/operations/${publish.operationKey}`, organizer))
            .status,
          403,
        );
        assert.equal(
          (await request(`/api/sessions/${event.id}`, organizer, publish))
            .status,
          403,
        );
      },
    );
  } finally {
    if (groupId)
      sql(
        `with removed_changes as (delete from app.session_changes where session_id in(select id from app.sessions where group_id='${groupId}')), removed_receipts as (delete from app.operation_receipts where actor_id='${organizer.id}' and (resource_id='${groupId}' or resource_id in(select id from app.sessions where group_id='${groupId}'))), removed_sessions as (delete from app.sessions where group_id='${groupId}'), removed_roles as (delete from app.group_roles where group_id='${groupId}') delete from app.groups where id='${groupId}';`,
      );
  }
});
