# Split session cost: local validation

Date: 2026-10-22 (Asia/Singapore). Branch `codex/split-session-cost-design`,
application baseline `a4480d9`. Approved design and plan are under
`docs/superpowers`. This is synthetic local evidence, not deployment or transfer
verification. Independent branch review follows this implementation record.

## Result and user note

Organizers can enter a total to split instead of a fee per seat. Participants
see estimates and the maximum-share consent, with guests counted as seats.
Finalization after start creates exact minor-unit bills. Dues distinguishes
estimates, amounts to pay, waivers/removals and zero shares. Reviewed corrections
can keep or lower the total and restore previously eligible waived shares;
affected paid amounts block repricing. Prior amounts and payment declarations
remain inspectable. No payments or refunds are processed.

## Environment and checks

- Node 24.16.0, pnpm 11.14.0, Next 16.4.2, OpenNext Cloudflare 1.20.13,
  Wrangler 4.151.3, local Supabase/Postgres 17.
- `pnpm check`: passed; lint has zero warnings/errors, all four package
  typechecks and the Next production build pass.
- `pnpm db:lint` and local security advisors: no issues. All 13 local migration
  records match, including seven forward feature migrations. No reset or
  production database change. A restricted local backup preceded schema writes.
- Next production `next start` on 5186 through local test proxy 5183:
  **89/89** API/domain checks pass. The proxy injects one targeted synthetic
  post-commit response failure only when armed; it is not application code.
- `pnpm build:cloudflare`: passed. Local `opennextjs-cloudflare preview` on
  5184: **89/89** checks pass. Builds ran sequentially in the same checkout.
- Behavioral coverage includes fixed/free compatibility, role/direct RPC denial,
  claim eligibility and cutoff boundaries, late cancellation plus replacement,
  max-safe arithmetic, guest rounding, zero/unallocated cost, post-lock start,
  completed/cancelled sessions, simultaneous/stale/replayed actions, paid
  blockers, ordinary/reviewed undo, private reasons and attendance independence.

## Browser evidence

Real browser walkthroughs used the isolated synthetic session created through
the UI. Inspected mobile 448×853 and desktop 1280×720 layouts. Draft persistence,
publication, solo/guest consent, keyboard join/sheet focus, exact estimates,
early removal, retained late cancellation/replacement, pending waiver, delayed
finalization and Dues estimate/settled separation passed.

On the Next production artifact, an interrupted successful finalization kept
new writes disabled; **Check result** recovered exactly one pricing run. A
successful correction was interrupted the same way; the entered total/reason
stayed visible and recovery found one correction. A paid allocation blocked
confirmation. Explicit unpaid, ordinary waiver/undo and reviewed restoration
worked. A concurrent payment update refused a stale preview without another
run. Three intended runs remained after the stale/recovery scenarios.

On the Cloudflare artifact, public visitors saw aggregates only. A participant
saw only their own before/after amounts with generated explanations. Organizer
notes appeared only in manager history. A temporary synthetic co-host lost
write permission immediately after role revocation; refresh removed managed
controls. Signing out cleared private state, and signing in as the organizer
loaded the organizer’s own party and controls. The temporary role was restored.
No browser console warnings/errors were recorded on this final walkthrough.

Screenshots are local ignored artifacts; no private user data was used.
Primary-checkout deletions of AGENTS.md, PRD.md and README.md were preserved,
as was the separate server on port 5173.

## Boundaries

No cloud provisioning, deployment, live provider configuration, reset, transfer
verification, refund, merge or tracker mutation. Actual device installation and
production migration are outside this feature’s local checks. Remote push/PR
publication still requires its own authorization. The next review is the
independent whole-branch code review, followed by owner review.
