import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  localEnv,
  fixturePassword,
  firstGroup,
  secondGroup,
} from "./local-env.mjs";

function cli(...args) {
  return execFileSync("npx", ["--no-install", "supabase", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 40 * 1024 * 1024,
  });
}
function configure() {
  const status = JSON.parse(cli("status", "-o", "json"));
  const s = status.data ?? status;
  const url = s.API_URL ?? s.api_url;
  const key = s.PUBLISHABLE_KEY ?? s.ANON_KEY ?? s.publishable_key;
  const secret = s.SECRET_KEY ?? s.SERVICE_ROLE_KEY ?? s.secret_key;
  if (!url || !key || !secret || new URL(url).hostname !== "127.0.0.1")
    throw new Error("Local configuration could not be read safely.");
  writeFileSync(
    ".dev.vars",
    `SUPABASE_URL=${url}\nSUPABASE_PUBLISHABLE_KEY=${key}\nSUPABASE_SECRET_KEY=${secret}\nLOCAL_AUTH_ENABLED=true\nGOOGLE_AUTH_ENABLED=false\n`,
    { mode: 0o600 },
  );
  console.log(
    "Local credentials written to ignored .dev.vars (values are not logged).",
  );
}
async function seed() {
  const env = localEnv();
  const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let existing;
  for (let attempt = 0; attempt < 30; attempt++) {
    const { data, error } = await admin.auth.admin.listUsers();
    if (!error) {
      existing = data;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!existing)
    throw new Error("Local Auth did not become ready within 15 seconds.");
  const fixtures = [
    ["organizer", "Mika"],
    ["member", "Sam"],
    ["outsider", "Alex"],
    ["newcomer", "Riley"],
  ];
  const users = {};
  for (const [kind, name] of fixtures) {
    const email = `${kind}@rallypoint.test`;
    let user = existing.users.find((u) => u.email === email);
    if (!user) {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: fixturePassword,
        email_confirm: true,
        user_metadata: { full_name: name },
      });
      if (error)
        throw new Error("A synthetic local identity could not be created.");
      user = data.user;
    }
    if (!user || !/^[0-9a-f-]{36}$/.test(user.id))
      throw new Error("Invalid local fixture identity.");
    users[kind] = user.id;
  }
  cli(
    "db",
    "query",
    "--local",
    `insert into app.group_roles(group_id,user_id,role) values ('${firstGroup}','${users.organizer}','organizer'),('${firstGroup}','${users.member}','member'),('${secondGroup}','${users.outsider}','organizer') on conflict(group_id,user_id) do update set role=excluded.role;`,
  );
  console.log(
    "Four synthetic Auth identities and two isolated group fixtures are ready.",
  );
}
try {
  if (
    !readFileSync("supabase/config.toml", "utf8").includes(
      'project_id = "rallypoint"',
    )
  )
    throw new Error("Unexpected local project.");
  const command = process.argv[2];
  if (command === "start") {
    try {
      execFileSync("docker", ["network", "inspect", "rallypoint-local"], {
        stdio: "ignore",
      });
    } catch {
      execFileSync(
        "docker",
        [
          "network",
          "create",
          "-o",
          "com.docker.network.bridge.host_binding_ipv4=127.0.0.1",
          "rallypoint-local",
        ],
        { stdio: "ignore" },
      );
    }
    console.log(
      "Starting isolated local Postgres, Auth, REST API and mail sink…",
    );
    cli(
      "start",
      "--network-id",
      "rallypoint-local",
      "--exclude",
      "realtime,storage-api,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor",
    );
    configure();
    await seed();
  } else if (command === "reset") {
    console.log("Resetting only the synthetic local RallyPoint database…");
    cli("db", "reset", "--local", "--yes", "--network-id", "rallypoint-local");
    configure();
    await seed();
  } else if (command === "stop") {
    cli("stop");
    console.log("Local RallyPoint services stopped; local data is preserved.");
  } else {
    throw new Error("Use start, reset or stop.");
  }
} catch (error) {
  // CLI output may include local keys. Never dump it or an SDK error object.
  console.error(
    error instanceof Error && !("stderr" in error)
      ? error.message
      : "The local Supabase command failed. Inspect container status; no credential output was logged.",
  );
  process.exitCode = 1;
}
