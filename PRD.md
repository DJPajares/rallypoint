# RallyPoint — Project Plan

**Where your people come together.**

**Owner:** RallyPoint project owner (the user)

**Updated:** 2026-10-21

**Status:** Shared-link pilot, public/invite-only private access, and sign-in timing accepted. Detailed behavior and technical direction remain proposed where identified below.

**Approval source:** The user's RallyPoint brief establishes the vision, feature goals, and constraints. Their selection of “Set up my project” authorized the documentation bootstrap. In the subsequent planning discussion on 2026-10-21, “use the recommendations” accepted the three first-release decisions recorded below. It does not approve every earlier proposal, task creation, or application implementation.

This document owns product requirements and technical decisions. [AGENTS.md](AGENTS.md) owns execution rules. The Linear project linked in [README.md](README.md#project-destinations) owns task status and dependencies. Issue execution reports own observed validation evidence; the authorized request's report owns standalone setup evidence. Written requirements do not establish implemented behavior. The owner separately approved task briefs TP-01–TP-06 and confirmed the repository/Linear destinations; those approvals do not approve unresolved product policies or authorize implementation.

## Purpose and tradeoffs

Make bringing people together as effortless as showing up. Replace spreadsheets, scattered chats, and manual coordination with a clear answer to: what is happening, where and when, what does it cost, and do I have a spot?

Start with recreational pickleball, badminton, tennis, and basketball communities. Support gatherings as events rather than making sports, teams, matches, or scoring mandatory concepts. The experience is **Create → Share → Join → Show Up → Repeat**. Members may be called **Ralliers**; participation does not by itself prove attendance.

The user's priorities are polished mobile-first UX, frictionless onboarding, shareable links, a focused PWA (an installable web application), maintainability, and zero or extremely low operating costs. Prefer native and first-party capabilities. Paid dependencies need a clear benefit and the owner's spending authorization. Resolve tradeoffs in favor of participation accuracy, privacy, and fewer steps before decorative or social complexity.

## Accepted first-release boundary

The owner accepted these recommendations in the first planning round:

- **Shared-link pilot:** Existing groups create and share events, with registration, capacity, cancellations, and automated waitlists. Discovery, recurring activities, and richer social features follow.
- **Public and invite-only private events:** Preserve both access modes in the first release. The specific invitation and admission flow remains to be decided.
- **Sign in when creating or joining:** Public browsing stays open. Participation is account-based; guest participation is outside this release. The authentication provider remains to be selected.

The first outcome to plan is an organizer sharing an event with eight places, a ninth person joining the waitlist, and a cancellation automatically releasing a place to that waiter. Eight places is an acceptance example, not a product capacity limit. This outcome does not establish the proposed start-time cutoff, roster policy, or notification policy.

| Delivery horizon | Boundary and reason |
| --- | --- |
| Accepted first-release boundary | Shared-link creation and participation for existing groups; public and invite-only private events; accounts required to create/join, with public browsing open. |
| User-supplied core features deferred by the accepted phasing | Public browsing/discovery, recurring activities, and richer social features including profiles and community connections. They remain intended product scope. Additional activity-specific configurations are also proposed for later delivery, while the base event stays activity-agnostic. |
| User-supplied future features | Achievements, collectible badges, titles, quests, milestones, optional leaderboards, reputation, advanced communities, venue integrations, and partnerships. |

Built-in payments, chat, team management, scoring, native mobile apps, AI features, and offline registration are outside the proposed first release. Displaying a cost does not process payment. No extension infrastructure is required merely because an idea is deferred.

Proposed operating assumptions are one organizer per event, one place per participating account, manually entered venue/cost information, online registration, and a basic display name. These details still require acceptance where consequential.

The following are **proposed acceptance contracts**, except for the explicitly accepted scope, access modes, and sign-in timing above. They elaborate feature goals without silently accepting unresolved product policies or technical mechanisms.

## Event and participation contracts

**RP-01 — Create, publish, and share.** An organizer can create an event with a title, activity, venue/location instructions, start and end, event time zone, positive capacity, visibility, and free/paid cost information. Currency is explicit when an amount is shown. Optional description and participation instructions do not delay the basic path. Reject invalid times/capacity inline and preserve entered values after a failed save. Publication produces a stable shareable URL. Owner edits preserve that URL and existing registrations; capacity cannot be reduced below confirmed participation. Drafts are owner-only. Activity labels and optional details must work for a workshop as well as a sports session.

**Acceptance:** Create and edit both a pickleball session and a workshop; open each published link in another session and see the intended details. The displayed time includes its zone and represents the same instant for different viewers.

**RP-02 — Identify and join.** Accepted: viewing a public event requires no account, and creating or joining requires sign-in. Proposed details: use managed authentication, return the person to the same event afterward, and require only a display name beyond the provider's necessary data. One account has at most one active participation record per event; an organizer consumes a place only if they explicitly join. The response distinguishes confirmed and waitlisted participation. Repeated submissions cannot add another place or improve queue priority. If the server outcome is unknown, reconcile the existing registration before retrying.

**Acceptance:** A signed-out visitor resumes their join after sign-in. Double taps, retries after a lost response, and concurrent requests by that account produce one active result.

**RP-03 — Allocate places fairly.** For a published future event, allocate available places in authoritative server processing order, independent of device clocks. A full event accepts a join into an ordered waitlist. Cancellation of a confirmed place automatically promotes the earliest active eligible waiter; new joins cannot jump that queue. Capacity increases apply the same promotion rule. Leaving the waitlist removes eligibility; rejoining enters at the tail. Repeating cancellation has no extra effect. Place allocation, cancellation, and related promotion must succeed consistently without intermediate overbooking or lost queue entries.

**Acceptance:** Two accounts contesting the last place yield exactly one confirmation and one waiter. A cancellation racing with a new join preserves the existing waiter's priority. A failed mutation leaves a consistent prior state, and reconnecting shows the committed outcome.

**RP-04 — Maintain independent states.** Event states are draft, published, and cancelled. Whether the event has started/passed and whether it is full are separate conditions. Participation states are confirmed, waitlisted, and cancelled. Proposed cutoff: joining and self-service cancellation close at the event start; the organizer can cancel the event. Event cancellation blocks further joins/promotions and clearly invalidates reservations for everyone affected. Previously issued URLs explain cancellation instead of appearing to be valid reservations. Past events must not be presented as upcoming; a reservation never counts as observed attendance.

**Acceptance:** Exercise draft/published/cancelled and future/past boundaries. A concurrent event cancellation and join cannot leave a valid new reservation for the cancelled event.

**RP-05 — Protect visibility and ownership.** Accepted: the pilot supports public and invite-only private events. The invitation mechanism remains open. Proposed detailed contract: only the organizer may change the event; people may manage their own participation. A private event requires organizer-granted access; knowing its ordinary URL is insufficient. Private event details, participant data, and metadata must not leak through discovery, previews, cached pages, or live channels. An unlisted page readable by anyone with a link must be named “unlisted,” not represented as private. Unlisted mode is not an additional first-release commitment. For public events, propose publicly visible participant counts; names are visible only to authorized participants and the organizer. Contact details and authentication records are never public. Enforce permissions at the authoritative data boundary and recheck them after access changes.

**Acceptance:** Anonymous users, unrelated accounts, participants, and the organizer receive only their permitted reads and writes, including through direct API calls. A private link's public preview contains no event details. Sign-out does not leave private content available in a shared device cache.

**RP-06 — Show reliable live outcomes.** Open event pages receive participation changes without manual reload. On reconnection or return, fetch authoritative state. Pending actions have visible feedback; failures offer an understandable retry without losing context. Never confirm a place from a local counter, offline cache, or optimistic display alone. A paused/unavailable backend reports that availability cannot be verified. Proposed first-release promotion awareness is in-app on the open page or next visit; background email, SMS, and push delivery are not promised.

**Acceptance:** Two sessions converge after join, cancellation, and promotion. Disconnect during a write and restore access: the UI resolves the actual result without duplicate participation. Service failure never displays a fabricated confirmation.

**RP-07 — Make mobile participation effortless.** The event page prioritizes activity, time, venue, cost, availability, and a clear next action. Use progressive disclosure and short forms. Proposed baseline: usable at 360 CSS pixels and by desktop keyboard, with labeled controls, visible focus, readable contrast, announced errors/status changes, and reduced-motion support. English is the proposed initial language; dates, zones, and currency remain explicit. Installation is optional; normal browser links always work. Provide the PWA installation assets and cache only safe shell/static resources. Offline registration and offline access to private data are excluded. Public share previews should identify the event without exposing participant data.

**Acceptance:** Complete the core flow in a mobile viewport and by keyboard; inspect loading, empty, full, waitlisted, cancelled, denied, and failure states. Check installability and the server-delivered public preview metadata on the eventual hosting runtime.

## Technical direction — proposed

Recommend one TypeScript project: React with Vite for the mobile UI, Supabase for managed identity/PostgreSQL/live updates, and Cloudflare Workers with static assets for hosting. This keeps event/participation records in one relational source of truth and avoids maintaining an independent application server. Provider fit and current limits are observations, not a promise of permanently free hosting; dated research belongs in [README.md](README.md#cost-and-provider-notes).

Put access decisions and concurrent participation transitions in authoritative operations backed by database transactions and appropriate constraints. Browser state is a presentation of those results. Row-level permissions and controlled write privileges must prevent bypassing the same rules through a different API path. Define the operation contract and meaningful errors before implementing it; do not create parallel specifications without a consumer need.

A small route in the same Worker deployment can serve safe public event metadata so chat previews do not depend on browser JavaScript. All other application logic should remain in the UI or authoritative backend unless a concrete need justifies more. Start with typed/manual venue information and link sharing; no paid geocoding, notification service, custom identity system, extra cache/database, upload storage, or message broker is necessary. The proposed layout has one home in the README; no application directories have been scaffolded.

Collect only necessary identity and event data. Organizers author events; Ralliers control their profile and participation. Cancellation is distinct from data deletion. Before real-user launch, the owner must accept retention durations, an account/data removal route, treatment of organizer-owned events, and backup expiry. Recommend cancelling future participation and removing/anonymizing profile data on deletion, with ownership resolved before deleting an organizer account. Test with synthetic data until these policies are settled.

## Evidence and useful outcomes

Use a small consenting community pilot to observe whether an organizer can create/share an event without assistance, visitors can obtain a clear registration outcome, cancellations refill from the queue, and organizers choose to repeat. Record completion and drop-off points through observed sessions or minimal first-party records; a paid analytics service is unnecessary. No user research, conversion baseline, adoption target, or measured performance is claimed. Agree a representative workload and response-time target before performance acceptance.

The indicative progression is a believable event page and creation flow, then trusted end-to-end registration, then a pilot that proves cancellation/reconnection/privacy and the PWA experience. These are useful outcomes for later planning, not executable tasks or authorization to implement them. Runtime/database evidence must cover RP-01–RP-07 for the agreed release; document review alone cannot establish those outcomes.

## Open decisions and material risks

The project owner decides the following in planning. The accepted release boundary, access modes, and sign-in timing do not need to be reopened:

| Decision | Recommendation and affected work |
| --- | --- |
| Authentication provider and private admission | Accounts and invite-only privacy are accepted. Evaluate a managed social sign-in such as Google against the actual group's access needs; confirm invitation redemption/revocation and roster visibility before their implementation. Email sign-in needs a suitable sender. Provider setup is not yet authorized. |
| Participation policies | The first outcome includes automatic promotion following cancellation. Confirm one-person/one-place, start-time cutoff, whether promotion needs reconfirmation, and in-app versus background awareness before dependent implementation. |
| Stack and operational tolerance | Accept or revise the proposed stack. A free-tier pilot must tolerate quota exhaustion and inactive-project pauses; an unattended public launch needs an accepted availability/recovery approach and spending ceiling. Never upgrade automatically. |
| Real-user data and release | Set retention/removal and organizer-ownership rules, expected pilot load, and acceptable recovery/export evidence before storing real participant data. Broader public discovery also needs appropriate abuse controls before release. |

Detailed product policy and architecture remain proposals wherever not explicitly supplied by the user. Record later accepted decisions here with their actual approval source; do not infer approval from implementation or task completion.
