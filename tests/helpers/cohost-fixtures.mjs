import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { localEnv, fixturePassword } from "../../scripts/local-env.mjs";
import { sql } from "./split-fixtures.mjs";

const env = localEnv();
const base = process.env.RALLYPOINT_TEST_URL ?? "http://127.0.0.1:3000";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));

export const request = (path, actor, body) =>
  fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

export async function cohostFixture(t, { join = true } = {}) {
  const actors = await Promise.all(
    ["organizer", "member", "newcomer", "outsider"].map(async (name) => {
      const client = createClient(
        env.SUPABASE_URL,
        env.SUPABASE_PUBLISHABLE_KEY,
        {
          auth: { persistSession: false, autoRefreshToken: false },
        },
      );
      const { data, error } = await client.auth.signInWithPassword({
        email: `${name}@rallypoint.test`,
        password: fixturePassword,
      });
      assert.ok(!error && data.session, "Synthetic login must succeed");
      const actor = {
        id: data.user.id,
        token: data.session.access_token,
        client,
      };
      const me = await request("/api/me", actor);
      assert.equal(me.status, 200);
      return { ...actor, ...(await me.json()) };
    }),
  );
  const [owner, member, newcomer, outsider] = actors;
  const created = await request("/api/groups", owner, {
    operationKey: crypto.randomUUID(),
    name: "Synthetic co-host group",
  });
  assert.equal(created.status, 200);
  const group = (await created.json()).group;
  const extraUsers = [];
  t.after(() => {
    // Only this test's group and its dependent records; no shared fixture roles.
    sql(`begin;
      delete from app.operation_receipts where resource_id='${group.id}' or resource_id in
        (select id from app.sessions where group_id='${group.id}') or resource_id in
        (select id from app.parties where session_id in(select id from app.sessions where group_id='${group.id}'));
      delete from app.email_jobs where session_id in(select id from app.sessions where group_id='${group.id}');
      delete from app.attendance_changes where party_id in(select id from app.parties where session_id in(select id from app.sessions where group_id='${group.id}'));
      delete from app.seat_attendance where party_id in(select id from app.parties where session_id in(select id from app.sessions where group_id='${group.id}'));
      delete from app.fee_changes where party_id in(select id from app.parties where session_id in(select id from app.sessions where group_id='${group.id}'));
      delete from app.fee_obligations where party_id in(select id from app.parties where session_id in(select id from app.sessions where group_id='${group.id}'));
      delete from app.registration_events where party_id in(select id from app.parties where session_id in(select id from app.sessions where group_id='${group.id}'));
      delete from app.parties where session_id in(select id from app.sessions where group_id='${group.id}');
      delete from app.session_changes where session_id in(select id from app.sessions where group_id='${group.id}');
      delete from app.sessions where group_id='${group.id}';
      delete from app.groups where id='${group.id}';
      ${extraUsers.map((id) => `delete from auth.users where id='${id}';`).join("\n")}
      commit;`);
  });
  sql(
    `insert into app.group_roles values('${group.id}','${member.id}','member');`,
  );
  const local = (offset) =>
    new Date(Date.now() + offset).toISOString().slice(0, 16);
  const published = await request(`/api/groups/${group.id}/sessions`, owner, {
    operationKey: crypto.randomUUID(),
    groupId: group.id,
    intent: "publish",
    details: {
      title: "Synthetic co-host session",
      activity: "Badminton",
      location: "Synthetic court",
      instructions: "",
      startLocal: local(86400000),
      endLocal: local(93600000),
      openLocal: local(-3600000),
      cutoffLocal: local(43200000),
      timeZone: "UTC",
      capacity: "1",
      fee: "5.00",
      currency: "SGD",
      guests: false,
    },
  });
  assert.equal(published.status, 200);
  const session = (await published.json()).session;
  if (join) {
    for (const actor of [member, newcomer]) {
      const joined = await request(
        `/api/registrations/${session.slug}`,
        actor,
        {
          operationKey: crypto.randomUUID(),
          version: session.version,
          seats: 1,
          guestName: "",
          consent: true,
        },
      );
      assert.equal(joined.status, 200);
    }
  }
  const path = `/api/groups/${group.id}/cohosts`;
  return {
    actors,
    owner,
    member,
    newcomer,
    outsider,
    group,
    session,
    path,
    sql,
    extraUsers,
    async read(actor = owner, suffix = "") {
      const response = await request(path + suffix, actor);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      return (await response.json()).cohosts;
    },
    async change(
      actor,
      profileId,
      action,
      revision,
      operationKey = crypto.randomUUID(),
    ) {
      return request(path, actor, {
        profileId,
        action,
        revision,
        operationKey,
      });
    },
  };
}
