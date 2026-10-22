import { readFileSync } from "node:fs";

export function localEnv() {
  const env = Object.fromEntries(
    readFileSync(new URL("../apps/web/.env.local", import.meta.url), "utf8")
      .split("\n")
      .filter((line) => /^[A-Z_]+=/.test(line))
      .map((line) => {
        const index = line.indexOf("=");
        return [
          line.slice(0, index),
          line.slice(index + 1).replace(/^"|"$/g, ""),
        ];
      }),
  );
  const url = new URL(env.SUPABASE_URL);
  if (
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.port !== "54321"
  ) {
    throw new Error(
      "This command only accepts the isolated local Supabase instance on port 54321.",
    );
  }
  return env;
}
export const fixturePassword = "rallypoint-local-only-382";
export const firstGroup = "11111111-1111-4111-8111-111111111111";
export const secondGroup = "22222222-2222-4222-8222-222222222222";
