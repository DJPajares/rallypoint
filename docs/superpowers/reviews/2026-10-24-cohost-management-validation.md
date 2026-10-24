# P-15 co-host management — review evidence

Date: 2026-10-24, Asia/Singapore. Task: [WDL-390](https://linear.app/wwonderland/issue/WDL-390).
Fresh review covered `814629b`, including `origin/main` at `0db3fdd`.
The verified review-fix code is `522e20d`; documentation updates follow it. Branch:
`djpajares/wdl-390-p-15-let-a-group-owner-make-someone-a-co-host`.
No release version is assigned. This is implementation and local validation,
not human acceptance, merge or deployment.

## User note

Group owners can make a past session registrant a co-host and remove that access
when it is no longer needed. Session registrations, fees and attendance stay intact.

## Result and scope

The owner-only **Co-hosts** page lists current co-hosts and account holders who
registered for this group's sessions, with current display names and profile
links. Candidate reads are paginated at 50. Inviting people, ordinary membership
entry, ownership transfer and changing an existing organizer/owner are excluded.
The group page retains the newly merged **Edit group** action and shows the
acting role.

The transactional SQL functions recheck current owner authority under the group
lock. Grants/removals commit with actor/target/before/after/time audit and an
actor-scoped receipt. Removal restores previous ordinary membership or removes
the role if there was none. Legacy co-hosts without recorded membership return
to no role. Reads, writes and receipts enforce current permissions; old grant
replays return current state without restoring access. An owner can still
administer access to a removed group's retained session history.

## Environment

- macOS local worktree; Node 24.16.0, pnpm 12.15.0, Next.js 16.4.2,
  Prisma 7.10.1 and Supabase CLI 2.121.0; existing dependency pins retained.
- Existing loopback synthetic Supabase Postgres/Auth/Storage/mail services.
  Real accounts, groups, addresses and provider secrets were not used as test data.
- Initial API/browser checks used Next development on `127.0.0.1:3015`.
  Final full suite and integration smoke used the production build on that port.
  The existing app on port 3000 was left alone.
- Local SQL was ultimately applied with `pnpm db:migrate:local`, through the
  migration runner newly adopted on `main`. It applied
  `20261024121000_cohost_management` and then the additive
  `20261024135449_cohost_recovery`; no hosted command was run.

## Observed checks

| Check | Result and coverage |
| --- | --- |
| Pre-change `pnpm test:api` | 314/314 passed on the original `55b8c36` baseline; historical baseline only |
| Initial P-15 RED run | All 7 new tests failed on absent routes/functions before implementation |
| Focused P-15/identity/Prisma checks | 22/22 passed before integrating newer `main` |
| Final `pnpm check` | Passed workspace lint/type checks and production build; 6/6 build tasks successful |
| Before-review full suite | 344/344 passed on the integrated branch |
| Final `RALLYPOINT_TEST_URL=http://127.0.0.1:3015 pnpm test:api` | 345/345 passed, 0 skipped, approximately 213 seconds, against the production build and both final migrations |
| Final `pnpm db:lint` | No schema errors |
| Final `pnpm db:validate` | Prisma schema valid |
| `pnpm db:migrate:local` | Applied both P-15 migrations through Prisma; existing migration entries retained |
| Clean migration replay | All 45 source migrations applied to a disposable local database, then Prisma owner bootstrap/read and non-owner denial passed; temporary database removed |
| Formatting and patch checks | Changed TypeScript/test files passed Prettier checks; `git diff --check` passed |

The full suite includes nine P-15 integration tests covering owner-only
reads/writes, signed-out and cross-role denial, metadata spoofing, direct RPC and
table denial, group isolation, current/historical eligibility, existing co-hosts,
last-owner/organizer protection, membership restoration, preserved participation
and payment state, audit identity/time, concurrent retries, stale revisions,
receipt recovery (including deleted-draft GET/POST replay), old-grant replay, removed-group revocation, and a manager write
waiting behind removal. Paging tests reach 53 distinct profile handles with
identical names and a changed profile name.

## Browser evidence

Observed using headed Chromium and synthetic identities:

- An owner sees the acting role and both **Edit group** and **Co-hosts**;
  a co-host can manage sessions but does not see role-assignment controls.
- Grant/removal updates the lists and announces/focuses the confirmed result.
  The removal dialog starts on Close, supports Escape and names the person and
  lost controls. Membership restoration is also checked in real API tests.
- A second identity gains manager access after the grant. After removal, a fresh
  request denies manager access while preserving its own waitlisted registration.
- Going offline before a write leaves an unconfirmed result, disables competing
  changes, keeps the submitted request, and offers **Check result** / **Retry
  same request**. An unresolved lookup returns 404; identical retry succeeds.
- A previous success status was reproduced during a later unconfirmed write,
  then fixed and the same browser scenario passed after loading the new module.
- An outside role change makes the displayed revision stale. The attempted write
  is refused; the retry control reloads the list without submitting another change.
- An injected API 503 read shows an error without cached candidate names;
  removing the injection and retrying loads the actual list.
- A real list with 54 candidates displays 50 then all 54 unique profile handles.
  Identical long names wrap within a 320px viewport. Empty groups show no
  fabricated candidates. No horizontal overflow at 320px, 390px or 1440px;
  reduced-motion emulation was exercised.

Local screenshots are under ignored `output/playwright/`, including
`p15-production-owner.png`, `p15-production-revoked.png`,
`p15-empty-phone.png`, `p15-recovery-phone.png` and
`p15-current-state-recovery.png`. They are local evidence,
not published artifacts or actual-device certification.

## Failures resolved and limitations

- The first race-fixture run timed out before its readiness marker; the isolated
  test and subsequent focused/full runs passed without a production lock change.
- Initial schema-only replay setup could not restore another provider role's
  default ACLs. Excluding those unrelated fixture ACLs let all application
  migrations and their actual grants run successfully in the temporary database.
- Integrating `main` revealed that a removed group hid co-host administration
  while retaining historical manager access. A new test failed with 403 before
  the owner projection was fixed, then passed in the final full suite.
- The build retains an existing render-purity lint warning in
  `apps/web/src/session-pages.tsx` (`Date.now` during render). No new lint errors.
  The pre-existing manifest/README pnpm engine-version discrepancy did not block
  frozen installation with the pinned pnpm 12.15.0 and was left outside this task.
- Browser probes intended to discard an already committed HTTP response failed
  in the CLI routing harness with “Route is already handled”; those probes do
  not count as passing evidence. Real API tests verify committed-receipt replay
  and current-state recovery; the browser verifies actual offline uncertainty.
- Actual phones, assistive technologies and live Google/provider integrations
  were not tested. Hosted migration, deployment and live recovery remain unverified.

## Review and implementation rulings

Fresh read-only review: Codex GPT-6.1-sol, high reasoning. The first reviewer
model hit its usage limit before doing review work. The replacement found two
Important issues, no Critical or Minor findings. The authorized single fix pass:

- Recovered UI feedback ignored returned access. Reproduced an old grant
  announcing Added while the current list was empty; fixed the callback to compare
  the submitted profile/action with the returned assigned list. Both inverses
  (grant then remove; remove then regrant) passed browser recovery checks.
- Main's draft-deletion receipt path bypassed role revocation. The new real API
  test failed with 200 instead of 403 before the additive recovery guard; after
  it, lookup and same-key POST replay are denied. Co-host/draft checks passed
  16/16 and the final full suite passed 345/345.

The fixes were verified by the author through these regressions and the full
suite; no second reviewer pass was dispatched. No deferred minors.
The reviewer set invitations/general membership/ownership transfer, live
operations and the existing dependency policy outside scope; those boundaries
remain unchanged. Historical access administration follows ruling 3 below.

1. Preserve the existing local services, newer history and occupied port 3000;
   use port 3015 and an independent clean replay. Risk: shared synthetic state
   could mask compatibility gaps; the separate clean replay addresses that limit.
2. Load further candidates with explicit bounded reads, resetting pages on a new
   root revision/identity. Tradeoff: refreshing reloads previously opened pages.
3. Keep owner role administration available for removed groups, because retained
   sessions keep manager permissions. Tradeoff: a retained management URL can
   deliberately grant/revoke historical access; it cannot restore the group or
   create new sessions.

## Migration and recovery

The migration is additive and ordered after the newly integrated main migrations.
Historical SQL is unchanged. SQL grants/RLS and transactional functions remain
authoritative; Prisma exposes only bound, allowlisted function calls.

Rolling back application code hides the new routes but retains current role
assignments and audit history. It does not revoke grants. Revoke unwanted access
through the owner flow before removing it, or use a separately reviewed operator
recovery. Do not drop real audit history as a code rollback. During local
development only, task-created fixtures and empty unrecorded probe objects were
removed before the final migration was applied through the adopted runner.
No unrelated data/history was reset. Hosted backups and recovery require their
own authorized verification.

## Human verification

1. With local services and the app running, create a group as a synthetic owner,
   publish a session and have another synthetic account register.
2. On the group, open **Co-hosts**, select that registrant and make them co-host.
   Their next group/roster request should expose normal co-host controls only
   for that group; their account cannot assign another co-host.
3. As owner remove the co-host, confirm the dialog, and retry a privileged action
   from their open page. It must be denied; their own registration remains.
4. Repeat with someone who was already a member, then with a nonmember.
   Removal restores only the earlier membership. Try a stale list or offline
   submission: no unconfirmed success or automatic new request should be shown.

These steps are for review. Passing local checks does not mark WDL-390 Done;
human review and integration remain outstanding.
