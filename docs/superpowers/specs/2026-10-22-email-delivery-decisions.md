# Session email delivery decisions (D-05)

Date: 2026-10-22. Task: [WDL-385](https://linear.app/wwonderland/issue/WDL-385). Baseline: `0708533bf750fefdee8e6e48c30b7156f35974c0`.

**Decision status: accepted, 2026-10-22.** The owner first requested “use my current trove setup for this” for the sender, then replied “Approved” to the remaining proposed defaults and draft PR #18. The recipient/timing, scheduler, send/retry ceilings, overflow and failure-visibility policies below are accepted. Alternatives are retained for context and are not selected. This approves the decision brief; implementation selection, live setup, spending, merge and deployment retain their own authorization boundaries.

## Reuse the existing sender

Trove's [tracked email rollout guide](https://github.com/DJPajares/trove/blob/256855034afcc6d41b06bb3ba0143a6051e2c46a/docs/auth/email-auth-rollout.md) records Resend on `auth.wndrhive.com`, with `wndrhive <no-reply@auth.wndrhive.com>` configured as shared Supabase Auth SMTP. No Resend credential is stored in Trove's application configuration. This establishes documented configuration, not live domain-verification, account-plan or deliverability evidence.

Use `RallyPoint <no-reply@auth.wndrhive.com>` for session notifications, using the same Resend account/domain via its HTTPS email API. P-12 should configure a separate sending-only credential restricted to that domain, in supported server secret storage. Do not copy or expose Trove's SMTP credential, change its shared Auth templates/settings, or move RallyPoint's database/Auth into Trove's project. Keep open/click tracking disabled. There is no new domain, mailbox or provider purchase in this decision.

A separate credential improves attribution/revocation but creates no separate sending quota or reputation. Alternatives: reuse the SMTP credential (unnecessary coupling), or verify a new notification subdomain (additional setup the owner did not request). [Resend domain requirements](https://resend.com/docs/dashboard/domains/introduction), [key isolation/restriction](https://resend.com/docs/dashboard/api-keys/introduction).

## Recipients and timing — accepted

| Update | Recipient rule |
| --- | --- |
| Confirmed/waitlisted join | The party's primary verified account, with the committed outcome. A replay creates no second email. |
| Promotion | The primary account of the promoted whole party, once for that promotion. |
| Cancellation | Deduplicated primary accounts that were confirmed/waitlisted when cancelled, plus those whose retained unpaid fee/claim is ended by that cancellation. Capture that audience durably; already-withdrawn parties with no affected unpaid liability receive no cancellation update. |
| Reminder | The primary account of a party confirmed at or before `start − 24h`, still confirmed and authorized when dispatched. No waitlisted/withdrawn party, guest or organizer-only copy. An organizer receives it only if independently registered. |
| Material change | Only changes subsequently accepted/implemented through P-11; none while booked details remain locked. |

One reminder per session/account. No catch-up for a confirmation/promotion after the reminder time. A one-minute sweep may dispatch during the 15 minutes following the due time; afterward skip it rather than send a late reminder. This is an attempt window, not an exact inbox-arrival promise. Registration/session clocks remain authoritative.

If P-11 later permits changing start times: move an unattempted reminder to the new due time; if that time has passed, skip it. Once a reminder was submitted or its submission became ambiguous, do not send another for a new start time. Do not implement rescheduling in P-06 ahead of P-11.

Before every provider attempt, recheck current identity/destination, access, session state and party state. Suppress superseded confirmations/promotions and all reminders on cancellation/withdrawal. Freeze destination/body/key on the first attempt; a changed destination or superseding event suppresses the old job instead of mutating its retry payload. Cancellation wins over pending join/promotion messages. The atomic eligibility check/claim defines dispatch eligibility; a later cancellation can race an in-flight send. Such a message cannot be recalled reliably, so include a link to authoritative current status. Suppression after an ambiguous attempt remains Not confirmed, not Not sent.

Subjects/preheaders are generic. Bodies identify the person's own status and link back to the session; exclude other participants, contacts, attendance, payment details and any private-event preview details. Guests need no email address. Alternative reminder audiences (waitlist, all members, guests or hosts) add noise/disclosure without a confirmed place; do not include them.

## Scheduler — accepted

Use one Cloudflare Cron Trigger every minute on the existing deployment, using OpenNext's documented custom Worker: delegate `fetch` to the generated handler and add `scheduled` for a bounded outbox drain. The scheduled path calls the shared server delivery adapter directly, not a public HTTP endpoint or a Next-rendered page. Postgres persists and leases work; a trigger is only a wake-up and never the record of delivery. Duplicate/overlapping sweeps must be harmless.

| Option | Assessment |
| --- | --- |
| Cloudflare Cron + custom OpenNext Worker | Selected: same deployment and server secrets; documented adapter extension, no extra service. |
| Supabase `pg_cron` + `pg_net`/function | Viable alternative, but adds database network scheduling and secret/runtime management; inactive database pauses still affect it. |
| `pg_cron` calling an app endpoint | Adds a scheduler credential, an HTTP entry point and another failure boundary for the same work. |

Current repo: Next `16.4.2`, OpenNext `1.20.13`, Wrangler `4.151.3`; Wrangler currently points straight at `.open-next/worker.js` and defines no Cron Trigger. The current adapter guide explicitly documents adding `scheduled` via a custom entry point. This is documentation compatibility evidence, not a tested new handler. [OpenNext custom Worker](https://opennext.js.org/cloudflare/howtos/custom-worker), [Cloudflare Cron](https://developers.cloudflare.com/workers/configuration/cron-triggers/), [Supabase Cron](https://supabase.com/docs/guides/cron).

Cloudflare currently lists 100,000 free daily requests, five Cron Triggers/account and **10 ms CPU per free scheduled invocation**. A minute sweep is 1,440 invocations/day (calculated); it shares account capacity with the app. Five small jobs is an initial maximum, not proof of fitting the CPU budget. P-06 must test the handler locally; P-12 must measure the actual runtime and lower the batch if needed. No automatic paid-plan fallback. [Worker limits](https://developers.cloudflare.com/workers/platform/limits/).

## Limits and retry policy — accepted

| Control | Initial RallyPoint limit |
| --- | --- |
| Submission budget | 50 provider attempts/UTC day; 1,500 per UTC calendar month. Debit before each attempt, including retries and ambiguous calls; never refund an uncertain attempt. |
| Per invocation | At most five jobs; one sender lease and one in-flight provider request, with at least one second between request starts. |
| Bulk audience | At most 50 distinct recipients per session-wide update. Above this, terminally suppress the entire bulk update with visible `audience_limit` evidence; never send just the first 50. This limits email, not event capacity or cancellation. |
| Queue bound | At most 500 active recipient-delivery jobs, including leased/retrying jobs. A new delivery that would be job 501 is terminally suppressed with `queue_capacity` evidence on its source signal/session summary; never add it to a secondary pending list. Participation still commits. No automatic replay when capacity returns. |
| Per message | Three provider attempts total: first eligible attempt, then after 1 minute and after a further 5 minutes; respect a longer provider retry delay within the expiry. |
| Request timeout | 10 seconds; timeout is an unknown submission outcome, not proof of non-delivery. |
| Expiry | Reminder: due + 15 minutes. Join/promotion: earlier of session start or enqueue + 23 hours. Cancellation: enqueue + 23 hours. Never retry at/after expiry. |

These are accepted product operating ceilings, not provider guarantees or an accepted overall pilot size. Resend currently lists Free at 100/day and 3,000/month, counting recipients and received mail, with a default team-wide 10 requests/second limit. Trove and other keys/domains share the team pool. RallyPoint's caps leave nominal headroom but **cannot reserve capacity for Trove** or prove combined usage fits. Before enabling live sends, P-12 must check the actual account/plan, other applications' usage and acceptable combined budget; keep delivery disabled if shared headroom is not accepted. No plan upgrade or overage authorization follows from this brief. [Resend account limits](https://resend.com/docs/knowledge-base/account-quotas-and-limits), [pricing](https://resend.com/pricing).

Durable jobs deduplicate by logical update/account, with a stable provider idempotency key and immutable attempted payload. Retry only transient transport/5xx, rate-limit, or concurrent-idempotent conflicts. Permanent validation/auth/domain/payload-conflict failures stop and surface; do not generate a new key to escape a conflict. Daily/monthly quota errors open a sender circuit until the relevant reset/owner action, still bounded by each job's expiry. Budget deferrals for already-admitted jobs do not busy-loop or extend their original enqueue-based expiry. Bulk/queue-ceiling suppression happens before provider attempts and is terminal; it creates no held job outside the 500 active-job ceiling and no later catch-up. Preserve safe terminal evidence on the durable source signal/session summary rather than creating a hidden pending backlog. Missing or unparsable retry hints use the bounded backoff above. Resend's idempotency retention is 24 hours; the 23-hour outer bound leaves margin. Beyond that window, an ambiguous job stays unconfirmed and is not resent automatically. [Idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys), [error contract](https://resend.com/docs/api-reference/errors).

Use one recipient per `POST /emails`, no CC/BCC or provider-side scheduling. That keeps per-person outcomes and eligibility checks explicit. The public API discovery brief confirmed Bearer auth, `Idempotency-Key`, JSON `from/to/subject/text/html`, and a 200 response with provider `id`; it explicitly does not provide application quota enforcement. [Send Email](https://resend.com/docs/api-reference/emails/send-email).

## Failure visibility — accepted

Organizers/co-hosts see status only for their own sessions, using participant display names rather than contact addresses:

- **Queued**: no provider acceptance yet; include a plain waiting/limit reason when applicable.
- **Sent to email service**: provider accepted the request. Never label this Delivered or imply the person read it.
- **Not confirmed**: any earlier submission remains ambiguous after timeout/disconnection or unreconciled attempt exhaustion. A later auth/validation error, expiry, recipient change, withdrawal or cancellation cannot erase that ambiguity. Resolve it only when an idempotent replay establishes provider acceptance; otherwise stop retries when required and retain Not confirmed.
- **Not sent**: no prior ambiguous/accepted attempt exists, and there is a definite rejection, known-unsent expiry, disabled setup or terminal bulk/queue suppression; distinguish the reason. Budget/rate deferrals for admitted jobs remain Queued until expiry, then become Not sent only if never ambiguous.

Keep only safe reason codes, kind, attempt count, timestamps and provider ID where available; no tokens, raw provider bodies or mail contents in logs/organizer views. Persist retry payload privately only for its retry lifetime and purge it when no longer needed. Long-lived evidence retention remains D-09's separate pre-pilot decision.

Do not add a Resend webhook or full-access read key in the first increment: it could alter Trove's shared endpoint setup and broadens scope. Consequently, post-acceptance bounces/delivery delays remain visible in the existing Resend dashboard to its owner, **not in RallyPoint**. This is an explicit observability limit. Alternative: a separately reviewed shared webhook router can surface bounce states later. Even provider `delivered` only means the receiving mail server accepted it, not inbox placement or reading. [Resend event semantics](https://resend.com/docs/webhooks/event-types), [restricted-key limits](https://resend.com/docs/api-reference/errors).

## Implementation handoff and validation boundary

The owner accepted the recipient, ceiling/retry, scheduler and visibility policies on 2026-10-22. P-06's brief is refreshed to these choices. The D-05 policy question is resolved; PR #18 remains subject to the repository's human review/integration workflow, and P-06 may be selected as its own implementation task after that dependency is integrated. P-12 owns live domain/key verification, shared quota acceptance, runtime CPU evidence and authorized test recipients. Do not remove that live-setup gate. D-08/D-09 pilot and retention decisions retain their own boundaries.

P-06 should extend the existing transactional registration, promotion and cancellation signals into durable jobs; never call Resend inside seat/fee transactions. Verify duplicate processing, quota contention across workers, crash after provider acceptance, timeouts, permanent failures, expiry, stale access/state, reminder boundaries, cancellation fan-out and queue overflow against a service stand-in. A notification failure cannot undo a valid party, promotion, cancellation or fee result. Test the scheduled handler in the actual local Worker runtime. P-12 reports live evidence separately.

**Observed in this task:** current source/configuration and Trove's pinned rollout guide read; official documentation and public API discovery reviewed; decisions checked for conflicts with RP-12/D-05/D-10. Independent document review found ambiguous overflow handling and loss of prior submission ambiguity; both are now explicit above. No product code, migrations, provider settings or secret values changed; no email sent and no runtime delivery/CPU test claimed. After the owner's approval, the decision status and downstream P-06 brief were updated; local documentation link/placeholder checks and `git diff --check` passed. This internal decision change needs no product release note.
