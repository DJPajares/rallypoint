# RallyPoint — First Session Task Proposal

**Status:** Reviewed batch authorized for publication to the selected Linear project on 2026-10-21. Publication does not authorize implementation or close unresolved policy/technology gates.  
**Prepared:** 2026-10-21.  
**Decision owner:** Darwin Jason Pajares.

**Publication authorization:** The owner requested a PR in `DJPajares/rallypoint`, followed by creation of these eight reviewed tasks in the [RallyPoint Linear project](https://linear.app/wwonderland/project/rallypoint-a26d48cd9e2d). The task contents and scope below remain the reviewed batch; publication resolves no open gate.

## Outcome and boundary

An organizer can publish a group-owned, unlisted session, share its link, accept verified participants and optional +1 parties, fill withdrawals through a strict waitlist, track external payments, and record attendance. Participants receive email updates and can always check their authoritative status on the event page.

This proposed batch uses a **fixed per-seat fee** and a 12-seat example to prove that loop. Twelve is a verification fixture, not a production capacity ceiling. Free events can use a zero amount. The full PRD remains the MVP contract; this batch does not claim to finish the MVP.

Outside this batch: split-fee finalization; templates/duplication/recurrence; public/private visibility modes; announcements; profile enrichment/attendance-count display; report/block/member-removal workflows; roster export, rich previews and QR sharing; push/SMS; discovery/social/chat; payment processing; offline writes; and production launch. These remain in their existing MVP or deferred categories. Copying a working event link is included.

Only a minimal group/organizer context is needed here; general membership management and a complete co-host invitation experience are separate MVP work. Co-host authorization must nevertheless be tested against synthetic role fixtures, using the accepted management boundaries.

This is a review proposal, not a live backlog or task-status mirror. P-01 through P-08 are proposal references, not tracker IDs. After authorized publication, execution status belongs to the chosen task record; this proposal stays a historical review artifact.

## Accepted behavior this batch must preserve

- Public/unlisted viewing needs no sign-in. Reservation requires verified sign-in. First-loop events belong to a group and default to unlisted; eligible nonmembers can join without becoming group members.
- One organizer-enabled guest may be managed by the primary registrant without a guest account. Primary and guest join/promote together in strict arrival order; a later solo party cannot bypass a two-seat party that does not fit.
- Waiting incurs no fee. With upfront consent, promotion confirms immediately before event start and creates the published fee obligation, including after the cutoff. No claim timer is added.
- Participants can withdraw before start. Before the cutoff, unpaid obligations are removed; at/after cutoff they remain unless the organizer waives them. Any paid refund is handled externally.
- Visitors see basic details/counts; confirmed participants see display names. Each participant sees their own fee/payment status. Organizers/co-hosts manage the full roster, payments, check-in and no-shows. Other participants' financial and attendance history stays hidden.
- Email plus immediate in-page status covers confirmations, promotions and material changes. One reminder is scheduled 24 hours before start; later sign-ups get no catch-up reminder. Email is not guaranteed receipt or the authority for a reservation.

Requirements and decisions remain authoritative in [PRD.md](PRD.md); execution and evidence rules remain in [AGENTS.md](AGENTS.md).

## Open gates and concrete recommendations

These are **not accepted merely by appearing in the task proposal**. Task-creation approval alone does not close them.

| Gate | Recommendation or needed output | Blocks |
| --- | --- | --- |
| D-10 — stack/provider | P-01 supplies one app/data/auth/email combination, local verification commands and current official evidence; owner accepts the consequential choice | Runnable work in P-02 onward |
| D-01 — minimum role bootstrap | Recommend the group creator becomes its organizer. Co-hosts share the already accepted event/payment/attendance powers; granting/revoking co-host rights remains organizer-controlled. General membership entry and a co-host invitation UI are outside this batch | P-02 role bootstrap and any live co-host assignment |
| D-03 — direct-join deadline | Recommend closing new direct joins at event start, matching the accepted promotion/withdrawal deadline. Post-registration guest edits are outside this batch; whole-party withdrawal remains available under the accepted policy | Final time-boundary behavior in P-03/P-08 |
| D-04 — fixed-fee replacement accounting | Recommend a replacement gets its own normal charge; the late withdrawer's existing charge remains until an organizer explicitly waives it. Show those as separate records, never an automatic refund/credit. This can leave both owing a fixed fee, so the owner must confirm the intended result | Complete fee acceptance in P-04/P-05; split fees remain outside this batch |
| D-05 — email delivery envelope | Recommend reminders to currently confirmed primary registrants, with guest details included for the primary; no waitlist reminder that could imply confirmation. P-01 identifies provider/sender permission, quotas, bounded retries and observable failure handling | Outbound enablement in P-06 and live delivery evidence in P-08 |
| D-08/D-09 — real-data pilot | Choose actual workload/device/performance/resource limits, retention/deletion handling and operating responsibility before collecting real pilot data | Real-data pilot/launch, not synthetic development checks |

P-01 can proceed as a research/decision brief after separate implementation/work authorization. The other tasks are conditional on their listed gates and prerequisites. No accounts, sender domains, repositories, databases or infrastructure are to be created merely to prove access.

## Proposal order and readiness

| Reference | Reviewable result | Direct prerequisites | Readiness at proposal time |
| --- | --- | --- | --- |
| P-01 | A concrete stack/provider decision for this session loop | Accepted PRD decisions | Ready for investigation once authorized |
| P-02 | Organizer publishes a group session and shares its unlisted page | P-01 accepted; D-01 minimum role bootstrap | Conditional |
| P-03 | Verified participant/guest party confirms or waitlists without oversubscription | P-02; D-03 direct-join deadline | Conditional |
| P-04 | Withdrawal releases seats and promotes the queue while preserving fee rules | P-03; D-04 fixed-fee replacement policy | Conditional |
| P-05 | Organizer tracks manual payments and explicit fee waivers | P-03; D-04 fixed-fee replacement policy | Conditional; independent of P-04 implementation once their shared record contract exists |
| P-06 | Email updates and the 24-hour reminder reflect authoritative state | P-04; D-05 delivery envelope/provider access | Conditional |
| P-07 | Organizer records/corrects attendance per participant/guest seat | P-03 | Conditional; independent of P-04/P-05/P-06 |
| P-08 | Complete mobile/PWA session-loop evidence, including failure paths | P-05, P-06, P-07 and all applicable gates | Conditional |

The order records actual prerequisites rather than requiring every task to depend on the previous number. P-05 and P-07 can be developed independently after their prerequisites; no parallel agents are authorized by this observation.

## Model guidance

The execution platform/model has not been selected for these future tasks. Each brief supplies a capability and reasoning recommendation; exact model availability is **unverified for the execution environment**. Resolve current model names before publication/execution rather than inventing a roster. This does not authorize delegation.

## P-01 — Select the app, identity, data and email approach for the session loop

### Description

Deliver one reviewable technical decision that makes verified reservation, transactional party allocation and scheduled email implementable at low operating cost. References: PRD technical direction, RP-05/RP-06/RP-08/RP-12, D-01/D-05/D-08/D-10.

### Scope

**Included:** inspect the actual docs-only folder; compare the smallest sufficient stack options; recommend one app toolchain, one authoritative data store, a verified-sign-in method and one email provider/scheduling approach. Check current official documentation, pricing/usage restrictions, sender-domain requirements, local testing and authorization support. Define where join/withdrawal/promotion integrity lives, the minimum operation/data contract and failure semantics, and how development avoids real participant data. List the exact human decisions/access still needed.

**Excluded:** scaffolding, dependency installation, service/account provisioning, external writes, secrets, a production deployment or designing the remaining MVP.

### Suggested Models & Reasoning

- **Platform/model:** agent capable of cross-service architecture and source verification; exact model unverified.
- **Reasoning:** high.
- **Reason:** seat integrity, sign-in, delivery quotas and provider restrictions must fit one coherent low-cost approach.

### Acceptance Criteria

1. The decision names the recommended toolchain/providers, one alternative and material tradeoffs, with links to current primary sources and a verified/unverified distinction for account access and costs.
2. It explains how two simultaneous last-seat requests, a +1 party, duplicate retries and withdrawal/promotion preserve capacity, and identifies the authoritative permission boundary.
3. It identifies the sender/recipient permissions, scheduler, aggregate delivery/retry limits and development stand-in for email without claiming live delivery readiness.
4. It lists grounded setup/check commands and clearly distinguishes documented commands from executed checks; it does not claim a runnable application exists.
5. It presents remaining D-01/D-03/D-04/D-05 choices concretely for owner acceptance. D-10 is accepted only by an explicit owner decision; dependent implementation remains blocked until then.

### Dependencies

- **Blocked by:** no research blocker; actual implementation requires the owner's decisions and any later authorized service setup.
- **Blocking:** P-02 and the provider-specific parts of P-06.
- **Readiness:** ready for bounded investigation after work authorization.

### Execution Context and Verification

- **Read/reuse:** PRD decisions and accepted session-loop rules; README's actual project inventory. No application/API contract or package manifest exists yet.
- **Checks:** compare current official capabilities to each named requirement; distinguish public documentation from authenticated target access; inspect whole-operation cost and quotas.
- **Commands:** establish the actual commands for the selected toolchain in the decision/setup guidance; do not invent or execute installation commands as part of this research task.

## P-02 — Publish and share an organizer's unlisted fixed-fee session

### Description

An organizer signs in, establishes the minimal group context, publishes a session and opens its shareable page as a visitor. References: RP-01/RP-02/RP-05/RP-09/RP-16 and accepted D-01/D-06 portions.

### Scope

**Included:** implement the accepted stack and verified sign-in flow with return-to-event behavior; minimal group creation/organizer authorization; event draft/publication with title/activity, start/end/timezone, location/instructions, positive capacity, registration opening, cancellation cutoff, fixed fee/currency and guest toggle. Default to unlisted; provide copy-link sharing. Establish the responsive accessible app shell and PWA manifest/icons. Permit clear event-detail updates and define their material-change signal using the P-01 operation contract.

**Excluded:** general membership/co-host invitation UI, extra visibility modes, recurrence/templates, QR/previews, provider publication and the full profile editor. Changes to terms of existing registrations must not be silently applied; any unresolved edit contract is a named blocker rather than an invented migration rule.

### Suggested Models & Reasoning

- **Platform/model:** full-stack agent capable of identity and access-control work; exact model unverified.
- **Reasoning:** high.
- **Reason:** anonymous viewing, organizer rights and private fields must survive direct requests as well as the UI.

### Acceptance Criteria

1. A verified organizer publishes a valid 12-seat session, copies its link and sees the same basic details as an unsigned visitor; unlisted is the initial mode.
2. Invalid capacity, end-before-start, inconsistent opening/cutoff times or currency precision are rejected with entered values preserved and no partial publication.
3. An unrelated participant cannot edit the event or see protected organizer/payment/attendance records through direct operations. The group creator's role follows the accepted D-01 bootstrap decision.
4. Repeating an interrupted publish does not create duplicate events; verified sign-in returns to the intended event.
5. The mobile shell has usable keyboard/focus/error behavior and a valid installable PWA configuration; it does not imply offline reservations.
6. README contains the actual adopted local setup/check commands with observed results. Any external-service setup remains within separately authorized scope.

### Dependencies

- **Blocked by:** P-01 accepted technical decision; D-01 role bootstrap; concrete edit constraints for already-booked events before enabling such edits.
- **Blocking:** P-03.
- **Readiness:** conditional.

### Execution Context and Verification

- **Read/reuse:** P-01 architecture/operation contract; PRD and AGENTS. Proposed areas are app/shared-link pages, trusted auth/event operations and accessible UI primitives; adapt paths to the chosen framework.
- **Checks:** actual chosen lint/type/build checks, focused role/input tests and a browser walkthrough with organizer and unsigned visitor.
- **Commands:** use the adopted commands recorded by P-01/P-02 in README; none currently exist.

### Manual Test

Future-runtime procedure: sign in as the organizer, publish the example session and open its copied link in an unsigned session. Confirm basic details are visible; attempt publication with capacity zero; attempt an edit as an unrelated signed-in participant. Expect preserved input and an authoritative denial respectively. Check a narrow mobile viewport and keyboard navigation.

## P-03 — Join or waitlist a verified participant and optional guest party

### Description

A participant gets a truthful reservation or waitlist result without exceeding capacity or bypassing a waiting party. References: RP-05/RP-06/RP-07/RP-09/RP-16, D-01/D-03/D-04/D-06.

### Scope

**Included:** verified-primary joining; optional one guest with no separate guest account; authoritative party ordering/capacity and duplicate prevention; waiting consent; initial fixed-fee obligation only on confirmation; own-status view and the accepted roster/privacy projections. Preserve the accepted queue position when displaying current waitlist information.

**Excluded:** partial-party admission, queue bypass, payment holds, claim timers, guest editing after registration, split fees and group auto-membership.

### Suggested Models & Reasoning

- **Platform/model:** agent capable of transactional concurrency and authorization reasoning; exact model unverified.
- **Reasoning:** high.
- **Reason:** party ordering, last-seat races and response privacy are the central integrity risk.

### Acceptance Criteria

1. An unsigned visitor can view permitted details but cannot reserve; after verified sign-in an eligible primary can join without acquiring group membership.
2. Two simultaneous solo requests for the final free seat yield exactly one confirmation and a truthful waitlist result for the other. Repeated requests by the same identity do not consume another seat.
3. A two-seat party with one available seat stays wholly waitlisted; neither a later solo waitlist entry nor a new solo arrival bypasses it. Guest registration is rejected when disabled.
4. Waiting creates no fee. Joining the waitlist clearly obtains consent to automatic confirmation before start and the applicable fee, including post-cutoff promotion; confirmed fixed-fee totals include chargeable guest seats.
5. Link visitors see details/counts, confirmed participants see display names, and each participant sees only their own fee/payment information; organizer/co-host views use the accepted wider authority.
6. An ambiguous network result offers an authoritative status recheck, not an invented confirmation. Opening/start boundaries follow the accepted time contract; new direct-join closure remains blocked until D-03 is decided.

### Dependencies

- **Blocked by:** P-02; D-03 direct-join deadline; accepted data/operation contract from P-01.
- **Blocking:** P-04, P-05 and P-07.
- **Readiness:** conditional.

### Execution Context and Verification

- **Read/reuse:** P-01 contract and P-02 identity/event primitives. Proposed affected areas are registration/queue operations, fixed-fee allocation and shared-link status/roster views.
- **Checks:** meaningful simultaneous-request and retry tests against the authoritative store; verify projections and denied direct reads with multiple identities; browser status/consent walkthrough.
- **Commands:** adopted README commands plus the selected store's actual concurrency-test setup; establish these rather than substituting mocked button-state tests.

### Manual Test

Future-runtime procedure: fill 11 of 12 seats, enqueue a primary +1, then try a later solo join. Both requests must wait and no seat count may exceed capacity. Free a second seat using an authorized test fixture and verify party ordering. Repeat the original join request and inspect each role's roster/payment view.

## P-04 — Withdraw, release seats and immediately promote the next party

### Description

A pre-start withdrawal releases seats while queue order and cancellation-fee obligations remain correct. References: RP-06 through RP-09, D-03/D-04.

### Scope

**Included:** whole-party self-service withdrawal before start; waitlist removal; pre-cutoff unpaid-obligation removal; retained post-cutoff obligation; authoritative strict-order whole-party promotion; creation of the promoted party's fixed-fee obligation; durable promotion/change signal for email.

**Excluded:** guest edits, timed offers, queue skipping, automatic fee waivers/refunds and post-start self-service withdrawal.

### Suggested Models & Reasoning

- **Platform/model:** agent capable of concurrent lifecycle and financial-state integrity; exact model unverified.
- **Reasoning:** high.
- **Reason:** seat release and promotion must have one authoritative result while financial records remain independent.

### Acceptance Criteria

1. Withdrawal before, exactly at and after cutoff but before start releases the correct seats. Before cutoff it removes unpaid obligations; at/after cutoff an existing obligation remains until an explicit organizer waiver.
2. A two-seat head party promotes only when both seats are available; a later one-seat party cannot bypass it. The promoted party confirms immediately without a claim step and receives its applicable fixed-fee allocation once.
3. Concurrent withdrawal/new join/promotion and duplicate retries never overbook, allocate the same seat twice or produce duplicate fee allocations.
4. A waitlist withdrawal racing promotion returns one truthful final state. Cancelled/withdrawn registrants are not subsequently promoted from stale work.
5. No promotion or self-service withdrawal occurs at/after start. Email failure does not undo a confirmed promotion. Existing paid markers are preserved as manual records rather than claims of refund.

### Dependencies

- **Blocked by:** P-03; D-04 confirmation of fixed-fee replacement accounting.
- **Blocking:** P-06; P-08 through P-06.
- **Readiness:** conditional; coordinate the allocation/waiver contract with P-05, without making payment UI a seat-allocation dependency.

### Execution Context and Verification

- **Read/reuse:** accepted RP-08 and P-03 registration/allocation contract. Proposed areas are trusted withdrawal/promotion operations and own-status refresh.
- **Checks:** authoritative concurrency tests, controlled-clock cutoff/start tests, duplicate-event/retry tests and browser recovery scenarios. Verify the operation contract before changing implementation.
- **Commands:** chosen test/runtime commands in README; document how test time and independent concurrent clients are controlled.

### Manual Test

Future-runtime procedure: fill the event, waitlist a primary +1, withdraw one confirmed solo and verify no bypass. Withdraw a second and verify one two-seat promotion. Repeat once before cutoff and once after, checking the departing registrants' fee records; simulate a lost response and recheck status.

## P-05 — Track external payments and explicit organizer fee waivers

### Description

An organizer/co-host can distinguish who owes a fee, who is marked paid, and which obligation was explicitly waived. References: RP-09/RP-10/RP-11 and D-04/D-06.

### Scope

**Included:** protected payment instructions/QR image with a text fallback; organizer/co-host paid/unpaid edits; explicit fee waiver independent of payment status; actor/time for corrections; active and retained late-withdrawal obligations; participant's own fee/status view.

**Excluded:** payment processing, bank reconciliation, receipt uploads, automated refunds/credits, split fees and public payment history.

### Suggested Models & Reasoning

- **Platform/model:** agent capable of scoped state editing and access-control tests; exact model unverified.
- **Reasoning:** medium, increasing if the selected persistence model makes correction integrity complex.
- **Reason:** the work is bounded record management with important permission and state-separation checks.

### Acceptance Criteria

1. An authorized organizer/co-host marks an allocation paid, corrects it and explicitly waives an obligation; each action records its actor/time and never changes reservation status.
2. Waiving an obligation is distinguishable from receiving payment. Existing paid records are not silently rewritten as refunds, and a retained late-cancellation charge remains visible under the accepted replacement policy.
3. A participant sees their own fee/status and permitted payment instructions but cannot mark themselves paid or inspect another participant's financial records through direct operations.
4. A QR-image failure leaves usable text instructions. Invalid/unsafe uploads are rejected; viewing or editing instructions never changes seats or payment markers.
5. A failed or conflicting save does not claim success or silently overwrite an intervening correction. The final persisted value and actor are identifiable.

### Dependencies

- **Blocked by:** P-03's allocation/authorization contract; D-04 fixed-fee replacement policy.
- **Blocking:** P-08.
- **Readiness:** conditional; P-04 is not an implementation prerequisite if cancelled/retained records are verified with synthetic fixtures, with full withdrawal integration covered in P-08.

### Execution Context and Verification

- **Read/reuse:** P-03 allocations and accepted visibility; P-04 shared record shape. Proposed areas are organizer roster/payment controls and participant own-status view.
- **Checks:** role-denial tests, correction/waiver invariants, conflicting-save behavior and QR fallback in an actual browser. Use synthetic payment records only.
- **Commands:** the selected project checks in README; no real bank API is needed or implied.

### Manual Test

Future-runtime procedure: create an unpaid registration, mark it paid as organizer, correct it and waive a separate retained obligation. Inspect as the participant and an unrelated account. Break the QR image URL or use a controlled failed-image fixture; text instructions must remain usable.

## P-06 — Send truthful email updates and the 24-hour reminder

### Description

Participants receive the accepted email updates while event/seat state remains authoritative when delivery fails. References: RP-02/RP-08/RP-12 and D-05.

### Scope

**Included:** confirmations distinguishing confirmed/waitlisted; promotion and material-change/cancellation emails; one reminder 24 hours before start; primary-registry destination for guest parties; bounded delivery/retries and non-sensitive failure evidence; reminder suppression when eligibility is lost. Use the accepted provider and recipient/time-change rules.

**Excluded:** marketing, SMS, browser push, multiple-provider routing, an inbox/chat product and calendar export in this batch.

### Suggested Models & Reasoning

- **Platform/model:** agent capable of scheduled delivery, retry and external-service failure reasoning; exact model unverified.
- **Reasoning:** high.
- **Reason:** retries, stale reminders and state/delivery separation can otherwise mislead participants or create duplicate effects.

### Acceptance Criteria

1. A confirmed join, waitlisted join and promotion produce correctly labelled emails for the verified primary destination. A party's guest does not require a separate account/contact destination.
2. Promotion is persisted before delivery is attempted; a failed/duplicated delivery attempt neither reverses confirmation nor creates another seat/allocation. Queued/sent/failed evidence never claims guaranteed receipt.
3. Eligible recipients get one 24-hour reminder under the accepted D-05 audience rules. A sign-up after the reminder time gets its action confirmation and no catch-up reminder.
4. Withdrawn participants and cancelled events do not receive stale reminders. A material time change follows the explicitly accepted rescheduling rule rather than silently using the old schedule.
5. Provider failures/retries respect the accepted operation-wide recipient/retry/resource ceilings and preserve non-sensitive diagnostics. Email bodies/previews exclude other attendees' payment, contact and attendance history.
6. Real adapter code is exercised against a service stand-in for rejection/timeout/retry scenarios. Any live test uses separately authorized sender/recipient scope and reports live evidence separately; account/sender access blockers remain explicit.

### Dependencies

- **Blocked by:** P-04 trigger/state behavior; P-01 provider decision; D-05 sender/recipient, reminder-rescheduling, bounded retry and permission decisions.
- **Blocking:** P-08 live email evidence.
- **Readiness:** conditional; sender authorization and any user-controlled consent cannot be fabricated from public provider documentation.

### Execution Context and Verification

- **Read/reuse:** P-01 delivery contract and P-02/P-03/P-04 material state changes. Choose one maintained local contract/request artifact where it makes the provider-bound behavior reusable; do not create duplicate specifications or a shared Postman workspace without need/authorization.
- **Checks:** actual delivery adapter against a service stand-in, controlled-clock scheduling, duplicate processing and stale-recipient tests. Follow the API simulation workflow when running code that calls the external provider. A mocked delivery is not live deliverability evidence.
- **Commands:** adopted scheduling/test commands in README; use secure test variables rather than committed credentials.

### Manual Test

Future-runtime procedure: with an authorized test recipient, join/waitlist/promote and inspect message labels and the linked status page. Use controlled time to cross the reminder boundary, then test a late sign-up and withdrawn registrant. Force provider failure through the stand-in and confirm spot status stays correct; report any unperformed live test precisely.

## P-07 — Check in participants and guests without exposing attendance history

### Description

Organizers/co-hosts can record who actually showed up and correct mistakes, independently of payment. References: RP-14 and accepted D-06 controls.

### Scope

**Included:** unrecorded/checked-in/no-show states per confirmed primary/guest seat; organizer/co-host correction; no-show recording after the session; visibility/authorization and retained actor/time where needed to explain a correction.

**Excluded:** self check-in, location tracking, public attendance history, profile-count presentation, reliability indicators, streaks and sport tools.

### Suggested Models & Reasoning

- **Platform/model:** agent capable of a scoped organizer workflow and state/permission tests; exact model unverified.
- **Reasoning:** medium.
- **Reason:** the main work is a small interface and clear independent state transitions.

### Acceptance Criteria

1. An organizer/co-host checks in primary and guest independently and corrects a mistake without double-counting either seat.
2. Waitlisted/cancelled seats cannot be checked in as confirmed attendees. Missing attendance remains unrecorded rather than automatically becoming a no-show.
3. A no-show can be recorded only after the session; ordinary participants cannot change another person's attendance or retrieve their history through direct operations.
4. Changing attendance never changes payment or spot status. An unpaid confirmed participant can still be recorded accurately as present.
5. A failed/concurrent correction returns a truthful final state rather than showing an unsaved or silently overwritten value.

### Dependencies

- **Blocked by:** P-03's confirmed-seat and organizer/co-host authorization contract.
- **Blocking:** P-08.
- **Readiness:** conditional; no payment UI or email implementation dependency.

### Execution Context and Verification

- **Read/reuse:** PRD attendance/state distinctions and P-03 seat/role primitives. Proposed areas are organizer roster/check-in and trusted attendance operations.
- **Checks:** role/time/seat eligibility tests, corrections, primary-versus-guest independence and a mobile browser walkthrough.
- **Commands:** actual adopted README checks; use controlled time and synthetic participants.

### Manual Test

Future-runtime procedure: check in a primary but not their guest, correct the primary to unrecorded and restore it. After the session, record the guest's no-show. Confirm an unpaid attendee can be checked in, a waitlisted person cannot, and an ordinary participant cannot change or inspect another attendee's history.

## P-08 — Verify the complete first-session loop in the mobile PWA

### Description

Produce observed evidence that the agreed loop works across organizer/participant identities, the real authoritative store and the chosen delivery boundary. This validates the first increment, not the whole MVP or production launch.

### Scope

**Included:** run the integrated 12-seat fixed-fee scenario, privacy/role matrix, last-seat/party/race boundaries, payment/waiver/attendance independence, email/reminder behavior, responsive accessibility and PWA install/offline failure checks. Fix in-scope integration defects and record exact version/environment/date/coverage.

**Excluded:** new MVP features, broad load infrastructure, an end-to-end automation suite, production deployment, real-data pilot and claims that provider stand-ins prove live receipt.

### Suggested Models & Reasoning

- **Platform/model:** agent capable of cross-layer verification and diagnosing concurrency/privacy failures; exact model unverified.
- **Reasoning:** high.
- **Reason:** the evidence must connect UI actions, authoritative data and external delivery without overclaiming any layer.

### Acceptance Criteria

1. An organizer publishes/shares the event; eligible signed-in participants/guest parties confirm or waitlist; withdrawal promotes the right party; payment/waiver controls and attendance complete the agreed loop with recorded evidence.
2. Concurrent last-seat joins, one vacancy before a two-seat party, duplicate retries, cutoff/start boundaries and interrupted actions preserve seats, fee records and truthful displayed status.
3. Visitor/participant/organizer/co-host and unrelated-group identities see only their permitted data, including direct reads/mutations; private financial/attendance data is absent from public responses and email previews.
4. A narrow-screen and keyboard walkthrough covers loading/empty/error/recovery states and non-color status cues. The PWA installs on the accepted test environment; offline mutations cannot claim success and identity-specific state does not leak across sign-out/account change.
5. Actual adopted project checks pass. Email adapter stand-in evidence and any separately authorized live recipient evidence are reported distinctly. Missing required integration evidence is a blocker, not a completion claim.
6. The report names remaining MVP gaps and D-08/D-09 pilot/launch gates. It makes no deployment, real-data readiness or full-MVP claim.

### Dependencies

- **Blocked by:** P-05/P-06/P-07, their transitive prerequisites, accepted first-loop product/technical gates and authorized delivery-test scope where live evidence is required.
- **Blocking:** owner acceptance of this increment; no later task is invented here.
- **Readiness:** conditional.

### Execution Context and Verification

- **Read/reuse:** actual implementations and focused tests from P-02 through P-07; PRD accepted rules; AGENTS evidence policy.
- **Checks:** relevant adopted suites once, focused data/role/concurrency checks and an actual browser/runtime walkthrough. Add focused regression tests for discovered behavior defects; do not introduce a new end-to-end suite without authorization.
- **Commands:** README's adopted commands plus exact recorded browser/device, store and delivery environments; do not substitute a documented command for an executed result.

### Manual Test

Future-runtime procedure: use one organizer, a synthetic co-host, an unrelated account and enough synthetic participant parties for 12 seats plus a waitlist. Follow the full create/share/join/withdraw/promote/payment/check-in path. Repeat with the one-seat/two-person-party boundary, a post-cutoff withdrawal, lost responses and unavailable email. Install/open the PWA, test offline failure and switch identities; record every expected result and any gap.

## Review and creation boundary

The owner authorized publication of all eight tasks in the selected RallyPoint Linear project. Each issue must retain the reviewed scope, schema and actual blocking relationships. The earlier archived TP-01–TP-06 batch remains history; do not restore it or create duplicate active work. Linear owns execution status; this document records the reviewed brief and publication provenance, not a status mirror.

Recheck the selected team/project and current access before task writes, reuse any matching active P-01–P-08 issue on retry, and map proposal references to actual identifiers/dependencies. Link the documentation PR and immutable reviewed documents from the issues. Connection setup, task creation and application implementation remain distinct authorizations.

This reviewed batch authorizes task publication only as explicitly requested. It authorizes no application execution, outbound participant messages, account setup, repository creation, merge or deployment.
