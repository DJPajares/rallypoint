import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { localEnv, fixturePassword } from "../scripts/local-env.mjs";
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
const nonce = crypto.randomUUID().slice(0, 8);
async function person(label) {
  const email = `ct-${nonce}-${label}@rallypoint.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: fixturePassword,
    email_confirm: true,
    user_metadata: { full_name: `Courts ${label} ${nonce}` },
  });
  assert.ok(!error && data.user);
  const signedIn = await createClient(
    env.SUPABASE_URL,
    env.SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  ).auth.signInWithPassword({ email, password: fixturePassword });
  assert.ok(!signedIn.error && signedIn.data.session);
  return { id: data.user.id, token: signedIn.data.session.access_token };
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
const add = (actor, court, operationKey = crypto.randomUUID()) =>
  request("/api/courts", actor, { operationKey, ...court });
const courtsIn = async (actor, area) => {
  const r = await request(`/api/courts?area=${area}`, actor);
  assert.equal(r.status, 200);
  return (await r.json()).courts;
};
const name = (label) => `${label} ${nonce}`;

test("all 55 planning areas are listed under their region", async () => {
  const r = await request("/api/areas");
  assert.equal(r.status, 200);
  const { regions } = await r.json();
  assert.deepEqual(
    regions.map((g) => [g.name, g.areas.length]),
    [
      ["Central", 22],
      ["East", 6],
      ["North", 8],
      ["North-East", 7],
      ["West", 12],
    ],
  );
  const all = regions.flatMap((g) => g.areas);
  assert.equal(new Set(all.map((a) => a.key)).size, 55);
  const label = (key) => all.find((a) => a.key === key)?.label;
  assert.equal(label("downtown-core"), "CBD (Downtown Core)");
  assert.equal(label("southern-islands"), "Sentosa (Southern Islands)");
  assert.equal(label("pasir-ris"), "Pasir Ris");
  assert.ok(
    regions
      .find((g) => g.name === "East")
      .areas.some((a) => a.key === "pasir-ris"),
  );
});

test("a signed-in person adds a court and it is listed by area", async () => {
  const me = await person("adder");
  const r = await add(me, {
    area: "pasir-ris",
    name: name("Pasir Ris Sports Centre"),
    mapsLink: "https://maps.app.goo.gl/example",
  });
  assert.equal(r.status, 200);
  const { court } = await r.json();
  assert.deepEqual(Object.keys(court).sort(), [
    "area",
    "id",
    "mapsUrl",
    "name",
  ]);
  assert.equal(court.area, "pasir-ris");
  const listed = await courtsIn(me, "pasir-ris");
  assert.ok(listed.some((c) => c.id === court.id));
  assert.deepEqual(Object.keys(listed[0]).sort(), [
    "area",
    "id",
    "mapsUrl",
    "name",
  ]);
  assert.ok(!(await courtsIn(me, "tampines")).some((c) => c.id === court.id));
});

test("bad details are refused and nothing is stored", async () => {
  const me = await person("bad");
  for (const court of [
    { area: "pasir-ris", name: "  ", mapsLink: "" },
    { area: "pasir-ris", name: "x".repeat(61), mapsLink: "" },
    {
      area: "pasir-ris",
      name: name("Court"),
      mapsLink: "http://maps.google.com",
    },
    { area: "atlantis", name: name("Court"), mapsLink: "" },
  ]) {
    const r = await add(me, court);
    assert.equal(r.status, 422, JSON.stringify(court));
  }
  assert.equal(
    sql(`select count(*) from app.courts where created_by='${me.id}';`),
    "0",
  );
});

test("signed-out visitors can't add or list courts", async () => {
  const r = await add(null, {
    area: "pasir-ris",
    name: name("Ghost"),
    mapsLink: "",
  });
  assert.equal(r.status, 401);
  assert.equal((await request("/api/courts?area=pasir-ris")).status, 401);
});

test("a court name is listed once per area", async () => {
  const me = await person("dup");
  assert.equal(
    (await add(me, { area: "bedok", name: name("Bedok Hall"), mapsLink: "" }))
      .status,
    200,
  );
  const again = await add(me, {
    area: "bedok",
    name: `  ${name("BEDOK hall")} `,
    mapsLink: "",
  });
  assert.equal(again.status, 409);
  assert.equal((await again.json()).error.code, "court_exists");
  assert.equal(
    (
      await add(me, {
        area: "tampines",
        name: name("Bedok Hall"),
        mapsLink: "",
      })
    ).status,
    200,
  );
});

test("adding is limited to 20 courts per person", async () => {
  const me = await person("limit");
  sql(
    `insert into app.courts(area_key,name,created_by) select 'woodlands','Limit ${nonce} '||i,'${me.id}' from generate_series(1,20) i;`,
  );
  const r = await add(me, {
    area: "woodlands",
    name: name("One more"),
    mapsLink: "",
  });
  assert.equal(r.status, 409);
  const { error } = await r.json();
  assert.equal(error.code, "court_limit");
  assert.equal(
    error.message,
    "You’ve added 20 courts, the most one person can. Pick one from the list.",
  );
});

test("a retry adds the court once", async () => {
  const me = await person("retry");
  const key = crypto.randomUUID();
  const court = { area: "yishun", name: name("Yishun Court"), mapsLink: "" };
  const first = await (await add(me, court, key)).json();
  const second = await (await add(me, court, key)).json();
  assert.equal(second.court.id, first.court.id);
  assert.equal(
    sql(`select count(*) from app.courts where created_by='${me.id}';`),
    "1",
  );
  const changed = await add(me, { ...court, name: name("Other") }, key);
  assert.equal(changed.status, 409);
  assert.equal((await changed.json()).error.code, "idempotency_conflict");
});

test("courts store no location coordinates and no adder in reads", () => {
  assert.equal(
    sql(
      `select string_agg(column_name,',' order by column_name) from information_schema.columns where table_schema='app' and table_name='courts';`,
    ),
    "area_key,created_at,created_by,id,maps_url,name",
  );
});
