import type { Database, DatabaseEnv } from "@rallypoint/database";

/** Searches a matchmaking pass handles; the rest wait for the next minute (D-08). */
const MATCHMAKING_BATCH = 50;

/**
 * One ranked matchmaking pass (WDL-422). The database does the pairing and
 * expiry in one transaction; this only opens a connection, runs it and closes.
 */
export async function matchmake(
  env: DatabaseEnv,
  open: (env: DatabaseEnv) => Pick<Database, "rpc" | "close">,
): Promise<void> {
  if (!env.DATABASE_URL) return;
  const db = open(env);
  try {
    const { error } = await db.rpc("run_matchmaking", {
      p_limit: MATCHMAKING_BATCH,
    });
    if (error) throw new Error("run_matchmaking failed");
  } catch {
    // Never log the error: it can carry database detail.
    console.error("matchmaking failed");
  } finally {
    await db.close();
  }
}
