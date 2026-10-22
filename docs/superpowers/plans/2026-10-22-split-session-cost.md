# Split Session Cost Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The owner must review this plan and select the execution method first.

**Goal:** Let organizers publish a total session cost, show estimates, finalize exact seat shares after start, and make reviewed corrections without rewriting payment history.

**Architecture:** Extend the existing Next.js modular application. Keep contingent split claims separate from monetary obligations; Postgres creates immutable split snapshots and exact seat allocations atomically, while the existing party fee record remains the current payment projection. Preserve fixed-fee records and reuse current managed identity, role checks, request receipts and UI components.

**Tech Stack:** Existing pinned pnpm/Turbo, Next.js/React/TypeScript, Supabase Auth/Postgres 17 and Node test runner. No new dependency, service, cache or payment provider.

**Spec:** [Accepted split specification](../specs/2026-10-22-split-session-cost-design.md). Baseline is documentation commit `84ef3fc` over application baseline `a4480d9`; recheck relevant changes if `main` advances before execution.

## Global Constraints

- “Existing records remain fixed-fee records; do not reinterpret their amounts as session totals.”
- “Payment tracking follows finalization.” This restriction is for split sessions; existing fixed-fee timing stays intact.
- “Before-cutoff withdrawal removes contingent unpaid liability and its seats from the denominator.” Retain unwaived late-withdrawn seats, including when replaced; waiting contributes no liability.
- “Neither a paid marker nor check-in/no-show status decides whether a seat pays.”
- “Each correction's total must be no greater than the current effective total.” Currency is immutable after bookings; never create a new liable party through correction.
- “Never automatically clear or carry a paid marker onto a different amount.”
- “Public/link visitors receive no payer identities, individual cancellation liabilities, payment markers or financial history.”
- “No provider setup, database reset or production migration occurs during specification work.” Execution also preserves the current local project/data; production changes require separate authorization.
- Use the existing currencies SGD/USD/EUR/GBP (2 minor decimals), JPY (0), KWD (3); monetary JSON integers remain within `0..9007199254740991`.
- Follow PRD D-13: reuse device timezone/default controls; no user-facing revision IDs, technical mechanics, decorative copy or repeated fee/cutoff paragraphs.
- This is chat-only work: no external task creation/status writes. Check branch before edits/each commit/each push. No merge, auto-merge, deployment or unrelated publication.

## Review Focus

1. The same person withdraws late then joins again: retain the old claim and count the new party separately; do not deduplicate financial liability by user ID. Test in Task 2.
2. A waiver predates finalization and is undone afterward: require reviewed reallocation, never manufacture an amount or revive a before-cutoff withdrawal. Test in Task 4.
3. A two-seat party receives uneven minor units: its bill is the sum of seat allocations, not a rounded unit price multiplied by two. Test in Tasks 1 and 3.
4. A marker or waiver changes between preview/apply, or a role is revoked during recovery: reject stale/unauthorized work without duplicate runs; attendance alone must not stale the financial basis. Test in Tasks 3 and 4.
5. A correction reason mentions another participant: only managers see the reason; own history uses a generated amount-change explanation. Test in Tasks 4 and 5.

## File and Contract Map

| File                                                                                                                                         | Responsibility                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Create `packages/domain/src/fees.ts`                                                                                                         | Fee modes, split DTOs, exact allocation/estimate helpers                                                        |
| Modify `packages/domain/src/session.ts`, `registration.ts`, `package.json`                                                                   | Fee configuration normalization, compatible projections and `./fees` export                                     |
| Create `packages/api/src/splits.ts`; modify `index.ts`, `registrations.ts`                                                                   | Managed split routes and pending/finalized payment transitions                                                  |
| Modify `packages/api/src/sessions.ts` only if needed by fee validation                                                                       | Reuse session save/read routes; no parallel session API                                                         |
| New migrations ending `_split_cost_claims.sql`, `_split_cost_finalization.sql`, `_split_cost_corrections.sql`                                | Additive claims, immutable runs/allocations, compatible fee projection and protected RPCs                       |
| Create `tests/split-domain.test.mjs`, `tests/split-claims.test.mjs`, `tests/split-finalization.test.mjs`, `tests/split-corrections.test.mjs` | Focused unit and real-local Auth/API/Postgres tests                                                             |
| Create `tests/helpers/split-fixtures.mjs`                                                                                                    | Synthetic fixtures/cleanup and clock/lock fixtures reused by split integration tests                            |
| Create `apps/web/src/split-controls.tsx`, `split-fee.tsx`                                                                                    | Managed preview/apply/correct flow and own/pending split displays                                               |
| Modify `apps/web/src/session-pages.tsx`, `registration-panel.tsx`, `fee-controls.tsx`, `screens.tsx`, `styles/pages.css`                     | Creation, consent, roster, payment controls and own Dues                                                        |
| Modify `docs/foundation-api.md`, `README.md`                                                                                                 | Maintain the actual interface and setup/manual validation; do not introduce a second API specification/platform |

