import {
  mkdtempSync,
  readdirSync,
  renameSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
const root = resolve(import.meta.dirname, "..");
const holding = mkdtempSync(join(tmpdir(), "rallypoint-env-"));
const moved = [];
let exitCode = 1;
try {
  for (const dir of [root, join(root, "apps/web")]) {
    for (const name of readdirSync(dir)) {
      if (
        name === ".env" ||
        /^\.env\.(local|production|development|test)(\.local)?$/.test(name) ||
        name === ".dev.vars"
      ) {
        const from = join(dir, name),
          to = join(holding, String(moved.length));
        renameSync(from, to);
        moved.push([from, to]);
      }
    }
  }
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (
      /^(SUPABASE_|LOCAL_AUTH_|GOOGLE_AUTH_|EMAIL_AUTH_|EMAIL_OTP_|PAYMENT_QR_)/.test(
        key,
      )
    )
      delete env[key];
  const result = spawnSync("pnpm", ["build:cloudflare"], {
    cwd: root,
    env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("Cloudflare build failed.");
  const compiled = readFileSync(
    join(root, "apps/web/.open-next/cloudflare/next-env.mjs"),
    "utf8",
  );
  if (
    !compiled
      .split("\n")
      .filter(Boolean)
      .every((line) =>
        /^export const (production|development|test) = \{\};$/.test(line),
      )
  )
    throw new Error(
      "Staging artifact contains embedded environment values; do not deploy.",
    );
  console.log(
    "Staging artifact verified: no embedded .env values; use Cloudflare runtime bindings.",
  );
  exitCode = 0;
} finally {
  for (const [from, to] of moved.reverse()) renameSync(to, from);
  rmSync(holding, { recursive: true });
}
process.exitCode = exitCode;
