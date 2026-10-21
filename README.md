# RallyPoint

**Fill the spots, not the chat.**

A mobile-first app for getting a recurring group together. This first scaffold
provides the public shell, managed sessions, group-role boundaries and isolated
local development. Session publication, reservations, payments and attendance
are implemented by subsequent tasks.

## Run locally

Requirements: Node 24+ (verified with 24.16.0), npm, and a running Docker-compatible
daemon. The first database start downloads local images. No cloud account, paid
resource or real participant data is needed for this setup.

```sh
npm ci
npm run db:start
npm run dev
```

Open [the app](http://127.0.0.1:5173) and
[the local mail inbox](http://127.0.0.1:54324).

`db:start` starts only the local RallyPoint Postgres/Auth/REST/mail services,
writes local credentials to ignored `.dev.vars` without logging them, and seeds
four synthetic Auth identities and two groups. The Docker network binds published
ports to loopback. Existing unrelated containers and Supabase projects are not used.
The development server uses port 5173 strictly, so an occupied port is an error.

In the local sign-in form, request a code for one of these fixtures and read the
message in the local inbox. No message is sent outside the local mail sink.

| Synthetic account | Expected view |
| --- | --- |
| organizer@rallypoint.test | Sunday Social Club; organizer group view allowed |
| member@rallypoint.test | Sunday Social Club; organizer group view denied |
| outsider@rallypoint.test | Eastside Rallies; Sunday Social Club denied |
| newcomer@rallypoint.test | Empty group list |

The fixed password in `scripts/local-env.mjs` is for these local-only test users.
Never reuse it for a real account. Global public signup is disabled; the local
email provider is enabled only to exercise existing synthetic identities.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | React/Vite plus the actual local Workers runtime |
| `npm run check` | Lint, client/Worker TypeScript checks and production build |
| `npm run preview` | Serve built output in the local Workers runtime |
| `npm run db:lint` | Check local SQL/function typing |
| `npm run test:api` | Live local Auth/API permission checks; requires the app and DB running |
| `npm run db:reset` | Recreate only the local synthetic DB from migrations and seed identities/roles |
| `npm run db:stop` | Stop the local RallyPoint containers, preserving their data |

After reset, sign out of old browser sessions and sign in again: recreated fixture
users have new IDs. Reset is a development recovery procedure, not a production
migration/backup plan. The helper always targets local services; it has no linked
or remote reset path. Do not place real data in this development database.

`npm run test:api` uses the synthetic passwords without logging tokens. It checks
missing/forged sessions, group isolation, metadata role spoofing, immediate role
revocation, backend-RPC denial, internal-table exposure and truthful empty results.
It temporarily removes and restores the synthetic organizer role.

## Configuration

Copy `.dev.vars.example` only for manual configuration. `db:start` normally
creates the real local file for you. Keep the Supabase secret/service key in that
ignored server-only file or supported Worker secret storage. The app's public
configuration contains only the Auth URL/publishable key and enabled methods.
No `VITE_*` secret variables are needed.

The shell works without configuration; sign-in explains the missing setup rather
than claiming a connection succeeded. All private API responses are uncached.

Google OAuth is the accepted live identity method. Its Supabase provider,
Google client, allowed audience/origins and callback URL still need separate
configuration and verification. The callback is `/auth/callback`; the app resumes
only validated same-origin destinations. Set `GOOGLE_AUTH_ENABLED=true` only when
the provider is configured. The local email-code exercise is enabled only for a
loopback request with a loopback Auth service and `LOCAL_AUTH_ENABLED=true`.
It does not prove live Google OAuth.

No cloud Supabase project is linked and no Cloudflare/Resend service is provisioned.
The configuration intentionally contains no deploy script. PWA manifest and
192/512-pixel icons are present; installability and safe shell caching remain part
of later PWA verification. There is no offline mutation queue or identity-data cache.

## Where to work next

- `src/`: app shell, routes, Auth provider and identity-scoped request state.
- `worker/`: verified identity boundary and explicit trusted API operations.
- `supabase/migrations/`: versioned schema; `app` tables are unexposed and
  backend RPCs in `api` deny browser roles.
- [Foundation API contract](docs/foundation-api.md): reusable operations and errors.
- `scripts/local.mjs`: isolated local lifecycle and synthetic fixtures.
- `tests/api.test.mjs`: focused API authorization regression checks.
- [PRD](PRD.md): product requirements and accepted/open decisions.
- [Agent rules](AGENTS.md), [Claude bridge](CLAUDE.md).

D-10 was approved in chat on 2026-10-22. The approved stack is
React/TypeScript/Vite/npm, Cloudflare Workers, Supabase Postgres/Auth,
Google OAuth and Resend. The [P-01 decision brief](https://linear.app/wwonderland/document/p-01-technical-decision-recommended-stack-and-session-loop-contract-eba7e99b792c)
contains the research and proposed future contracts. D-01 group-owner bootstrap
and the remaining D-03/D-04/D-05 policies retain their own gates. This scaffold
seeds explicit roles without adding a public group-owner assignment operation.

The session-publishing task reuses this shell, Auth/data boundary and migration
history. No event schema, queue, ledger, delivery infrastructure or inactive
future directories were added.

## Project destinations

- [GitHub repository](https://github.com/DJPajares/rallypoint), integration through
  reviewed PRs to `main`; the owner controls merging.
- [RallyPoint in Linear](https://linear.app/wwonderland/project/rallypoint-a26d48cd9e2d)
  owns approved task status and real dependencies.
- [WDL-382](https://linear.app/wwonderland/issue/WDL-382) owns this scaffold.
- [Reviewed original task batch](FIRST_SESSION_TASK_PROPOSAL.md) records publication
  provenance. WDL-382 was added later at the owner's request; archived TP tasks stay history.

Earlier documentation/planning provenance remains in Git history, including the
[bootstrap source](https://github.com/DJPajares/project-bootstrap-template/blob/ffc643068690548995a67d4bb85c3785894f9ec6/PROJECT_BOOTSTRAP.md).
Past provider research is not live integration evidence. Each change's PR/issue
report records its actual checks, environment and limitations.