Migration paths above are suffixes, not invented timestamps. At execution, create each with `pnpm exec supabase migration new <name>` using the stated name, then use its actual generated path. CLI help for this, `db advisors --local`, and `migration list --local` was checked during planning. Inspect relevant current Supabase docs/changelog before SQL implementation.

### Shared domain interfaces (Task 1 owns these)

Export from `@rallypoint/domain/fees`:

```ts
type FeeMode = "fixed" | "split";
interface SplitParty {
  partyId: string;
  queueSequence: string;
  seats: 1 | 2;
}
interface SplitSeat {
  partyId: string;
  seat: 1 | 2;
  amountMinor: number;
}
interface SplitPartyAmount {
  partyId: string;
  chargedSeats: 1 | 2;
  totalMinor: number;
}
interface SplitAllocation {
  state: "allocated" | "unallocated";
  totalMinor: number;
  payingSeats: number;
  unallocatedMinor: number;
  seats: SplitSeat[];
  parties: SplitPartyAmount[];
}
interface SplitSummary {
  phase: "estimating" | "finalized" | "unallocated";
  currency: string;
  totalMinor: number;
  payingSeats: number;
  estimatedSeatRange: { minMinor: number; maxMinor: number } | null;
  prospectivePartyMinor: { one: number; two: number | null } | null;
}
interface OwnSplitClaim {
  eligible: boolean;
  waived: boolean;
  estimateMinor: number | null;
}
interface ManagedSplitClaim extends OwnSplitClaim {
  revision: number;
}
interface OwnSplitChange {
  previousMinor: number | null;
  currentMinor: number | null;
  at: string;
  kind: "total_reduced" | "waiver_redistributed" | "waiver_restored";
}
```

Also export `feeModeOf(details: {feeMode?: unknown}): FeeMode`,
`allocateSplit(totalMinor: number, parties: readonly SplitParty[]): SplitAllocation`
and `estimateNextParty(totalMinor: number, payingSeats: number, seats: 1 | 2): number`.
Queue sequences are decimal strings; compare through `BigInt`, never lossy JSON numbers.
`estimateNextParty` treats the prospective party as the newest queue entry.

Add optional `feeMode` to legacy `SessionForm`/`SessionDetails`; absent means fixed.
Continue using form `fee` as the entered amount. Normalized fixed details use
`feeMinor`; split details use `totalMinor`, never a fake per-seat `feeMinor`.
For omitted-mode legacy input, keep `feeMode` omitted in normalized output too;
use `feeModeOf` at reads. Do not break old operation-receipt payload equality or
make a no-change save of a booked fixed session look like a material edit.
Normalize zero-cost creation to fixed/free. Add optional `mode`/`splitRunId` and
nullable `unitMinor` to `Fee`; fixed JSON keeps its current meaning/values.
Add `split?: SplitSummary` to shared sessions and registration views;
`splitClaim?: OwnSplitClaim` and `splitHistory?: OwnSplitChange[]` to own parties;
manager roster claims use `ManagedSplitClaim`. Waiting parties have no claim or fee.

### Shared managed operation contract (Tasks 3 and 4 own this)

Define in `fees.ts`:
`SplitPreviewInput = {intent: "finalize"} | {intent: "correct"; totalMinor: number; undoWaiverPartyId?: string}`.
`SplitPreview` is `Omit<SplitAllocation,"parties">` plus `basis: string`,
`currency: string`, `currentRunId: string | null`, `blockedPaidPartyIds: string[]`,
and `parties: SplitPreviewParty[]`. `SplitPreviewParty` extends `SplitPartyAmount`
with `previousMinor: number | null`, `markedPaid: boolean`, `primaryName: string`,
`guestName: string` and `changes: OwnSplitChange[]` (empty for initial allocation).
These manager fields never appear in public/ordinary participant projections.

