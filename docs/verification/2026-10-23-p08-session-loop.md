# P-08 first-session verification — partial evidence

Date: 2026-10-23 (Asia/Singapore). Task: [WDL-381 / P-08](https://linear.app/wwonderland/issue/WDL-381/p-08-verify-the-complete-first-session-loop-in-the-mobile-pwa). Source: `d12d46d6bc94c24da86e64ec5f9c16223fa80152` (main after PR #30).

**P-08 is incomplete.** Local and live RPC checks below passed. On 2026-10-24 the owner reported that the Android/Chrome, installed-PWA, sign-in and inbox checklist worked. That is owner-reported evidence; exact device/browser versions, individual notification types and the remaining accepted device/accessibility/performance checks are not yet recorded. This report does not establish pilot readiness, WCAG compliance, a production launch or full-MVP completion. The latest continuation fixes one number-control accessibility reference; the visible layout is unchanged.

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

## Initial staging evidence and blocker (2026-10-23)

Read-only provider inspection resolved `rallypoint.wndrhive.com` to READY Vercel deployment `dpl_QvHGqnKJwr7SdqjrACHu972vuqJn`, Git source `d12d46d6bc94c24da86e64ec5f9c16223fa80152`, region `sin1`. The deployed application matches this local product baseline.

Postman checked the deployed health endpoint (HTTP 200, one assertion passed, exit 0) and signed-out workspace boundary (HTTP 401, one assertion passed, CLI exit 1 for the expected non-2xx response). The denial included `sign_in_required` and `no-store`. The live browser hydrated the existing-account email form. No live email was sent, shared identity created or authenticated live flow claimed.

The shared wProject database migration ledger still lists only the RallyPoint bootstrap and API-exposure migrations, alongside unrelated apps' migrations. Read-only schema inspection found no `rallypoint.session_change_signals`, `email_jobs`, `email_sender`, `email_budget` or `payment_notes` tables, and no `rallypoint_api.claim_email_jobs(uuid,integer)` or `begin_email_attempt(uuid,uuid,jsonb)` functions. This is concrete drift between deployed application and database, not a frontend redesign issue. Health/config success does not exercise these operations.

Current main contains 16 source migrations after the bootstrap's last source migration (`20261022170000_badges.sql`): currency/payment-mode/release/note/instruction changes, booked-session edits and email outbox/dispatch. Their mapped-schema upgrade must be reviewed against the actual cloud definitions, backed up and applied through a namespaced incremental migration before repeating the live loop. The bootstrap renderer explicitly refuses an existing installation; do not rerun it or use local `db push/reset/seed` against wProject. See [staging migration rules](../deployment/staging.md#database-setup-and-future-migrations).

The initial inspection did not apply cloud SQL. The later owner-authorized upgrade is recorded below. Shared Auth/Trove settings, sender/scheduler setup, application deployments, plans and the other agent's P-14 work were not changed by this continuation. Runtime sender credentials, shared quota/headroom and actual Cloudflare delivery remain unverified. A Vercel READY deployment does not establish that the separate Cloudflare scheduled Worker runs the current email code.

## Remaining completion evidence

| Required area                                | Current result / next evidence                                                                                                                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local integrated loop and backend boundaries | Observed above; clean suite passes.                                                                                                                                                               |
| Live authenticated loop                      | Schema drift resolved; live rollback-only RPC checks passed. Owner reports phone sign-in and joining work; the full live organizer/member loop is not independently observed.                     |
| Live email                                   | Owner reports sign-in codes and session notification receipt work. Individual notification types, timings, sender and scheduler host/version were not supplied; no independent inbox observation. |
| Android/Chrome browser and installed PWA     | Owner reports the described browser/install/reopen/join/interrupted-connection/sign-out checks work. Phone model, OS and Chrome versions were not supplied.                                       |
| iPhone/Safari browser and installed PWA      | No device evidence available. Owner's Android-only availability does not change D-08's accepted support matrix.                                                                                   |
| Desktop keyboard                             | Chrome keyboard coverage now includes sign-in, setup/publish/share, guest join, check-in and withdrawal. Full payment/waitlist keyboard coverage and desktop Safari remain unverified.            |
| Accessibility/performance                    | Complete the physical-device/core-loop checks; no WCAG or 3-second-budget claim from this limited browser walkthrough.                                                                            |

The owner has now reported the following Android checklist works, without supplying exact OS/Chrome versions: open the custom domain, receive/verify an existing account's code, add/install RallyPoint from Chrome, reopen it standalone, join a synthetic session, go offline and attempt a mutation (must stay unconfirmed), reconnect/recover the same request, sign out/switch accounts and confirm private roster/fee/attendance data does not follow the old identity. Use only synthetic session data; do not put authentication codes in the report. Repeat the accepted matrix on iPhone/Safari when a device is available.

P-13's separate provider eligibility/headroom, backup locations and synthetic restore/deletion prerequisites remain before real pilot data. Existing Maps, embedded payments, profile editing, badge tiers and other backlog features are outside P-08; passing these checks does not imply they exist. Keep P-08 open until its missing evidence is recorded and accepted. This internal verification report needs no user-facing release note.

## Prepared upgrade evidence (2026-10-23, before application)

The owner asked to continue after the staging blocker was reported. The branch now adds an explicit `--upgrade` mode to the existing schema renderer, covering only the 16 reviewed source migrations after the original bootstrap through `20261023144000`. The two renderer safety tests failed before implementation and passed afterward; default initial-install behavior remains guarded, and invalid modes emit no SQL.

Read-only comparison found all **63 cloud RallyPoint function definitions exactly matched** the recreated old baseline. A local rehearsal populated that baseline with a draft, a booked guest party, a paid fee, check-in and audit/receipt history. An injected failure after the upgrade rolled back all function/schema/data changes. The successful upgrade preserved the existing records (the new `session_changes.material` field has its intended false default), and all **95 final mapped function definitions matched** the current full migration chain. Existing local `app/api` definitions were unchanged; a repeated upgrade and a missing-install rehearsal were refused atomically. All staging tables retained RLS, zero RPCs became browser-callable, and historical bookings created no email jobs.

Rendered SQL SHA-256: `281c7a3d1ae420bec74ca5000d64f19da14399d478e575e4bce827ab70b863da` (1,920 lines, 125,902 bytes). Reproduce with `node scripts/render-staging-schema.mjs --upgrade`; inspect the [upgrade/recovery instructions](../deployment/staging.md#upgrade-the-existing-2026-10-23-bootstrap). The script emits SQL only and does not connect or apply it.

**Historical recovery gate:** automatic approval review blocked the broad shared-project export; that export was not retried. The owner subsequently requested the scoped deployment fix on 2026-10-24. A narrower recovery approach and the actual upgrade are recorded below; the broader P-13 recovery routine is still separate.

Fresh continuation checks: `pnpm check` passed; `supabase db lint --local --schema rallypoint,rallypoint_api --fail-on error` found no schema errors. The complete clean local suite, including the new renderer checks, passed **267/267**, zero failed/skipped, in **155.932 seconds**. The earlier 265-test evidence remains the product baseline; the two additional tests cover safe upgrade rendering. These results still do not establish a cloud upgrade or physical-device/live-email success.

A further local catalog comparison found **371 mapped columns, constraints, indexes and triggers** identical to the complete migration baseline. Fresh read-only review found no actionable defect in the prepared upgrade path. The SQL guard checks known sentinel objects rather than every possible drift; the documented pre-apply definition comparison remains mandatory. The reviewer did not independently verify cloud state, a backup/restore, a live upgrade, live email or physical devices; none is claimed here.

## 2026-10-24 live deployment gap resolved

Owner instruction: fix the deployment gap while preserving unrelated schemas/resources. Main and Vercel still use `d12d46d`. Source SQL remains SHA-256 `281c7a3d1ae420bec74ca5000d64f19da14399d478e575e4bce827ab70b863da`. No product/UI code changed in this continuation.

A scoped recovery copy was encrypted, read back with matching checksums and restored into a network-isolated disposable local PostgreSQL 17 container. Its 19 RallyPoint tables and 63 functions restored; the exact upgrade preserved the captured records, and an injected failure rolled back. This limited recovery check does not establish whole-project/Auth disaster recovery or complete P-13 readiness. No broad shared-project export was retried.

Supabase `apply_migration` returned `Invalid or expired requestState` twice. After verifying neither attempt changed the database, the authenticated Supabase CLI 2.121.0 ran the identical reviewed SQL inside explicit `BEGIN`/`COMMIT`, together with one new migration-history entry: **`20261023212741_rallypoint_staging_upgrade_20261023`**. CLI exit 0; cloud Postgres 17.6. The prior unrelated and RallyPoint migration entries remained present.

Observed immediately after application:

- All 19 original RallyPoint table row counts/hashes matched pre-upgrade state, excluding only the intended new `session_changes.material` field. Existing data was preserved.
- All **95 function definitions matched individually** against the locally restored/upgraded recovery copy. The cloud has all **26 expected RallyPoint tables**; all have RLS and no RallyPoint function is executable by `anon` or `authenticated`.
- A before/after fingerprint over **3,009 unrelated database definitions and permission/settings records** was identical. This covered other app and managed schemas, columns, functions, constraints, indexes, non-internal triggers, policies, ACLs/default ACLs and database-role settings. The expected single RallyPoint migration-history insertion is outside that comparison. This is catalog evidence, not a full functional test or row-by-row data scan of other apps.
- No historical email jobs were backfilled. The sender lock/attempt state was unused; no sender or scheduler was enabled by this work.

A **live rollback-only RPC smoke check** then published a synthetic PHP-fee session, confirmed a two-seat party, retried the same join key without duplication, verified PHP 2,500 minor-unit liability, recorded the member payment note without marking paid, marked paid as organizer, checked in both seats and verified notification enqueue. It used an existing RallyPoint identity reference without creating/editing Auth users. Every synthetic write rolled back; zero synthetic groups remained. This verifies the trusted database boundary, not browser authentication or inbox delivery.

A later read observed a new join on the existing session, with its receipt, split claim and one queued `joined_confirmed` job. Those records are outside the rollback-only synthetic test and were preserved. They do not contradict the immediate post-migration preservation comparison; no cleanup or delivery attempt was made against them.

Postman rechecked `https://rallypoint.wndrhive.com`: health HTTP 200, one assertion passed, exit 0; signed-out workspace HTTP 401 with `sign_in_required` and `no-store`, one assertion passed, CLI exit 1 for expected non-2xx. Security advisories remain the intentional service-only RLS/no-policy information and the pre-existing shared Auth password-setting warning; no new security-warning category appeared. The unrelated catalog fingerprint was unchanged again after the RPC smoke check.

The [database-before-application release check](../deployment/staging.md#database-before-application-release-check) now requires verified compatible database migrations before merging dependent application code. This is a manual release dependency; no automatic migration system, schema renaming, new library, application deployment or merge was introduced. The two renderer safety tests passed again. Earlier 267-test/build evidence above remains historical; unchanged product code was not rebuilt solely for this operational/docs continuation.

Fresh read-only review found no actionable Critical/Important issue in the documentation, renderer and supplied nonsensitive logs. The reviewer independently reran the two renderer checks, verified the SQL checksum and checked the diff, but did not independently verify cloud state or recovery contents.

At this point in the operational continuation, owner phone/inbox confirmation had not yet been supplied; the later confirmation is recorded below. Cloudflare remained deployed; its scheduler/code version was not changed or independently reverified here.

## 2026-10-24 owner phone and inbox confirmation

After the assistant described the real-phone/inbox checklist for https://rallypoint.wndrhive.com, the owner replied: **“yes all are working.”** The previously supplied device scope was Android/Chrome only.

Record this as the owner's report that Android/Chrome sign-in and joining, home-screen installation/reopening, interrupted-connection handling, sign-out privacy, receipt/use of the eight-digit sign-in code, and session notification receipt work. It is not a new agent-observed browser or mailbox run. No mailbox contents, authentication codes or participant details were collected.

The owner did not supply phone model, Android/Chrome versions, individual notification kinds/timings, or sender/scheduler configuration. Do not infer that every D-05 reminder/change/cancellation case ran or that the Cloudflare scheduler version was inspected. The owner confirmation resolves the previously missing general phone/inbox outcome report; iPhone/Safari, full desktop keyboard/Safari, the broader organizer/member flow and accessibility/performance coverage still need their own evidence under the accepted matrix. P-08 remains In Progress and PR #31 remains draft; no acceptance, merge, launch or policy waiver is inferred.

## 2026-10-24 extended Chrome checks and capacity accessibility fix

The owner asked to continue. Reused the dedicated local P-08 stack and exact product source described above, with the single NumberStepper fix below copied from this branch. Browser: headless Chrome 155 (user agent reports 155.0.0.0) on macOS 27.0.1; desktop viewport 1280 × 800, then 375 × 812 for reflow/reduced-motion sampling. All identities, sessions, email codes and writes in this continuation were local synthetic data; shared staging/Auth/schemas and other local stacks were not changed.

**Defect found and fixed:** axe-core 4.13.0 reported `aria-valid-attr-value` on the capacity decrement/increment buttons: each referenced a generated input ID absent from the DOM. `NumberStepper` assigned its caller-supplied ID directly to `NumberField.Input`, leaving Base UI Root's context with a different generated ID. Following the installed Base UI 1.8.0 contract, moved that same `id` to `NumberField.Root`. This changes no styling, layout, business rule, dependency or database schema. Both buttons now reference the rendered `capacity` input; label/description associations are preserved. Plain-language note: improved accessibility of the session capacity control.

A focused real-browser assertion failed before the fix because both ARIA targets were missing, then passed after rebuilding with the fix. The session form's automated violations changed from one rule affecting two nodes to zero. No new test framework or package was introduced.

**Observed keyboard/browser behavior:** synthetic organizer email-code sign-in; workspace/group navigation; empty-publish validation with a readable alert; title/activity entry, radio arrow selection, calendar arrow/date/time selection and Escape return; capacity arrow adjustment; payment select opening; registration opening and guest switch; publish and Copy link. A separate member browser signed in, dismissed the badge dialog with Escape, selected a guest, entered the guest name and confirmed two seats. Organizer check-in worked for primary and guest; Escape returned from the party sheet to its row. Member withdrew both seats. Local SQL confirmed one withdrawn party, two independent attendance records and zero money records for this untracked-payment session. This extends the earlier paid-session and queue evidence; it does not claim every payment/waitlist action was repeated using only a keyboard.

Local timings from key activation to the stated observation:

| Action / observation                              | Time   |
| ------------------------------------------------- | ------ |
| Publish, edit-route navigation                    | 188 ms |
| Copy link, success status                         | 14 ms  |
| Guest join, authoritative two-seat count rendered | 187 ms |
| Guest check-in, control state updated             | 191 ms |
| Withdraw, authoritative empty seat count rendered | 84 ms  |

These are individual localhost samples, with no physical-network throttling or statistical performance/load claim. They do not establish the three-second phone-network target.

**Automated accessibility coverage:** sampled sign-in, workspace/group, session setup, published setup, shared/joined/withdrawn member states, organizer/badge/party-sheet states and the narrow organizer view using axe WCAG 2 A/AA, 2.1 AA and 2.2 AA tags. After the number-control fix, sampled states reported zero violations. Additional WCAG 2.1 A rules also reported zero violations on the final organizer/member views. Some contrast checks remain `incomplete` (the final narrow view had one short-content element requiring human classification); zero automated violations is not a full WCAG audit. At 375 px, document width equalled viewport width; reduced-motion preference was enabled. The workspace Open group link had a visible 3 px focus outline, and dialog Escape/return behavior was exercised.

**Safari boundary:** installed Safari reports 27.0.1. A supported WebDriver session probe failed because Allow Remote Automation is disabled. No Safari setting was changed and no Safari session was created; the test driver was stopped. No WebKit emulation or phone-width Chrome run is presented as physical Safari evidence.

Fresh focused review found no actionable regression in the two-line prop move. The reviewer checked both call sites and Base UI's installed source/types, confirming Root forwards the ID to the input and step-button references without creating duplicate IDs; browser/build evidence was not independently rerun by the reviewer.

Fresh regression result: **267/267 passed**, zero failed/skipped, in **152.017 seconds**, with the local API test URL explicitly set to port 3118. Lint, type checking and the production build also passed after the fix. P-08 remains In Progress for the explicitly unverified parts of the accepted matrix; the owner's Android/inbox confirmation above remains valid. This continuation does not merge or redeploy the application.
