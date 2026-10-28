import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { localEnv, fixturePassword } from "../scripts/local-env.mjs";

// P-36: private sessions seen and joined only by the people the organizer
// chose. Synthetic accounts only.
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
async function login(email) {
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password: fixturePassword,
  });
  assert.ok(!error && data.session, "Synthetic sign-in must succeed");
  const who = { id: data.user.id, token: data.session.access_token };
  const me = await request("/api/me", who);
  return { ...who, ...(await me.json()) };
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
const details = (over = {}) => {
  const now = Date.now();
  return {
    title: "Synthetic private session",
    activity: "Workshop",
    startLocal: local(now + 86400000),
    endLocal: local(now + 93600000),
    timeZone: "UTC",
    location: "Synthetic room",
    instructions: "",
    capacity: "10",
    openLocal: local(now - 3600000),
    cutoffLocal: local(now + 43200000),
    fee: "5.00",
    currency: "SGD",
    guests: true,
    ...over,
  };
};

test("private sessions", async (t) => {
  const nonce = crypto.randomUUID().slice(0, 8),
    users = [],
    sessions = [],
    groups = [];
  t.after(() => {
    const s = sessions.map((id) => `'${id}'`).join(",") || "null";
    const g = groups.map((id) => `'${id}'`).join(",") || "null";
    const u = users.map((id) => `'${id}'`).join(",") || "null";
    const of = `(select id from app.parties where session_id in (${s}))`;
    sql(`begin;
      create temp table teams on commit drop as select group_id id from app.sessions where id in (${s});
      delete from app.session_access where session_id in (${s});
      delete from app.invites where session_id in (${s}) or group_id in (${g}) or inviter_id in (${u});
      delete from app.join_requests where session_id in (${s});
      delete from app.group_join_requests where group_id in (${g});
      delete from app.operation_receipts where resource_id in (${s}) or resource_id in ${of} or resource_id in (${g}) or actor_id in (${u});
      delete from app.email_jobs where session_id in (${s});
      delete from app.fee_changes where party_id in ${of};
      delete from app.fee_obligations where party_id in ${of};
      delete from app.registration_events where party_id in ${of};
      delete from app.parties where session_id in (${s});
      delete from app.session_changes where session_id in (${s});
      delete from app.sessions where id in (${s});
      delete from app.group_roles where group_id in (select id from teams) or group_id in (${g});
      delete from app.groups where id in (select id from teams) or id in (${g});
      ${users.map((id) => `delete from auth.users where id='${id}';`).join("\n")}
      commit;`);
  });
  async function person(label) {
    const email = `p36-${nonce}-${label}@rallypoint.test`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: fixturePassword,
      email_confirm: true,
      user_metadata: { full_name: `Synthetic ${label}` },
    });
    assert.ok(!error && data.user);
    users.push(data.user.id);
    return login(email);
  }
  const labels = ["org", "listed", "member", "invitee", "holder", "asker"];
  const [org, listed, member, invitee, holder, asker, outsider, stranger] =
    await Promise.all([...labels, "outsider", "stranger"].map(person));

  async function create(over = {}, access, extra = {}) {
    const r = await request("/api/sessions", org, {
      operationKey: crypto.randomUUID(),
      intent: "publish",
      details: details(over),
      ...(access ? { access } : {}),
      ...extra,
    });
    assert.equal(r.status, 200, await r.clone().text());
    const s = (await r.json()).session;
    sessions.push(s.id);
    return s;
  }
  async function update(s, over, access, who = org) {
    const current = (
      await (await request(`/api/sessions/${s.id}`, who)).json()
    ).session;
    return request(`/api/sessions/${s.id}`, who, {
      operationKey: crypto.randomUUID(),
      intent: "update",
      version: current.version,
      details: details(over),
      ...(access ? { access } : {}),
    });
  }
  const managed = async (s, who = org) =>
    (await (await request(`/api/sessions/${s.id}`, who)).json()).session;
  const shared = async (s, who) =>
    (await (await request(`/api/shared/${s.slug}`, who)).json()).session;
  const registration = async (s, who) =>
    request(`/api/registrations/${s.slug}`, who);
  const join = (s, who, version = s.version) =>
    request(`/api/registrations/${s.slug}`, who, {
      operationKey: crypto.randomUUID(),
      version,
      seats: 1,
      guestName: "",
      consent: true,
    });
  const ask = (s, who, version = s.version) =>
    request(`/api/registrations/${s.slug}/requests`, who, {
      operationKey: crypto.randomUUID(),
      version,
      seats: 1,
      guestName: "",
      consent: true,
    });
  const stub = (s) => ({ slug: s.slug, private: true });

  // Everyone but the stranger played in one of org's public sessions, so
  // org knows them.
  const known = await create();
  for (const who of [listed, member, invitee, holder, asker, outsider])
    assert.equal((await join(known, who)).status, 200);
  const g = (
    await (
      await request("/api/groups", org, {
        operationKey: crypto.randomUUID(),
        name: "Synthetic private group",
        visibility: "private",
      })
    ).json()
  ).group;
  groups.push(g.id);
  {
    const sent = await request("/api/invites", org, {
      operationKey: crypto.randomUUID(),
      kind: "group",
      target: g.id,
      profileId: member.profileId,
    });
    assert.equal(sent.status, 200, await sent.clone().text());
    const id = (await sent.json()).invite.id;
    const ok = await request(`/api/invites/${id}/accept`, member, {
      operationKey: crypto.randomUUID(),
    });
    assert.equal(ok.status, 200, await ok.clone().text());
  }
  const access = { groups: [g.id], people: [listed.profileId] };

  await t.test("public session unchanged", async () => {
    const s = await create();
    const view = await shared(s, outsider);
    assert.equal(view.details.title, "Synthetic private session");
    assert.ok(view.counts);
    assert.equal((await shared(s)).details.title, "Synthetic private session");
    assert.equal((await join(s, outsider)).status, 200);
  });

  const priv = await create({ access: "private" }, access);

  await t.test("outsider and signed-out get only the stub", async () => {
    assert.deepEqual(await shared(priv), stub(priv));
    assert.deepEqual(await shared(priv, outsider), stub(priv));
    assert.deepEqual(await shared(priv, { token: "not-a-token" }), stub(priv));
    const read = await registration(priv, outsider);
    assert.equal(read.status, 200, await read.clone().text());
    assert.deepEqual((await read.json()).registration, stub(priv));
    const j = await join(priv, outsider);
    assert.equal(j.status, 403);
    const body = await j.json();
    assert.equal(body.error.code, "session_private");
    assert.equal(body.error.message, "This session is private.");
    const a = await ask(priv, outsider);
    assert.equal(a.status, 403);
    assert.equal((await a.json()).error.code, "session_private");
    const qr = await request(`/api/registrations/${priv.slug}/payment-qr`, outsider);
    assert.ok([403, 404].includes(qr.status));
    assert.equal(
      sql(`select count(*) from app.parties where session_id='${priv.id}'`),
      "0",
    );
  });

  await t.test("listed person and listed group member view and join", async () => {
    for (const who of [listed, member]) {
      const view = await shared(priv, who);
      assert.equal(view.details.title, "Synthetic private session");
      assert.equal(view.details.access, "private");
      assert.equal((await join(priv, who)).status, 200);
    }
  });

  await t.test("invitee views; withdrawn invite removes view", async () => {
    const sent = await request("/api/invites", org, {
      operationKey: crypto.randomUUID(),
      kind: "session",
      target: priv.id,
      profileId: invitee.profileId,
    });
    assert.equal(sent.status, 200, await sent.clone().text());
    assert.equal(
      (await shared(priv, invitee)).details.title,
      "Synthetic private session",
    );
    const id = (await sent.json()).invite.id;
    assert.equal(
      (
        await request(`/api/invites/${id}/withdraw`, org, {
          operationKey: crypto.randomUUID(),
        })
      ).status,
      200,
    );
    assert.deepEqual(await shared(priv, invitee), stub(priv));
  });

  await t.test("removed party holder keeps view and booking", async () => {
    const s = await create(
      { access: "private" },
      { groups: [], people: [holder.profileId] },
    );
    assert.equal((await join(s, holder)).status, 200);
    const before = sql(
      `select p.state||'|'||o.total_minor from app.parties p join app.fee_obligations o on o.party_id=p.id
       where p.session_id='${s.id}' and p.user_id='${holder.id}'`,
    );
    const r = await update(s, { access: "private" }, { groups: [], people: [] });
    assert.equal(r.status, 200, await r.clone().text());
    assert.equal(
      sql(
        `select p.state||'|'||o.total_minor from app.parties p join app.fee_obligations o on o.party_id=p.id
         where p.session_id='${s.id}' and p.user_id='${holder.id}'`,
      ),
      before,
    );
    assert.equal(
      (await shared(s, holder)).details.title,
      "Synthetic private session",
    );
    const reg = (await (await registration(s, holder)).json()).registration;
    assert.ok(reg.own, JSON.stringify(reg));
    const out = await request(`/api/registrations/${s.slug}/withdraw`, holder, {
      operationKey: crypto.randomUUID(),
      partyId: reg.own.id,
    });
    assert.equal(out.status, 200, await out.clone().text());
    assert.equal(
      (await shared(s, holder)).details.title,
      "Synthetic private session",
    );
  });

  await t.test("leaving or archiving a listed group removes access", async () => {
    const g2 = (
      await (
        await request("/api/groups", org, {
          operationKey: crypto.randomUUID(),
          name: "Synthetic second group",
          visibility: "private",
        })
      ).json()
    ).group;
    groups.push(g2.id);
    const sent = await request("/api/invites", org, {
      operationKey: crypto.randomUUID(),
      kind: "group",
      target: g2.id,
      profileId: asker.profileId,
    });
    await request(`/api/invites/${(await sent.json()).invite.id}/accept`, asker, {
      operationKey: crypto.randomUUID(),
    });
    const s = await create({ access: "private" }, { groups: [g2.id], people: [] });
    assert.equal((await shared(s, asker)).details.title, "Synthetic private session");
    const left = await request(`/api/groups/${g2.id}/leave`, asker, {
      operationKey: crypto.randomUUID(),
    });
    assert.equal(left.status, 200, await left.clone().text());
    assert.deepEqual(await shared(s, asker), stub(s));
    // Archiving the listed group takes access away from its members.
    const s2 = await create({ access: "private" }, { groups: [g.id], people: [] });
    assert.equal((await shared(s2, member)).details.title, "Synthetic private session");
    sql(`update app.groups set archived_at=now() where id='${g.id}'`);
    try {
      assert.deepEqual(await shared(s2, member), stub(s2));
    } finally {
      sql(`update app.groups set archived_at=null where id='${g.id}'`);
    }
  });

  await t.test("ask to join refused on private; joinMode stored direct", async () => {
    const s = await create(
      { access: "private", joinMode: "request" },
      { groups: [], people: [asker.profileId] },
    );
    assert.equal((await managed(s)).details.joinMode, "direct");
    const a = await ask(s, asker);
    assert.equal(a.status, 403);
    assert.equal((await a.json()).error.code, "session_private");
  });

  await t.test("pending request survives switch to private", async () => {
    const s = await create({ joinMode: "request" });
    const a = await ask(s, asker);
    assert.equal(a.status, 200, await a.clone().text());
    const r = await update(s, { access: "private" }, { groups: [], people: [] });
    assert.equal(r.status, 200, await r.clone().text());
    const reg = (await (await registration(s, asker)).json()).registration;
    assert.ok(reg.joinRequest, JSON.stringify(reg));
    assert.equal((await ask(s, stranger)).status, 403);
    const view = (await (await registration(s, org)).json()).registration;
    const accepted = await request(`/api/registrations/${s.slug}/requests/accept`, org, {
      operationKey: crypto.randomUUID(),
      requestId: view.requests[0].id,
    });
    assert.equal(accepted.status, 200, await accepted.clone().text());
  });

  await t.test("save checks", async () => {
    const bad = async (accessList, code, message) => {
      const r = await request("/api/sessions", org, {
        operationKey: crypto.randomUUID(),
        intent: "publish",
        details: details({ access: "private" }),
        access: accessList,
      });
      assert.equal(r.status, 422, await r.clone().text());
      const body = await r.json();
      assert.equal(body.error.code, code);
      assert.equal(body.error.message, message);
    };
    await bad(
      { groups: [], people: [stranger.profileId] },
      "access_person_invalid",
      "You can't add that person.",
    );
    const team = sql(`select group_id from app.sessions where id='${known.id}'`);
    await bad(
      { groups: [team], people: [] },
      "access_group_invalid",
      "You can't add that group.",
    );
    const theirs = (
      await (
        await request("/api/groups", stranger, {
          operationKey: crypto.randomUUID(),
          name: "Synthetic not mine",
          visibility: "public",
        })
      ).json()
    ).group;
    groups.push(theirs.id);
    await bad(
      { groups: [theirs.id], people: [] },
      "access_group_invalid",
      "You can't add that group.",
    );
    await bad(
      {
        groups: Array.from({ length: 21 }, () => crypto.randomUUID()),
        people: [],
      },
      "access_limit",
      "You can add up to 20 groups and 100 people.",
    );
    // A co-host's save keeps entries another manager added, even ones the
    // co-host doesn't know.
    const s = await create({ access: "private" }, { groups: [], people: [listed.profileId] });
    sql(`insert into app.group_roles(group_id,user_id,role)
      select group_id,'${stranger.id}','cohost' from app.sessions where id='${s.id}'`);
    const kept = await update(
      s,
      { access: "private" },
      { groups: [], people: [listed.profileId] },
      stranger,
    );
    assert.equal(kept.status, 200, await kept.clone().text());
    assert.deepEqual(
      (await managed(s)).access.people.map((p) => p.profileId),
      [listed.profileId],
    );
  });

  await t.test("switching access is not a material change", async () => {
    const s = await create();
    assert.equal((await join(s, holder)).status, 200);
    const r = await update(s, { access: "private" }, { groups: [], people: [] });
    assert.equal(r.status, 200, await r.clone().text());
    assert.equal(
      sql(`select bool_or(material) from app.session_changes where session_id='${s.id}'`),
      "f",
    );
    const reg = (await (await registration(s, holder)).json()).registration;
    assert.equal(reg.own.state, "confirmed");
  });

  await t.test("run again copies mode and list", async () => {
    const s = await create({ access: "private" }, access);
    const copy = await create({ access: "private" }, null, { fromSession: s.id });
    const view = await managed(copy);
    assert.equal(view.details.access, "private");
    assert.deepEqual(view.access.groups.map((x) => x.id), [g.id]);
    assert.deepEqual(
      view.access.people.map((p) => p.profileId),
      [listed.profileId],
    );
  });

  await t.test("join racing removal", async () => {
    const s = await create({ access: "private" }, { groups: [], people: [invitee.profileId] });
    const [j, u] = await Promise.all([
      join(s, invitee),
      update(s, { access: "private" }, { groups: [], people: [] }),
    ]);
    assert.equal(u.status, 200, await u.clone().text());
    const parties = sql(
      `select count(*) from app.parties where session_id='${s.id}' and user_id='${invitee.id}'`,
    );
    if (j.status === 200) assert.equal(parties, "1");
    else {
      assert.equal(j.status, 403);
      assert.equal(parties, "0");
    }
  });

  await t.test("share read with no or bad token is the stub", async () => {
    const r = await fetch(`${base}/api/shared/${priv.slug}`, {
      headers: { Authorization: "Bearer " },
    });
    assert.equal(r.status, 200);
    assert.deepEqual((await r.json()).session, stub(priv));
    const text = await (
      await request(`/api/shared/${priv.slug}`, { token: "x.y.z" })
    ).text();
    assert.ok(!text.includes("Synthetic"), text);
  });

  await t.test("access options only list your groups and known people", async () => {
    const r = await request("/api/sessions/access-options", org);
    assert.equal(r.status, 200, await r.clone().text());
    const options = await r.json();
    assert.ok(options.groups.some((x) => x.id === g.id));
    assert.ok(!options.groups.some((x) => x.id === known.id));
    const ids = options.people.map((p) => p.profileId);
    assert.ok(ids.includes(listed.profileId));
    assert.ok(!ids.includes(stranger.profileId));
    assert.ok(!ids.includes(org.profileId));
    const q = await (
      await request("/api/sessions/access-options?q=listed", org)
    ).json();
    assert.deepEqual(
      q.people.map((p) => p.profileId),
      [listed.profileId],
    );
    assert.equal(
      (await request("/api/sessions/access-options")).status,
      401,
    );
  });
});
