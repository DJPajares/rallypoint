import { execFileSync } from "node:child_process";
import { localEnv } from "./local-env.mjs";

// P-39: nothing sends email locally, so email jobs from earlier test runs stay
// queued until the 500-job cap fills and the email tests fail. Before a run,
// expire the queued jobs of synthetic test accounts in the local database.
// Real accounts' jobs, and every other database, are left alone.
localEnv();
const expired = execFileSync(
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
    input: `with gone as (update app.email_jobs j set expires_at=now(),updated_at=now()
      from auth.users u where u.id=j.user_id and u.email like '%@rallypoint.test'
        and j.state in ('queued','sending') and j.expires_at>now() returning 1)
      select count(*) from gone;`,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  },
).trim();
console.log(`Expired ${expired} leftover synthetic email jobs.`);
