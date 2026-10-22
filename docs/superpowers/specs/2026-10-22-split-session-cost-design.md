# Total session cost and finalized splits

Date: 2026-10-22. Written specification awaiting owner review.

## Intent and approval boundary

The organizer knows the cost of a session and should be able to enter that total
without calculating a price per person. Participants see a changing estimate;
the organizer finalizes exact amounts after the paying headcount settles.

The owner approved the conversational design: a total-cost alternative to fixed
fees; estimates before start; organizer finalization at or after start; confirmed
and unwaived late-withdrawn seats in the split, including replacement seats;
exact rounding; unallocated cost with no payers; and explicit reviewed corrections
that preserve payment history. Payment tracking follows finalization. These are
recorded in [PRD RP-09 and D-04](../../../PRD.md#rp-09--free-fixed-and-split-costs).

This document makes that behavior concrete. Details identified as proposed below
need review with this written specification. Approval to write this document is
separate from written-spec approval, implementation planning, implementation,
external task creation, merge and deployment.

## Context and scope

Baseline: `a4480d9` on `main`, including the Next.js workspace, paid/unpaid
markers, fee waivers and attendance controls. Existing responsibilities are in
`apps/web`, `packages/domain`, `packages/api` and root `supabase/migrations`.
The maintained interface reference is [foundation-api.md](../../foundation-api.md).

Include total-cost configuration, estimates and join consent, contingent paying
seats, finalization, own Dues and organizer views, and reviewed split corrections.
Preserve fixed-fee/free sessions, party/queue behavior, role checks, no-store
private reads, payment history and attendance independence. Existing records
remain fixed-fee records; do not reinterpret their amounts as session totals.

Exclude payment collection, transfer verification, deposits, partial payments,
automatic refunds, new guest-edit/cancellation/attendance rules and new delivery
infrastructure. No provider setup, database reset or production migration occurs
during specification work.

## Session creation and participant experience

Keep a short choice between a fee per seat and a total to split. Zero cost remains
free. Enter one amount using the existing currency and precision rules; do not
ask the organizer to enter a headcount or per-person estimate. Follow PRD D-13:
reuse established defaults and controls, without new timezone questions, internal
revision labels or repeated policy paragraphs.

Preserve the current material-edit boundary after bookings begin. The total,
currency and fee mode cannot change through the ordinary session editor after
that boundary. Reviewed correction operations described below have their own
guards and history; finalization confirms the published total.

Before start, show the published total and an estimate based on the current
paying seats. Label it **Estimated share** and say that it changes until the
organizer finalizes after start. A participant with a guest sees their two-seat
party estimate. For a prospective direct join, also show the estimate including
that party if confirmed now. Never present a waitlist estimate as an amount due
or a promise of promotion.
After start, keep showing an estimate until the organizer finalizes; reaching
the start time alone never creates final amounts or payment markers.

The join/waitlist consent explains that the final share can change as paying
seats change, a guest counts as another seat, late withdrawal retains liability
unless waived, and pre-start promotion creates the same contingent liability.
Proposed consent detail: make clear that a party could owe up to the published
total if it is the only paying party left. An estimate is never a finalized
monetary obligation or a paid amount.

Proposed presentation detail: show aggregate paying-seat count alongside the
estimate, including that it may include retained cancellations. Public/link
visitors receive no payer identities, individual cancellation liabilities,
payment markers or financial history. Only the participant sees their own
party's financial information; current organizers/co-hosts see the full basis.

## Which seats pay

Count each seat in a confirmed party that has not been explicitly waived. Also
count each retained seat of a party that withdrew at or after cutoff, unless the
organizer waived that liability. A primary plus guest contributes two seats.
Waivers continue to apply to the existing party allocation as a whole; this
feature introduces no separate guest payment account or partial waiver.

Before-cutoff withdrawal removes contingent unpaid liability and its seats from
the denominator. Waiting parties owe nothing and contribute no paying seats.
Promotion before start creates contingent liability for the whole party once.
Neither a paid marker nor check-in/no-show status decides whether a seat pays.

A replacement does not waive the departing party. Both contribute their paying
seats to the eventual split. For SGD 120 with five confirmed seats and one
retained late withdrawal, six seats pay SGD 20 each. If another seat is then
confirmed before start, seven seats split the same SGD 120. Retaining a split
liability retains a share of that total, not an earlier estimated price.

Seat release and promotion never wait for financial resolution. The authoritative
withdrawal/promotion result and the paying-seat basis change together, using the
existing post-lock server-time checks. Retry/replay cannot add a second claim.

## Estimate, finalization and rounding

Estimates update from authoritative reads; they do not persist changes to an
amount marked paid. Refreshes preserve unresolved action recovery. With zero
paying seats, show **No split yet** and the unallocated total. A prospective
first join can still see the estimate for their party. Never divide by zero.

Only a current group owner, organizer or co-host can preview and apply
finalization. The server allows the apply operation at or after the stored start
instant, checked after any lock wait. A published or completed session can be finalized; a cancelled
session cannot start a new split. Cancellation itself does not erase historical
allocations or payment markers, and this feature adds no cancellation operation.

The preview states total/currency, paying-seat count, included parties and exact
party amounts. Apply names that preview's basis. If the total, session state,
paying seats or relevant waiver/payment state changed, refuse the stale apply
and request a fresh preview. Two concurrent finalizations cannot create two
effective splits. Unknown results use the existing request-key recovery flow.

Persist one atomic finalization with its total, currency, paying-seat snapshot,
exact allocations, actor and time. Financial snapshots stay separate from live
registration status and attendance. With no paying seats, record an unallocated
result with no participant amount due; the organizer sees the uncovered cost.

Proposed deterministic rounding detail: for total `T` in currency minor units
and `N > 0` paying seats, use `base = T div N` and `remainder = T mod N`.
Order parties by their existing queue sequence, then their stable ID as a tie
breaker; within a party, order primary before guest. Give one extra minor unit
to the first `remainder` seats. Sum seat amounts into the primary's party amount.
For SGD 100 across three solo seats, allocate 33.34, 33.33 and 33.33. A party's
amount must not assume a uniform rounded unit price multiplied by its size.

Every allocated run is deterministic, uses valid currency minor units and checked
arithmetic, and conserves the total exactly. If a total is smaller than the number of paying
seats, some allocations are zero; show **Nothing due**, without claiming payment.

## Payment markers, waivers and corrections

For split sessions, estimates/pending liability cannot be marked paid or unpaid.
After finalization, reuse protected manual payment tracking and own Dues. Fixed
sessions retain their current payment timing. No marker verifies an external
transfer, and no money is moved by finalization or correction.

Before finalization, an explicit waiver removes the party's contingent seats
from the basis; undoing it restores eligibility under the withdrawal rule. Both
actions are attributable and revision checked, as current fee controls are.
Undo never makes a waitlisted or before-cutoff-withdrawn party chargeable.

After finalization, paid/unpaid and waiver corrections remain explicit. A waiver
does not automatically increase anyone else's amount. Preserve the original
allocation and show the waived amount as uncovered cost; undoing that
post-finalization waiver restores the same allocation. Original allocated amounts
still sum to the finalized total; amounts currently due, paid markers and waived
amounts are distinct summaries.

The following correction safeguards are proposed for written-spec review:

- If a claim was waived before initial finalization, there is no original
  allocation to restore. Its later undo must use the pricing-correction preview
  and atomically reinclude that previously eligible claim with the new split.
  It never invents an amount or silently changes everyone else's bill. The
  correction can be blocked by an affected paid allocation, as described below.
- A pricing correction previews the old and proposed total, paying basis,
  party amounts and affected payment states. It requires an organizer reason,
  explicit confirmation and a fresh revision; it records actor/time and preserves
  the previous split. Applying it does not change seats, queue or attendance.
- The first version may lower the effective total or redistribute after an
  explicit waiver/undo. Each correction's total must be no greater than the
  current effective total. It cannot raise the total, change currency,
  invent a new liable party or use attendance as a replacement headcount. Restoring
  a previously eligible waived claim is allowed through the reviewed undo flow.
  Raising the agreed total needs a separately defined consent flow.
- Refuse a correction that would change an allocation currently marked paid.
  The organizer first resolves payment outside RallyPoint and explicitly corrects
  the marker through the existing auditable flow where appropriate. Never
  automatically clear or carry a paid marker onto a different amount. Unchanged
  allocations retain their markers and amount basis.
- Keep historical amounts and marker actions inspectable after a correction.
  Participants see their own previous/current amounts and an understandable
  change explanation. No separate transfer ledger, automatic credit settlement
  or claim of a processed refund is introduced.

## Component responsibilities and operation guarantees

`packages/domain` owns the browser-safe fee-mode model, input validation, pure
minor-unit allocation and estimate formatting. It distinguishes estimates from
final allocations and retains compatibility with fixed-fee contracts.

`packages/api` verifies managed identity and current roles, obtains authoritative
configuration and exposes the appropriate public, own or organizer projection.
Client totals, clocks, headcounts, party eligibility and role metadata are never
authoritative. Unknown actions, invalid amounts, early/stale finalization and
unauthorized writes fail without changing records.

The authoritative database operation snapshots eligibility and writes the split
atomically under the established session/group lock order. Preview/revision
checks also cover competing waiver/payment writes. Reuse request-key receipts:
the same successful request replays its committed result, while a new correction
is a new explicit action. An interrupted browser request never implies success.

Persist the fee mode/published total, contingent liability basis, immutable split
runs/seat allocations and links to existing auditable party fee/payment history.
Exact schema and HTTP payload changes belong in the subsequent implementation
plan and maintained interface reference; no speculative endpoint names or
competing API artifact is created by this product specification.

`apps/web` adapts session creation, shared-session consent/status, organizer
preview/confirmation and fee controls, plus own Dues. Reuse existing components,
notices and recovery controls. Empty, pending, forbidden, stale and interrupted
states retain context. Preview/finalize/correct controls remain keyboard usable,
and status changes use accessible headings/notices. Private reads stay no-store.

## Verification required during implementation

These are future acceptance checks, not results observed during specification work:

1. Existing fixed/free sessions and current role, queue, withdrawal, payment and
   attendance regressions still pass; historical records keep their fee mode.
2. Total-cost inputs reject invalid currency/precision and unsafe amounts. Equal,
   uneven, guest-party, small-total and zero-payer cases conserve the exact total
   or explicitly report unallocated cost.
3. Before-cutoff removal, exact/after-cutoff retention, replacement joins,
   waitlisting, promotion, waiver and undo produce the correct paying basis
   without changing queue fairness or granting membership.
4. Initial finalization is denied when post-lock server time is before start;
   it is allowed exactly at/after start, including a request that waited across
   the boundary, and uses the committed basis.
   Cancelled-session denial preserves history. Attendance changes do not reprice.
5. Simultaneous finalizations, a stale preview after waiver changes, competing
   payment writes, identical request retries and committed-but-lost responses
   produce one truthful effective result without duplicate allocations.
6. Public and ordinary participants cannot finalize/correct/read others' dues.
   A revoked co-host loses authority on the next write. Own Dues distinguishes
   an estimate, amount due, paid declaration, waiver and uncovered cost correctly.
7. Corrections preserve prior amount/actor/time, reject changes to paid amounts,
   refuse total increases and expose stale results without silently
   replacing newer work. Waivers never auto-redistribute another person's bill.
8. A browser walkthrough covers creation, guest consent, live estimates,
   organizer preview/finalization, own Dues, correction denial/recovery, keyboard
   operation and mobile layout. Run the adopted lint/type/build and local API
   checks on the implementation; do not claim this document validates runtime behavior.

## Delivery boundary

This change writes the specification and updates accepted PRD decisions only.
No application code, schema, service configuration or external task is changed.
No release note is needed for documentation alone. After owner review of this
written specification, use Superpowers writing-plans to prepare the implementation
plan for its separate review and execution-method choice.
