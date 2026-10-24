import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
const runtime = process.argv[2] ?? "nodejs";
if (!["nodejs", "cloudflare"].includes(runtime))
  throw new Error("Unknown Prisma runtime.");
const schema = "prisma/.runtime.prisma";
try {
  writeFileSync(
    schema,
    readFileSync("prisma/schema.prisma", "utf8").replace(
      /runtime\s*=\s*"nodejs"/,
      `runtime             = "${runtime}"`,
    ),
  );
  execFileSync("prisma", ["generate", "--schema", schema], {
    stdio: "inherit",
  });
} finally {
  rmSync(schema, { force: true });
}
