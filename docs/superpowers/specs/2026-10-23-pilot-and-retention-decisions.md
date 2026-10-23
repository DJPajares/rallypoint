# A small, owner-run pilot (D-08 / D-09)

Date: 2026-10-23, Asia/Singapore. [P-13 / WDL-388](https://linear.app/wwonderland/issue/WDL-388). Inspected main: `0cbe1e0`.

**Status:** the owner accepted the pilot limits and owner-run approach below in chat. This short brief records those choices and proposes the remaining operating details for final owner review. It is a policy decision, not an implemented backup/deletion system or permission to launch with real data.

## Keep the pilot small

The owner approved **up to 3 groups, 30 seats per session (guests count), 100 RallyPoint accounts, and $0 in new monthly service spending**. Chat evidence: the owner answered “Use those starting limits”, then selected “Owner-run pilot (Recommended)” for the backup/retention proposal.

These are operating limits for the first pilot, not permanent product limits or new application caps implemented here. Count all participating groups together, including sessions on both deployed hosts. Use the existing app, shared wProject and hosting; add no monitoring, backup or workflow service.

Proposed D-08 details:

- Darwin Jason Pajares owns pilot admissions, support, backup, cleanup and the weekly usage check. Pause new admissions when any agreed limit or shared-provider headroom is exhausted; do not upgrade automatically. Existing commitments still need an orderly outcome.
- Check one physical iPhone with current stable Safari and one Android phone with current stable Chrome, in the browser and installed PWA. Check desktop Chrome/Safari with a keyboard. Record actual device/OS/browser versions during P-08; support outside this matrix remains unverified.
- Target WCAG 2.2 AA for the core create/share/join/waitlist/withdraw/payment-record/check-in loop. Check labels, errors, keyboard/focus, readable contrast, non-color status and reduced motion. This names a target, not a compliance claim. Normal core actions should resolve within 3 seconds on the test network; interrupted actions must remain recoverable instead of showing invented success. No load-testing platform or uptime SLA.
- Review the pilot after four weeks. Manual operating limits do not claim automated enforcement or protection against arbitrary public traffic. The existing staging sign-in only accepts existing shared Auth accounts; wider onboarding needs a separate reviewed change.

## Current provider boundaries

Checked against official sources on 2026-10-23. Published allowances are shared with other apps; none is reserved for RallyPoint. Actual remaining usage and Resend plan must be checked before real sends/admissions, then weekly.

| Provider | Relevant published allowance / constraint |
| --- | --- |
| [Supabase Free](https://supabase.com/pricing) | 500 MB database, 1 GB files, 5 GB egress, 50,000 monthly active users; two active free projects and pausing after a week of inactivity. Existing wProject and rsvply are active. No new project is proposed. |
| [Vercel Hobby](https://vercel.com/docs/plans/hobby) | Read-only team API confirms Hobby. Published allowances include 100 GB transfer, 1 million function invocations and 4 CPU-hours. Personal, non-commercial use only: the owner must confirm the actual pilot qualifies before using this host for real groups. A commercial launch needs a separate eligible-host/budget decision. Do not switch hosts here. |
| [Cloudflare Workers Free](https://developers.cloudflare.com/workers/platform/pricing/) | 100,000 requests/day and 10 ms CPU/invocation. Keep the existing deployment; its account plan, shared headroom and scheduler runtime fit still need verification before relying on it. |
| [Resend Free](https://resend.com/pricing) | Published 100 emails/day and 3,000/month. Auth codes, Trove and RallyPoint share the account. Keep D-05's existing RallyPoint ceilings: 50 attempts/UTC day, 1,500/month, bulk audience 50, active queue 500. These do not guarantee room for other apps or email receipt. |

No billing setting, sender, scheduler or P-06 implementation is changed by this task. Existing notification limits can mean email is deferred or not sent even inside the pilot size. The session page remains authoritative.

## One practical backup routine

**Owner-selected:** manual encrypted backups on days with changes and before migrations; keep them for **30 days**. Proposed operating detail: take one at the end of each active pilot day and immediately before every database migration or destructive cleanup. Keep an encrypted working copy and one encrypted copy off the app/provider, using an owner-controlled existing device/storage location. No new subscription. Remove expired copies, versions and trash when making the next backup.

Use one **wProject database recovery bundle**, including the Auth identities/dependencies needed by its app records, schema/roles/data, plus a separate copy of **RallyPoint's private uploaded files** and their object paths. A database export alone is not a Storage-file backup. This shared database snapshot necessarily includes other wProject app data; keep it encrypted and owner-only. It is not a claim that other apps' uploaded files are backed up. Preserve deployment/migration versions and keep secret configuration in the owner's secure credential store, outside Git/chat.

Supabase Free does not include the paid plans' automatic daily backup service; its guidance recommends regular exports. Default CLI dumps omit data/custom roles and managed schemas unless handled explicitly. Follow the current provider workflow and verify the bundle's Auth/dependency coverage; no one-line dump is assumed complete. [Backup limits](https://supabase.com/docs/guides/platform/backups), [CLI recovery guidance](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

Before real pilot data: name the owner-controlled backup locations, complete a synthetic restore rehearsal into a disposable local environment, verify sign-in identity links, both RallyPoint schemas, roles/fees/history and a private file. Record the result. Target at most one active day's lost changes and recovery by the next working day; these depend on the manual routine, not provider guarantees.

A RallyPoint defect gets a reviewed namespaced repair, not a whole-project restore over Trove. Test recovery in isolation first; any shared-project disaster recovery needs separate owner approval and coordination. Keep outbound delivery disabled during recovery, reapply completed deletions before reopening restored data, and do not blindly replay old queues. No live export or restore is performed by P-13.

## Simple retention rules

**Owner-selected:** session/payment/attendance history for **12 months**, backups for **30 days**, and RallyPoint-only deletion requests handled within **30 days**, preserving the shared Trove login. Proposed details:

| Record | Keep / remove |
| --- | --- |
| Active profile, preferences and earned-summary data | While the RallyPoint account is active. On deletion, remove profile/contact overrides, photos, preferences and selected titles within 30 days. Do not preserve a deleted person's badge profile. |
| Sessions, registrations/guests, fees/paid markers, attendance and correction history | 12 months after the session ends or is cancelled, then purge. Remove expired private QR/instruction files with their session. Retain the facts needed for reconciliation, not unnecessary personal notes. |
| Receipts, consent, source signals and delivery deduplication | Keep with their related session/history so cleanup cannot recreate an operation or resend an old update. Remove addresses/frozen message content and routine delivery diagnostics after 30 days once terminal; preserve only the minimum non-content status/deduplication evidence until session expiry. |
| Future reports | Collect none in this pilot. Proposed later default: 90 days after closure; decide D-07 access and any actual reporting obligations before enabling collection. |
| Backup copies | Maximum 30 days, including extra copies/versions/trash. A completed-deletion list stays privately available through the affected backup window, then expires with it. Reapply it before a restore is exposed. |

On an account-deletion request, first resolve active bookings and group ownership through reviewed existing rules; deletion does not silently waive fees, refund money or abandon future sessions. Remove RallyPoint access and identifying snapshots; retain only the minimum de-identified transaction facts until the above deadline, using “Former member” where attribution is no longer retained. An internal ID that still links to shared Auth is **pseudonymous, not anonymous**: the cleanup design must remove that link before claiming anonymization. Never delete/ban a shared Auth user or globally revoke Trove sessions as a RallyPoint cleanup shortcut.

For a group-deletion request, resolve/cancel its future sessions under existing rules and close it to new bookings; retain only the prior history until its 12-month deadline, then remove the group. This does not add a group-deletion feature here.

The owner handles requests and monthly retention cleanup. Current schemas require Auth references, badges derive from attendance, and no complete deletion/retention tool exists. A reviewed follow-on procedure must resolve those dependencies, preserve active users' earned summaries without keeping raw history forever, and prove that deleted data cannot reappear through Auth fallbacks or old backups. This brief neither implements that procedure nor authorizes destructive SQL. Before the first real pilot, verify a working owner-operated deletion path on synthetic data; otherwise stay synthetic-only. An unresolved dispute needs an explicit, documented owner decision before expiry, never silent indefinite retention. No legal/compliance or accounting-retention claim is made.

## Decisions and evidence still needed

The final owner review covers the proposed device/accessibility/performance targets and detailed recovery/retention rules. Real-pilot readiness additionally needs the Hobby-use eligibility decision, current shared usage headroom, backup locations and successful restore/deletion exercises. Those are operational evidence, not facts created by approving this document. P-08 records actual device/loop evidence; P-13 does not unpause P-06 or start new implementation tasks.

Alternative considered: stay synthetic-only until funded managed backups are available. The owner chose the small owner-run pilot; managed backup services, new schedulers and a cleanup framework are unnecessary for this decision task. [Accessibility target reference](https://www.w3.org/TR/WCAG22/).
