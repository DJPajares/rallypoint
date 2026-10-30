import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { localEnv, fixturePassword } from "../scripts/local-env.mjs";
import { sql } from "./helpers/split-fixtures.mjs";

// Home, Sessions and Groups redesign (owner, 2026-10-30): the Groups list
// shows each group's member count, and the Sessions list gives each row its
// place, plus, for sessions you host that haven't started, how many are
// waiting and how many still owe. Synthetic accounts only.
const env = localEnv(),
  base = process.env.RALLYPOINT_TEST_URL ?? "http://127.0.0.1:3000";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const request = (path, actor, body) =>
  fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const local = (t) => new Date(t).toISOString().slice(0, 16);

test("tab data: member counts and session rows", async (t) => {
  const nonce = crypto.randomUUID().slice(0, 8),
    users = [],
    sessions = [],
    groups = [];
  t.after(() => {
    const ids = sessions.map((id) => `'${id}'`).join(",") || "null";
    const parties = `(select id from app.parties where session_id in (${ids}))`;
    const gids = groups.map((id) => `'${id}'`).join(",") || "null";
    sql(`begin;
      delete from app.operation_receipts where actor_id in (${users.map((id) => `'${id}'`).join(",") || "null"});
      delete from app.email_jobs where session_id in (${ids});
      delete from app.fee_changes where party_id in ${parties};
      delete from app.fee_obligations where party_id in ${parties};
      delete from app.registration_events where party_id in ${parties};
      delete from app.parties where session_id in (${ids});
      delete from app.session_changes where session_id in (${ids});
      create temp table gone as select group_id from app.sessions where id in (${ids});
      delete from app.sessions where id in (${ids});
      delete from app.group_roles where group_id in (${gids});
      delete from app.groups where id in (select group_id from gone) or id in (${gids});
      ${users.map((id) => `delete from auth.users where id='${id}';`).join("\n")}
      commit;`);
  });
  async function person(label) {
    const email = `tabs-${nonce}-${label}@rallypoint.test`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: fixturePassword,
      email_confirm: true,
      user_metadata: { full_name: `Synthetic ${label}` },
    });
    assert.ok(!error && data.user);
    users.push(data.user.id);
    const client = createClient(
      env.SUPABASE_URL,
      env.SUPABASE_PUBLISHABLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const signed = await client.auth.signInWithPassword({
      email,
      password: fixturePassword,
    });
    const who = { id: data.user.id, token: signed.data.session.access_token };
    await request("/api/me", who);
    return who;
  }
  const [host, a, b] = await Promise.all(["host", "a", "b"].map(person));

  const made = await request("/api/groups", host, {
    operationKey: crypto.randomUUID(),
    name: `Tabs ${nonce}`,
    visibility: "public",
  });
  const g = (await made.json()).group;
  groups.push(g.id);
  sql(
    `insert into app.group_roles(group_id,user_id,role) values('${g.id}','${a.id}','member');`,
  );
  const workspace = (await (await request("/api/workspace", host)).json())
    .groups;
  assert.equal(workspace.find((x) => x.id === g.id).memberCount, 2);

  const now = Date.now();
  const r = await request("/api/sessions", host, {
    operationKey: crypto.randomUUID(),
    intent: "publish",
    details: {
      title: `Tabs ${nonce}`,
      activity: "Workshop",
      startLocal: local(now + 86400000),
      endLocal: local(now + 93600000),
      timeZone: "UTC",
      location: "Synthetic court 3",
      instructions: "",
      capacity: "1",
      openLocal: local(now - 3600000),
      cutoffLocal: local(now + 43200000),
      fee: "5.00",
      currency: "SGD",
      guests: false,
    },
  });
  assert.equal(r.status, 200);
  const s = (await r.json()).session;
  sessions.push(s.id);
  for (const who of [a, b])
    assert.equal(
      (
        await request(`/api/registrations/${s.slug}`, who, {
          operationKey: crypto.randomUUID(),
          version: s.version,
          seats: 1,
          guestName: "",
          consent: true,
        })
      ).status,
      200,
    );
  const row = async (who) =>
    (await (await request("/api/me/sessions", who)).json()).upcoming.find(
      (x) => x.slug === s.slug,
    );
  const hosting = await row(host);
  assert.equal(hosting.location, "Synthetic court 3");
  assert.equal(hosting.waitingCount, 1);
  assert.equal(hosting.toPayCount, 1);
  const joined = await row(a);
  assert.equal(joined.location, "Synthetic court 3");
  assert.equal("waitingCount" in joined, false);
  assert.equal("toPayCount" in joined, false);
  // "To pay" counts as game day does: someone who withdrew after the cutoff
  // still owes, alongside whoever moved in.
  sql(`begin; set local session_replication_role=replica;
    update app.sessions set details=jsonb_set(details,'{cutoffAt}',to_jsonb((now()-interval '1 minute')::text)) where id='${s.id}';
    commit;`);
  const partyA = sql(
    `select id from app.parties where session_id='${s.id}' and user_id='${a.id}';`,
  );
  assert.equal(
    (
      await request(`/api/registrations/${s.slug}/withdraw`, a, {
        operationKey: crypto.randomUUID(),
        partyId: partyA,
      })
    ).status,
    200,
  );
  const after = await row(host);
  assert.equal(after.waitingCount, 0);
  assert.equal(after.toPayCount, 2);
});
