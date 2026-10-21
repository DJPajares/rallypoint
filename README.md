# RallyPoint

**Where your people come together.**

Make bringing people together as effortless as showing up.

RallyPoint is a proposed mobile-first platform for organizing and joining group activities. Start with recreational sports communities while keeping gatherings event-agnostic.

## Start here

- [PRD.md — project plan](PRD.md): supplied intent, proposed release scope, observable requirements, technical direction, and decisions to resolve.
- [AGENTS.md — agent working rules](AGENTS.md): authority, planning, execution, validation, and delivery rules.

**Current state:** Documentation and planning only. The owner accepted the shared-link pilot, public/invite-only private events, and sign-in when creating or joining; see the PRD for the approval source. Other product policies and the stack remain proposed. There is no application, package manifest, database, deployed environment, or runnable development/build/test command. Linear owns task status and issue execution evidence; the authorized request's report owns standalone setup evidence.

## Project destinations

- **Private GitHub repository:** [DJPajares/rallypoint](https://github.com/DJPajares/rallypoint). Repository access is required to read its files from another conversation.
- **Linear project:** [RallyPoint](https://linear.app/wwonderland/project/rallypoint-a26d48cd9e2d), project `P-WDL-4`, in the [wWonderland workspace](https://linear.app/wwonderland), under team **wonderland (WDL)**.
- **Authority:** GitHub stores the source and documents. Linear owns approved task records and their real dependencies; do not mirror the backlog into GitHub issues or another local task system. The owner approved proposal TP-01–TP-06 and confirmed these destinations in the setup conversation. Task creation does not authorize implementation.

## Proposed implementation layout

This layout is a proposal for later scaffolding; these directories have not been created. See the PRD for the technology recommendation and responsibility boundaries.

```text
src/
  app/                    Routing, session handling, and PWA integration
  features/events/        Event creation, details, and organizer controls
  features/participation/ RSVP, cancellation, and waitlist presentation
  components/             Shared accessible interface primitives
  lib/                    Typed backend clients and formatting helpers
worker/                   Public share metadata and static-asset routing
public/                   Icons, manifest, and safe static assets
supabase/migrations/      Versioned data model, permissions, and operations
tests/                    Focused integration and concurrency verification
```

Do not turn this outline into empty infrastructure. After stack acceptance and authorized scaffolding, add the actual prerequisites, pinned dependencies/lockfile, environment-variable names, synthetic-data setup, and verified run/build/check commands here. Keep credentials in supported local/provider secret storage. Development checks must use isolated synthetic data rather than live participant records. No tool installation or external account connection is necessary to review these documents.

## Cost and provider notes

Checked against official documentation on **2026-10-21**. These are current planning inputs, not service guarantees or approved provider commitments. Recheck them at provisioning and before release.

| Source | Observed constraint and consequence |
| --- | --- |
| [Supabase pricing](https://supabase.com/pricing) | Free includes a 500 MB database and 50,000 monthly active users. Free projects can pause after one week of inactivity; there is a limit of two active projects. A small pilot may fit, but inactivity can interrupt availability. |
| [Supabase email delivery](https://supabase.com/docs/guides/auth/auth-smtp) | The default sender is for testing, restricted to project-team addresses, and currently limited to two messages per hour. Public email sign-in requires a suitable custom sender; it is not a ready free production onboarding path. |
| [Cloudflare static-asset billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/) | Static-asset requests are free and unlimited; dynamic routes use Workers limits/pricing. Worker-first routes can return 429 when free-tier request limits are exceeded. Public metadata rendering still consumes dynamic resources. |

The [Cloudflare React/Vite guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/react/) documents the proposed hosting pattern. The [Supabase database-functions guide](https://supabase.com/docs/guides/database/functions) and [row-level security guide](https://supabase.com/docs/guides/database/postgres/row-level-security) inform the proposed authoritative data boundary. They are implementation references, not evidence that RallyPoint's permissions or transactions work.

Start a pilot on free plans only after the owner accepts their limitations. Use provider subdomains initially. Keep live subscriptions scoped to open pages and bound retries and data reads. Include auth, live-message/connection quotas, egress, storage, hosting, any domain/email needs, and recovery/export requirements in the launch cost review. No precise capacity estimate or permanent $0 operating promise has been established. Paid upgrades require owner authorization.

## Continue planning

Continue from the Linear task records and accepted PRD decisions. To continue in another conversation, give it access to `/Users/wonderboi/Documents/ChatGPT/rallypoint` or the private repository, plus the relevant Linear issue. These are local files, not publicly retrievable URLs; if it cannot access either source, attach the actual `PRD.md` and `AGENTS.md` files.

Copy this starter:

> Read and follow https://raw.githubusercontent.com/DJPajares/project-bootstrap-template/main/TASK_PLANNING.md for RallyPoint at `/Users/wonderboi/Documents/ChatGPT/rallypoint` or https://github.com/DJPajares/rallypoint (private; access required). Read `PRD.md`, `AGENTS.md`, and `README.md`. Use https://linear.app/wwonderland/project/rallypoint-a26d48cd9e2d for approved task status and dependencies. Preserve the accepted shared-link pilot, public/invite-only private events, and sign-in when creating or joining. The first outcome is create → share → join, including reliable capacity, cancellations, and waitlist promotion. Reuse the approved TP-01–TP-06 task records; do not restart settled discussion or duplicate tasks. Resolve remaining authentication-provider, invitation, participation-policy, and low-cost-stack decisions before dependent implementation. Preserve my sports-first, event-agnostic, mobile-first PWA direction and zero/extremely-low-cost constraint. Follow discuss → decide → draft tasks → approve creation for new work. Existing task-creation approval does not authorize implementation.

## Bootstrap provenance

Prepared using the user's RallyPoint context and the retrieved [Project Bootstrap instructions](https://raw.githubusercontent.com/DJPajares/project-bootstrap-template/main/PROJECT_BOOTSTRAP.md), with its [agent-rules reference](https://raw.githubusercontent.com/DJPajares/project-bootstrap-template/main/templates/AGENTS.template.md) and [requirements reference](https://raw.githubusercontent.com/DJPajares/project-bootstrap-template/main/templates/PRD.template.md). References were read as guidance; they do not substitute for project decisions.
