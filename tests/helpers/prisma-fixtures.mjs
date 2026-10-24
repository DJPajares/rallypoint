import { execFileSync } from "node:child_process";
import { localEnv } from "../../scripts/local-env.mjs";

export function prismaFixture() {
  const env = localEnv();
  const url = new URL(env.DATABASE_URL);
  if (
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.port !== "54322"
  )
    throw new Error("Prisma fixtures require the isolated synthetic database.");
  const schema = "prisma_test_" + crypto.randomUUID().replaceAll("-", "");
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
      {
        input: query,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
  sql(
    `create schema ${schema}; grant usage on schema ${schema} to service_role;`,
  );
  return {
    env: { ...env, SUPABASE_API_SCHEMA: schema },
    schema,
    sql,
    close: () => sql(`drop schema ${schema} cascade;`),
  };
}