`ManagedSplitView` returns `summary: SplitSummary`, `currentRunId: string | null`,
`revision: number`, `uncoveredMinor: number`, and `history` rows with run ID,
total/currency/paying seats, actor/time/reason and per-party before/after amounts.

- GET `/api/splits/:slug` → `{split: ManagedSplitView}`; current managers only.
- POST `/api/splits/:slug/preview`, body `SplitPreviewInput` → `{preview: SplitPreview}`. Read-only, no operation receipt; preview is allowed before start, apply is not.
- POST `/api/splits/:slug/finalize`, body `{operationKey, basis}`.
- POST `/api/splits/:slug/correct`, body `{operationKey, basis, totalMinor, reason, undoWaiverPartyId?}`. Reason is trimmed, 1–300 characters.
- Both successful apply operations return `{operationKey, committedRunId, registration: RegistrationView, split: ManagedSplitView}`; existing GET `/api/operations/:key` returns the same envelope shape. `committedRunId` names that receipt's immutable run, while `split.currentRunId` can name a later correction. Recovery never relabels an old committed action as the later one.
- `basis` is a 64-character SHA-256 fingerprint of canonical trusted financial state and preview intent/inputs. Include session lifecycle/start/configuration, current run/revision, every eligible/excluded claim revision and relevant fee revision/marker; exclude attendance. Recompute under apply locks; it is a concurrency token, never authorization.
- Errors: 401/403 retain existing identity/role codes; 422 `invalid_split`; 409 `split_not_finalized`, `split_already_finalized`, `split_too_early`, `split_unavailable`, `stale_split`, `split_total_increase`, `split_paid_allocation`, `split_undo_requires_review`, or existing `idempotency_conflict`; 503 retains ambiguous-result recovery. No-store JSON everywhere.

### Common execution/test boundary

Use the existing managed worktree or suitable isolated successor; preserve primary-checkout edits. Recheck the branch/spec and run `pnpm check` plus baseline `pnpm test:api` with the local app/DB ready before implementation. Do not interpret historical passing counts as the new baseline.

For SQL-bearing tasks, create a restricted local backup under ignored `output/` before the first migration, then use `pnpm db:start` to apply pending versioned migrations without resetting data. Do not overwrite applied migrations. Run `pnpm db:lint`, `pnpm exec supabase db advisors --local --type security`, and `pnpm exec supabase migration list --local`; compare pre-existing advisory findings rather than claiming every historical warning is new. No production/linked commands.

Recovery: if a migration fails, stop split writes and inspect transaction/migration state; do not blindly reapply partially executed SQL. Use a reviewed forward repair, or restore the isolated synthetic backup when appropriate. Once split records exist, do not revert to an old application that would read a null legacy generated total as a free split; preserve split reads/history and repair forward. Never drop financial history to recover.

All new tables enable RLS, revoke `public/anon/authenticated` access and grant only needed service-role operations. Functions are security invoker with empty search path and qualified objects. Writers acquire request advisory lock, group lock/current-role check, session lock, then affected claim/fee rows in stable party-ID order. Direct browser RPC calls must fail.

For every task: observe its focused behavioral RED before implementation, make it GREEN, run its relevant existing regression tests, check the branch, and commit only that coherent task. After final validation, follow AGENTS.md's human-review delivery gate; do not assume this plan authorizes a new remote upload.

---

### Task 1: Exact allocation and compatible fee configuration

**Files:** Create `packages/domain/src/fees.ts`, `tests/split-domain.test.mjs`; modify `packages/domain/src/session.ts`, `registration.ts`, `package.json`, and `tests/sessions.test.mjs`.

**Interfaces:** Produces all shared domain interfaces above. `feeModeOf` defaults omitted modes to fixed; `normalizeSession(value, publish)` preserves draft strings and enforces the chosen mode/precision on publication. All exported arithmetic helpers reject unsafe/non-integer/negative amounts, duplicate party IDs, invalid sequences/seats and unsafe aggregate counts with `InputError`.

- [ ] **Step 1: Add domain RED cases** including these exact assertions:

