# Session Cancellation Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for this single coherent task. Follow test-first implementation and whole-change review.

**Goal:** Let current organizers/co-hosts cancel a draft or published session safely.

**Architecture:** One transactional operation under the established group/session locks; one private cancellation signal per session; reuse operation receipts. Keep party/payment history and existing projections, with explicit cancelled-state presentation.

**Tech Stack:** Existing Next.js, Hono/Zod, pnpm and Supabase Postgres; no new dependencies or services.

**Spec:** [WDL-384](https://linear.app/wwonderland/issue/WDL-384), accepted cancellation fee policy, PRD RP-02/RP-08/RP-12 and D-04/D-13.

## Global Constraints

- Preserve registrations and paid markers. Remove unpaid liability with actor/time.
- No emails, refunds, undo cancellation, provisioning, deployment or merge.
- Respect current roles even on replay and recovery. Never expose draft details.
- Private operations remain uncached and inaccessible to browser database roles.
- Reuse plain interface copy, native confirmation sheet and same-request recovery.

## Review Focus

- Cancelled drafts remain private; published links retain safe public details.
- Pending and finalized split fees cannot leave or recreate unpaid liability.
- A join or payment racing cancellation cannot half-commit or escape its lock.
- Repeated cancellation and interrupted-response recovery produce one signal.
- Stale participant screens never promise a place or future promotion after refresh.

## Task 1: Cancel a session end to end

**Files:**
- Create: `tests/cancellations.test.mjs`, generated `supabase/migrations/*_session_cancellation.sql`.
- Modify: fixture helper, `apps/api/src/sessions.ts`, domain fee types/standing, session and registration views, payment/split presentation, PRD, README and `docs/foundation-api.md`.

**Interfaces:**
- Consumes: `app.require_manager`, existing session/group locks, operation receipts, fee/split histories, `useMutation` and `Sheet`.
- Produces: `POST /api/sessions/:id/cancel` with `{operationKey}` -> `{operationKey, session}`; same receipt readable through `GET /api/operations/:key`.
- Database: `api.cancel_session(p_actor_id uuid,p_actor_name text,p_key uuid,p_session_id uuid)`; private `app.session_cancellations` keyed by session with previous state, actor, name and time.

- [x] Baseline: install frozen dependencies, start local synthetic services and run existing suite on port 3001.
- [x] RED: fixed-fee cancellation preserves parties/paid rows, removes all unpaid fees including late withdrawals, audits once and refuses future joins/withdrawals/edits. Assert role denial, draft privacy, concurrent/repeated cancellation and receipt recovery.
- [x] GREEN: add migration and validated route; reuse lock ordering, wrap existing save/recovery behavior, end pending split claims and record cancellation-specific removal history.
- [x] Extend tests for revoked co-hosts, transaction rollback, joined/cancelled races, split claims/finalized fees, terminal state and direct RPC denial.
- [x] UI: one confirmation sheet in managed session; authoritative result controls terminal state. Remove join/withdraw/promote promises on cancelled screens; preserve entitled records and explain external refunds without claiming one.
- [x] Verify phone/keyboard confirmation, failure/recovery, participant and visitor views in browser. Run `pnpm check`, `pnpm db:lint`, `pnpm test:api` and OpenNext build where feasible.
- [x] Self-review, independent whole-change review, resolve findings; record validation and migration recovery in review artifact.
- [ ] Commit isolated branch and deliver through the repository PR workflow; leave task In Review for the owner.

Execution checks and review findings are recorded in [the verification report](../../verification/2026-10-22-session-cancellation.md). Delivery status remains authoritative in Linear and the PR.
