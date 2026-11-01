# Edit profile redesign — plan (P-32)

Spec: `docs/superpowers/specs/2026-11-01-edit-profile-redesign-design.md`.

1. **Domain (tests first).** Add `levelChoices(activity)` to `packages/domain/src/profile.ts`. It returns `[{ value, label, meaning }]` in scale order, followed by the "No rating" choice, so the screen has no hard-coded level order. Cover it in `tests/profile-domain.test.mjs`: order, the descriptions coming from the activity, and the final "No rating" entry with value `""`.
2. **Screen.** Rewrite `apps/web/src/profile-edit.tsx`:
   - add sections for Name, Activities you play (rows with a toggle and inline `LevelPick` radios) and Something else?;
   - keep the draft, snapshot, validation, save, unclear-result and discard logic;
   - when the form is dirty, add a `beforeunload` guard;
   - on success, go to `/profile?saved=1`.
3. **Profile confirmation.** On `/profile`, when `saved=1`, announce "Profile saved." in a polite status and remove the parameter from the address.
4. **Styles.** Replace the old `.activity-row` and `.level-choice` rules with styles for the toggle rows, the level list and the own-activity rows. Use tokens only, keep 44px targets and visible focus, and make it work in light and dark.
5. **Checks.** Run `pnpm lint`, `pnpm typecheck`, `pnpm build` and the domain test. The API tests need Docker, so record them as blocked here. If the app can't run without the local database, record the browser walkthrough as blocked too and leave it in the manual test.
