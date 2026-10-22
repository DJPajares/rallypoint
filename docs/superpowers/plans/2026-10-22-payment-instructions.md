# Payment Instructions and QR Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for this single coherent task. Follow test-first implementation and whole-change review.

**Goal:** Organizers/co-hosts add, correct and remove plain payment instructions and one optional QR image per session; only entitled people see them, with the text always usable without the image.

**Architecture:** Instructions live in their own private table, outside the booked-locked session details, with a revision and actor/time, written through operation-keyed RPCs under the existing group/session locks. The QR image is stored in a private local Supabase Storage bucket; the database row holds only its object path. Every image read goes through an authorized API route that re-checks entitlement and streams the bytes uncached. There are no public or signed URLs.

**Tech Stack:** Existing Next.js, Hono/Zod, pnpm, Supabase Postgres and local Supabase Storage (`storage-api` container enabled locally). No new npm dependencies.

**Spec:** [WDL-383](https://linear.app/wwonderland/issue/WDL-383), PRD RP-10, D-06 and D-13, plus the data-rights row for "Photos and payment QR".

## Global Constraints

- Visibility follows the task's proposed rule (confirm in review): current organizers/co-hosts, plus the actor's own `confirmed` or `waitlisted` party on a non-draft, non-cancelled session. Link visitors, unrelated accounts, withdrawn parties, share responses and emails get nothing.
- Instructions text: trimmed, 1–1000 characters. It is rendered as plain text, with no links or HTML.
- QR image: at most one per session; 1 MiB maximum; only `image/png`, `image/jpeg` and `image/webp`. The claimed type must match the file's magic bytes. SVG and anything else is rejected. An image can exist only while instructions text exists.
- Writes never touch `app.sessions`, parties, fee obligations or paid markers. They also never bump the session version.
- Writes are refused on cancelled sessions (`session_closed`), and participants don't see instructions there.
- Copy: "Pay the organizer directly. RallyPoint doesn't process or confirm payments." Never say a payment was received or verified.
- Use local Storage only. No cloud bucket, provisioning, deployment or merge.

## Review Focus

- **Stale tab:** an organizer saves from an old tab after another change. Expect `stale_payment_instructions` (409) and no overwrite.
- **Orphaned images:** an upload is interrupted, replayed or rejected after the object was stored. Afterwards the session folder holds at most the referenced object.
- **Lost entitlement:** a participant withdraws, or the session is cancelled, after the image loaded. A fresh image read is refused.
- **Spoofed type:** a renamed SVG/HTML claims `image/png`, or a header claims one type while the bytes are another. Expect a 422 understandable error, and nothing is stored.
- **Image failure:** a blocked image or a 404 on the image route. The text remains, with an explanation, and no broken layout.

---

## Task 1: Payment instructions end to end

**Files:**
- Create: `supabase/migrations/20261022143000_payment_instructions.sql`, `apps/api/src/payments.ts`, `apps/web/src/payment-instructions.tsx`, `tests/payment-instructions.test.mjs`.
- Modify: `supabase/config.toml` (bucket), `scripts/local.mjs` (stop excluding `storage-api`), `apps/api/src/index.ts` (mount), `packages/domain/src/registration.ts` (types), `apps/web/src/session-pages.tsx` (editor card), `apps/web/src/registration-panel.tsx` (participant card), `tests/helpers/split-fixtures.mjs` (cleanup), README, `docs/foundation-api.md` and the PRD decision note.

**Interfaces:**
- Database: `app.payment_instructions(session_id uuid pk references app.sessions on delete cascade, body text, image_path text null, image_type text null, image_bytes int null, revision int, updated_by uuid, updated_by_name text, updated_at timestamptz)`. There are no browser grants.
- `api.update_payment_instructions(p_actor_id uuid, p_actor_name text, p_key uuid, p_session_id uuid, p_revision int, p_action text /* save|remove_image|remove */, p_body text, p_image_path text, p_image_type text, p_image_bytes int) returns jsonb` → `{operationKey, paymentInstructions, removedPath}`. Its action set also includes `set_image`, which the upload route uses. `p_revision` is 0 when no row exists yet. The function checks: lock, receipt (`payment_instructions`), manager, not cancelled, revision. It records actor/time.
- `api.read_payment_instructions(p_actor_id uuid, p_session_id uuid)` (manager only) → `{text, hasImage, imageType, revision, updatedAt, updatedBy} | null`.
- `api.read_payment_qr(p_actor_id uuid, p_slug uuid)` → `{path, type}`, or null when there is no image. It raises `insufficient_privilege` unless the actor is entitled.
- `app.registration_view` is wrapped: entitled actors get `paymentInstructions: {text, hasImage, imageRevision}`; everyone else gets no key at all.
- `api.read_operation` is wrapped so that the `payment_instructions` receipts recover the manager view.
- HTTP:
  - `GET /api/sessions/:id/payment-instructions` → `{paymentInstructions}`
  - `POST /api/sessions/:id/payment-instructions` with JSON `{operationKey, revision, action, text?}` → `{operationKey, paymentInstructions}`
  - `POST /api/sessions/:id/payment-instructions/qr?operationKey=&revision=` with a raw image body and an image `Content-Type` → same response as the JSON POST
  - `GET /api/registrations/:slug/payment-qr` → image bytes, with `Cache-Control: no-store`, `nosniff` and `Content-Security-Policy: default-src 'none'; sandbox`
- Errors:
  - `invalid_image` (422) for a wrong or mismatched type
  - `image_too_large` (413)
  - `instructions_required` (409) for an image without text
  - `stale_payment_instructions` (409)
  - `session_closed` (409)
  - `group_access_denied` (403)
  - `payment_instructions_unavailable` (403/404) for image reads
- Domain types: `PaymentInstructions` for the participant view and `ManagedPaymentInstructions` for the manager view.

- [ ] **Baseline:** restart local services with Storage enabled (`pnpm db:stop && pnpm db:start`), confirm the `payment-qr` bucket exists and is private, and run the existing suite against a dev server.
- [ ] **RED:** `tests/payment-instructions.test.mjs` covers:
  - an organizer saves, corrects and removes text, and uploads, replaces and removes a PNG
  - a booked session's version, parties, fees and paid markers stay unchanged
  - a participant, an unrelated account and a visitor are denied writes
  - entitled confirmed/waitlisted actors read the text and image
  - visitors, unrelated accounts, withdrawn parties and the `/api/shared` projection contain no instruction text or path
  - SVG, mismatched bytes, more than 1 MiB and non-image bodies are rejected
  - stale revisions and same-key replays are handled, with exactly one object left in the session folder
  - cancelled sessions refuse writes and hide instructions
  - a direct RPC call with the publishable key is denied

  Run it and confirm it fails.
- [ ] **GREEN:** migration plus the bucket config plus `payments.ts`. The upload route works in this order:
  1. Read at most 1 MiB, validate the content type and magic bytes, and fail fast with the manager read and revision check.
  2. Upload `<sessionId>/<uuid>` to `payment-qr`, then call the RPC.
  3. Delete the new object if the RPC fails or returns a different path.
  4. After any committed write, prune every object in the session folder except the current path.

  Run the focused test until it passes.
- [ ] **UI:**
  - Managed session page: a "Payment instructions" card outside the locked details form, with a textarea, save/remove, and an image add/replace/remove control. It uses `useMutation` for the JSON actions. The upload uses its own fetch; on an uncertain result it refreshes the record instead of re-sending.
  - Registration panel: a "How to pay" card for entitled actors. It shows the text, then the image fetched with the bearer token into an object URL. If the image fails, it hides the image and says the image couldn't load and to use the text. It always shows the outside-RallyPoint line.
- [ ] **Verify:** check upload, fallback (image request blocked), denial, keyboard and phone width in the browser. Run `pnpm check`, `pnpm db:lint` and `pnpm test:api`.
- [ ] **Review and deliver:** self-review and an independent whole-change review, then update README, the API contract and the PRD. Commit on the issue branch, open a PR, and move WDL-383 to In Review.
