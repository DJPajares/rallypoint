# P-08 staging schema upgrade plan

> **For agentic workers:** Use superpowers:executing-plans inline. Keep the cloud write gated by the recovery-backup approval recorded below.

**Goal:** Prepare and prove the missing RallyPoint staging upgrade before continuing live P-08 checks.
**Architecture:** Reuse the existing schema renderer with an explicit upgrade mode for the known 16-migration bootstrap. Keep the generated SQL transactional and confined to RallyPoint namespaces. Preserve the shared Auth service and existing data.
**Tech Stack:** Node, existing Supabase SQL migrations, disposable local Postgres.
**Spec:** `docs/verification/2026-10-23-p08-session-loop.md`; accepted staging boundaries in `docs/deployment/staging.md` and D-08/D-09.

## Global Constraints

- No UI changes, new service, spending, shared Auth setting changes, bootstrap replay, cloud reset or broad migration push.
- Upgrade source is reviewed main d12d46d: after 20261022170000 through 20261023144000, exactly 16 migrations.
- Automatic approval review rejected a full shared-project backup to unspecified local storage. Do not retry it before explicit owner approval of payload and destination. No usable backup currently exists; no cloud upgrade before backup.

## Review Focus

- Wrong/missing installation: guard must fail before changing anything.
- Partial/repeated upgrade: guard must refuse; rollback must leave data intact.
- Namespace mapping: no local app/api or unrelated app mutation targets.
- Existing sessions/identities: preserve data and legacy payment defaults.
- Missing cloud/device evidence: keep P-08 incomplete.

## Task 1: Prepare the exact upgrade

**Files:** modify `scripts/render-staging-schema.mjs`; add `tests/staging-upgrade.test.mjs`; update staging guide and P-08 evidence.
**Interface:** existing zero-argument renderer remains initial-install-only; `--upgrade` emits only the known 16-migration transition.

- [x] Add failing renderer checks for exact source selection, mapping and invalid/repeated mode safety; observe failure.
- [x] Add the smallest explicit upgrade mode; run focused checks.
- [x] Rehearse bootstrap → populated synthetic records → upgrade in disposable Postgres; compare final definitions with full current bootstrap and test rollback/replay/refusal.
- [x] Record local evidence and generated SQL checksum; obtain one read-only review, update draft PR #31.
- [ ] Ask for the exact shared recovery-backup approval; once approved, encrypt/verify backup, apply reviewed namespaced upgrade and repeat live checks. Physical-device and actual inbox evidence remain separate.
