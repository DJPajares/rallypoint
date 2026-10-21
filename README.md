# RallyPoint

**Fill the spots, not the chat.**

Create and share group activities. Sign-ups, waitlists, and payments, all in one link.

RallyPoint is a planned mobile-first PWA for organizers of recurring group activities, initially recreational sports. The core experience is create → share → join → show up → repeat. It works alongside group chats and tracks payments made outside the app.

## Project foundation

This repository contains project documents only. There is no runnable application, package manifest, installed application dependencies, database or deployment. GitHub and Linear are the selected project destinations; task publication does not authorize implementation.

- [PRD.md](PRD.md): product purpose, supplied MVP, testable requirements, proposed structure, decisions and validation direction.
- [AGENTS.md](AGENTS.md): shared working rules, task workflow/format, testing and human authority.
- [CLAUDE.md](CLAUDE.md): imports the shared rules for Claude-compatible tooling.
- [FIRST_SESSION_TASK_PROPOSAL.md](FIRST_SESSION_TASK_PROPOSAL.md): the reviewed eight-task first-session batch, publication provenance and explicit gates; not a live backlog.

The supplied product context is the baseline. Generated detailed policies and technology choices are proposals until accepted. Linear owns approved task status and dependencies. Direct requests own standalone work; validation belongs to each change's issue execution report or linked completion/review record.

## Setup and verification

There are no application installation, development, build or test commands yet. Once a toolchain is accepted and implemented, record verified prerequisites and commands here. Keep credentials in supported environment/secret facilities, never in committed documents.

The PRD proposes an application layout; bootstrap deliberately creates no source scaffolding or empty future directories. Selecting a stack, provisioning services and implementing the application require further work authorization.

## Project destinations

- **GitHub repository:** [DJPajares/rallypoint](https://github.com/DJPajares/rallypoint), currently public; integrate through a PR to `main` and leave merging to the owner.
- **Linear project:** [RallyPoint](https://linear.app/wwonderland/project/rallypoint-a26d48cd9e2d), project `P-WDL-4`, UUID `c069181d-b6bf-43a7-863d-d7fda47c21b1`, in wWonderland, team **wonderland (WDL)**.
- GitHub owns source/document history; Linear owns the approved tasks and real dependency relations. Link PRs and issues explicitly; no automatic status transition or organization-wide GitHub/Linear integration is assumed.
- The owner authorized the reviewed P-01–P-08 task publication. Earlier TP-01–TP-06 records WDL-368–WDL-373 are archived history and must remain untouched.

## Next conversation

The first-session behavior and eight-task publication are reviewed; use the PRD's accepted decisions and the current Linear issue rather than restarting settled brainstorming. The stack and other explicitly listed gates remain open. Continue discuss → decide → draft tasks → approve creation for new batches; creating the current tasks does not start implementation.

Copy this into a separate conversation that can access this local project:

```text
Read and follow https://raw.githubusercontent.com/DJPajares/project-bootstrap-template/main/TASK_PLANNING.md for RallyPoint at https://github.com/DJPajares/rallypoint, or /Users/wonderboi/dev/github/rallypoint. If you cannot retrieve the guide, say so.

Read the actual PRD.md, AGENTS.md and README.md; use https://linear.app/wwonderland/project/rallypoint-a26d48cd9e2d for approved task status and dependencies. If repository/local access is unavailable, ask me to attach those actual documents.

Continue from the current P-01–P-08 task record and the accepted first-session policies. Preserve the organizer-first, sports-first, event-agnostic PWA and low-cost boundaries. Do not restore the archived TP-01–TP-06 batch or duplicate tasks. Resolve each named policy/technical gate before dependent implementation; task publication alone is not implementation authorization. For new work, follow discuss → decide → draft tasks → approve creation.
```

The local path is not a publicly readable URL. A conversation running elsewhere needs the actual project files attached or access to a later verified repository.

Bootstrap instruction provenance: [PROJECT_BOOTSTRAP.md](https://github.com/DJPajares/project-bootstrap-template/blob/ffc643068690548995a67d4bb85c3785894f9ec6/PROJECT_BOOTSTRAP.md) and its agent, Claude, requirements and task references at the same revision. Source revision is provenance, not a RallyPoint software version.

## Earlier planning context

The repository previously held a smaller shared-link pilot and an unapproved React/Vite, Supabase and Cloudflare Workers candidate. The current PRD records how this round extends and sequences that direction. Keep the [earlier README](https://github.com/DJPajares/rallypoint/blob/0e270f5cb1b0cb3e90a1ddebda45795dabc41714/README.md) as historical setup/layout/provider research; do not silently adopt its provider choice or reuse dated pricing/limits without current verification. No runtime verification in that document establishes behavior for an application that does not exist yet.