```js
const parties = [
  { partyId: "a", queueSequence: "9007199254740993", seats: 2 },
  { partyId: "b", queueSequence: "9007199254740994", seats: 1 },
];
assert.deepEqual(
  allocateSplit(10000, parties).seats.map((s) => s.amountMinor),
  [3334, 3333, 3333],
);
assert.deepEqual(
  allocateSplit(10000, parties).parties.map((p) => p.totalMinor),
  [6667, 3333],
);
assert.equal(allocateSplit(12000, []).unallocatedMinor, 12000);
assert.equal(estimateNextParty(12000, 5, 1), 2000);
assert.equal(feeModeOf({}), "fixed");
assert.throws(
  () => allocateSplit(Number.MAX_SAFE_INTEGER + 1, parties),
  InputError,
);
```

Add table cases `T=1,N=3 → [1,0,0]`, `T=0,N=3 → [0,0,0]`, reordered input with identical output, `MAX_SAFE_INTEGER` exact conservation, duplicate IDs/invalid seats, and currency normalization SGD `100.00 → totalMinor=10000`, JPY fractions rejected, KWD `1.234 → 1234`. Existing omitted-mode `12.50` stays `feeMinor=1250` with no added `feeMode`; zero stays free. The sum of party amounts must equal `T` whenever payers exist.

- [ ] **Step 2: Run** `node --test tests/split-domain.test.mjs`; expect a meaningful missing-helper/incorrect-result failure. Keep pure cases independent of running Supabase.
- [ ] **Step 3: Implement the declared helpers and normalized fields.** Use integer/BigInt division/remainder, sort sequence then party ID, primary before guest, and sum seat allocations into parties. Export `./fees`. Use explicit `.ts` local imports for the Node tests; keep `session.ts` imports of fee types type-only so sharing its existing `InputError` does not create a runtime import cycle. Do not introduce a second money formatter or redefine a split estimate as `Fee`.
- [ ] **Step 4: Run** `node --test tests/split-domain.test.mjs` and `pnpm --filter @rallypoint/domain typecheck`; expect all cases and typecheck to pass. Validate the existing normalization tests through the normal session suite once the app is running.
- [ ] **Step 5: Commit** the domain change as `Add exact split allocation and compatible fee modes`, after checking the isolated branch.

### Task 2: Contingent claims, estimates and pending waivers

**Files:** Create CLI-generated `supabase/migrations/*_split_cost_claims.sql`, `tests/helpers/split-fixtures.mjs`, `tests/split-claims.test.mjs`; modify `packages/api/src/registrations.ts`, `docs/foundation-api.md`. Consume Task 1 domain types; include session normalization adapter changes in `sessions.ts` only if required.

**Interfaces:** The migration adds `app.split_claims(party_id PK, eligible boolean, waived boolean, revision integer, changed_at, changed_by)` and append-only `app.split_claim_changes` with claim revision, action, actor/name/time. A claim is created once only on confirmation/promotion. A waitlist party has no claim. `app.split_summary(p_session uuid) returns jsonb` supplies `SplitSummary`; `app.split_claim(p_party uuid,p_managed boolean) returns jsonb` supplies the proper claim projection. Extend `api.save_session`, `api.read_shared_session`, `app.registration_view`, `app.fill_waitlist`, `api.join_session`, `app.release_withdrawal_fee` and `api.update_payment`; do not lose the latest attendance projection.

Fixture contract: export `splitFixture(t, {total: string, seats: readonly (1|2)[], currency?: string, cutoffPast?: boolean})`. It creates a synthetic split session and confirmed parties, returns `session`, `organizer`, `actors`, `parties`, `get(actor,path)`, `post(actor,path,body)` (both return `Response`), `sql(query): string`, `moveStart(offsetMs): void`, and `lockStart(offsetMs,holdMs): Promise<{finished: Promise<void>}>`. Reuse local-only Auth/SQL patterns from payment/withdrawal tests; every fixture registers cleanup through `t.after`. Clock fixtures alter only their synthetic session in a transaction, restore guards on error, and never introduce a production clock override. Do not refactor unrelated test suites.

Include optional `capacity: number` in fixture options; default to `max(1, sum(seats))` and create two extra synthetic actors for later join/waitlist cases. `seats` names the initial confirmed parties, so reject fixture configuration where their sum exceeds capacity. Cleanup is scoped to recorded synthetic IDs; extend it when later tasks add dependencies.

- [ ] **Step 1: Add real-local RED subtests.** Publish via existing `/api/groups/:id/sessions` with `{feeMode:"split",fee:"120.00"}`; assert saved `totalMinor===12000`, no per-seat `feeMinor`, and booked edits remain refused. For fixture `seats:[1,1,1,1,1,1]`, assert `own.fee===null`, `own.splitClaim.estimateMinor===2000` for each confirmed party, and `mark_paid`/`mark_unpaid` each return `409 split_not_finalized`.

