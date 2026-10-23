# P-16 Booked Session Edits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for this inline implementation.

**Goal:** Implement accepted D-14 booked-session edits, preserving consent, seats and payment history.
**Architecture:** Existing group → session locking and save receipts remain authoritative. A migration replaces the blanket lock with field validation, atomically records private material-change signals and promotes capacity increases. Withdrawal compares original consent with material-change history. The web editor confirms material changes and keeps booking rules disabled.
**Tech Stack:** Next.js, React, Hono, TypeScript, Supabase/Postgres; adopted local Node integration tests.
**Spec:** ../specs/2026-10-22-post-booking-edit-decisions.md; Linear WDL-391.

## Global Constraints

- P-06 is paused and excluded. Do not edit its worktree, email dispatcher or reminder schedules.
- Preserve current payment-mode, unpaid-release and check-in behavior.
- No live migrations, deployment, merge or direct pushes to main.
- Use a separate local Supabase project and an identical product-source snapshot; only test harness container/port literals change in that private snapshot.
- Follow the direct implementation request under AGENTS.md; D-14 is already accepted.

## Review Focus

Inspect receipt replay after start and after co-host revocation; direct SQL trigger protection versus API validation; missing/removed JSON keys; canonical instant comparisons and preserved timezone; capacity promotion combined with a material change; consent of promoted waitlisted parties; paid markers and historical withdrawn fees; atomic signal/audit creation and browser privacy; confirmation/retry behavior.

### Task 1: Authoritative policy and integration behavior

**Files:** new Supabase migration; tests/booked-edits.test.mjs; apps/api/src/sessions.ts; docs/foundation-api.md.

- [x] Write API tests for allowed descriptive edits, immutable rules, capacity and strict queue, material signals, cutoff coupling, withdrawal consent, paid preservation, split claims, permissions, stale versions, retries and post-lock start boundaries.
- [x] Run focused tests against the separate pre-change database.
  Command: RALLYPOINT_TEST_URL=http://127.0.0.1:3002 node --test --test-concurrency=1 tests/booked-edits.test.mjs
  Expected: new policy cases fail on the original blanket lock.
- [x] Create migration with CLI, replace booked guard/save validation, record material change plus one private durable signal and implement affected withdrawal history. Preserve old migration history.
- [x] Update API errors and contract docs. Run focused tests.
  Expected: all focused tests pass.
- [x] Commit policy and tests.
- [x] Final task command: same focused test command above.
  Expected: all focused tests pass.

### Task 2: Editor, withdrawal and complete verification

**Files:** packages/domain/src/{session,registration,fees}.ts; apps/web/src/{session-pages,registration-panel}.tsx and fee/split display consumers; tests/session-domain.test.mjs (existing domain test location if different); tests/sessions.test.mjs.

- [x] Write/run meaningful domain tests for actual material edits and preserved timezone.
  Expected: fail before implementation.
- [x] Enable permitted controls, keep booking rules disabled, confirm material changes once, show affected withdrawal and distinct removed-after-change history.
- [x] Update the prior blanket-lock expectation to exercise a genuinely locked booking-rule change.
- [x] Run pnpm check, pnpm db:lint and pnpm test:api against the isolated stack. Exercise editor and withdrawal at phone width; run clean staging build.
  Expected: lint/types/build, SQL lint and complete suite pass; browser confirms actual behavior.
- [x] Commit UI and verification documentation.
- [x] Final task command: pnpm check && pnpm db:lint && pnpm test:api
  Expected: all checks pass.

## Recovery and delivery

Migration is additive to data/history and replaces functions. Roll back application with schema retained; do not restore blanket locks after booked edits without a separately reviewed migration. Before live use, review/merge this PR and migrate the mapped RallyPoint schemas through the existing staging workflow. Send no emails in this task. Final review uses a fresh reviewer, then commit/push and create a human-reviewed PR; update WDL-391 to In Review with evidence.
