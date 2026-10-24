# P-17 venue Google Maps link — review evidence

Date: 2026-10-24, Asia/Singapore. Task: [WDL-392](https://linear.app/wwonderland/issue/WDL-392).
Branch: `djpajares/wdl-392-p-17-link-a-session-venue-to-google-maps-without-google`,
cut from `main` at `ac9b105`. Verified code: `efc6b77` (after review fixes); documentation follows it.
No release version is assigned. This is implementation and local validation,
not human acceptance, merge or live-flow verification.

## User note

Organizers can paste a Google Maps link for the venue. Participants then get
"Open in Google Maps", which opens that exact place instead of a search for the
venue name.

## Result and scope

- Optional **Google Maps link** field under Location; blank removes it.
- Kept only for `https://` links on `www.google.com/maps…`, `maps.google.com`,
  `maps.app.goo.gl/…` and `goo.gl/maps/…`, up to 2,048 characters, with no
  credentials or port. Lookalike hosts and other schemes are refused with
  "Use a link copied from Google Maps." on the field; the rest of the form is kept.
- The same check runs in the shared session rules (form and API, so direct
  requests are covered) and as the `sessions_maps_link_check` database constraint.
  Manager authorization is unchanged; the link is read with the session details.
- A blank link is never stored, so sessions saved before this change are not
  altered and re-saving them is not a change.
- Under D-14 the link is part of the venue: on a booked session, adding,
  replacing or removing it shows "Change the time or place?", records a material
  change and a change signal (`mapsLink` in `changes`/`previous`), and gives
  affected parties free withdrawal until start.
- The ticket's "Open in Google Maps" opens the saved link in a new tab with
  `rel="noopener noreferrer"`; without one it keeps the existing venue search.
- "Run again next week" copies the link with the venue.
- No Google Cloud project, key, SDK, embed, place lookup or server-side fetch.

## Environment

- macOS local worktree; Node 24.16.0, pnpm 12.15.0, Next.js 16.4.2,
  Prisma 7.10.1, Supabase CLI 2.121.0; no dependency changes.
- Existing loopback synthetic Supabase Postgres/Auth/Storage/mail services,
  shared with the main checkout. Migration `20261024150000_session_maps_link`
  was applied to that local database only.
- API and browser checks used this branch's Next development server on
  `127.0.0.1:3001` (`RALLYPOINT_TEST_URL`), because `:3000` served the main checkout.
- Synthetic accounts and sessions only.

## Checks

| Check | Result |
| --- | --- |
| `node --test tests/maps-link-domain.test.mjs` (RED first, then GREEN) | 5/5 pass; accepts the four link forms, rejects 15 unsafe/unrelated inputs, link-only change is material, run-again copies it |
| `node --test tests/maps-link.test.mjs tests/booked-edits.test.mjs tests/sessions.test.mjs` (RED first, then GREEN) | 26/26 pass; add/replace/remove, 422 bad link, 403 non-manager, DB constraint, booked link-only change material + signal + free withdrawal, old booked session stays non-material |
| `pnpm db:lint` | No schema errors |
| `pnpm check` (lint, typecheck, build) | Pass |
| `node --test tests/pages.test.mjs tests/navigation.test.mjs` | Pass |
| `pnpm test:api` (whole suite) | 355/355 pass, 0 fail, 0 skipped |

Browser, 375×812, keyboard and DOM inspection on `:3001`:

- Unsafe link `javascript:alert(1)` on Save draft: field error shown under the
  field, `aria-invalid`, focus moved to the field, title and venue kept.
- Saved share link: "Open in Google Maps" `href` equals the stored link,
  `target="_blank"`, `rel="noopener noreferrer"`; no `google`, `gstatic` or
  `googleapis` resource was requested by the page; the action is reached by Tab.
- Session without a link: the action searches the venue text (existing behaviour).
- Editing a session saved without a link: the field is empty.
- Booked session, link-only change: "Change the time or place?" sheet; confirming
  stored the link with a material change and signal `{"mapsLink": …}`.

## Fresh review

A fresh reviewer read `ac9b105..7899d30` against the plan and WDL-392: no
critical findings. It confirmed the copied SQL functions change only the
intended lines and that all five review-focus cases hold. Two important
findings were fixed in `efc6b77` and checked in the browser before and after:

- The link error was not announced to screen readers. It now uses
  `role="alert"` with `aria-invalid` and focus on the field.
- The field's `maxLength` silently cut pasted links over 2,048 characters.
  A 2,134-character link is now kept and rejected with the field error;
  nothing is saved.

The same commit restores formatting outside P-17 that an earlier format pass
had changed. After the fixes: `pnpm check` passes and `pnpm test:api` is
355/355. Deferred minor findings: doubled-slash share links pass the form
but fail the database check with the generic message; `mapsLink: null` from a
direct API client is refused rather than clearing the link; a server-returned
link error stays shown while retyping; no test re-saves a booked session with
an unchanged link. Country Google domains such as `google.com.ph/maps` are
refused because the accepted host list is exact.

## Gaps

- No real-device check of how iOS/Android hand the link to the Maps app; links
  were not opened against live Google Maps.
- No staging or production verification; no live provider involved.
- Material-change emails are still not sent (unchanged; the signal is recorded).
- An existing hydration warning on the sign-in page appeared in the dev console;
  it is unrelated to this change.
