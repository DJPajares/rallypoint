import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import {
  localEnv,
  fixturePassword,
  firstGroup,
  secondGroup,
} from "../scripts/local-env.mjs";

// P-35: sessions stand alone on their own hosting team.
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
const details = (over = {}) => {
  const now = Date.now();
  return {
    title: "Synthetic standalone session",
    activity: "Workshop",
    startLocal: local(now + 86400000),
    endLocal: local(now + 93600000),
    timeZone: "UTC",
    location: "Synthetic room",
    instructions: "Test only",
    capacity: "4",
    openLocal: local(now - 3600000),
    cutoffLocal: local(now + 43200000),
    fee: "5.00",
    currency: "SGD",
    guests: true,
    ...over,
  };
};

test("standalone sessions", async (t) => {
  const organizer = await login("organizer@rallypoint.test"),
    member = await login("member@rallypoint.test"),
    sessions = [];
  t.after(() => {
    if (!sessions.length) return;
    const ids = sessions.map((id) => `'${id}'`).join(",");
    const of = `(select id from app.parties where session_id in (${ids}))`;
    sql(`begin;
      create temp table teams on commit drop as select group_id id from app.sessions where id in (${ids});
      delete from app.operation_receipts where resource_id in (${ids}) or resource_id in ${of};
      delete from app.email_jobs where session_id in (${ids});
      delete from app.fee_changes where party_id in ${of};
      delete from app.fee_obligations where party_id in ${of};
      delete from app.registration_events where party_id in ${of};
      delete from app.parties where session_id in (${ids});
      delete from app.session_changes where session_id in (${ids});
      delete from app.sessions where id in (${ids});
      delete from app.groups where id in (select id from teams) and kind='host';
      commit;`);
  });
  const create = async (body = {}) => {
    const r = await request("/api/sessions", organizer, {
      operationKey: crypto.randomUUID(),
      intent: "publish",
      details: details(),
      ...body,
    });
    const json = await r.clone().json();
    if (json.session) sessions.push(json.session.id);
    return r;
  };
  const kind = (sessionId) =>
    sql(
      `select g.kind from app.sessions s join app.groups g on g.id=s.group_id where s.id='${sessionId}';`,
    );

  await t.test("create a session without a group", async () => {
    const r = await create();
    assert.equal(r.status, 200, await r.clone().text());
    const s = (await r.json()).session;
    assert.equal(kind(s.id), "host");
    assert.equal(
      (await request(`/api/sessions/${s.id}`, organizer)).status,
      200,
    );
    assert.equal((await request(`/api/sessions/${s.id}`, member)).status, 403);
    const joined = await request(`/api/registrations/${s.slug}`, member, {
      operationKey: crypto.randomUUID(),
      version: s.version,
      seats: 1,
      guestName: "",
      consent: true,
    });
    assert.equal(joined.status, 200);
    assert.equal((await joined.json()).registration.own.state, "confirmed");
  });

  await t.test("new session is idempotent", async () => {
    const operationKey = crypto.randomUUID();
    const first = await create({ operationKey });
    const again = await create({ operationKey });
    assert.equal(first.status, 200);
    assert.equal(again.status, 200);
    const a = (await first.json()).session,
      b = (await again.json()).session;
    assert.equal(a.id, b.id);
    assert.equal(
      sql(
        `select count(*) from app.groups g where g.kind='host' and g.id=(select group_id from app.sessions where id='${a.id}');`,
      ),
      "1",
    );
  });

  await t.test("update ignores the body group", async () => {
    const s = (await (await create()).json()).session;
    const r = await request(`/api/sessions/${s.id}`, organizer, {
      operationKey: crypto.randomUUID(),
      groupId: secondGroup,
      intent: "update",
      version: s.version,
      details: { ...s.details, title: "Renamed standalone" },
    });
    assert.equal(r.status, 200, await r.clone().text());
    assert.equal((await r.json()).session.details.title, "Renamed standalone");
  });

  await t.test(
    "a session made through the old group route stands alone",
    async () => {
      const r = await request(`/api/groups/${firstGroup}/sessions`, organizer, {
        operationKey: crypto.randomUUID(),
        groupId: firstGroup,
        intent: "publish",
        details: details(),
      });
      assert.equal(r.status, 200, await r.clone().text());
      const s = (await r.json()).session;
      sessions.push(s.id);
      assert.equal(kind(s.id), "host");
      const edited = await request(`/api/sessions/${s.id}`, organizer, {
        operationKey: crypto.randomUUID(),
        groupId: firstGroup,
        intent: "update",
        version: s.version,
        details: { ...s.details, title: "Still mine" },
      });
      assert.equal(edited.status, 200, await edited.clone().text());
    },
  );

  await t.test("migration left no session on a community group", () => {
    assert.equal(
      sql(
        "select count(*) from app.sessions s join app.groups g on g.id=s.group_id where g.kind<>'host';",
      ),
      "0",
    );
  });

  await t.test("community groups hold only admins and members", () => {
    assert.equal(
      sql(
        "select count(*) from app.group_roles r join app.groups g on g.id=r.group_id where g.kind='community' and r.role not in ('owner','member');",
      ),
      "0",
    );
  });
  await t.test("hosting teams don't count as groups", async () => {
    const groupsStat = async () =>
      (await (await request("/api/me/badges", organizer)).json()).stats.groups;
    const profileGroups = async () =>
      (
        await (
          await request(
            `/api/people/${(await (await request("/api/me", organizer)).json()).profileId}`,
          )
        ).json()
      ).profile.stats.groups;
    const before = [await groupsStat(), await profileGroups()];
    assert.equal((await create()).status, 200);
    assert.deepEqual([await groupsStat(), await profileGroups()], before);
    assert.equal(
      before[0],
      Number(
        sql(
          `select count(*) from app.group_roles r join app.groups g on g.id=r.group_id where g.kind='community' and r.user_id=(select id from auth.users where email='organizer@rallypoint.test');`,
        ),
      ),
    );
  });
  await t.test(
    "a session's hidden team can't be renamed or removed as a group",
    async () => {
      const s = (await (await create()).json()).session;
      const team = sql(`select group_id from app.sessions where id='${s.id}';`);
      const rename = await request(`/api/groups/${team}/rename`, organizer, {
        operationKey: crypto.randomUUID(),
        name: "Renamed team",
      });
      assert.equal(rename.status, 403);
      const archive = await request(`/api/groups/${team}/archive`, organizer, {
        operationKey: crypto.randomUUID(),
      });
      assert.equal(archive.status, 403);
      assert.equal(
        sql(`select archived_at is null from app.groups where id='${team}';`),
        "t",
      );
    },
  );

  await t.test(
    "run again copies co-hosts only for someone who manages the source",
    async () => {
      const s = (await (await create()).json()).session;
      const newcomer = await login("newcomer@rallypoint.test");
      sql(
        `insert into app.group_roles(group_id,user_id,role) select group_id,'${newcomer.id}','cohost' from app.sessions where id='${s.id}';`,
      );
      const copy = async (who) => {
        const r = await request("/api/sessions", who, {
          operationKey: crypto.randomUUID(),
          intent: "draft",
          fromSession: s.id,
          details: details(),
        });
        assert.equal(r.status, 200, await r.clone().text());
        const id = (await r.json()).session.id;
        sessions.push(id);
        return sql(
          `select count(*) from app.group_roles where group_id=(select group_id from app.sessions where id='${id}') and user_id='${newcomer.id}' and role='cohost';`,
        );
      };
      assert.equal(await copy(organizer), "1");
      assert.equal(await copy(member), "0");
    },
  );

  await t.test(
    "a former group co-host gains nothing on a new session",
    async () => {
      sql(
        `insert into app.group_roles(group_id,user_id,role) values('${firstGroup}','${member.id}','cohost') on conflict(group_id,user_id) do update set role='cohost';`,
      );
      try {
        const r = await request(
          `/api/groups/${firstGroup}/sessions`,
          organizer,
          {
            operationKey: crypto.randomUUID(),
            groupId: firstGroup,
            intent: "publish",
            details: details(),
          },
        );
        const s = (await r.json()).session;
        sessions.push(s.id);
        assert.equal(
          (await request(`/api/sessions/${s.id}`, member)).status,
          403,
        );
      } finally {
        sql(
          `update app.group_roles set role='member' where group_id='${firstGroup}' and user_id='${member.id}';`,
        );
      }
    },
  );
});
