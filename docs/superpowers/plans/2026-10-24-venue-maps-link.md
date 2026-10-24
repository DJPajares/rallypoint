# Venue Google Maps Link Implementation Plan (P-17 / WDL-392)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an organizer/co-host attach an optional pasted Google Maps link to a session venue, so participants open that exact place instead of a name search.

**Architecture:** The link is an optional `mapsLink` key inside the existing `app.sessions.details` JSON. `normalizeSession` (run by both the form and the API) validates it; a table check constraint backs it up. Booked-session rules (D-14) treat a link change as a venue change: `assert_booked_edit` allows the key, and `save_session_before_cancellation` counts it as material and puts it in the change signal. The session ticket opens the saved link, falling back to today's venue search.

**Tech Stack:** TypeScript domain package, Hono API, Supabase Postgres migrations (applied by Prisma `db:start`), Next.js App Router web app, `node --test`.

**Spec:** [WDL-392](https://linear.app/wwonderland/issue/WDL-392/p-17-link-a-session-venue-to-google-maps-without-google-cloud) plus the design the owner approved in chat on 2026-10-24, summarized below.

### Approved design (2026-10-24)

- Optional "Google Maps link" field under Location; blank removes the link.
- Accept only `https://` on `www.google.com/maps…`, `maps.google.com`, `maps.app.goo.gl/…`, `goo.gl/maps/…`, ≤ 2,048 characters; reject credentials, ports, lookalike hosts and other schemes. Error "Use a link copied from Google Maps."; entered details are kept. RallyPoint never fetches or expands the link.
- Checked in the browser, at the API (direct requests), and by a database check. Same manager authorization as other details.
- Sessions without a link stay valid; a blank link is never stored, so it never reads as a change.
- On a booked session, adding/replacing/removing the link is a venue change: same "Change the time or place?" confirmation, bookings kept, free withdrawal, recorded in the change signal.
- Ticket: with a link, "Open in Google Maps" opens exactly that link in a new tab (`rel="noopener noreferrer"`); without one, the existing venue search stays, same label. No Google SDK or lookup.
- Run again next week copies the link with the venue.

## Global Constraints

- Allowed hosts/paths, exactly: `www.google.com` with path `/maps` or `/maps/…`; `maps.google.com` any path; `maps.app.goo.gl` with a non-empty path; `goo.gl` with path `/maps/` plus at least one more character. Scheme `https:` only. No username, password or port.
- Maximum length 2,048 characters (raw input and stored value).
- Field label "Google Maps link"; help "Paste a share link from Google Maps."; error copy exactly `Use a link copied from Google Maps.`; action label "Open in Google Maps".
- No Google Cloud, API key, SDK, embed, Places/geocoding call, or server-side fetch of the link.
- D-13: no internal terms (Place ID, URL validation, version) in the interface.
- The stored value is the parsed `URL.href`; a blank link is omitted from `details`, never stored as `""`.

## Review Focus

1. A session saved before P-17 (no `mapsLink` key) is re-saved unchanged on a booked session → must not trip `booked_event_locked` or count as a material change. Test in Task 2 (descriptive edit on booked session without link).
2. Hostname lookalikes and `@`-credential tricks (`https://www.google.com.evil.example/maps/…`, `https://www.google.com@evil.example/maps`, `https://www.google.com:444/maps`) → rejected. Tests in Task 1.
3. A link-only change on a booked session (venue text identical) → confirmation sheet in the UI and a material change + signal in the DB. Tests in Tasks 1 and 2.
4. Opening an older session in the edit form → the link input shows empty, not the text "undefined". Checked in Task 3 browser step.
5. A direct API save by a non-manager carrying a valid link → 403 and nothing stored. Test in Task 2.

---

### Task 1: Domain validation, material change and run-again copy

**Files:**
- Modify: `packages/domain/src/session.ts` (SessionForm, blankSession, normalizeSession, hasMaterialSessionChange)
- Modify: `packages/domain/src/run-again.ts:49`
- Test: `tests/maps-link-domain.test.mjs` (create)

**Interfaces:**
- Produces: `SessionForm.mapsLink?: string`; `export const mapsLinkError = "Use a link copied from Google Maps."`; `export function normalizeMapsLink(value: unknown): string | undefined` (blank/undefined → `undefined`; valid → `URL.href`; invalid → throws `InputError(mapsLinkError)`). `normalizeSession` sets `mapsLink` only when non-blank, for drafts and publishes alike. `hasMaterialSessionChange` also returns true when `(before.mapsLink ?? "") !== (after.mapsLink ?? "")`.

- [ ] **Step 1: Write the failing tests** in `tests/maps-link-domain.test.mjs` (reuse the `form` fixture shape from `tests/booked-edits-domain.test.mjs`):
  - `accepts each supported Google Maps link and stores the parsed href`: for `https://www.google.com/maps/place/Synthetic+Court`, `https://www.google.com/maps?q=1`, `https://maps.google.com/?cid=1`, `https://maps.app.goo.gl/AbC123`, `https://goo.gl/maps/AbC123`, and `  https://MAPS.APP.GOO.GL/AbC123  ` → `normalizeSession({...form, mapsLink: x}, true).mapsLink === new URL(x.trim()).href`; also valid with `publish=false`.
  - `blank or missing link is omitted`: `mapsLink` of `undefined`, `""`, `"   "` → result has no own `mapsLink` key (`!("mapsLink" in result)`).
  - `rejects unsafe or unrelated links with the field message`: each of `javascript:alert(1)`, `http://www.google.com/maps/place/x`, `https://www.google.com.evil.example/maps/place/test`, `https://www.google.com@evil.example/maps`, `https://user:pw@www.google.com/maps`, `https://www.google.com:444/maps`, `https://www.google.com/mapsevil`, `https://www.google.com/search?q=x`, `https://maps.app.goo.gl/`, `https://goo.gl/maps/`, `https://goo.gl/abc`, `https://example.com/`, `not a url`, `42` (number), and `"https://maps.app.goo.gl/" + "a".repeat(2030)` → `assert.throws(..., { message: session.mapsLinkError })` for both `publish` true and false.
  - `a link-only change is material, an equal or both-missing link is not`: before without link vs after with link → true; before with link vs after removed → true; replaced → true; same link → false; both missing → false.
  - `run again copies the link`: `nextWeekForm(details, now)` from `packages/domain/src/run-again.ts` with details carrying `mapsLink` → result `mapsLink` equal; without one → `""`.

- [ ] **Step 2: Run to verify failure**
  Run: `node --test tests/maps-link-domain.test.mjs`
  Expected: FAIL (`mapsLinkError` undefined / link not kept).

- [ ] **Step 3: Implement** in `packages/domain/src/session.ts`: add `mapsLink?: string` to `SessionForm`, `mapsLink: ""` to `blankSession`, `normalizeMapsLink` (parse with `new URL`, check exact `hostname` and `pathname` per Global Constraints, `username`/`password`/`port` empty, length of raw trimmed input and of `href` ≤ 2048), call it in `normalizeSession` before the `if (!publish) return form;` line, and extend `hasMaterialSessionChange`. In `run-again.ts` add `mapsLink: d.mapsLink ?? ""` beside `location`.

- [ ] **Step 4: Run tests**
  Run: `node --test tests/maps-link-domain.test.mjs tests/booked-edits-domain.test.mjs tests/run-again-domain.test.mjs`
  Expected: PASS.

- [ ] **Step 5: Commit**
  `git add packages/domain/src/session.ts packages/domain/src/run-again.ts tests/maps-link-domain.test.mjs && git commit -m "feat: validate an optional Google Maps link for a session venue"`

### Task 2: Database guard and booked-edit rules

**Files:**
- Create: `supabase/migrations/20261024150000_session_maps_link.sql`
- Test: `tests/maps-link.test.mjs` (create; uses `splitFixture` from `tests/helpers/split-fixtures.mjs`)

**Interfaces:**
- Consumes: Task 1 `normalizeSession` keeps `mapsLink` (API passes it through unchanged).
- Produces: constraint `sessions_maps_link_check` on `app.sessions`; `app.assert_booked_edit` allows key `mapsLink`; `app.save_session_before_cancellation` treats `details->>'mapsLink'` changes as material and includes `mapsLink` in signal `changes` (when changed) and `previous`.

- [ ] **Step 1: Write the failing tests** in `tests/maps-link.test.mjs`, with `edit`/`save` helpers copied from `tests/booked-edits.test.mjs`:
  - `organizer adds, replaces and removes a link on an unbooked session`: `splitFixture(t, { feeMode: "fixed" })`; save with `mapsLink: "https://maps.app.goo.gl/AbC123"` → 200, `GET /api/sessions/shared/:slug` returns `details.mapsLink` equal; replace with a `www.google.com/maps/place/…` link → stored; save with `mapsLink: ""` → shared details has no `mapsLink`.
  - `direct API save rejects a bad link and a non-manager`: `mapsLink: "https://www.google.com.evil.example/maps/place/test"` → 422 with message `Use a link copied from Google Maps.`; a valid link posted by `f.actors.at(-1)` → 403; stored details unchanged (`f.sql("select details->>'mapsLink' from app.sessions where id=…")` empty).
  - `database refuses a stored link outside the allowed hosts`: `f.sql` update with trigger disabled (pattern from `moveStart`) setting `mapsLink` to `https://example.com/` → throws (check violation); setting it to a valid link succeeds.
  - `link-only change on a booked session is a material venue change`: `splitFixture(t, { feeMode: "fixed", seats: [1], capacity: 2 })`; save adding a link → 200; `select material from app.session_changes where session_id=… order by version desc limit 1` → `t`; signal row's `changes` has key `mapsLink` and `previous` has `mapsLink` null; registration view for `f.actors[0]` has `own.freeWithdrawalAfterChange === true`.
  - `booked session without a link keeps descriptive edits non-material`: booked fixture, save `title` change only (no `mapsLink` key sent) → 200 and latest `session_changes.material` is `f`.

- [ ] **Step 2: Run to verify failure** (app and DB running per README)
  Run: `pnpm db:generate && node --test tests/maps-link.test.mjs`
  Expected: unbooked tests pass only if Task 1 is in; the DB-constraint and booked tests FAIL (`booked_event_locked` / no constraint).

- [ ] **Step 3: Write the migration**: add `alter table app.sessions add constraint sessions_maps_link_check check (not (details ? 'mapsLink') or (jsonb_typeof(details->'mapsLink')='string' and length(details->>'mapsLink') between 1 and 2048 and details->>'mapsLink' ~ '^https://(www\.google\.com/maps([/?#]|$)|maps\.google\.com([/?#]|$)|maps\.app\.goo\.gl/[^/?#]|goo\.gl/maps/[^/?#])'))`; `create or replace` `app.assert_booked_edit` from `20261023130001_booked_session_edits.sql` with `'mapsLink'` added to the allowed key list; `create or replace` `app.save_session_before_cancellation` from the same file with `or s.details->>'mapsLink' is distinct from p_details->>'mapsLink'` in `material_change`, `'mapsLink'` added to the signal `unnest(array[...])` using the text comparison branch (`k in ('location','mapsLink')`), and `'mapsLink',previous_details->'mapsLink'` in `previous`. Keep the existing revoke/grant lines for both functions. Apply with `pnpm db:start`.

- [ ] **Step 4: Run tests**
  Run: `node --test tests/maps-link.test.mjs tests/booked-edits.test.mjs tests/sessions.test.mjs && pnpm db:lint`
  Expected: PASS; lint reports no errors.

- [ ] **Step 5: Commit**
  `git add supabase/migrations/20261024150000_session_maps_link.sql tests/maps-link.test.mjs && git commit -m "feat: guard the venue maps link and treat its change as a venue change"`

### Task 3: Form field and ticket action

**Files:**
- Modify: `apps/web/src/session-pages.tsx` (Location field area ~line 524; `submit` ~line 317; `SessionTicket` ~line 832)

**Interfaces:**
- Consumes: `mapsLinkError`, `SessionForm.mapsLink` from Task 1; existing `mapsUrl(venue)` from `@rallypoint/domain/my-sessions`.

- [ ] **Step 1: Implement the field**: below Location, `<Field id="mapsLink" label="Google Maps link (optional)" help="Paste a share link from Google Maps.">` with an `<input id="mapsLink" type="url" inputMode="url" maxLength={2048} value={form.mapsLink ?? ""}>` (not the `input()` helper, which would print `undefined` for older sessions), disabled with `disabledFields`, `aria-describedby="mapsLink-help"` plus `mapsLink-error` when invalid. In `submit`, when `normalizeSession` throws with message `mapsLinkError`, set a field error rendered under the input as `<p id="mapsLink-error" role="alert">`, set `aria-invalid`, focus the input, and keep the form; other errors keep the existing form-level path. Clear the field error on change.

- [ ] **Step 2: Implement the ticket action**: `const mapHref = d.mapsLink || mapsUrl(d.location);` label `Open in Google Maps`; keep `target="_blank" rel="noopener noreferrer"`.

- [ ] **Step 3: Verify**
  Run: `pnpm check && node --test tests/pages.test.mjs tests/navigation.test.mjs`
  Expected: PASS.
  Browser (phone width 375px, keyboard): create a session with a link, publish, open the shared page, Tab to "Open in Google Maps" and confirm its `href` equals the saved link and the page makes no request to `maps.googleapis.com`; paste `javascript:alert(1)` and save → field error shown, other fields kept; open an older session without a link → empty field, search action still present; booked session link-only change → "Change the time or place?" sheet.

- [ ] **Step 4: Commit**
  `git add apps/web/src/session-pages.tsx && git commit -m "feat: add a Google Maps link field and open the saved place"`

### Task 4: Record the increment and evidence

**Files:**
- Modify: `PRD.md` (RP-02 area, beside the P-15 increment note), `README.md` (session details section, one line on the optional link)
- Create: `docs/superpowers/reviews/2026-10-24-venue-maps-link-validation.md`

- [ ] **Step 1:** Add one PRD line: accepted P-17 increment (2026-10-24, WDL-392) — optional pasted Google Maps link, allowed hosts, treated as venue under D-14, no Google Cloud; link this plan and the validation record; "Implemented for review; acceptance, integration and deployment remain separate."
- [ ] **Step 2:** Write the validation record: date, branch/commit, environment (local synthetic DB and app), commands run with observed results, browser checks done, and gaps (no real-device Maps app check, no live provider check).
- [ ] **Step 3: Run** `pnpm check && pnpm test:api`; Expected: PASS (record actual counts).
- [ ] **Step 4: Commit** `git add PRD.md README.md docs/superpowers && git commit -m "docs: record the venue maps link increment and validation"`
