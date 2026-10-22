# RallyPoint — Product Requirements

**Tagline:** Fill the spots, not the chat.  
**Descriptor:** Create and share group activities. Sign-ups, waitlists, and payments, all in one link.  
**Vision:** Make getting together the easy part, so every community keeps coming back.

**Status:** Planning draft with accepted first-loop access, identity, guest-party, waitlist, cancellation-fee, visibility, organizer-control and email-notification decisions. Supplied product intent remains the baseline; other detailed behavior and technical recommendations await acceptance.  
**Owner:** Darwin Jason Pajares, product owner.  
**Updated:** 2026-10-21.  
**Source of intent:** The owner's RallyPoint project context and local bootstrap authorization. In the planning conversation on 2026-10-21, the owner explicitly accepted verified sign-in, group-owned first-loop events and separate membership in D-01; pre-start withdrawal, organizer-enabled +1 parties managed by the primary registrant without guest accounts, strict queue order and immediate promotion with upfront consent in D-03; cancellation-fee handling in D-04; email delivery and reminder timing in D-05; and unlisted default access, roster visibility and organizer/co-host controls in D-06. These approvals do not approve the remaining proposals or authorize implementation.

This document owns product requirements and product/technical decisions. `AGENTS.md` owns execution rules. The [RallyPoint Linear project](https://linear.app/wwonderland/project/rallypoint-a26d48cd9e2d) owns approved work status and dependencies; a direct authorized request owns work that has no task. Each change's completion response, or its linked review record when one exists, owns validation evidence. Nothing in this document claims that an application has been implemented or tested.

## Purpose and audience

RallyPoint replaces the administrative work around recurring activities: chat polls, pasted rosters, spreadsheets, payment chasing, and manually filling dropouts. An organizer publishes a session and shares one link; participants can see whether they have a spot and what they need to do before showing up.

The primary audience is organizers of recurring pickleball, badminton, tennis, and basketball sessions. Participants are the secondary audience. The underlying concepts remain suitable for meetups, workshops, and outdoor activities; sports terminology must not become a prerequisite for creating an event.

The name combines a place to regroup, the act of gathering people, and the exchange that keeps a tennis rally going.

### Principles that guide tradeoffs

- Prioritize organizer effort, full sessions, and reliable attendance over engagement features.
- Work alongside existing group chats. Share a useful link and exportable roster; do not recreate chat.
- Aim for event creation in under a minute and one-tap joining for a returning eligible participant. First-time identity setup, choosing a guest, or correcting invalid inputs may require more steps; measure them separately.
- Make spot status, fee obligations, and important changes explicit before a participant acts.
- Prefer free tiers and native capabilities, while keeping resource use bounded and costs visible. A free operating cost is a goal, not a verified provider guarantee.
- Use an event-agnostic model with sports-first defaults and optional sport-specific profile information.
- Deliver a polished, modern, fun mobile experience without expanding the MVP.

## Scope and success

The full MVP includes groups and roles; templates, recurring series, and event duplication; capacity-controlled registration, waitlists, opening times, cancellation cutoffs, and guest +1s; fixed/split fees and manual paid/unpaid tracking; confirmations, promotions, reminders, event-change notifications and calendar export; attendance; rich link previews, text rosters and QR sharing; announcements; profiles; event visibility; and report/block/member removal.

The **first useful validation slice** is one group running one complete session: create → share → join or waitlist → fill a cancellation → track a manual payment → check in. This is sequencing within the supplied MVP, not a reduction of the approved intent or an executable task batch.

Explicit exclusions are an open discovery feed; friends, follows, feeds and DMs; in-app chat; payment processing; and a custom field builder. Payment links, QR codes, and paid markers must not be described as RallyPoint processing or verifying a bank transfer. PWA delivery does not imply offline registration.

Later possibilities remain deferred:

| Phase | Ideas | Revisit condition |
| --- | --- | --- |
| 2 | Reliability indicators, milestones/streaks, team randomizer, court rotation, organizer insights | Evidence from recurring groups and a separate scope decision |
| 3 | Discovery by area/activity, achievements, opt-in leaderboards, venue partnerships, integrated payments | Demonstrated demand and explicit product, privacy, cost, and operational decisions |

Success should be assessed with consented pilot observation and minimal aggregate measurement. No baseline, conversion rate, retention target, or research result is claimed.

| Outcome | Measure and evidence | Target status |
| --- | --- | --- |
| Less setup effort | Timed creation from a ready organizer's start to a shareable event; observe a second session created from existing information | Under one minute is supplied intent; define the benchmark inputs before measuring |
| Clear, quick participation | Returning eligible participant's action count; ability to correctly identify confirmed/waitlisted status | One-tap join is supplied intent; first-time onboarding measured separately |
| Fewer unfilled cancellations | Vacancies, eligible waitlist promotions, and time until a replacement is confirmed | Establish a pilot baseline; no invented improvement target |
| Less chasing | Organizer-reported admin time and count of manual roster/payment corrections | Compare pilot sessions with each group's prior process |
| Communities keep returning | Groups that run a subsequent session and participant return rate | Owner sets the evaluation window and target after baseline observation |

Analytics tooling is not selected or required by this bootstrap. Pilot notes can establish the first baseline.

## Concepts, ownership, and independent states

The following model combines supplied features, the explicitly accepted policies below, and remaining recommendations. The decision section distinguishes accepted choices from open gates before dependent implementation.

| Concept | Meaning and authority | Boundary |
| --- | --- | --- |
| Profile | An individual's display identity, optional photo, activities, self-declared skill and derived attendance count | A self-declared skill is not a verified rating; attendance is not a reliability score |
| Group | A recurring community with an owner, organizers/co-hosts, and members | Membership and event registration are independent |
| Template | Reusable activity/event defaults | No roster, payment, attendance, or notification history is copied |
| Series | A rule connecting scheduled event occurrences | Registering for one occurrence does not reserve future occurrences |
| Event | A dated occurrence with its own capacity, registration rules, visibility, fees and attendees | Accepted first-loop ownership: exactly one group; broader standalone-event support remains an open structural choice |
| Registration | One participant's request for one or more seats, including an allowed guest | Counts seats, not accounts; an organizer is not automatically an attendee |
| Waitlist | Server-ordered registrations awaiting capacity | Waiting does not confer a confirmed seat or imply payment is due |
| Fee allocation | An amount and currency owed for a registration's chargeable seats | Fixed and split are alternatives; fee calculation is independent of payment status |
| Payment record | An organizer/co-host's paid or unpaid marker for an allocation | A participant's statement or QR display is not proof of receipt |
| Attendance | Unrecorded, checked in, or no-show for an eligible seat | No-show is recorded explicitly after the session, not inferred from an unpaid fee |
| Announcement | An organizer's one-way event update | No reply thread, reactions system, DM, or chat |

### Integrity and lifecycle

- **Seat integrity:** confirmed seats never exceed capacity. Concurrent joins and promotions must resolve against one authoritative state. An ambiguous network response is not proof of a reservation.
- **Independent state:** event lifecycle, visibility, registration window, membership, registration status, payment status and attendance remain separate. Do not build a single overloaded status flag.
- **Event lifecycle:** draft → published → completed, or draft/published → cancelled. Published events may be edited. Registration availability is computed separately from publication, opening time, start time, capacity and eligibility. The cancellation cutoff controls fee liability, not the ability to withdraw before the event starts. Accepted promotion boundary: no promotions at or after event start. Accepted join boundary (2026-10-22): new direct joins and waitlist entries close exactly at event start, using server time after lock waits.
- **Registration lifecycle:** an eligible attempt becomes confirmed or waitlisted; a waitlisted registration can become confirmed; either can become cancelled through permitted withdrawal or organizer action. Repeated taps/retries must not create duplicate active registrations or repeated seat consumption.
- **Capacity changes:** reject a reduction below the existing confirmed seat count; do not silently evict participants. Raising capacity can make the next eligible waitlist entry promotable.
- **Removal and cancellation:** cancel the relevant registration before freeing seats. Group removal must not leave invisible active future bookings; the recommended handling is specified in D-07. Cancelling an event stops future joins, promotions and reminders while preserving its record and manually recorded payment history. **Organizer cancellation fee treatment accepted, 2026-10-22 (WDL-384):** every unpaid obligation stops being due, with the cancelling actor/time recorded, including fees retained after withdrawal. Paid markers and allocations stay unchanged; the organizer handles any refund outside RallyPoint. Draft cancellation keeps draft details private.
- **History:** duplicating an event resets registration, payment, attendance and delivery state. Edits or series changes must not silently rewrite completed event history.
- **Time:** each event stores a timezone, taken silently from the organizer's device when the event is created; nobody is asked for one and the interface never shows one (D-13). Opening times, cutoffs, recurrence and reminders use that zone, and participants see times in the event's local time without a zone label. Store an unambiguous instant for dated actions and preserve the series' local-time intent.

**Accepted first-loop management controls:** organizers and co-hosts can view the full event roster and manage payment status, check-in and no-shows. Other role boundaries remain proposed: owner-managed group roles, organizer/co-host control of events, registrations and announcements, and members managing their own eligible participation/profile. A user may never escalate a role through a client request. Prevent removal of the last group owner without an explicit transfer or group closure. Final role granularity is part of D-01.

## Primary workflows

1. **Create and share.** An organizer enters a group, chooses a template, duplicates an event, or starts a session. Minimum useful inputs are title/activity, start/end, location/instructions and capacity; timezone and visibility are defaulted, not asked (D-13); fees and registration rules have visible defaults. Publishing validates the inputs and returns a stable event link. Optional recurrence creates bounded occurrences. Invalid input preserves the draft; failed publication must not produce duplicate events. Share by link, QR or approved text export. A QR failure leaves the link usable. Requirements: RP-01 through RP-04, RP-15 and RP-16.
2. **Join and know the result.** A participant opens the shared link, sees the access-permitted details, fee, guest allowance and registration rules, completes only necessary identity setup, and joins. The result clearly says confirmed, waitlisted with queue information, not open yet, closed, or ineligible. A full event creates a waitlist entry if enabled. An interrupted action offers a status recheck without suggesting an unconfirmed spot is held. Requirements: RP-05 through RP-08 and RP-17.
3. **Cancel and fill the vacancy.** An eligible participant can withdraw until the event starts, including after the cancellation cutoff. Show before withdrawal that an existing fee obligation remains after the cutoff unless the organizer waives it. Release the seats without waiting for payment resolution; the seat change and next eligible promotion use authoritative capacity. A promotion changes spot status even if its notification fails. Event cancellation ends future registration activity and sends an update rather than pretending to refund money. Requirements: RP-06 through RP-10 and RP-12.
4. **Track the fee.** The organizer chooses free, fixed or split cost, publishes the visible amount or estimate and payment instructions, finalizes split allocations when appropriate, and marks paid/unpaid after checking their external payment account. Attendees see their own allocation and status. Invalid amounts/currency or split allocations that do not total correctly are rejected. Notification or QR failures do not alter the ledger. Requirements: RP-09 through RP-11.
5. **Show up and repeat.** The organizer checks in participants/guests, later records actual no-shows, posts any announcement, and duplicates the session or uses the next series occurrence. Attendance counts update from check-ins without importing prior registrations or payments into the next event. Requirements: RP-03, RP-04 and RP-13 through RP-15.

## Requirements and observable acceptance

The feature coverage below comes from the supplied MVP. Verified sign-in before reservation (D-01), pre-start withdrawal, organizer-enabled +1 parties that stay together in strict queue order, and immediate pre-start promotion with upfront fee consent (D-03/D-04) are accepted planning decisions. Waiting itself incurs no fee. Group-owned first-loop events, separate group membership, unlisted default access, primary-managed guests without separate accounts, cancellation-fee handling, roster/financial/attendance visibility, organizer/co-host management controls, and email delivery with a 24-hour reminder are also accepted. Other detailed defaults, role/access rules and mechanisms remain **draft recommendations**. Each referenced decision identifies its accepted portion and any dependent work still awaiting acceptance.

### RP-01 — Groups and roles

Create and manage recurring communities with organizers, co-hosts and members. Require a usable group name, show the acting role, and enforce management permissions at the authoritative boundary. **Accepted for the first loop:** an event belongs to one group; eligible signed-in participants may join its unlisted event without being group members, and event registration does not automatically grant group membership or organizer rights. Group membership entry and role granularity remain open in D-01.

**Accepted bootstrap, 2026-10-22:** a verified group creator becomes its owner, with authority over organizer/co-host assignments. General role-assignment/invitation UI and membership entry remain outside P-02. Creation never grants authority over another group.

**Acceptance:** an authorized organizer creates an event in their group; a member cannot change roles or another group's data; removing the final owner without transfer is rejected; a denied action leaves the group unchanged. Verify role boundaries with two groups and several roles.

### RP-02 — Event creation and editing

An authorized organizer can save a draft, validate required inputs, publish and edit a session. Capacity is a positive whole number, end follows start, and any opening/cutoff rules are internally consistent with the event time. Users see material changes to time, venue, capacity, visibility or fee. Changes that reduce access must invalidate newly unauthorized reads; historical public disclosure cannot be undone.

**Accepted edit boundary, 2026-10-22:** organizers/co-hosts may edit before any bookings. After a session has bookings (including waiting parties), material detail changes remain disabled until the treatment of existing registrations is decided. Withdrawal does not erase that history. The session version and durable changed-field signal identify published detail edits; outbound delivery remains P-06.

**Acceptance:** publish a valid event and reopen its link; reject invalid date/capacity inputs without losing the entered draft; reject a capacity reduction below confirmed occupancy; a material edit appears on the page and creates the applicable change notification under RP-12. Verify unauthorized edits are refused.

### RP-03 — Templates and duplication

Provide activity defaults and duplicate past events so recurring organizers do not re-enter stable information. Review date/time, fee and visibility before publishing a duplicate. Sport-related fields are optional and must not block a workshop or meetup.

**Acceptance:** duplicate a completed badminton session and publish it for a new date without carrying over attendees, payment markers, check-ins, share secrets or previously sent notifications. Create a non-sport event without irrelevant required sport fields.

### RP-04 — Recurring series

Create a finite series and manage an occurrence separately from future occurrences. Recommended initial recurrence is weekly on selected days with an end date; alternative recurrence patterns require an accepted scope decision. Show the number and dates before publishing. Define one occurrence versus future occurrences explicitly when editing. Timezone changes and daylight-saving boundaries must be reviewed as local-time scheduling behavior, not naive fixed-hour addition.

**Acceptance:** preview and create the stated occurrences; edit one without changing its siblings; a future-series edit preserves completed sessions and registrations already attached to unchanged occurrences. Repeating a submission must not duplicate occurrences. D-02 settles supported patterns, generation limits and treatment of booked future changes before implementation.

### RP-05 — Link entry and participant identity

Keep permitted event information accessible from a shared link without an unnecessary onboarding tour. **Accepted:** public/unlisted event viewing does not require sign-in; reserving a place requires verified sign-in. Use the minimum identity needed to manage a stable registration, prevent duplicates and deliver notifications, and return the participant to the original event after sign-in. Private-event access remains subject to its separate authorization policy.

**Acceptance:** an unsigned visitor can view the permitted public/unlisted event details but cannot reserve a place before verified sign-in; an eligible returning signed-in participant joins in one tap after seeing the relevant rules; a new participant resumes the same event after identity setup; repeated attempts for the same active identity/event return the existing registration instead of another seat. D-10 selects Google OAuth through Supabase Auth; the group/role bootstrap remains open under D-01.

### RP-06 — Registration window, capacity and waitlist

Offer first-come-first-served registration with capacity limits and an optional waitlist. Determine ordering by authoritative acceptance order. **Accepted queue rule:** preserve strict party order; neither a later waitlist entry nor a new arrival bypasses the first eligible waiting party merely because the later party would fit. Enforce opening time and closure on every attempt. A full event clearly offers waiting rather than a false confirmation. Queue position is current information, not a guarantee of admission.

**Acceptance:** at the opening boundary, premature requests are refused and eligible requests are accepted; two simultaneous requests for the last seat result in one confirmed seat and a truthful alternative for the other; duplicate retries consume no extra seat; no join is accepted into a cancelled event. Check authoritative behavior rather than only disabling a button.

### RP-07 — Guest +1s

Let organizers enable guest +1 participation and make the primary registrant responsible for its guest information and notifications. Count every guest against capacity and costs when chargeable. **Accepted:** guest participation is organizer-enabled, with at most one guest per registrant; primary and guest join and are promoted together as one party in strict queue order. A two-seat party is never partially confirmed. **Accepted guest identity:** the primary signed-in registrant manages their +1 without requiring a separate guest account. **Still proposed:** a guest receives no independent private-event access entitlement.

**Acceptance of the party policy:** a two-seat party cannot confirm into one available seat and is shown as wholly waitlisted; if it heads the eligible queue, a later solo waitlist entry or new solo arrival cannot bypass it. Once two seats are available, both party seats confirm together exactly once. Guest registration is unavailable when disabled by the organizer. **Proposed guest-edit behavior:** removing a guest releases only that seat while preserving the primary's state where valid; retries create no second guest. Verify that the primary registrant can register their guest without a guest sign-in step. Private guest access and post-registration edit behavior remain proposals.

### RP-08 — Withdrawal and automatic promotion

Show the cancellation cutoff and fee implications before joining and again when withdrawing. **Accepted:** participants can withdraw their registration any time before the event starts, including at or after the cutoff. Withdrawal releases the appropriate confirmed seats or removes the waitlist entry. Before the cutoff, withdrawal removes any unpaid fee obligation. At or after the cutoff, an existing fee obligation remains unless the organizer explicitly waives it; seat release must not wait for that financial resolution. Any refund of money already paid is handled by the organizer outside RallyPoint. At or after event start, self-service withdrawal is closed. No in-app messaging or automatic refund is implied. **Accepted promotion:** before event start, automatically confirm the next eligible party in strict queue order when the whole party fits; there is no claim timer or additional acceptance step. Before a participant joins the waitlist, clearly explain and obtain consent that promotion can happen until event start and creates the applicable fee obligation, including after the cancellation cutoff. Waiting itself incurs no fee; a participant can leave the waitlist before promotion. Notify the registrant of promotion; delivery failure does not undo the authoritative confirmation or convert a queued notification into proof of receipt. Payment resolution does not gate seat allocation.

**Acceptance of the withdrawal policy:** withdrawal just before the cutoff, exactly at it, or after it but before event start releases the reservation without double-allocating seats during a simultaneous join/promotion. Just before the cutoff, withdrawal removes any unpaid fee obligation. At and after the cutoff, the existing fee obligation is preserved unless explicitly waived; an existing paid marker remains a manual payment record. Any required paid refund is handled externally by the organizer; RallyPoint never claims to have processed it. At or after event start, self-service withdrawal is refused without changing the record. **Acceptance of the promotion policy:** the next eligible party is promoted once without a claim timer; withdrawn/removed registrants and cancelled/started events cannot be promoted; a head-of-queue party that cannot fit is not bypassed. Joining the waitlist requires visible consent to automatic pre-start confirmation and its fee implications. Before promotion, no fee is due; promotion after the cutoff applies the published fee obligation. A simultaneous waitlist withdrawal and promotion has one authoritative result, no duplicate seats, and a clearly displayed final status. For split costs, confirmation creates contingent liability; the monetary amount is finalized under RP-09 and D-04.

### RP-09 — Free, fixed and split costs

Support free events, a fixed fee per chargeable seat, or a shared total split across a stated set of chargeable seats. Every monetary value has a currency and valid minor-unit precision; different currencies are never silently combined. Clearly distinguish a split estimate from a finalized amount. **Accepted:** waitlisting alone creates no amount due; immediate promotion creates the applicable published fee obligation under the consent given when joining the waitlist, including after the cancellation cutoff.

**Organizer cancellation accepted, 2026-10-22 (WDL-384):** unpaid obligations stop being due with actor/time recorded; paid history stays unchanged and any refund is external. **Split approach accepted, 2026-10-22:** the organizer enters the total session cost as an alternative to a fixed per-seat fee. Show live estimates before start; a current organizer/co-host explicitly finalizes at or after start, then payment tracking becomes available for those allocations. Split equally across confirmed chargeable seats plus unwaived seats retained after a late withdrawal, including guests. A replacement adds paying seats without waiving the departing party. Waiting remains free. Finalization states the total and paying headcount, conserves the total exactly with deterministic minor-unit rounding, and shows unallocated cost when there are no payers. Attendance does not automatically reprice the split. **Accepted cancellation-fee policy:** before-cutoff withdrawal removes unpaid liability; at or after cutoff it remains unless explicitly waived. Refunds of already-paid money remain external. Finalized amounts stay fixed unless an explicit reviewed correction preserves prior amounts and payment history. The owner accepted the [written split specification](docs/superpowers/specs/2026-10-22-split-session-cost-design.md) on 2026-10-22, including its correction safeguards: no total increase, no repricing an amount currently marked paid, no automatic redistribution after a waiver, and reviewed undo when a party has no allocation in the current split. Implementation-plan review and execution-method selection follow separately.

**Acceptance:** a fixed event with a guest shows the correct seat-based amount; a non-even split sums exactly to its total in the currency's minor units; zero chargeable seats cannot produce a divide-by-zero fee; a changed total/headcount clearly requires review and does not silently reassign payments. The written split specification is accepted; review its implementation plan and select the execution method before building this increment. D-04 records the accepted scope and preserves separate integration/deployment gates.

### RP-10 — External payment instructions

Show organizer-supplied payment QR codes or plain payment instructions at the approved visibility. Do not initiate, collect, reconcile, refund or guarantee payments. A QR code includes a usable fallback description/instruction. Do not require bank statements or payment receipt uploads for MVP.

**Acceptance:** an entitled participant can read the instructions when the QR image is unavailable; unauthorized/public preview reads do not reveal protected payee details; removing or correcting an instruction does not alter registrations or payment markers. Display wording accurately says payment occurs outside RallyPoint.

### RP-11 — Manual paid/unpaid tracking

**Accepted:** organizers/co-hosts manage payment status; participants see only their own fee/payment status and cannot manage another participant's finances. Authorized organizers/co-hosts mark a registration's allocation paid or unpaid and can correct an error. Preserve who changed the marker and when. A participant sees their own status; another attendee's finances are not public roster information. Payment status does not grant a spot or trigger waitlist precedence.

**Acceptance:** an organizer records and corrects a payment; an ordinary participant cannot mark themselves or others paid through a direct request; a paid but cancelled registration is still not confirmed; two edits cannot silently obscure the final saved value or actor. If a save fails, the interface does not claim payment tracking was updated.

### RP-12 — Notifications and calendar

**Accepted first-loop delivery:** email plus immediate in-page status for confirmations, waitlist promotions, material event changes and cancellation. Send one reminder 24 hours before event start; do not send a catch-up reminder for a later sign-up. The page always shows authoritative spot status independently of outbound delivery; email may be delayed or missed. Use consented recipient destinations and avoid sensitive roster/payment information in notification previews. Add-to-calendar exports the event's identity, time/zone, location at the viewer's access level, and link; downloading it is not a calendar-sync subscription.

**Acceptance:** a join confirmation identifies confirmed versus waitlisted; a promotion is durable even if delivery fails; cancelled events stop scheduled reminders; a duplicate delivery attempt does not represent a second promotion; a calendar export opens with the intended time and consistent event identity. D-05 accepts email and reminder timing. Email provider/sender configuration, recipient selection, failed-delivery visibility and a bounded delivery/retry budget still require resolution before notification enablement.

### RP-13 — Announcements

Organizers/co-hosts publish one-way updates on an event for its permitted attendees. Recommended audience is confirmed participants, with an explicit option to include waitlisted registrants. Preserve the announcement on the event even if its outbound notification fails. Do not add replies, DMs or a conversation feed.

**Acceptance:** an organizer posts an update, eligible participants can read it, a member cannot impersonate the organizer, and unauthorized viewers cannot read private-event announcements. A retry does not create duplicate announcements; delivery failure is distinguishable from publication failure.

### RP-14 — Attendance and no-shows

**Accepted management controls:** organizers/co-hosts manage check-in and no-shows; ordinary participants cannot mark other people's attendance or view their attendance history. Authorized organizers/co-hosts record check-in for confirmed participant and guest seats, correct mistakes, and mark no-shows after the session. Attendance starts unrecorded; cancelled/waitlisted seats are not counted as attendees or automatically marked no-show. Do not implement participant location tracking or reliability scoring.

**Acceptance:** check in a primary and guest independently; correct a check-in without double-counting; a waitlisted person has no confirmed-seat check-in; record a no-show after the session without changing payment status. A profile's attendance count reflects the accepted completed check-ins under RP-15.

### RP-15 — Profiles

Provide name, optional photo, activities, optional self-reported skill level, and attendance count. Do not require a skill rating for an unrelated event. Recommended attendance count is the person's completed-event check-ins, excluding guests' attendance, waitlists, cancellations and explicit no-shows. Count visibility is settled with the profile privacy policy in D-06.

**Acceptance:** edit one's own optional information without modifying others; a corrected check-in updates the count once; a guest does not inflate the primary participant's personal count; no-show history is not exposed as an unrequested public reputation score. A missing photo has a usable fallback.

### RP-16 — Sharing and visibility

Support public, unlisted and private event modes, rich previews, copy-as-text rosters and event-link QR codes. Public visibility does not create a discovery feed. **Accepted first-loop default:** unlisted. Anyone with the link can view basic event details; an eligible participant must sign in to join and does not automatically become a group member. An unlisted URL is not a private authorization boundary. **Accepted broader MVP boundary retained from the earlier repository:** private events require organizer-granted access; knowing the ordinary URL is insufficient. Their public preview is generic. Group membership as an admission mechanism remains a proposal; organizer-invitation redemption/revocation is still to be decided, not silently replaced by a membership-only rule. Public/unlisted previews contain only intentionally shareable event summary information, never roster, financial, report or attendance-history data.

**Accepted first-loop visibility:** link visitors see basic event details and attendance counts; confirmed participants see a display-name roster; each participant sees their own fee/payment status. Organizers and co-hosts see the full roster and manage payments, check-in and no-shows. Other participants' financial and attendance history stays hidden. **Still proposed:** roster export is organizer-only and excludes payment and no-show history. It is a deliberate disclosure and cannot recall copies already pasted elsewhere.

**Acceptance:** open each mode with an entitled and an unrelated identity, including direct data reads and preview requests; a private link/QR does not bypass membership; exported text respects the chosen audience and guest labels; a QR resolves to the stable event link; public/unlisted rich previews work without leaking protected fields. D-06 confirms the access matrix before publishing real group data.

### RP-17 — Report, block and remove

Allow reporting an event/profile/member, personal blocking, and authorized member removal. Restrict report contents and reporter identity to the moderation role; keep group administration separate from personal blocking. Recommended effects and moderation ownership are in D-07, including treatment of existing registrations. Do not imply 24-hour moderation or an appeal system that has not been staffed or scoped.

**Acceptance under D-07:** submit a report without disclosing it to the reported member; an unrelated member cannot read reports or remove someone; a removed member cannot reuse membership to access private pages; affected future registrations are reconciled without phantom seats; blocking cannot silently delete another person's paid record. Verify overlapping roles and existing shared events.

## Experience, data and operational boundaries

- **Mobile and accessibility:** make the central loop usable on narrow screens, with keyboard access, visible focus, semantic controls, meaningful labels and programmatic errors. Never encode confirmed/waitlisted/paid solely by color. Respect reduced-motion preferences. Recommended formal accessibility target and browser/device support are launch decisions in D-08; do not claim compliance from this draft.
- **Content:** use plain, friendly language: confirmed, waitlisted, unpaid, cancelled and checked in have distinct meanings. Show fee/currency and material cutoffs before joining, once, at the point of joining. Follow the D-13 interface boundaries. English is the proposed first language; additional locales are not implied.
- **PWA boundary:** recommend an installable responsive web experience with a manifest and appropriate icons. Native app-store distribution is excluded from this first implementation. Cache the application shell where useful; do not cache authenticated rosters, financial records or private event details by default. Joining, cancelling, paying-status edits and check-in require a live authoritative result. No offline write queue, background registration or stale guarantee of a seat is included. On reconnect, recheck status; clear identity-specific state on sign-out/account change.
- **Authorization:** enforce object- and role-level access in authoritative application/data operations, not only through hidden buttons. Validate time, capacity, role and eligibility at each mutation. Denied operations must leave state unchanged. Recheck revoked membership on private access and background delivery.
- **Privacy:** collect only necessary identity, contact destination, user-supplied profile, event, registration, guest, fee-marker, attendance and report data. Separate contact destinations from public profiles. No contacts import, advertising profile or location history is required. Do not publish exact private venues or payment instructions through previews.
- **Security:** use maintained identity and session facilities once selected; protect sessions, validate uploads and avoid executable user-supplied content. QR images/photos are untrusted uploads. Keep secrets outside source and logs. Use test identities and synthetic events during development.
- **Reliability:** authoritative seat changes and retries must preserve the integrity rules. Optional preview, QR or notification failures cannot roll back a valid registration or fabricate delivery success. Preserve enough non-sensitive error context to diagnose a failed operation and let users recheck its outcome.
- **Operations and cost:** one operation's total recipients, recurrence generation, storage, retries and scheduled work must have explicit bounded limits before enabling it. Inspect aggregate cost, not just unit pricing. The owner approves paid resources and the initial operating ceiling. D-08 sets pilot workload, capacity limits, performance budget, support environments and recovery expectations before launch.

### Information authority and lifecycle

| Information | Authority and allowed purpose | Visibility, freshness, deletion and failure |
| --- | --- | --- |
| Identity/contact and profile | Person supplies their identity/profile; selected identity provider owns authentication evidence | Verified contact is for agreed transactional delivery, not a public roster field. Revalidate sessions; provider failure cannot fabricate sign-in. Account deletion and retained history require D-09 |
| Groups, events, templates, announcements | Authorized group organizers own content; RallyPoint's persisted record is operational truth | Edits are immediately authoritative for future reads; enforce current access. Keep the source event distinct from a copy; delete/archive policy in D-09 |
| Registration and queue | Authoritative accepted join/withdrawal operations | Re-fetch for decisions; cached availability is advisory. Guests are subordinate to their primary registration and collect minimum information. Removal must reconcile active seats |
| Fee/payment markers | Event fee configuration plus the recording organizer, with actor/time | A marker is a manual declaration. Never reuse as external bank evidence. Preserve correction history while minimizing financial detail; retention in D-09 |
| Attendance count | Recorded check-ins derived under RP-15 | Preserve the original attendance basis and recalculate on correction. Withhold unsupported counts rather than inventing them; no inferred reliability claim |
| Reports and blocks | Reporter/blocker input; restricted moderation decisions | Not public profile data. Define moderator ownership, retention and deletion under D-07/D-09 before accepting real reports |
| Photos and payment QR | User-supplied uploads; uploader must have permission to share | Store only for the intended visibility. An internal retention policy does not grant rights to third-party material. Reject unsafe uploads and provide text/image fallbacks |
| Notification delivery | Event state determines eligibility; delivery provider supplies delivery outcome where supported | A queued request is not proof of receipt. Store minimum recipient/delivery metadata; provider use/retention, suppression and costs must be checked when selecting it |

No third-party venue, sports, maps, social or payment data service is required. Calendar export and QR generation should use local/native capabilities where practical. No external service's price, terms, access or production availability has been verified by this bootstrap.

## Technical direction and proposed structure

Accepted technical constraints are mobile-first PWA delivery, shareable event links, persistent shared participation state, manual payment tracking, event-agnostic concepts, and low operating cost. **D-10 accepted on 2026-10-22:** React/TypeScript/Vite with npm, Cloudflare Workers for static assets and trusted API/scheduling, Supabase Postgres/Auth, Google OAuth sign-in and Resend transactional email. Local synthetic scaffolding is authorized; cloud provisioning, spending and deployment remain separate.

**Recommendation:** use one modular web application and one authoritative persistent data store. The client presents event information and issues actions; trusted application/data operations enforce identity, roles, seats, fees and history. Scheduled delivery handles reminders and change alerts using persisted event state. This fits shared capacity and recurring notifications without requiring microservices, native apps, multiple identity systems or a speculative extension framework.

The owner accepted the [P-01 technical recommendation](https://linear.app/wwonderland/document/p-01-technical-decision-recommended-stack-and-session-loop-contract-eba7e99b792c) for local scaffolding. Postgres is the authoritative store; the Worker verifies identity and checks current group roles through deliberately exposed backend operations. Provider account access and live integration still require evidence. The separate D-01/D-03/D-04/D-05 policy proposals remain open. Actual commands and pinned package versions belong in README and the lockfile.

On 2026-10-22, the owner directly requested conversion to Turborepo, Next.js and
pnpm (D-11). The current implementation direction is one Next.js App Router app
with shared domain and server-only API workspace packages. This supersedes the
Vite/npm portion of D-10. Cloudflare through OpenNext, Supabase Auth/Postgres,
Google OAuth and Resend retain their existing roles and live-service gates.

The following is a **proposed layout for later implementation**, not created source directories or a runnable scaffold:

```text
rallypoint/
  PRD.md                 Product contract and decisions
  AGENTS.md              Shared execution rules
  CLAUDE.md              One-way import of AGENTS.md
  README.md              Orientation and actual setup/check commands when adopted
  src/
    app/                 Shared-link pages and organizer/participant interfaces
    domain/              Groups, event/series, registration, fees and attendance rules
    server/              Trusted persistence, authorization and delivery scheduling
    ui/                  Reused accessible visual/interaction primitives
  public/                PWA manifest, icons and approved public assets
  tests/                 Focused behavioral checks using the chosen toolchain
```

Adapt these areas to the selected framework rather than forcing a second routing/server system. Use schema migrations when persistent storage is introduced; isolate local/test data from real groups. Agree a backup/recovery method before storing pilot data. Provider configuration, credentials, package versions, and runnable commands belong in the README/setup guidance once real, not in this product contract.

## Validation and delivery direction

Sequence useful outcomes rather than building all infrastructure first:

1. Prove a shareable group-owned session and truthful capacity/waitlist status, including cancellation and guest rules after D-01/D-03/D-06 decisions.
2. Complete the organizer's session loop with fixed/split allocations, manual payments, notifications/calendar, announcements and attendance after their relevant decisions.
3. Reduce repeat effort with templates, duplication and bounded series; complete sharing, profiles and trust controls; validate the entire supplied MVP with recurring pilot groups.

These are indicative outcomes, not executable tasks, assignments, estimates or authorization to create issues. Later planning may overlap independent outcomes while respecting actual dependencies.

Before calling an implemented MVP ready, collect evidence for:

- Complete organizer and participant walkthroughs for a sport session and a non-sport event.
- Simultaneous last-seat joins; withdrawal/promotion races; duplicate retries; guests that do not fit; opening/cutoff/start boundaries; role denial and membership revocation.
- Fee rounding and headcount changes; paid/unpaid correction without changing slot status; attendance correction and count provenance.
- Private/unlisted/public reads, link previews, exports and announcements under different identities; malicious/invalid uploads and report access.
- Real selected-channel notifications with failure/retry and cancellation suppression; calendar time/identity; series local-time scheduling; PWA install and offline error behavior on the chosen browser/device scope.
- Focused automated checks and the adopted lint/type/build checks; changed interactive flows in an actual runtime. No new end-to-end suite is implied by this specification.
- Resource limits, restore procedure, privacy/deletion handling, moderation ownership and relevant provider permissions before real pilot data or launch.

Evidence must identify the version/artifact, environment, date, scenarios checked, results and gaps. Specification review is not runtime verification. The product owner accepts consequential product decisions and launch readiness; implementation completion does not authorize repository publication, deployment, merging or spending.

## Decisions and uncertainty

The project context supplies the name, audience, principles, MVP feature list, exclusions, future phases and core experience. Those remain the baseline. On 2026-10-21, the owner accepted verified sign-in before reservation; pre-start withdrawal with retained post-cutoff fee liability; organizer-enabled +1 parties that join/promote together in strict queue order; and immediate pre-start promotion with upfront fee consent and no fee for waiting. The owner also accepted group-owned first-loop events, unlisted default link access, separate group membership, primary-managed guests without separate accounts, before-cutoff removal of unpaid fees, externally handled refunds of already-paid money, the first-loop roster/financial/attendance visibility and organizer/co-host controls, and email plus immediate in-page status with a reminder 24 hours before start and no catch-up reminder for later sign-ups. The rows below distinguish accepted portions from remaining proposals; none authorizes implementation or task creation.

| ID | Open decision and recommendation | Tradeoff and dependent work |
| --- | --- | --- |
| D-01 | **Partly accepted, 2026-10-21:** public/unlisted viewing without sign-in; verified sign-in before reservation; group-owned first-loop events; nonmember participation without automatic membership. **Bootstrap accepted, 2026-10-22:** the verified creator becomes owner and controls organizer/co-host assignments. **Open:** general membership entry and broader role/standalone-event policies | Owner explicitly approved creator-as-owner for P-02. Role-assignment/invitation UI stays outside this increment; joining grants no management authority |
| D-02 | Series controls. Recommend bounded weekly recurrence on selected days, explicit end date, occurrence versus future edit scope, and preview before applying changes | Simpler than a general recurrence editor. Set generation ceiling and booked-occurrence change handling before series implementation |
| D-03 | **Partly accepted, 2026-10-21:** withdrawal before event start; organizer-enabled one guest, managed by the primary registrant without a separate guest account; primary/guest stay together; strict queue order without later-party bypass; immediate promotion before event start without a claim timer, with upfront fee consent. Waiting is free and leaving before promotion is allowed. **Deadline accepted, 2026-10-22:** new direct joins and waitlist entries close exactly at start, evaluated after lock waits. **Still proposed:** private guest access and post-registration edits | Accepted in the owner's planning replies. Strict party order can leave a vacancy while the first eligible party needs two seats; the owner accepted this tradeoff. Fee effects are in D-04. Resolve remaining private-guest details and post-registration edits before their implementation |
| D-04 | **Partly accepted, 2026-10-21:** before-cutoff withdrawal removes unpaid fee obligations; at or after cutoff an existing obligation remains unless explicitly waived; waiting is free; immediate promotion creates the published fee obligation, including after cutoff, with prior consent; the organizer handles any already-paid refund outside RallyPoint. **Fixed-fee replacement accepted, 2026-10-22:** a late withdrawing registrant retains their existing fee until an explicit organizer waiver, while a promoted replacement owes their own published fee independently. Filling the vacancy does not automatically waive the original fee; paid history and external refunds remain separate. **Split approach accepted, 2026-10-22:** published total cost, live estimates, organizer/co-host finalization at or after start, then payment tracking; equal seat shares across confirmed and unwaived late-withdrawn seats, including guests and replacements; exact rounding and zero-payer unallocated cost; explicit reviewed corrections preserve history. **Written safeguards accepted, 2026-10-22:** no effective-total increase, paid-amount repricing blocked, no automatic waiver redistribution, reviewed undo when an allocation is absent from the current split, attributable preserved history and explicit consent to the possible total. See the written specification linked in RP-09 | Owner accepted the written specification and authorized implementation planning. Implementation-plan review and execution-method selection remain separate. Neither split approval nor filling a vacancy waives retained liability or authorizes automatic refunds; the existing fixed-fee rule stays intact |
| D-05 | **Partly accepted, 2026-10-21:** email plus immediate in-page status for confirmations, promotions and material changes; one reminder 24 hours before start, with no catch-up reminder for later sign-ups. The event page remains authoritative when email is delayed/missed. **Open:** provider/sender, reminder recipients, retry/resource ceiling and failed-delivery visibility | Accepted in the owner's planning reply. Resolve provider/sender permissions, recipient rules and bounded delivery/failure behavior before enabling outbound email; do not add SMS, browser push or multiple providers to the first loop |
| D-06 | **Partly accepted, 2026-10-21:** first-loop events default to unlisted; basic details/counts for link visitors; eligible verified participants may join without automatic membership; display-name roster for confirmed participants; own fee/payment status for each participant; full roster and payment/check-in/no-show controls for organizers/co-hosts; other participants' financial and attendance history hidden. **Broader accepted intent:** organizer-granted private access, with exact invitation/admission mechanics still open. **Still proposed:** membership as an admission basis, exports, detailed profile/attendance-count and private guest visibility | Accepted in the owner's planning replies. Unlisted links are shareable, not private access control. Resolve remaining private/profile/export policies before implementing them; creator-as-owner bootstrap is accepted under D-01 |
| D-07 | Blocking, member removal and moderation. Recommend a personal block prevents new joins to blocker-organized events and hides blocked profile details from the blocker; it does not silently cancel existing shared-event bookings. Organizer member removal revokes private membership, prevents new joins to that group's events until an organizer restores eligibility, and explicitly cancels that member's future active registrations, triggering normal seat reconciliation; payment history remains. Owner handles reports initially | Shared groups and organizer roles can overlap. Decide precedence, report access, response expectations and existing-booking handling before implementing/enabling these controls |
| D-08 | Pilot support and operating envelope. Recommend start with the actual pilot groups' devices and expected session sizes, visible accessible interactions, and no paid resources without explicit owner approval | No workload, latency target, browser matrix, formal accessibility target, storage ceiling or recovery objective was supplied. Set concrete acceptance limits before load validation and pilot launch; verify current provider quotas before commitment |
| D-09 | Retention, account/group deletion and report history. Recommend allow deletion/anonymization of personal profile/contact data, retain only the minimum group/event record required for authorized reconciliation, and restrict any retained moderation/payment history | Exact retention duration, backup expiry and deletion obligations are not established. Decide policy and cleanup responsibility before collecting real pilot data; this draft makes no legal-compliance claim |
| D-10 | **Accepted, 2026-10-22:** React/TypeScript/Vite, npm, Cloudflare Workers, Supabase Postgres/Auth, Google OAuth and Resend. The owner approved the recommended stack and starting WDL-382 local synthetic scaffolding | No further stack gate for local development. Live Google/sender/hosting setup, cloud provisioning, spending and deployment remain separate; D-01/D-03/D-04/D-05 policy gates are unchanged |
| D-11 | **Accepted, 2026-10-22:** convert the existing app to a Turborepo monorepo, Next.js and pnpm, as directly requested by the owner | Supersedes the Vite/npm portion of D-10. Preserve existing URLs, visual design, authorization, queue/fee policy and database history. Local conversion and review are authorized; cloud provisioning, spending and deployment retain their own gates |
| D-12 | **Accepted, 2026-10-22:** native-feeling responsive UI frame and visual direction: phone bottom tab bar (Home · Sessions · create · Groups · Dues), tablet/desktop top bar, a floating menu button on every size shared with the owner's Trove app, navy and neon-green brand, light/dark themes. See `docs/superpowers/specs/2026-10-22-ui-ux-redesign-design.md` | Supersedes D-11's "preserve visual design" clause only. Sessions, Dues and Updates ship as honest empty states; they do not authorize cross-group lists, payment tracking or notifications. URLs, authorization and registration/fee consent behavior stay unchanged |
| D-13 | **Accepted, 2026-10-22:** interface boundaries, set by the owner ("you don't even need timezone… remove similar noises"). (1) Ask only what the organizer must decide; everything else gets a default. Timezone comes from the organizer's device and visibility is unlisted, and neither is ever asked. (2) Never show internal or technical concepts: timezones, version numbers, "unlisted"/visibility, access-control wording, server or request mechanics, ids. (3) Say each thing once, where it is acted on: fee and cutoff terms belong in the join and withdraw steps, not in repeated footnotes. (4) No decorative copy (kickers, taglines, ledes) that does not help the task. (5) Times appear in the session's local time with no zone label | Supersedes the earlier "show timezone" content rule. The timezone stays in the data model, so stored instants, cutoff checks and validation are unchanged. Consent wording for fees stays explicit, only shortened. Recovery messages for unconfirmed requests stay, in plain words. Participants in another zone see the organizer's local times, which suits local recurring groups |

Key risks are organizer/admin scope overwhelming the first usable loop, identity friction undermining joining, races oversubscribing seats, party fairness leaving vacancies, missed promotions/reminders, privacy leaks through previews/exports, and free-tier exhaustion. Mitigate with the bounded delivery sequence, pilot timing, authoritative integrity checks, explicit D-03 tradeoff, truthful in-page status, access-matrix tests and hard resource ceilings. Revisit a recommendation when pilot evidence contradicts it; update the accepted contract rather than quietly shipping a different rule.

### Earlier repository planning and this update

The [earlier repository PRD](https://github.com/DJPajares/rallypoint/blob/0e270f5cb1b0cb3e90a1ddebda45795dabc41714/PRD.md) recorded an eight-place shared-link pilot, public and organizer-invited private access, and sign-in when creating/joining. Account-only participation and a smaller payment-free batch reflected that earlier planning pass; the current owner's supplied MVP and explicit planning approvals add primary-managed +1s, manual payment tracking, attendance and email. The current eight-task batch starts with an unlisted fixed-fee increment; it does not claim the broader public/private MVP is finished or erase the earlier organizer-granted private-access intent. Eight and twelve are verification examples, not product limits.

The prior six Linear tasks WDL-368–WDL-373 are archived history. The owner explicitly authorized publication of the reviewed P-01–P-08 batch and this GitHub PR on 2026-10-21; task publication does not approve the remaining policy/technology gates or authorize implementation. Earlier provider/layout research remains available through the immutable [previous README](https://github.com/DJPajares/rallypoint/blob/0e270f5cb1b0cb3e90a1ddebda45795dabc41714/README.md); its numbers and service assumptions must be rechecked before use. No earlier proposed stack became accepted through this documentation update.

