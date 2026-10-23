# P-08 first-session verification — partial evidence

Date: 2026-10-23 (Asia/Singapore). Task: [WDL-381 / P-08](https://linear.app/wwonderland/issue/WDL-381/p-08-verify-the-complete-first-session-loop-in-the-mobile-pwa). Source: `d12d46d6bc94c24da86e64ec5f9c16223fa80152` (main after PR #30).

**P-08 is incomplete.** Local checks below passed; authenticated staging, live session email delivery and the accepted physical-device matrix still lack evidence. This report does not establish pilot readiness, WCAG compliance, a production launch or full-MVP completion. No product/UI change was needed for the checks performed.

## Environment and reproducibility

Node 24.16.0, pnpm 11.14.0, Next.js 16.4.2, Supabase CLI 2.121.0, PostgreSQL 17.11, Playwright-controlled Chrome 155.0.8059.86 on macOS. Phone-width viewport: 375 × 812; this is browser simulation, not Android/iOS.

The existing server at port 3000 was left alone. An initial regression run against a separate app at port 3108 passed 265 tests, but the reused local database contained another checkout's unmerged `20261023150000_my_sessions` migration. The setup helper correctly refused that mismatched migration history; it was not repaired or reset.

The authoritative repeat used a disposable private checkout of the exact source, Supabase project `rallypoint_p08`, API 54421, database 54422, local mail 54424, and app 3118. All 147 tracked product and migration files matched the branch byte for byte. Only private test-harness port/container references, local project identity and local Auth callback configuration were substituted. Dependencies were installed from the frozen lockfile. The clean database applied all 32 source migrations through `20261023144000_email_attempting_is_ambiguous`; no extra migration was present. No shared/cloud data was reset.

Commands used after the documented local setup, with the private port substitutions above:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm db:start
pnpm db:lint
RALLYPOINT_TEST_URL=http://127.0.0.1:3118 pnpm test:api
```

The first install/check ran in the isolated branch; the clean checkout also installed the same lockfile offline and built its own production artifact. Local credentials stayed in ignored files. These commands are local, not a shared-project migration procedure.

## Observed automated evidence

- `pnpm check`: lint, type checks and production build passed, exit 0.
- Clean-stack `pnpm db:lint`: no schema errors, exit 0.
- Clean-stack complete API suite: **265 passed, 0 failed, 0 skipped**, exit 0, 155.311 seconds. Reused-database results are not substituted for this clean repeat.
- Existing real-Auth/Postgres cases cover visitor/participant/organizer/co-host/unrelated-group boundaries, revoked roles and metadata spoofing, direct RPC/table denial, concurrent last-seat joins, strict party ordering, replay/recovery, opening/cutoff/start/end clock boundaries, fee/payment/attendance independence and cancellation rollback/history. See [tests](../../tests/) for the actual assertions.
- Email tests use recording provider stand-ins and a real local Mailpit sink. They cover durable outbox creation, confirmation/promotion/cancellation/reminder audiences and expiry, retries/ambiguity, idempotency, ceilings, disabled delivery, status/privacy and local inbox receipt. These are not Resend receipt or Cloudflare scheduler evidence.
- Postman unsaved local health request on `127.0.0.1:3108`: HTTP 200, one assertion passed, exit 0. No new collection, workspace or test framework was introduced.

## Integrated twelve-seat walkthrough

The organizer signed in with a real local email code, used the browser's session form/date controls to publish a 12-seat, guest-enabled session at SGD 12.50/seat, and used Copy link. A signed-out browser opened the actual shared URL: details/counts and sign-in appeared, with no private roster or manager controls.

Ten synthetic solo accounts joined through the real API. The member signed in through the shared page's return link and chose a guest in the browser. Consent showed SGD 25.00 for two seats. A browser network intercept allowed the POST to commit, then dropped its response. The page retained the entered guest and request key, disabled a different submission, and said the result was unconfirmed. **Check result** recovered the confirmed booking. A database check found exactly one member party; 12 seats were confirmed with one SGD 25.00 obligation.

A two-seat party and a later solo then waitlisted through the API. Withdrawing one confirmed solo left 11 seats occupied and both parties waiting. Withdrawing another promoted the two-seat head once: 12 seats occupied, the later solo still waiting. Database records corroborated those identities and states.

While offline, the member's **I've sent it** action showed an interrupted/unconfirmed request; it did not claim a payment or successful note. Back online, **Retry same request** saved the declaration while SGD 25.00 remained due.

The organizer's browser roster showed the declaration separately. Checking in the primary left the guest unrecorded and the fee unpaid. Checking in the guest and marking the party paid left two check-ins. Waiving another party's fee preserved the seat total. A database read confirmed 12 confirmed seats, two checked-in seats, one paid party and one waived fee. These are manual payment declarations, not bank verification.

The organizer saved payment instructions after booking and uploaded an existing app-icon PNG as a synthetic image fixture, not a real payment QR. The private image rendered. Blocking its download and reloading left the written instructions and an explicit image-unavailable fallback visible. No money was sent.

A separate API-created session had a paid two-seat party and an unpaid solo. Cancellation preserved the paid SGD 25.00 and both historical parties, and changed the unpaid liability to `removed_session_cancelled`. The one-off check initially expected the generic word `removed`; it was corrected to the existing contract's explicit state, then passed. No product fix was required.

Targeted keyboard checks: focus entered the join/party sheets; Escape closed the party sheet and returned focus to its row. The party flow ran with reduced motion. At 375 px the inspected join and party controls had no horizontal overflow. This is a targeted walkthrough, not a full accessibility audit. No physical-network performance claim is made. After organizer sign-out, the shared page showed no private instructions, manager payment controls or attendance panel, and the RallyPoint Auth storage key was absent. Desktop Tab navigation reached a visible control at 1280 × 800 without horizontal overflow. Cache Storage was empty and no service worker was registered in this test profile. Chromium installation diagnostics returned `in-incognito`, so this private automation profile cannot establish installability or installed/offline-shell behavior.

## Staging evidence and blocker

Read-only provider inspection resolved `rallypoint.wndrhive.com` to READY Vercel deployment `dpl_QvHGqnKJwr7SdqjrACHu972vuqJn`, Git source `d12d46d6bc94c24da86e64ec5f9c16223fa80152`, region `sin1`. The deployed application matches this local product baseline.

Postman checked the deployed health endpoint (HTTP 200, one assertion passed, exit 0) and signed-out workspace boundary (HTTP 401, one assertion passed, CLI exit 1 for the expected non-2xx response). The denial included `sign_in_required` and `no-store`. The live browser hydrated the existing-account email form. No live email was sent, shared identity created or authenticated live flow claimed.

The shared wProject database migration ledger still lists only the RallyPoint bootstrap and API-exposure migrations, alongside unrelated apps' migrations. Read-only schema inspection found no `rallypoint.session_change_signals`, `email_jobs`, `email_sender`, `email_budget` or `payment_notes` tables, and no `rallypoint_api.claim_email_jobs(uuid,integer)` or `begin_email_attempt(uuid,uuid,jsonb)` functions. This is concrete drift between deployed application and database, not a frontend redesign issue. Health/config success does not exercise these operations.

Current main contains 16 source migrations after the bootstrap's last source migration (`20261022170000_badges.sql`): currency/payment-mode/release/note/instruction changes, booked-session edits and email outbox/dispatch. Their mapped-schema upgrade must be reviewed against the actual cloud definitions, backed up and applied through a namespaced incremental migration before repeating the live loop. The bootstrap renderer explicitly refuses an existing installation; do not rerun it or use local `db push/reset/seed` against wProject. See [staging migration rules](../deployment/staging.md#database-setup-and-future-migrations).

This task did not apply cloud SQL, change shared Auth/Trove settings, enable a sender/scheduler, deploy, upgrade plans or change the other agent's P-14 work. Runtime sender credentials, shared quota/headroom and actual Cloudflare delivery remain unverified. A Vercel READY deployment does not establish that the separate Cloudflare scheduled Worker runs the current email code.

## Remaining completion evidence

| Required area                                | Current result / next evidence                                                                                                                                                                        |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local integrated loop and backend boundaries | Observed above; clean suite passes.                                                                                                                                                                   |
| Live authenticated loop                      | Blocked by staging schema drift; repeat after a reviewed upgrade.                                                                                                                                     |
| Live email                                   | Verify actual existing-account code receipt and transactional/reminder email delivery separately from stand-ins; record sender, host/version and inbox outcome without publishing codes or addresses. |
| Android/Chrome browser and installed PWA     | Owner can test Android/Chrome; actual OS/browser versions, install and outcomes not yet supplied.                                                                                                     |
| iPhone/Safari browser and installed PWA      | No device evidence available. Owner's Android-only availability does not change D-08's accepted support matrix.                                                                                       |
| Desktop keyboard                             | Chrome has targeted/partial coverage above; full core-loop keyboard/focus checks and desktop Safari remain unverified.                                                                                |
| Accessibility/performance                    | Complete the physical-device/core-loop checks; no WCAG or 3-second-budget claim from this limited browser walkthrough.                                                                                |

Once staging is ready, record these Android results with the exact OS and Chrome versions: open the custom domain, receive/verify an existing account's code, add/install RallyPoint from Chrome, reopen it standalone, join a synthetic session, go offline and attempt a mutation (must stay unconfirmed), reconnect/recover the same request, sign out/switch accounts and confirm private roster/fee/attendance data does not follow the old identity. Use only synthetic session data; do not put authentication codes in the report. Repeat the accepted matrix on iPhone/Safari when a device is available.

P-13's separate provider eligibility/headroom, backup locations and synthetic restore/deletion prerequisites remain before real pilot data. Existing Maps, embedded payments, profile editing, badge tiers and other backlog features are outside P-08; passing these checks does not imply they exist. Keep P-08 open until its missing evidence is recorded and accepted. This internal verification report needs no user-facing release note.

## Continued work: prepared staging upgrade, not yet applied

The owner asked to continue after the staging blocker was reported. The branch now adds an explicit `--upgrade` mode to the existing schema renderer, covering only the 16 reviewed source migrations after the original bootstrap through `20261023144000`. The two renderer safety tests failed before implementation and passed afterward; default initial-install behavior remains guarded, and invalid modes emit no SQL.

Read-only comparison found all **63 cloud RallyPoint function definitions exactly matched** the recreated old baseline. A local rehearsal populated that baseline with a draft, a booked guest party, a paid fee, check-in and audit/receipt history. An injected failure after the upgrade rolled back all function/schema/data changes. The successful upgrade preserved the existing records (the new `session_changes.material` field has its intended false default), and all **95 final mapped function definitions matched** the current full migration chain. Existing local `app/api` definitions were unchanged; a repeated upgrade and a missing-install rehearsal were refused atomically. All staging tables retained RLS, zero RPCs became browser-callable, and historical bookings created no email jobs.

Rendered SQL SHA-256: `281c7a3d1ae420bec74ca5000d64f19da14399d478e575e4bce827ab70b863da` (1,920 lines, 125,902 bytes). Reproduce with `node scripts/render-staging-schema.mjs --upgrade`; inspect the [upgrade/recovery instructions](../deployment/staging.md#upgrade-the-existing-2026-10-23-bootstrap). The script emits SQL only and does not connect or apply it.

**Recovery gate:** automatic approval review blocked the required recovery export; it was not retried or bypassed. No usable backup or cloud schema upgrade exists. Incomplete temporary exports were removed. The exact approval proposal is supplied privately to the owner; external review records retain technical results only. Live and device evidence remain pending.

Fresh continuation checks: `pnpm check` passed; `supabase db lint --local --schema rallypoint,rallypoint_api --fail-on error` found no schema errors. The complete clean local suite, including the new renderer checks, passed **267/267**, zero failed/skipped, in **155.932 seconds**. The earlier 265-test evidence remains the product baseline; the two additional tests cover safe upgrade rendering. These results still do not establish a cloud upgrade or physical-device/live-email success.

A further local catalog comparison found **371 mapped columns, constraints, indexes and triggers** identical to the complete migration baseline. Fresh read-only review found no actionable defect in the prepared upgrade path. The SQL guard checks known sentinel objects rather than every possible drift; the documented pre-apply definition comparison remains mandatory. The reviewer did not independently verify cloud state, a backup/restore, a live upgrade, live email or physical devices; none is claimed here.
