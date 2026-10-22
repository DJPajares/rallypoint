# WDL-384 session cancellation verification

**Date:** 2026-10-22. **Version:** this change on `djpajares/wdl-384-p-09-let-an-organizer-cancel-a-session`, based on `43a7eb32a42fbdcc38e6b88f53cf01925f23665c`.

**Task:** [WDL-384](https://linear.app/wwonderland/issue/WDL-384). Scope and implementation steps: [plan](../superpowers/plans/2026-10-22-session-cancellation.md).

**User note:** Organizers and co-hosts can cancel a session after one confirmation. The shared page shows Cancelled; unpaid fees stop being due while paid and registration history remain available. Any refund is arranged outside RallyPoint.

## Environment and observed checks

Local macOS, Node 24, pinned pnpm 11.14.0 and repository dependencies. Actual local Supabase Auth/Postgres/REST, synthetic identities only. Next development server at `127.0.0.1:3001`; mail goes only to the local mail sink. No upstream HTTP service requires simulation for this transition; the database under test runs locally.

| Check | Observed result |
| --- | --- |
| Baseline `pnpm test:api` | 90 passed before changes |
| New cancellation tests before implementation | Failed with missing cancellation operation (405) |
| Focused `tests/cancellations.test.mjs` | 8 passed |
| Final `RALLYPOINT_TEST_URL=http://127.0.0.1:3001 pnpm test:api` | 98 passed, 0 failed/skipped |
| Final `pnpm check` | Lint, TypeScript and Next production build passed |
| Final `pnpm db:lint` | No schema errors |
| Final `pnpm build:cloudflare` | OpenNext Worker build passed locally |
| `git diff --check` | Passed |

## Behavioral coverage

Actual HTTP requests and SQL observations cover organizer/co-host permission, ordinary member/participant/unrelated-organizer denial, direct authenticated RPC denial, malformed request and method rejection, cross-session key conflicts and actor-isolated receipts. Current roles are checked again after revocation for both replay and recovery.

Cancellation preserves party rows and complete paid fee rows. Due unpaid fixed fees, retained late-withdrawal fees, pending split claims and finalized unpaid split allocations are removed from liability with actor/time and revision history. Paid split allocations remain unchanged; corrections cannot revive cancelled unpaid debt. Subsequent joins, waitlist entries, withdrawals, promotions and edits are refused. Concurrent joins serialize with cancellation. Repeated requests yield one signal. An injected fee trigger failure rolls back session state, signal, fee and receipt; retry then succeeds.

Cancelled draft links return 404. The managed projection retains the prior publication state so reopened drafts do not gain share controls. Its regression was observed failing before the fix and passing afterward. Published links retain their safe public projection; roster/fee/actor/signal records do not enter that projection.

## Browser verification

At 390 × 844 and 360 × 800, using local synthetic accounts:

- Confirmation sheet fits the phone viewport. Escape closes it without changing state and returns focus to the trigger. Tab/Enter can activate confirmation.
- A temporary session-specific database failure returned 503. The UI kept the exact request, result lookup reported unresolved, dismissing the sheet kept recovery visible, and retrying the same request succeeded after removing the fault.
- The managed page focuses Cancelled, keeps the paid record and shows the unpaid amount Removed with the historical roster. Terminal edit/publish/cancel actions disappear.
- Signed-out shared page shows cancellation and historical seat totals with no roster/financial records and offers viewing a record instead of joining.
- An unpaid confirmed participant sees Your previous registration, the removed fee and Nothing due; no join/withdraw action or promise of future promotion remains. Participant roster contains names only.

Temporary viewport override restored. Browser fixture helper cleans up its generated session/identities after inspection.

## Review and limits

Independent read-only review found one issue: cancelled drafts inherited share controls from the non-draft state check. Publication history is now projected explicitly and used by the editor. Recheck reported no remaining findings. Runtime evidence above was produced by the implementing session; the reviewer did not independently rerun it.

These results establish local synthetic behavior and local build compatibility. Live Google OAuth, real email delivery, deployed Cloudflare behavior and cloud migrations were not exercised. Cancellation writes a durable signal but sends no email. There is no undo cancellation or in-app refund flow. Migration/recovery guidance is in the README; production application remains a separately authorized operation.
