# Foundation API

The browser authenticates with Supabase Auth. The Worker verifies the access
token with `getUser`, requires a verified managed email, and derives the actor
from that response. Editable metadata is display-only. All responses use
`Cache-Control: no-store`.

| GET path | Result | Access |
| --- | --- | --- |
| `/api/health` | `{ status: "ok" }`, Worker liveness only | Public |
| `/api/config` | Public Auth URL/key and enabled methods, never the server key | Public |
| `/api/me` | Own `{ id, email, displayName }` | Verified identity |
| `/api/workspace` | `{ groups: [{ id, name, role }] }`, current memberships only | Verified identity |
| `/api/groups/:id/setup` | `{ group: { id, name, role } }` | Current owner/organizer/co-host in that group |

Failures use `{ error: { code, message } }`: 401 missing/invalid session, 403
unverified identity or denied role, 404 unknown operation, 405 unsupported method,
and 503 configuration/upstream failure. Unknown API paths never get SPA HTML.
Provider errors and keys are not serialized.

Internal tables live in unexposed `app`; only `api` is exposed. Browser roles
have no table or backend-RPC grants. The server-only service principal calls
security-invoker functions with explicit actor/target filters. RLS is enabled as
defense in depth. Role checks read current data rather than cached JWT metadata.

There are no group-create/role-assignment or event mutations. D-01 owner bootstrap
remains open. Synthetic role fixtures do not adopt that policy. Feature tasks
extend this API and migration history rather than adding another auth/data stack.

Google OAuth uses Supabase PKCE and a same-origin callback; live client/audience/
redirect configuration is still required. Local email-code sign-in exercises
managed sessions only: request and Auth URLs must both be loopback and the local
flag must be enabled. It does not establish live Google integration. No Resend,
event publishing, offline writes or hosted deployment is implemented here.