Pin these transition cases to exact assertions: pending `waive` removes that party's seats from `split.payingSeats`; undo restores only eligible seats; early withdrawal sets `eligible=false` even if already waived; undo afterward leaves it false; late withdrawal preserves it; promotion creates one claim; waiting creates zero; late withdrawal then same-person rejoin creates two eligible party claims. Existing fixed `12.50` plus guest remains `totalMinor===2500` and can still be marked paid before start. Public and confirmed-other-party JSON must not include claim identities/history.

- [ ] **Step 2: Run** `node --test --test-concurrency=1 tests/split-claims.test.mjs`; expect unsupported total mode or missing-claim behavior to fail, not a missing local service.
- [ ] **Step 3: Implement pending claims and projections in the generated migration.** Branch on `coalesce(details->>'feeMode','fixed')`; validate split `totalMinor` and fixed `feeMinor` independently in trusted SQL. Do not backfill session JSON through the booked-edit guard. Reuse the same post-lock instant for withdrawal and eligibility, and the existing queue/receipt boundary. Pending `waive`/`undo_waiver` uses the existing payment route with the claim revision; mark actions are denied until an allocation exists. Extend payment request errors accordingly. Build estimates with the same integer/rank algorithm as Task 1; expose only aggregates publicly and own claim amounts privately. Do not create zero-valued `fee_obligations` as estimates.
- [ ] **Step 4: Apply locally and run** this task's suite, `node --test --test-concurrency=1 tests/registrations.test.mjs tests/withdrawals.test.mjs tests/payments.test.mjs tests/attendance.test.mjs`, and the SQL checks above. Expect exact financial/queue results and no new privilege findings. Cleanup removes claim history before claims/parties, only for fixture IDs.
- [ ] **Step 5: Update the interface reference and commit** as `Add split claims and live estimates without premature dues`. Include generated migration, fixtures, tests and pending-state contract together.

### Task 3: Atomic organizer finalization and exact fee projections

**Files:** Create generated `supabase/migrations/*_split_cost_finalization.sql`, `packages/api/src/splits.ts`, `tests/split-finalization.test.mjs`; modify `packages/api/src/index.ts`, domain `fees.ts`/`registration.ts` as needed to realize the declared DTOs, `docs/foundation-api.md`, and new fixture cleanup.

**Interfaces:** Export `splitRoute(path: string): boolean` and `splitRequest(request: Request, client: SupabaseClient, user: User): Promise<Response>` from `splits.ts`. Route them through the existing verified-user boundary before generic session dispatch. Implement `api.read_split(p_actor_id uuid,p_slug uuid)`, `api.preview_split(p_actor_id uuid,p_slug uuid,p_input jsonb)` and `api.finalize_split(p_actor_id uuid,p_actor_name text,p_key uuid,p_slug uuid,p_basis text)`, all returning the shared JSON envelopes. SQL helper `app.split_allocation(p_session uuid,p_total_minor bigint,p_undo_party uuid default null) returns jsonb` is the authoritative allocation counterpart to the domain helper.

Storage: add session `split_revision` (initial 0), `current_split_run_id` (nullable); immutable `app.split_runs` with session/revision/total/currency/paying count/state/basis/actor/name/time/reason, and `app.split_allocations` keyed `(run_id,party_id,seat)` with exact minor amount. Use a unique `(session_id,revision)` and indexed run/party lookups. Store a complete basis snapshot, including excluded claims and relevant fee revisions, so later review is reproducible.

For exact current fees, add `mode` (default fixed), nullable `split_total_minor` and `split_run_id` to `app.fee_obligations`; relax `unit_minor` NOT NULL only under a check requiring fixed unit amounts or an exact split amount/run. Leave the legacy generated `total_minor=unit_minor*charged_seats` intact for fixed rows; it is null for split rows. `app.party_fee` returns the explicit split total or existing fixed total, never multiplies a rounded split unit. Preserve all old fixed values/markers. Extend managed fee/change history with amount/currency/run snapshots before the first split is written; never erase existing actions.

- [ ] **Step 1: Add finalization RED cases** using Task 2 fixtures:

