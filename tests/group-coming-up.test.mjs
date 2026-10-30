import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { localEnv, fixturePassword } from "../scripts/local-env.mjs";
import { sql } from "./helpers/split-fixtures.mjs";

// Group page redesign (owner, 2026-10-30): members see the upcoming sessions
// an organizer opened to their group (P-36 access list). Nobody else does,
// and nothing else about those sessions is added. Synthetic accounts only.
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

test("members see the group's upcoming sessions; others don't", async (t) => {
  const nonce = crypto.randomUUID().slice(0, 8),
    users = [],
    sessions = [],
    groups = [];
  t.after(() => {
    const ids = sessions.map((id) => `'${id}'`).join(",") || "null";
    const gids = groups.map((id) => `'${id}'`).join(",") || "null";
    sql(`begin;
      delete from app.operation_receipts where actor_id in (${users.map((id) => `'${id}'`).join(",") || "null"});
      delete from app.session_access where session_id in (${ids});
      delete from app.session_changes where session_id in (${ids});
      create temp table gone as select group_id from app.sessions where id in (${ids});
      delete from app.sessions where id in (${ids});
      delete from app.group_join_requests where group_id in (${gids});
      delete from app.group_roles where group_id in (${gids});
      delete from app.groups where id in (select group_id from gone) or id in (${gids});
      ${users.map((id) => `delete from auth.users where id='${id}';`).join("\n")}
      commit;`);
  });
  async function person(label) {
    const email = `coming-${nonce}-${label}@rallypoint.test`;
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
  const [owner, member, visitor] = await Promise.all(
    ["owner", "member", "visitor"].map(person),
  );
  const made = await request("/api/groups", owner, {
    operationKey: crypto.randomUUID(),
    name: `Coming ${nonce}`,
    visibility: "public",
  });
  assert.equal(made.status, 200);
  const g = (await made.json()).group;
  groups.push(g.id);
  sql(
    `insert into app.group_roles(group_id,user_id,role) values('${g.id}','${member.id}','member');`,
  );
  const now = Date.now();
  async function session(title, startIn, access) {
    const r = await request("/api/sessions", owner, {
      operationKey: crypto.randomUUID(),
      intent: "publish",
      details: {
        title,
        activity: "Workshop",
        startLocal: local(now + startIn),
        endLocal: local(now + startIn + 7200000),
        timeZone: "UTC",
        location: "Synthetic room",
        instructions: "",
        capacity: "4",
        openLocal: local(now - 3600000),
        cutoffLocal: local(now + startIn - 3600000),
        fee: "0",
        currency: "SGD",
        guests: false,
        access: access ? "private" : "public",
      },
      ...(access ? { access } : {}),
    });
    assert.equal(r.status, 200, await r.clone().text());
    const s = (await r.json()).session;
    sessions.push(s.id);
    return s;
  }
  const later = await session(`Later ${nonce}`, 2 * 86400000, {
    groups: [g.id],
    people: [],
  });
  const sooner = await session(`Sooner ${nonce}`, 86400000, {
    groups: [g.id],
    people: [],
  });
  // Public, and not on this group's list: not "this group's" session.
  await session(`Elsewhere ${nonce}`, 86400000);
  const read = async (who) =>
    (await (await request(`/api/groups/${g.id}`, who)).json()).group;

  for (const who of [owner, member]) {
    const upcoming = (await read(who)).upcoming;
    assert.deepEqual(
      upcoming.map((s) => s.slug),
      [sooner.slug, later.slug],
    );
    assert.deepEqual(Object.keys(upcoming[0]).sort(), [
      "activity",
      "slug",
      "startsAt",
      "timeZone",
      "title",
    ]);
  }
  // A visitor to a public group sees the group, not its sessions.
  const seen = await read(visitor);
  assert.equal(seen.name, `Coming ${nonce}`);
  assert.equal("upcoming" in seen, false);
});
