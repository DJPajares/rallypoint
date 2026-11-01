# shadcn/ui + Tailwind CSS v4 — plan (D-24)

Spec: `docs/superpowers/specs/2026-11-01-shadcn-tailwind-design.md`. One PR, delivered as several commits.

1. **Baseline.** Before any change, take screenshots of `/design`, `/`, `/sign-in`, `/profile`, `/profile/edit`, `/people/{id}`, `/home` and a badge sheet, at phone and desktop width, light and dark, using synthetic mocks.
2. **Foundation.**
   - Add the dependencies at pinned versions and PostCSS for Next.
   - Create `theme.css` (tokens as the Tailwind theme, shadcn aliases, dark variant and base layer).
   - Add `cn()` and `components.json` in both workspaces.
   - Update the design-token test so it guards Tailwind class strings.
3. **Components.**
   - Vendor the shadcn base-nova sources (expanded classes, Phosphor icons) into `packages/ui/src/components/ui/`.
   - Rebuild every `@rallypoint/ui` export on them with Tailwind, keeping their APIs.
   - Delete `base.css`, `components.css` and `fields.css`.
4. **Screens.** Convert each `apps/web/src/*.tsx` from the old classes to Tailwind, file by file, and delete `frame.css`, `pages.css`, `badges.css` and `game-day.css`.
5. **Verify.**
   - Run lint, typecheck, build, the domain, token and pages tests, and the Playwright walkthroughs (Edit profile, Profile, badges, sheet swipe and lock, toast).
   - Take after-screenshots and compare them with the baseline.
   - Update the README with the Tailwind and shadcn notes.
