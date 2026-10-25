import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { readFileSync } from "node:fs";

// Exercise the real portable API without a Next server or live credentials.
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (error) {
      if (specifier.startsWith(".") && !/\.[a-z]+$/.test(specifier))
        return next(specifier + ".ts", context);
      throw error;
    }
  },
  load(url, context, next) {
    if (url.endsWith(".ts") && url.startsWith("file:"))
      return {
        format: "module",
        shortCircuit: true,
        source: stripTypeScriptTypes(readFileSync(new URL(url), "utf8"), {
          mode: "transform",
        }),
      };
    return next(url, context);
  },
});
const { default: app } = await import("../apps/api/src/index.ts");

test("Prisma uses the deployment schema; Supabase serves only Auth and private Storage", async () => {
  const { prismaFixture } = await import("./helpers/prisma-fixtures.mjs");
  const fixture = prismaFixture();
  const requests = [];
  const upstream = createServer(async (req, res) => {
    requests.push(req.url);
    res.setHeader("content-type", "application/json");
    if (req.url === "/auth/v1/user") {
      res.end(
        JSON.stringify({
          id: "11111111-1111-4111-8111-111111111111",
          email: "synthetic@example.test",
          email_confirmed_at: "2026-10-23T00:00:00Z",
          user_metadata: {},
          is_anonymous: false,
        }),
      );
      return;
    }
    if (req.url === "/storage/v1/object/rallypoint-payment-qr/probe.png") {
      res.setHeader("content-type", "image/png");
      res.end(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      return;
    }
    res.statusCode = 501;
    res.end("{}");
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  try {
    fixture.sql(`
      create function ${fixture.schema}.list_my_groups(p_actor_id uuid) returns jsonb language sql as $$ select jsonb_build_array(jsonb_build_object('id',p_actor_id)) $$;
      create function ${fixture.schema}.read_shared_session(p_slug uuid) returns jsonb language sql as $$ select null::jsonb $$;
      create function ${fixture.schema}.read_profile(p_profile_id uuid) returns jsonb language sql as $$ select jsonb_build_object('id',p_profile_id,'name','Synthetic') $$;
      create function ${fixture.schema}.read_payment_qr(p_actor_id uuid,p_slug uuid) returns jsonb language sql as $$ select '{"path":"probe.png","type":"image/png"}'::jsonb $$;
      revoke all on all functions in schema ${fixture.schema} from public;
      grant execute on all functions in schema ${fixture.schema} to service_role;
    `);
    const env = {
      ...fixture.env,
      SUPABASE_URL: `http://127.0.0.1:${upstream.address().port}`,
      SUPABASE_PUBLISHABLE_KEY: "synthetic-publishable",
      SUPABASE_SECRET_KEY: "synthetic-server",
      PAYMENT_QR_BUCKET: "rallypoint-payment-qr",
    };
    const headers = { authorization: "Bearer synthetic-token" };
    const request = () =>
      new Request("https://staging.example.test/api/workspace", { headers });
    const hosted = await app.fetch(request(), env);
    assert.equal(hosted.status, 200, await hosted.clone().text());
    assert.deepEqual(await hosted.json(), {
      groups: [{ id: "11111111-1111-4111-8111-111111111111" }],
    });
    const shared = await app.fetch(
      new Request(
        "https://staging.example.test/api/shared/11111111-1111-4111-8111-111111111111",
      ),
      env,
    );
    assert.equal(shared.status, 404, await shared.clone().text());
    const profile = await app.fetch(
      new Request(
        "https://staging.example.test/api/people/11111111-1111-4111-8111-111111111111",
      ),
      env,
    );
    assert.equal(profile.status, 200, await profile.clone().text());
    assert.deepEqual(await profile.json(), {
      profile: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Synthetic",
      },
    });
    const image = await app.fetch(
      new Request(
        "https://staging.example.test/api/registrations/11111111-1111-4111-8111-111111111111/payment-qr",
        { headers },
      ),
      env,
    );
    assert.equal(image.status, 200, await image.clone().text());
    assert.equal(image.headers.get("content-type"), "image/png");
    assert.equal((await image.arrayBuffer()).byteLength, 8);
    delete env.SUPABASE_API_SCHEMA;
    const local = await app.fetch(request(), env);
    assert.equal(local.status, 200, await local.clone().text());
    assert.deepEqual(await local.json(), { groups: [] });
    assert.ok(
      requests.every(
        (path) => path.startsWith("/auth/") || path.startsWith("/storage/"),
      ),
      "No database REST calls remain",
    );
  } finally {
    await new Promise((resolve) => upstream.close(resolve));
    fixture.close();
  }
});

test("staging password sign-in is explicit and never enables local-only authentication", async () => {
  const env = {
    SUPABASE_URL: "https://synthetic.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "synthetic-public",
    SUPABASE_SECRET_KEY: "synthetic-secret",
    LOCAL_AUTH_ENABLED: "true",
    PASSWORD_AUTH_ENABLED: "true",
  };
  const read = async (value) =>
    (
      await app.fetch(
        new Request("https://staging.example.test/api/config"),
        value,
      )
    ).json();
  const enabled = await read(env);
  assert.equal(enabled.auth.password, true);
  assert.equal(enabled.auth.localEmail, false);
  // One-time email codes are gone (D-22).
  assert.ok(!("email" in enabled.auth) && !("emailCodeLength" in enabled.auth));
  assert.ok(!JSON.stringify(enabled).includes("synthetic-secret"));
  delete env.PASSWORD_AUTH_ENABLED;
  assert.equal((await read(env)).auth.password, false);
});

test("staging turns password sign-in on and carries no email-code settings", () => {
  const vars = readWranglerConfig("wrangler.staging.jsonc").vars ?? {};
  assert.equal(vars.PASSWORD_AUTH_ENABLED, "true");
  assert.ok(!("EMAIL_AUTH_ENABLED" in vars) && !("EMAIL_OTP_LENGTH" in vars));
});

// Wrangler configs are JSONC: strip comments and trailing commas, then parse.
function readWranglerConfig(name) {
  const text = readFileSync(
    new URL(`../apps/web/${name}`, import.meta.url),
    "utf8",
  );
  const stripped = text
    .replace(
      /("(?:[^"\\]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
      (m, str) => str ?? "",
    )
    .replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(stripped);
}

test("local Worker runs the email drain every minute", () => {
  const config = readWranglerConfig("wrangler.jsonc");
  assert.equal(config.main, "worker.ts");
  assert.deepEqual(config.triggers?.crons, ["* * * * *"]);
});

test("staging gets no cron or delivery until P-12", () => {
  const config = readWranglerConfig("wrangler.staging.jsonc");
  assert.equal(config.triggers, undefined);
  assert.ok(!("EMAIL_DELIVERY_ENABLED" in (config.vars ?? {})));
});