```js
const f = await splitFixture(t, { total: "100.00", seats: [2, 1] });
const path = `/api/splits/${f.session.slug}`;
const preview = (
  await (
    await f.post(f.organizer, `${path}/preview`, { intent: "finalize" })
  ).json()
).preview;
assert.deepEqual(
  preview.parties.map((p) => p.totalMinor),
  [6667, 3333],
);
assert.equal(
  (
    await f.post(f.organizer, `${path}/finalize`, {
      operationKey: crypto.randomUUID(),
      basis: preview.basis,
    })
  ).status,
  409,
);
f.moveStart(-1000);
// Obtain a fresh preview after changing the synthetic start/basis, then apply.
```

Assert after apply `own.fee.totalMinor` is 6667/3333 respectively, `unitMinor===null`, exactly one run and three seat rows, correct actor/time, and no extra claim/party/attendance writes. Empty-payer total 12000 creates one unallocated run and no fees. A one-minor-unit split gives zero shares **Nothing due**, not paid. Anonymous/participant/outsider/revoked-manager callers cannot preview/finalize or call RPCs directly.

Add exact/after-start and lock-wait-crossing tests using `lockStart`; explicit internal helper instants can exercise equality without a browser clock. A cancelled session refuses new finalization. Apply two distinct keys against the same preview: one effective run, one `409`; same key/payload replays `200`, changed payload conflicts. Change a waiver after preview → `409 stale_split`, zero run writes. Attendance-only change leaves the basis valid. Recovery after role revocation is denied.

