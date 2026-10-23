# P-06 email delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send the accepted session emails (join, waitlist, promotion, release, cancellation, payment-instructions change, 24-hour reminder) from a durable outbox, within the D-05 ceilings, without ever letting delivery change seats, fees or attendance.

**Architecture:**
- **Database (Postgres):** triggers on the existing durable signals write one row per recipient into a bounded outbox table, inside the same transaction as the state change. Leasing, eligibility rechecks, budget and circuit checks, and attempt bookkeeping are plpgsql `api.*` functions. The database is the record of delivery.
- **`packages/email` (TypeScript):** renders each message, looks up the recipient's verified address through the Supabase Auth admin API, calls the provider (Resend for live, Mailpit for the local inbox), and drains at most five jobs per run.
- **Scheduler:** a custom OpenNext Worker adds a `scheduled` handler that calls the drain every minute.

**Tech Stack:** Supabase Postgres (plpgsql, triggers), TypeScript (Node 24 type stripping for tests), `@supabase/supabase-js` 2.118.0, OpenNext Cloudflare 1.20.13 with a custom Worker, Wrangler 4.151.3 Cron Triggers, local Mailpit v1.31.3, `node --test`.

**Spec:**
- [D-05 email delivery decisions](../specs/2026-10-22-email-delivery-decisions.md) (accepted 2026-10-22). This is the binding contract.
- [PRD.md](../../../PRD.md): RP-12, the D-05 row, and the D-18 paragraphs under RP-10 and RP-11.
- Tracker: [WDL-379](https://linear.app/wwonderland/issue/WDL-379/p-06-send-truthful-email-updates-and-the-24-hour-reminder). Branch: `djpajares/wdl-379-p-06-send-truthful-email-updates-and-the-24-hour-reminder`.

## Global Constraints

- **Sender:** `RallyPoint <no-reply@auth.wndrhive.com>`. No live key in source, logs or commits. Live enablement, the domain-restricted key and shared-quota acceptance belong to P-12. This plan only reads `RESEND_API_KEY` from server secrets when present.
- **Delivery is off by default.** It needs `EMAIL_DELIVERY_ENABLED="true"` and a provider. `EMAIL_PROVIDER` is `"resend"` or `"mailpit"`; Mailpit is local only.
- **Recipients:**
  - **Join (confirmed or waitlisted):** the party's primary account, once.
  - **Promotion:** the promoted party's primary, once.
  - **Release (D-18):** the released party's primary, once.
  - **Cancellation:** deduplicated primaries that were confirmed or waitlisted when the session was cancelled, plus primaries whose retained unpaid fee or claim that cancellation ended.
  - **Payment-instructions change (D-18):** confirmed and waitlisted primaries.
  - **Reminder:** the primary of a party confirmed at or before `start − 24h`, still confirmed and authorized at dispatch.
  - Guests, waiting-only copies, organizer-only copies and other participants get nothing.
- **Timing:**
  - One reminder per session and account, attempted only during the 15 minutes after its due time, never late. No catch-up reminder for a confirmation or promotion after the reminder time.
  - No reminder rescheduling (P-11/P-16 own start-time changes).
  - No material-change emails: booked details are locked until P-16.
- **Ceilings:**
  - At most 5 jobs per scheduled run, one sender lease, one in-flight provider request, and at least 1 second between request starts.
  - 50 provider attempts per UTC day and 1,500 per UTC calendar month, debited before every attempt (retries and ambiguous calls included) and never refunded.
  - At most 50 distinct recipients per session-wide update. Above that, suppress the whole update with `audience_limit` evidence; never send to the first 50.
  - At most 500 active jobs (queued or sending). Job 501 is terminally suppressed with `queue_capacity` evidence, with no secondary pending list and no automatic replay.
- **Retries:**
  - 3 attempts in total: the first, then after 1 minute, then after a further 5 minutes. A longer provider retry delay wins if it still fits within the expiry.
  - 10-second request timeout. A timeout is an unknown outcome, never proof of non-delivery.
  - One stable `Idempotency-Key` per job, and an immutable payload frozen on the first attempt.
  - Retry only transient transport errors, 5xx, rate limits and concurrent-idempotent conflicts. Permanent failures stop. Daily or monthly quota errors open a sender circuit until the reset.
- **Expiry:**
  - Reminder: due + 15 minutes.
  - Join, promotion and release: the earlier of session start and enqueue + 23 hours.
  - Cancellation and payment-instructions change: enqueue + 23 hours.
  - Never attempt at or after expiry.
- **Before every attempt, recheck:** the recipient still exists and has a verified email; the session isn't cancelled (cancellation wins over pending join, promotion, release and instruction emails); the party is still in the state the email describes; and for a reminder, the party is still confirmed and the session still published. A changed destination or a superseding event suppresses the old job; it never mutates the retry payload.
- **Organizer status words, exactly:** **Queued**, **Sent to email service**, **Not confirmed**, **Not sent**.
  - Any ambiguous attempt makes a job **Not confirmed** for good, unless an idempotent replay is accepted.
  - Never say "Delivered".
  - Organizers see only their own sessions, by display name, never by email address.
- **Email content:**
  - Generic subjects.
  - Bodies give only the person's own status, the session title, its local date and time, and a link to the session.
  - Never other participants, contacts, attendance, payment details, payment references or "I've sent it" notes.
  - No open or click tracking.
- **Privacy:** keep only safe reason codes, kinds, attempt counts, timestamps and the provider id. Purge the frozen payload (it holds the address and body) as soon as a job ends. No raw provider bodies, tokens or mail contents in logs or organizer views.
- **Separation of concerns:**
  - The provider is never called inside a seat or fee transaction.
  - A delivery failure never undoes a party, promotion, release, cancellation or fee.
  - Enqueue triggers never raise into the calling transaction: an overflow becomes evidence, not an error.
- **Staging schema render:** `scripts/render-staging-schema.mjs` rewrites every whole word `app` and `api`. Don't use those words as plain English in new SQL strings or reason codes.
- **Project rules:** existing lock order (actor/key advisory lock, group, session), `clock_timestamp()` after locks, `service_role`-only grants, RLS on every new table, synthetic data only, D-13 copy rules. Never commit to `main`.

## Review Focus

1. **A crash after the provider accepted a message but before the database recorded it.** Expected: the next attempt reuses the same idempotency key and frozen payload, so the person gets one email. The job ends **Sent to email service**, or **Not confirmed** if the replay is never resolved, never **Not sent**. Pinned in Task 4.
2. **Two overlapping scheduled runs.** Expected: one holds the sender lease and the other exits, so nothing is sent twice and the budget is debited once per real attempt. Pinned in Task 3.
3. **A session cancelled while a promotion email waits.** Expected: the promotion email is suppressed (**Not sent**, reason `superseded`) and only the cancellation email goes out. Pinned in Task 3.
4. **Joining 10 minutes after the reminder time, or withdrawing before it.** Expected: the late joiner gets a confirmation and no reminder; the withdrawn person gets no reminder. Pinned in Task 3.
5. **The daily budget running out partway through a run.** Expected: remaining jobs stay **Queued** with reason `daily_limit`, no provider call is made, and none expires early. Pinned in Task 4.

---

### Task 1: Outbox schema and enqueue triggers

**Files:**
- Create: `supabase/migrations/20261023140000_email_outbox.sql`
- Test: `tests/email-outbox.test.mjs` (new; copy the `sql`, `login`, `request`, `details` and cleanup helpers from `tests/release-unpaid.test.mjs`, and extend cleanup to delete `email_jobs` and `email_suppressions` rows first)

**Interfaces:**
- Produces the table `app.email_jobs`:

  | Column | Type and rule |
  | --- | --- |
  | `id` | `uuid` primary key, default `gen_random_uuid()` |
  | `kind` | `text` in `('joined_confirmed','joined_waitlisted','promoted','released','cancelled','instructions_changed','reminder')` |
  | `session_id` | `uuid` not null, references `app.sessions` |
  | `party_id` | `uuid` null, references `app.parties` |
  | `user_id` | `uuid` not null, references `auth.users` |
  | `source_key` | `text` not null |
  | `state` | `text` not null, default `'queued'`, in `('queued','sending','sent','not_confirmed','not_sent')` |
  | `reason` | `text` null |
  | `attempts` | `smallint` not null, default 0, check 0–3 |
  | `ambiguous` | `boolean` not null, default false |
  | `next_attempt_at` | `timestamptz` not null |
  | `expires_at` | `timestamptz` not null |
  | `lease_until` | `timestamptz` null |
  | `payload` | `jsonb` null |
  | `provider_id` | `text` null |
  | `created_at`, `updated_at` | `timestamptz` not null |

  Constraint `unique(kind, source_key, user_id)`, plus an index on `(state, next_attempt_at)`.
- Produces the table `app.email_suppressions(id uuid pk, session_id uuid not null references app.sessions, kind text not null, source_key text not null, reason text not null check(reason in ('audience_limit')), recipients integer not null, created_at timestamptz not null)`. It is the session-level evidence for a suppressed bulk update.
- Produces `app.enqueue_email(p_kind text, p_session uuid, p_party uuid, p_user uuid, p_source text, p_expires timestamptz) returns void`.
  - When 500 jobs are already active, it inserts the row as `state='not_sent', reason='queue_capacity'`.
  - A duplicate `(kind, source, user)` is a no-op (`on conflict do nothing`).
  - `next_attempt_at` is set to `clock_timestamp()`.
- Produces `app.enqueue_bulk(p_kind text, p_session uuid, p_source text, p_users uuid[], p_expires timestamptz) returns void`. With more than 50 distinct users it inserts one `email_suppressions` row (`audience_limit`, `recipients = count`) and no jobs; otherwise it calls `app.enqueue_email` once per user, with `p_party` null.
- Source keys:
  - join, promotion and release: `registration_events.id::text`;
  - cancellation: `session_id::text`;
  - instructions change: `session_id || ':' || revision`;
  - reminder: `session_id::text` (Task 3).

- [ ] **Step 1: Write the failing tests** in `tests/email-outbox.test.mjs`. Assert through SQL reads of `app.email_jobs`.
  - `"a confirmed join, a waitlisted join, a promotion and a release each queue one email for the primary"`:
    - Capacity `"1"`. A joins (confirmed), then B joins with a guest (waitlisted).
    - A withdraws, so B is promoted.
    - Expect kinds `joined_confirmed` (A), `joined_waitlisted` (B) and `promoted` (B), each with `user_id` = the primary, state `queued`, and no job for the guest.
    - Then a release on a release-on session queues `released` for the released primary.
  - `"a replayed join queues nothing new"`: the same operation key twice gives one `joined_confirmed` row.
  - `"join and promotion expire at the earlier of start or 23 hours"`: for a session starting in 2 hours, `expires_at` equals `startsAt`. For a session starting in 48 hours, `expires_at` is within 5 seconds of `created_at + 23h`.
  - `"cancellation reaches active primaries and those whose unpaid fee it ended, once each"`:
    - Parties: confirmed A; waitlisted B; C withdrew after the cutoff keeping a due fee; D withdrew before the cutoff (fee removed).
    - Cancel the session. Expect `cancelled` jobs for A, B and C only, `expires_at ≈ cancel + 23h`, and one job per account even if the account has two parties over time.
  - `"a draft cancellation queues nothing"`.
  - `"instruction changes after booking queue one email per active primary, combining unsent changes"`:
    - Book A (confirmed) and B (waitlisted), then save instructions twice.
    - Expect exactly one `instructions_changed` job for each of A and B, because a second change while a job is still queued and unattempted adds none.
    - After A's job is marked `sent` by SQL, a third save queues a new one for A.
  - `"more than 50 recipients suppresses the whole session-wide update"`:
    - Insert 51 synthetic confirmed parties with direct SQL, using `admin.auth.admin.createUser` for 51 accounts.
    - Cancel. Expect 0 `cancelled` jobs and one `email_suppressions` row with `reason='audience_limit'` and `recipients=51`.
  - `"job 501 is suppressed with queue_capacity evidence and the join still commits"`:
    - Insert 500 synthetic `queued` rows by SQL for an existing session or user.
    - Join. Expect the join to return 200 confirmed, and its job row to be `not_sent` with `queue_capacity`.
    - Delete the filler rows afterwards.
- [ ] **Step 2: Run** `pnpm db:start && RALLYPOINT_TEST_URL=http://127.0.0.1:3101 node --test --test-concurrency=1 tests/email-outbox.test.mjs`. Expected: FAIL (`relation "app.email_jobs" does not exist`).
- [ ] **Step 3: Write the migration.**
  - Tables with RLS on. Revoke from `public, anon, authenticated`; grant select, insert and update to `service_role`.
  - The two enqueue functions.
  - **An `after insert` row trigger on `app.registration_events`.**
    - Map kinds: `confirmed`→`joined_confirmed`, `waitlisted`→`joined_waitlisted`, `promoted`→`promoted`, `released`→`released`.
    - Ignore `withdrawn` and any other kind.
    - Recipient: `parties.user_id`.
    - Expiry: `least(startsAt, clock_timestamp() + interval '23 hours')`.
  - **A deferred cancellation trigger:** `create constraint trigger … after insert on app.session_cancellations deferrable initially deferred`, so it runs at commit, after `api.cancel_session` has removed fees.
    - The audience is the distinct `user_id`s of the session's parties that are `confirmed` or `waitlisted`, unioned with parties that have a `fee_changes` row with action `removed_session_cancelled` or a `split_claim_changes` row with that action, `created_at = cancellation.created_at`.
    - Skip it when `previous_state = 'draft'`.
    - Call `app.enqueue_bulk('cancelled', …, now + 23h)`.
  - **An `after insert` trigger on `app.payment_instruction_notices`.**
    - The audience is confirmed and waitlisted primaries.
    - Exclude users who already have an `instructions_changed` job for that session with `state='queued' and attempts=0`.
    - Call `app.enqueue_bulk('instructions_changed', …, now + 23h)`.
  - Triggers catch nothing and raise nothing into the caller. Overflow is handled inside the enqueue functions.
- [ ] **Step 4: Run** the Step 2 command plus `tests/registrations.test.mjs tests/withdrawals.test.mjs tests/cancellations.test.mjs tests/payment-instructions.test.mjs tests/release-unpaid.test.mjs` and `pnpm db:lint`. Expected: PASS. The existing tests still pass, showing the triggers never break a join, withdrawal, cancellation or release.
- [ ] **Step 5: Commit**: `git add supabase/migrations/20261023140000_email_outbox.sql tests/email-outbox.test.mjs && git commit -m "Queue durable email jobs from join, promotion, release, cancellation and instruction signals"`

### Task 2: Email rendering and provider adapters (pure TypeScript)

**Files:**
- Create: `packages/email/package.json` (`@rallypoint/email`, `"type": "module"`, exports `"./render"`, `"./provider"`, `"./drain"`, `"./client"`, depends on `@supabase/supabase-js` 2.118.0, with lint and typecheck scripts copied from `packages/domain`), `packages/email/tsconfig.json` (copy from `packages/domain`)
- Create: `packages/email/src/render.ts`, `packages/email/src/provider.ts`
- Modify: `pnpm-lock.yaml` (via `pnpm install`)
- Test: `tests/email-render-domain.test.mjs` (pure, no server)

**Interfaces:**
- Produces in `render.ts`:
  - `export type EmailKind = "joined_confirmed" | "joined_waitlisted" | "promoted" | "released" | "cancelled" | "instructions_changed" | "reminder";`
  - `export interface EmailContext { kind: EmailKind; title: string; startsAt: string; timeZone: string; link: string; firstName: string; queuePosition: number | null; cutoffAt: string | null }`
  - `export function renderEmail(c: EmailContext): { subject: string; text: string; html: string }`
- Produces in `provider.ts`:
  - `export type SendResult = { outcome: "accepted"; id: string } | { outcome: "transient"; retryAfterSeconds?: number; code: string } | { outcome: "ambiguous"; code: "timeout" | "network" } | { outcome: "permanent"; code: string } | { outcome: "quota"; code: "daily_quota" | "monthly_quota" }`
  - `export interface OutgoingEmail { from: string; to: string; subject: string; text: string; html: string; idempotencyKey: string }`
  - `export interface Provider { send(m: OutgoingEmail): Promise<SendResult> }`
  - `export function resendProvider(o: { apiKey: string; baseUrl?: string; fetch?: typeof fetch; timeoutMs?: number }): Provider`, with defaults `baseUrl` `https://api.resend.com` and `timeoutMs` 10000
  - `export function mailpitProvider(o: { baseUrl: string; fetch?: typeof fetch; timeoutMs?: number }): Provider`
- Import `.ts` paths explicitly between these files (`./render.ts`), as `packages/domain` does, so Node tests can import them directly.

- [ ] **Step 1: Write the failing tests** in `tests/email-render-domain.test.mjs`.
  - **Exact copy:** generic subjects (builder's call, owner may correct):

    | Kind | Subject | First line of text |
    | --- | --- | --- |
    | `joined_confirmed` | "Your RallyPoint place" | "You’re in for {title}." |
    | `joined_waitlisted` | "Your RallyPoint place" | "You’re on the waitlist for {title}, number {queuePosition} in line." (no "number …" when the position is null) |
    | `promoted` | "Your RallyPoint place" | "A place opened: you’re now in for {title}." |
    | `released` | "Your RallyPoint place" | "Your spot for {title} went to the waitlist because it wasn’t marked paid by {cutoff time}." |
    | `cancelled` | "Session update" | "{title} was cancelled." |
    | `instructions_changed` | "Session update" | "How to pay for {title} has changed." |
    | `reminder` | "Session reminder" | "{title} starts in about 24 hours." |

  - Every text body then has a line with the local date and time (`Intl.DateTimeFormat("en", { timeZone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })`, no zone name), then "See your current status: {link}", then "RallyPoint".
  - `html` carries the same text, HTML-escaped, in plain `<p>` paragraphs with one `<a href>`, with no images and no tracking.
  - Escaping: a title of `<b>&"` appears escaped in the html and raw in the text.
  - `"Resend outcomes are classified"`. Use a stub `fetch`:

    | Response | Result |
    | --- | --- |
    | 200 `{"id":"re_1"}` | accepted, `re_1` |
    | 500 | transient |
    | 429 with `retry-after: 120` | transient, `retryAfterSeconds` 120 |
    | 429 with body `{"name":"daily_quota_exceeded"}` | `quota` / `daily_quota` |
    | `monthly_quota_exceeded` | `monthly_quota` |
    | 409 `concurrent_idempotent_requests` | transient |
    | 409 `invalid_idempotent_request` | permanent |
    | 422 | permanent |
    | a fetch that never resolves, with `timeoutMs: 50` | ambiguous / `timeout` |
    | a fetch that throws `TypeError` | ambiguous / `network` |

    The request has `Authorization: Bearer k`, an `Idempotency-Key` header equal to `idempotencyKey`, and a JSON body with exactly `from`, `to` (one address), `subject`, `text` and `html`.
  - `"Mailpit adapter posts to the local send API"`: `POST {baseUrl}/api/v1/send` with `{From:{Email,Name},To:[{Email}],Subject,Text,HTML}`. A 200 `{"ID":"m1"}` gives accepted `m1`.
- [ ] **Step 2: Run** `node --test tests/email-render-domain.test.mjs`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `render.ts` and `provider.ts`.
  - Use `AbortSignal.timeout(timeoutMs)` for the request timeout.
  - Read the Resend error name from the JSON body if it parses. Never log or return the body.
  - Parse `retry-after` in seconds. Ignore a missing or unparsable value.
  - The from-name for Mailpit is parsed out of `from`.
- [ ] **Step 4: Run** `pnpm install && node --test tests/email-render-domain.test.mjs && pnpm lint && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit**: `git add packages/email pnpm-lock.yaml tests/email-render-domain.test.mjs && git commit -m "Render session emails and classify provider results"`

### Task 3: Leasing, eligibility, reminders and attempt bookkeeping (SQL)

**Files:**
- Create: `supabase/migrations/20261023141000_email_dispatch.sql`
- Test: `tests/email-dispatch.test.mjs` (new; drives the RPCs directly through `admin.schema("api").rpc(...)`)

**Interfaces:**
- Consumes: the Task 1 tables.
- Produces the table `app.email_sender(id smallint primary key check(id=1), holder uuid, lease_until timestamptz, circuit_until timestamptz, circuit_reason text, last_request_at timestamptz)`, seeded with one row.
- Produces the table `app.email_budget(period text primary key, attempts integer not null)`. The period is `'d:YYYY-MM-DD'` or `'m:YYYY-MM'`, both in UTC.
- Produces `api.claim_email_jobs(p_holder uuid, p_limit integer) returns jsonb`. The result is `{ "leased": boolean, "jobs": [ … ] }`. Each job has:
  - `id, kind, attempts, ambiguous, userId, idempotencyKey` (`'rallypoint-email-' || id`);
  - `payload` (the frozen payload or null);
  - `context` with `title`, `startsAt`, `timeZone`, `slug`, `firstName` (from the primary's display name, first word), `queuePosition` and `cutoffAt`.

  It runs in this order:
  1. Take the sender lease (`for update` on the single row): it is free, or `lease_until < now`, or already held by `p_holder`. Set `lease_until = now + 2 minutes`. If the lease is held by someone else, return `{leased:false, jobs:[]}`.
  2. If `circuit_until > now`, return `{leased:true, jobs:[]}`.
  3. Create due reminders: for published sessions with `startsAt − 24h <= now < startsAt − 24h + 15 min`, add one `reminder` job for each confirmed party whose `app.party_confirmed_at(party) <= startsAt − 24h`, via `app.enqueue_email`. Source is the session id; expiry is due + 15 minutes.
  4. End expired jobs: a `queued` job with `expires_at <= now` becomes `not_confirmed` (reason `expired`) if `ambiguous`, else `not_sent` (reason `expired`). A `sending` job whose `lease_until` has passed returns to `queued`.
  5. Pick up to `least(p_limit, 5)` `queued` jobs with `next_attempt_at <= now`, ordered by `next_attempt_at`, using `for update skip locked`.
  6. Recheck each one. Suppress it as `not_sent` (or `not_confirmed` if `ambiguous`) with reason `superseded` when any of these holds:
     - the session is cancelled and the kind isn't `cancelled`;
     - the party state no longer matches the kind:

       | Kind | Required party state |
       | --- | --- |
       | `joined_confirmed`, `promoted`, `reminder` | `confirmed` |
       | `joined_waitlisted` | `waitlisted` |
       | `released` | `removed`, with fee `released_unpaid` |

     - a reminder's session is no longer published.
  7. Mark the remaining jobs `sending` with `lease_until = now + 2 minutes`.
- Produces `api.begin_email_attempt(p_holder uuid, p_job uuid, p_payload jsonb) returns jsonb`. The result is `{ "go": boolean, "payload": jsonb|null, "waitMs": integer, "reason": text|null }`. In order:
  1. Require the lease and `state='sending'`.
  2. If the frozen payload exists and `p_payload->>'to'` differs from the frozen `to`, suppress the job as `not_sent` (or `not_confirmed` if ambiguous) with reason `destination_changed`, and return `go:false`.
  3. If the day budget has reached 50 or the month budget 1,500: open the circuit until the next UTC day or month (reason `daily_limit` or `monthly_limit`), return the job to `queued` with `reason` set and `next_attempt_at` = circuit end, keep `expires_at` unchanged, and return `go:false`.
  4. Otherwise debit both periods, freeze the payload if it is null, increment `attempts`, and return `waitMs = max(0, 1000 − ms since last_request_at)`. Then set `last_request_at = now + waitMs`.
- Produces `api.finish_email_attempt(p_holder uuid, p_job uuid, p_outcome text, p_code text, p_provider_id text, p_retry_after_seconds integer) returns void`, where `p_outcome` is one of `accepted | transient | ambiguous | permanent | quota | recipient_missing`:
  - **`accepted`:** `sent` (reason null), store `provider_id`, purge `payload`.
  - **`transient` or `ambiguous`:** set `ambiguous` on an ambiguous outcome. If `attempts < 3`, the next time is `now + interval` (1 minute after attempt 1, 5 minutes after attempt 2, or `p_retry_after_seconds` if longer). If the next time is before `expires_at`, the job goes back to `queued`. Otherwise it is terminal: `not_confirmed` if ambiguous, else `not_sent` with reason `attempts_exhausted` or `expired`, and the payload is purged.
  - **`permanent`:** terminal, `not_confirmed` if ambiguous, else `not_sent` with reason `rejected`. Purge the payload.
  - **`quota`:** open the circuit (as in begin), return the job to `queued`. A quota attempt still counts.
  - **`recipient_missing`:** terminal, `not_sent` (or `not_confirmed` if ambiguous) with reason `no_verified_email`. Purge the payload.
  - A finish for a job that isn't `sending` under this holder is a no-op.
- Produces `api.release_email_sender(p_holder uuid) returns void`, which clears the holder and lease.
- `api.disable_due_emails(p_holder uuid) returns integer`, used when delivery is off. It requires the lease and marks every due `queued` job `not_sent` with reason `delivery_disabled` (or `not_confirmed` if ambiguous), returning the count.
- All functions are `service_role` only. Read the current time with `clock_timestamp()` after the row locks.

- [ ] **Step 1: Write the failing tests** in `tests/email-dispatch.test.mjs`. Move session times with the `shift()` helper pattern from `tests/release-unpaid.test.mjs`, and set job columns directly with SQL to simulate elapsed time.
  - `"only one holder leases the sender at a time"`: holder A claims and gets `leased:true`; holder B gets `leased:false`. After A releases, B leases. After A's lease expires (set `lease_until` to the past), B leases.
  - `"a claim returns at most five due jobs and marks them sending"`: 7 queued jobs give 5 jobs, all with `state='sending'`; the other 2 stay `queued`.
  - `"a cancelled session suppresses waiting join and promotion emails but not its cancellation email"`: queue a promotion email, then cancel the session. The claim returns only the `cancelled` job; the promotion job is `not_sent` / `superseded`.
  - `"a withdrawn party's confirmation is superseded"`.
  - `"reminders: due window, confirmed in time, no late catch-up, no withdrawn"`:
    - Session start is now + 24h + 10 minutes. Party A confirmed now; B confirmed now then withdrew.
    - Shift `startsAt` to now + 24h − 1 minute (due a minute ago) and claim. Exactly one `reminder` job, for A.
    - A party C confirmed after the due time gets no reminder.
    - With `startsAt` at now + 24h − 16 minutes, the window is past: no reminder is created.
    - Claiming twice creates no duplicate.
  - `"budget: 50 a day, then deferral without early expiry"`: set the `d:` budget row to 50. Begin on a sending job returns `go:false`, reason `daily_limit`. The job is `queued`, `next_attempt_at` is the next UTC midnight, and `expires_at` is unchanged. The circuit is open, so the next claim returns no jobs.
  - `"retry schedule and attempt limit"`:
    - Transient after attempt 1: next ≈ now + 1 minute.
    - After attempt 2: next ≈ now + 5 minutes.
    - A retry-after of 600 seconds is used when it is earlier than expiry.
    - After attempt 3 the job is terminal `not_sent` / `attempts_exhausted`, with the payload null.
  - `"an ambiguous attempt can only end as Not confirmed or Sent"`: ambiguous, then permanent gives `not_confirmed`. Ambiguous, then accepted gives `sent`.
  - `"the frozen payload never changes and a new address suppresses the job"`: the first begin freezes `{to:"a@x"}`. A later begin with `{to:"b@x"}` gives `go:false` and `not_sent` / `destination_changed`.
  - `"delivery off marks due jobs Not sent"`: `disable_due_emails` gives a count of 2, with reason `delivery_disabled`.
  - `"only the service role can call dispatch functions"`: an anonymous client's `rpc` returns error code `42501` (or `PGRST202`, the function not exposed) for each function. Assert `error.code` specifically.
- [ ] **Step 2: Run** `pnpm db:start && RALLYPOINT_TEST_URL=http://127.0.0.1:3101 node --test --test-concurrency=1 tests/email-dispatch.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Write the migration** with the functions above. Use the `p_holder` lease for every write, so a job held by an expired holder can't be finished by it.
- [ ] **Step 4: Run** the Step 2 command, `tests/email-outbox.test.mjs` and `pnpm db:lint`. Expected: PASS.
- [ ] **Step 5: Commit**: `git add supabase/migrations/20261023141000_email_dispatch.sql tests/email-dispatch.test.mjs && git commit -m "Lease email jobs with budget, circuit, eligibility and retry rules"`

### Task 4: The drain

**Files:**
- Create: `packages/email/src/drain.ts`, `packages/email/src/client.ts`
- Test: `tests/email-drain.test.mjs` (new; imports `../packages/email/src/drain.ts` and runs it against the local database with a stub `Provider`)

**Interfaces:**
- Consumes: Task 2 `renderEmail`, `Provider` and `SendResult`; Task 3 RPCs.
- Produces in `client.ts`: `export interface EmailEnv { SUPABASE_URL?: string; SUPABASE_SECRET_KEY?: string; SUPABASE_API_SCHEMA?: string; EMAIL_DELIVERY_ENABLED?: string; EMAIL_PROVIDER?: string; RESEND_API_KEY?: string; MAILPIT_URL?: string; EMAIL_FROM?: string; APP_ORIGIN?: string }`, and `export function deliveryFromEnv(env: EmailEnv): DrainOptions | null`. It returns null when the URL or secret key is missing. When delivery isn't enabled it returns options with `provider: null`.
- Produces in `drain.ts`:
  - `export interface DrainOptions { db: SupabaseClient /* schema SUPABASE_API_SCHEMA ?? "api" */; admin: SupabaseClient["auth"]["admin"]; provider: Provider | null; from: string; appOrigin: string; holder?: string; sleep?: (ms: number) => Promise<void> }`
  - `export async function drainEmail(o: DrainOptions): Promise<{ leased: boolean; sent: number; retried: number; ended: number; skipped: number }>`
- Behavior, one pass:
  1. `claim_email_jobs(holder, 5)`. Return early if not leased.
  2. If `provider` is null, call `disable_due_emails` and finish.
  3. For each job, sequentially:
     - Look up the recipient with `admin.getUserById(userId)`. No user, or `email_confirmed_at` null → `finish(recipient_missing)`.
     - Build the payload `{to, from, subject, text, html}` with `link = appOrigin + "/s/" + slug`.
     - Call `begin_email_attempt` with the payload. On `go:false`, continue.
     - `sleep(waitMs)`.
     - `provider.send({...frozen payload, idempotencyKey})`, always sending the frozen payload returned by begin, never a freshly rendered one.
     - `finish_email_attempt` with the mapped outcome.
  4. Always call `release_email_sender` in `finally`.
- Never log addresses, bodies or provider responses. Only `console.info` with counts.
- `from` defaults to `"RallyPoint <no-reply@auth.wndrhive.com>"`.

- [ ] **Step 1: Write the failing tests** in `tests/email-drain.test.mjs`, using a recording stub provider (`{ calls: [], next: [] }`) and `sleep: async () => {}`.
  - `"a confirmed join becomes Sent to email service with one call"`: one call; `to` is the primary's email; the subject is "Your RallyPoint place"; the job is `sent` with `provider_id` stored and `payload` null.
  - `"a crash after acceptance replays the same key and payload"`:
    - Simulate a run that died after sending. The test itself calls `claim_email_jobs`, then `begin_email_attempt`, records that it "sent", and never calls `finish`.
    - Set the job's `lease_until` and the sender lease into the past.
    - A normal `drainEmail` run then returns the job to `queued`, re-claims it, and sends the identical `idempotencyKey` and byte-identical frozen payload. The job ends `sent` with `attempts = 2`.
  - `"a timeout leaves the job Not confirmed if it never resolves"`: three ambiguous attempts (advance `next_attempt_at` by SQL between drains) give `not_confirmed` and exactly 3 calls.
  - `"a permanent rejection stops at once"`: 1 call, `not_sent` / `rejected`.
  - `"budget exhaustion makes no provider call"`: with the daily budget preset to 50, 0 calls and the job is `queued` / `daily_limit`.
  - `"overlapping drains send once"`: start two `drainEmail` calls concurrently with different holders. The total provider calls equal the number of queued jobs (≤ 5), and no job is attempted twice.
  - `"an account without a verified email is Not sent"`: an unconfirmed user gives `not_sent` / `no_verified_email` and no call.
  - `"no email body contains another participant, a payment reference or a note"`: after a session with two parties, a payment note and payment instructions, every recorded call's `text` and `html` excludes the other party's name, the reference and the instruction text.
  - `"delivery off ends due jobs without calling a provider"`: `provider: null` gives `not_sent` / `delivery_disabled`.
  - `"the local inbox receives a message"`: with `mailpitProvider({ baseUrl: "http://127.0.0.1:54324" })`, a join leads to `GET http://127.0.0.1:54324/api/v1/messages` listing a message to the primary with the subject "Your RallyPoint place". Delete it with `DELETE /api/v1/messages`, by ID only.
- [ ] **Step 2: Run** `RALLYPOINT_TEST_URL=http://127.0.0.1:3101 node --test --test-concurrency=1 tests/email-drain.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** `drain.ts` and `client.ts`. `deliveryFromEnv` chooses the provider:
  - `EMAIL_PROVIDER="resend"` with `RESEND_API_KEY` → `resendProvider`;
  - `"mailpit"` with `MAILPIT_URL` → `mailpitProvider`;
  - anything else → `provider: null`.
- [ ] **Step 4: Run** the Step 2 command, plus `node --test tests/email-render-domain.test.mjs`, `pnpm lint` and `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit**: `git add packages/email/src/drain.ts packages/email/src/client.ts tests/email-drain.test.mjs && git commit -m "Drain the email outbox one message at a time within the ceilings"`

### Task 5: Every-minute schedule in the Worker

**Files:**
- Create: `apps/web/worker.ts`
- Modify: `apps/web/wrangler.jsonc` (`"main": "worker.ts"`, `"triggers": { "crons": ["* * * * *"] }`), `apps/web/package.json` (add `"@rallypoint/email": "workspace:*"`), `apps/web/tsconfig.json` only if `worker.ts` needs including
- Do **not** modify `apps/web/wrangler.staging.jsonc`. Enabling the staging cron and secrets is P-12.
- Test: `tests/deployment-config.test.mjs` (add assertions)

**Interfaces:**
- Consumes: `deliveryFromEnv` and `drainEmail` from `@rallypoint/email/client` and `@rallypoint/email/drain`.
- Produces: `export default { fetch: handler.fetch, async scheduled(_c: ScheduledController, env: EmailEnv, ctx: ExecutionContext) { … } }`. It imports `handler` from `./.open-next/worker.js` as the OpenNext custom-Worker guide shows, and calls `ctx.waitUntil(run())`. `run()` calls `deliveryFromEnv(env)` and, if that is non-null, `drainEmail(options)`. Errors are caught and only a safe line is logged.

- [ ] **Step 1: Write the failing assertions** in `tests/deployment-config.test.mjs`:
  - `"local Worker runs the email drain every minute"`: `apps/web/wrangler.jsonc` parses (strip comments as that test already does) with `main === "worker.ts"` and `triggers.crons` deep-equal to `["* * * * *"]`.
  - `"staging gets no cron or delivery until P-12"`: `wrangler.staging.jsonc` has no `triggers`, and its `vars` has no `EMAIL_DELIVERY_ENABLED`.
- [ ] **Step 2: Run** `node --test tests/deployment-config.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** `worker.ts` and the config changes. Add `EMAIL_DELIVERY_ENABLED`, `EMAIL_PROVIDER`, `MAILPIT_URL` and `APP_ORIGIN` to `apps/web/.env.example` with local values `false`, `mailpit`, `http://127.0.0.1:54324` and `http://127.0.0.1:3000`. Never add a key.
- [ ] **Step 4: Verify in the real local Worker runtime:**
  1. `pnpm --filter @rallypoint/web build:cloudflare`.
  2. `pnpm --filter @rallypoint/web exec wrangler dev --test-scheduled --port 8788 --var EMAIL_DELIVERY_ENABLED:true --var EMAIL_PROVIDER:mailpit --var MAILPIT_URL:http://127.0.0.1:54324` (background).
  3. Join a session through the API on 8788.
  4. `curl "http://127.0.0.1:8788/__scheduled?cron=*+*+*+*+*"`.
  5. Expect the Mailpit API to list the message and the job to be `sent`.

  Record the command output in the task report. Don't use port 3000 or 3100.
- [ ] **Step 5: Run** `node --test tests/deployment-config.test.mjs && pnpm check`. Expected: PASS.
- [ ] **Step 6: Commit**: `git add apps/web/worker.ts apps/web/wrangler.jsonc apps/web/package.json apps/web/.env.example pnpm-lock.yaml tests/deployment-config.test.mjs && git commit -m "Run the email drain from an every-minute Worker cron"`

### Task 6: Organizer email status and docs

**Files:**
- Create: `supabase/migrations/20261023142000_email_status_view.sql`
- Modify: `packages/domain/src/registration.ts` (types), `packages/domain/src/game-day.ts` (`emailWords`), `apps/web/src/game-day.tsx` (`PartyDetails`), `apps/web/src/session-pages.tsx` (cancelled-session manager note), `README.md` (a new "Session emails" section), `PRD.md` (RP-12 "Implemented for review" note)
- Test: `tests/email-outbox.test.mjs` (add view tests), `tests/game-day-domain.test.mjs` (add helper tests)

**Interfaces:**
- Wrap `app.registration_view` again: rename the current one to `app.registration_view_before_email_status`, keeping its signature, volatility and grants.
  - For managers only, add to each roster entry `emails: Array<{ kind: EmailKind; status: "queued" | "sent" | "not_confirmed" | "not_sent"; reason: string | null; attempts: number; at: string }>`. That is the latest job per kind for that party's primary in this session.
  - `status` maps `queued` and `sending` to `"queued"`.
  - Add a top-level `emailSummary: { suppressed: Array<{ kind: EmailKind; reason: "audience_limit"; recipients: number; at: string }>; cancellation: { queued: number; sent: number; notConfirmed: number; notSent: number } | null }`.
  - Non-managers get neither key.
- In `packages/domain/src/game-day.ts`, produce `export function emailWords(e: { status: string; reason: string | null; kind: string }): string`:

  | Status | Words |
  | --- | --- |
  | `queued` | "Queued" |
  | `queued` with reason `daily_limit` or `monthly_limit` | "Queued · daily email limit" (or "monthly email limit") |
  | `sent` | "Sent to email service" |
  | `not_confirmed` | "Not confirmed" |
  | `not_sent` | "Not sent · {reason words}" |

  Reason words: `superseded` "no longer applies", `expired` "too late", `rejected` "email service refused it", `attempts_exhausted` "email service didn’t accept it", `delivery_disabled` "email is off", `queue_capacity` "too many emails waiting", `no_verified_email` "no verified email", `destination_changed` "email address changed".

  Kind labels for the line prefix: "Booking", "Waitlist", "Moved up", "Spot released", "Cancellation", "Payment details", "Reminder".

- [ ] **Step 1: Write the failing tests.**
  - View: an organizer sees `emails[0]` with `{kind:"joined_confirmed", status:"queued"}` for a fresh join. A confirmed participant's view has no `emails` key anywhere, and no email address appears in either view's JSON.
  - After a suppressed 51-recipient cancellation, the organizer's `emailSummary.suppressed[0].reason` is `"audience_limit"`.
  - Domain: `emailWords` returns each mapping above exactly.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** the migration, the types and `emailWords`. In `PartyDetails`, add a quiet "Emails" list with one line per entry: "{kind label}: {emailWords}". The cancelled-session manager note gets one line, "Cancellation emails: {sent} sent to email service · {queued} queued · {notConfirmed} not confirmed · {notSent} not sent", omitting zero counts. When the update was suppressed, it says instead: "Cancellation emails weren’t sent: more than 50 people."
- [ ] **Step 4: Docs.**
  - README "Session emails" covers:
    - what is sent and to whom, the four status words, and the ceilings;
    - that delivery is off unless enabled;
    - local use with Mailpit at `http://127.0.0.1:54324`;
    - the Worker-runtime check command from Task 5;
    - that bounces are visible only in the Resend dashboard;
    - that live sending is P-12.
  - PRD RP-12 gets an "Implemented for review, {date}" note with the branch and this plan link. It records implementation, not acceptance.
- [ ] **Step 5: Run** `pnpm check && pnpm db:lint && RALLYPOINT_TEST_URL=http://127.0.0.1:3101 node --test --test-concurrency=1 tests/*.test.mjs`. Expected: PASS. Then do a browser check at 375 px with synthetic data:
  - a game-day party's details show its email lines;
  - a cancelled session shows the summary;
  - nothing shows an email address.

  Delete the synthetic data afterwards.
- [ ] **Step 6: Commit**: `git add supabase/migrations/20261023142000_email_status_view.sql packages/domain/src/registration.ts packages/domain/src/game-day.ts apps/web/src/game-day.tsx apps/web/src/session-pages.tsx tests/email-outbox.test.mjs tests/game-day-domain.test.mjs README.md PRD.md && git commit -m "Show organizers truthful email status and document session emails"`

## Builder's calls (owner: please check)

- **Recipient addresses come from the Supabase Auth admin API at each attempt.** The database's server role can't read `auth.users` (checked: permission denied), so a definer function would be the only alternative. Unverified addresses aren't sent.
- **Release and payment-instructions emails (D-18) are in scope** although WDL-379 predates them, because D-18 says P-06 sends them. Release expires like a promotion; an instructions change expires like a cancellation. Unsent instruction changes for the same person are combined.
- **The cron is added only to the local Worker config.** Staging keeps no cron and no delivery until P-12. Vercel, the primary staging host, can't run an every-minute schedule on its free plan, so the drain runs on the Cloudflare Worker, which reads the same database.
- **Local email goes to the existing Mailpit inbox through its send API.** Live email uses Resend. Both sit behind one `Provider` interface, and tests use a stub for failures.
- **A new `packages/email` package** holds rendering, the providers and the drain. It uses `.ts` imports, so tests can run the real drain directly.
- **The email copy** in Task 2's table, and **the organizer reason words** in Task 6.
- **When delivery is off,** the schedule marks due jobs **Not sent · email is off** rather than holding them.