- [ ] **Step 2: Run** `node --test --test-concurrency=1 tests/split-finalization.test.mjs`; expect missing route/RPC/finalization failure.
- [ ] **Step 3: Implement storage, trusted preview/apply and projections.** Fingerprint canonical JSON with Postgres 17 `encode(sha256(convert_to(...,'UTF8')),'hex')` ([official binary-string reference](https://www.postgresql.org/docs/17/functions-binarystring.html)); no new crypto extension/dependency. Role-check even on replay, verify the fingerprint and post-lock clock before any new write, and atomically write run/seat rows/current fee projection/session pointer/receipt. A receipt names the committed run. Extend `api.read_operation` while preserving its latest attendance/payment branches. Enable split `mark_paid`/`mark_unpaid` only after exact positive allocations exist; reject marking zero shares paid with `payment_transition_invalid`. Payment markers change no split or attendance state.
- [ ] **Step 4: Apply locally and run** finalization, claim, payment and attendance suites; verify SQL against domain outputs including max-safe totals and guest rounding. Run SQL checks. Inspect public, own, manager and `/api/dues` projections independently. Extend Dues to `{dues:DuesItem[],splitClaims:SplitClaimDuesItem[]}`. Define `SplitClaimDuesItem` in `registration.ts` with `partyId`, `partyState`, `seats`, `session:DuesItem["session"]`, `split:SplitSummary`, `splitClaim:OwnSplitClaim`; no fee, manager reason or other party rows. `splitClaims` contains own claim records without a fee: pending estimates plus waived/removed claims that never received an allocation, including after finalization. Never duplicate a party already in `dues`. Keep the existing dues limit of 200; apply the same bound to claim items. Positive unpaid amounts come first; zero says nothing due. After finalization, use the current run's frozen aggregate basis and set own `estimateMinor=null`; ordinary waivers do not produce new live estimates. In cleanup, clear the synthetic session's current-run pointer and delete dependent fee/change/seat rows before split runs/claims/parties; preserve attendance cleanup for fixtures that recorded it.
- [ ] **Step 5: Update the interface reference and commit** as `Finalize exact split allocations with protected recovery`. Keep DB arithmetic versus domain comparison evidence with the task.

### Task 4: Reviewed corrections, historical amounts and waiver undo

**Files:** Create generated `supabase/migrations/*_split_cost_corrections.sql`, `tests/split-corrections.test.mjs`; modify `packages/api/src/splits.ts`, `registrations.ts`, domain fee/history types, `docs/foundation-api.md`, and fixture cleanup.

**Interfaces:** Implement `api.correct_split(p_actor_id uuid,p_actor_name text,p_key uuid,p_slug uuid,p_basis text,p_total_minor bigint,p_reason text,p_undo_party uuid default null) returns jsonb`. Complete the `intent:"correct"` branch of `api.preview_split`. Applying creates a new immutable run and updates only affected current fee projections with bumped revisions and before/after history. Own `splitHistory` is a safe generated change summary, never the manager's free-text reason or another party's amounts. GET managed split history keeps full attributable reasons/snapshots.

- [ ] **Step 1: Add correction RED cases.** Finalize 12000 across three solo seats: each owes 4000. Mark party A paid; lowering to 9000 must return `409 split_paid_allocation` with no new run, changed amount or marker. After explicit audited `mark_unpaid` and a fresh preview, lowering succeeds with `[3000,3000,3000]`; prior 4000 amounts and marker actor/time remain inspectable. A requested total of 9001 after that correction returns `409 split_total_increase`.

Pin waiver cases: a post-finalization waiver preserves the original 4000 allocation, leaves others at 4000, and shows uncovered 4000; undo restores that 4000 with no new run. Reviewed redistribution after waiver changes the two remaining shares to 6000 each if neither affected fee is paid. If a party was waived before the initial split, plain `undo_waiver` returns `409 split_undo_requires_review`; the explicit correction with its `undoWaiverPartyId` produces a new run and 4000 shares from two prior 6000 shares. A before-cutoff-withdrawn or waiting party cannot be reintroduced. Test restore from an unallocated run as well.

Also test a waiver that occurs after the first run and is subsequently redistributed: plain undo must now return `409 split_undo_requires_review`; reviewed undo returns the three shares to 4000, never an extra 4000 on top of two 6000 bills. Ordinary undo is safe only when the current run contains that party's allocation. Check current-run allocation membership, not `fee.splitRunId`, because an unchanged paid fee can intentionally retain its earlier payment basis. `uncoveredMinor` is the current effective total minus current nonwaived allocations, not the sum of every historical waived fee.

Pin stale/permission/privacy cases with exact assertions: payment or waiver changes after preview → `409 stale_split` and zero writes; one of two concurrent corrections succeeds; duplicate request replays one run; reused key with different total/reason conflicts; old payment revision is refused after repricing; unauthorized/revoked callers and direct RPC users fail. Give manager reason `"Private note about another payer"`; assert it is absent from all public/ordinary participant JSON and present only for managers. Own history contains only the actor's party amount changes, with no participant-wide basis rows or actor identifiers.

After a later correction, recover the initial finalization request: assert its `committedRunId` still names the first run, `split.currentRunId` names the correction, and no extra run is created. A pre-finalization waived claim without a fee remains visible in own Dues as waived, with no invented zero payment or estimate after finalization.

- [ ] **Step 2: Run** `node --test --test-concurrency=1 tests/split-corrections.test.mjs`; expect unsupported correction/incorrect transition failures.
- [ ] **Step 3: Implement correction and waiver branching.** Initial-finalization snapshots never change. Recompute proposed allocation at the same or lower effective total using current eligible/unwaived claims, optionally undoing only the named originally eligible claim. Block changing any currently paid allocation; preserve markers on unchanged amounts. A post-finalization ordinary waiver/undo changes the current fee liability and matching claim disposition without auto-repricing; its history changes the next preview fingerprint. If the party has no allocation in the current run, require reviewed undo instead. Paid fees retain the existing mark-unpaid-before-waive rule. Before-cutoff exclusion remains permanent eligibility evidence. Corrections never modify session details, party/queue state or attendance. Extend fee history/check constraints with `split_corrected`, old/new amount and run basis, alongside existing marker actions. Initial allocation is recorded by its immutable run; do not fabricate a paid/unpaid marker action for it.
- [ ] **Step 4: Apply locally and run** correction/finalization/claim/domain suites plus payment/attendance regressions and SQL checks. Assert current allocations conserve each run's total; waived amounts reduce collectible dues without altering historical conservation. Cleanup includes split allocation/run history without deleting shared fixtures.
- [ ] **Step 5: Update the interface reference and commit** as `Preserve split history through reviewed corrections and waivers`.

### Task 5: Complete the organizer/participant flow and verify delivery

**Files:** Create `apps/web/src/split-controls.tsx`, `split-fee.tsx`; modify `session-pages.tsx`, `registration-panel.tsx`, `fee-controls.tsx`, `screens.tsx`, `styles/pages.css`, `README.md`; extend existing API tests only for meaningful regressions not already covered. No new end-to-end framework.

**Interfaces:** `SplitControls({slug:string,onDone:(view:RegistrationView)=>void}):ReactElement` loads managed split state and uses the declared preview/apply operations. `SplitFee({summary:SplitSummary,claim?:OwnSplitClaim,fee?:Fee|null,history?:OwnSplitChange[]}):ReactElement` renders the correct pending/final/waived/zero/removed state. `PendingSplitControls({slug:string,partyId:string,claim:ManagedSplitClaim,onDone:(view:RegistrationView)=>void}):ReactElement` reuses the existing payments route for pending waiver/undo only. These components use `@rallypoint/ui` controls and current notices/sheets/recovery. No financial calculation is authoritative in React.

- [ ] **Step 1: Observe browser RED on the existing app.** The editor has only a per-seat amount; split creation, pending claims and finalization controls are absent. Using synthetic records from Tasks 2–4, record inability to complete total-cost → estimate → finalize → own Dues, without claiming server failures. Add any missing focused API assertion for the exact projection the UI consumes before implementing it.
- [ ] **Step 2: Implement the fee-mode input and split displays.** Preserve one amount/currency control, form values on failure and the booked-editor lock. Shared/public details show the total/estimate, not “total per seat.” Candidate solo/guest estimates use Task 1 helper/current aggregate, remain explicitly conditional on confirmation, and use “No split yet” at zero payers. Keep the estimate visible after start until finalization. Dues renders eligible/unwaived estimating `splitClaims` under “Estimated”, distinct from “To pay”; waived/removed claim-only records go under “Settled” with their status and no invented monetary value. Final zero shares say “Nothing due.” All arrays are keyed by party ID, so rejoining does not hide older liability in Dues.
- [ ] **Step 3: Implement managed preview/finalize/correct and existing fee-control integration.** Display exact party amounts and before/after differences, concise start restriction, reason input for correction, and paid-allocation blockers. Never show internal fingerprint/revision terminology. Keep current controls for fixed fees and attendance. Pending claims expose waiver/undo but no paid controls; pre-finalization-waiver undo after finalization opens the reviewed correction flow. Do not allow “Mark paid” on a zero share. Show own safe change explanations; manager reasons stay protected.
- [ ] **Step 4: Verify in the real browser at mobile and desktop sizes.** Exercise creation/draft/publication, solo/+1 consent, early/late withdrawal and replacement, pending waiver, delayed finalization after start, preview refresh after stale state, positive paid/unpaid markers, blocked paid correction, ordinary waiver, reviewed undo and own history/Dues. Use synthetic clock fixtures to reach start without waiting. Interrupt a committed finalize/correct response: controls remain blocked until “Check result” resolves exactly one result. Revoke a co-host and switch accounts; no private state leaks. Check keyboard sheet/preview focus, errors/empty/loading states, and own/public/manager differences. Inspect screenshots and console output; log only synthetic data.
- [ ] **Step 5: Run final adopted checks** `pnpm check`, `pnpm db:lint`, and `pnpm test:api` with the app/DB ready, plus local advisors/migration list. Run `pnpm build` → `pnpm start` and `pnpm build:cloudflare` → `pnpm preview` sequentially, never overlapping builds in one checkout; exercise the changed financial flow on the final production artifacts and the API suite on each relevant runtime. Inspect the full diff, generated-artifact/secret exclusion, primary-checkout preservation and migration compatibility. Tests must pass against the resulting code; historical counts are not evidence. Update README manual steps and add a plain user note describing total-cost estimates/finalization and correction limits.
- [ ] **Step 6: Commit** as `Let organizers create and finalize total-cost sessions`, after checking the branch. If a review PR is authorized, push only after a fresh branch check, create/attach the actual PR with date/runtime/version/results and gaps, and stop for human review. Never merge/deploy from this plan alone.

## Self-Review and Handoff

Coverage: spec configuration/estimates/consent → Tasks 1, 2, 5; paying-seat integrity → Task 2; exact arithmetic/finalization/recovery → Tasks 1 and 3; waivers/corrections/history → Task 4; role/privacy/UI/Dues → Tasks 2–5; backward compatibility and runtime evidence → every task, completed in Task 5. Each Review Focus item has an explicit owning test above.

This plan is a document awaiting owner review, not evidence that the feature or tests exist. No new task, migration, endpoint or product code is created by writing it. Recommend **Native execution**: five tasks share the same financial interfaces and lock/receipt behavior; one implementer can carry that context, followed by one independent whole-branch review. The owner may choose subagent-driven execution instead; do not spawn implementation agents before that choice.
