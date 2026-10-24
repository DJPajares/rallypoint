# Profiles: edit yours, open anyone's (P-21)

Linear: [WDL-396](https://linear.app/wwonderland/issue/WDL-396). Requirements: PRD RP-15, D-06 (partly settled here), D-13, D-16, D-19. Owner direction, 2026-10-24.

## Intent

Today a person's name comes straight from their Google sign-in. Each booking keeps its own copy of that name, and only you can see your profile. The owner decided:

> "name, photo (for future feature), any other useful information for this app"
> "keep adding photo as a future feature"
> "name or username is tied to the account id. so changes to the name should reflect EVERYWHERE. if another user wants to check this user, they can just click on the username and it opens that person's profile page"
> "not signed in users can open another person's profile. a profile is what you want and what should be seen in the profile page"

So a profile is the person's public face in RallyPoint. They choose what goes on it, anyone can open it, and their name is one value tied to their account, shown the same everywhere.

## Goals

1. **Edit profile:** set your name, and the activities you play, each with an optional self-rated level (Beginner, Intermediate or Advanced).
2. **One name everywhere:** wherever RallyPoint shows a person who has an account, it shows their current name, in past records too.
3. **Open anyone's profile:** tapping a person's name opens their profile page. Signed-out visitors can open it too.

## Non-goals

- A profile photo. It's parked as P-29 ([WDL-404](https://linear.app/wwonderland/issue/WDL-404)).
- A people directory, search, follows, friends, messages or a "people you may know" list. These are MVP exclusions.
- Changing the sign-in email or provider, or deleting the account.
- Phone, address, birthday, age, gender and bio.
- Verified skill, rankings or skill badges.
- Guest (+1) profiles. A guest has no account, so they keep the name their host typed.

## Anti-goals (a failure even if it works)

- The edit changes the shared sign-in account's name in the owner's other apps. RallyPoint writes **only** its own data.
- A profile reveals more than its page shows. That means email, user ids, dues and payments, no-shows, session lists, groups or rosters.
- Someone can change another person's profile.
- A self-rated level reads as verified, or limits joining.
- The same person shows under two different names in the app.

## Behaviour

### The profile page (`/people/{profileId}`)
- **One page shows the same profile to everyone,** including signed-out visitors:
  - name
  - chosen title (D-16)
  - earned badges
  - the stats the profile shows today (the derived counts from D-16 and RP-15)
  - "Plays:" with each activity and its level, marked "self-rated"
- **Only the owner sees the editing parts:** the Edit profile button, the title picker, and unseen-badge prompts.
- **Visitors see a view-only page.** It never shows email, dues, payments, no-shows, groups or sessions.
- `/profile` stays the owner's own page. It shows the same content, plus a way to copy or share their profile link.
- **The profile id is a new random id, not the account id.** A link that doesn't match an id shows "Profile not found".

### Where names link to profiles
- Every place that shows the name of a person with an account links that name to their profile:
  - the roster ("Who's confirmed" / "See who's coming")
  - the organizer's game-day list and person sheet
  - "marked paid by …"-style lines that name an organizer
- Guest names stay plain text.
- Who can see a roster doesn't change (RP-16). Links only appear where names already do.

### One name everywhere
- **A person's name is worked out on each read:** their saved RallyPoint name, otherwise their Google name, otherwise the part of their email before "@".
- Every screen and email that names an account holder uses this current name, including past records.
- Stored name copies on bookings and audit rows stay in the database, but only as a fallback for a deleted account.
- Shared Auth metadata is read, never written.

### Edit profile (`/profile/edit`)
- **Name:**
  - The field is trimmed, can't be empty, and takes up to 80 characters.
  - Any script or emoji is fine.
  - It's one field, filled in with the person's current name. It can't be saved empty: "Enter your name." *(Owner, 2026-10-24: "why is the edit name separate from the original name? it should just be one".)* Saving an untouched Google name keeps it linked to the account, so a later Google change still shows.
- **Activities:**
  - Pick from the preset activities, plus up to 3 of your own (up to 40 characters each).
  - At most 10 in total, with no duplicates (ignoring case and spaces).
  - Each one has an optional level: Beginner, Intermediate or Advanced.
- **Visibility note:** one line on the screen says "Anyone with your profile link can see this."
- **Saving:**
  - Save returns to your profile showing the new values.
  - Cancel or back leaves without saving, asking "Discard your changes?" if anything changed.
  - Errors show next to the field and keep what you typed.
  - A failed or uncertain save says so and offers to try again.
- **Email:** the sign-in email shows read-only, as "Signed in as …". Only the owner sees this screen.

## Data and boundaries

- **Storage:** a new RallyPoint table holds one row per person:
  - an opaque `profile_id`
  - the name override
  - activities
  - `updated_at`
  - It's keyed by user id, created on first need, with RLS on and access only through `api.*` functions granted to `service_role`.
- **Reads:**
  - `GET /api/people/{profileId}` is public (no sign-in) and returns only the fields the page shows.
  - `GET /api/me/profile` returns the owner's editable values.
  - `GET /api/me` returns the current name and the person's `profileId`.
- **Saving:** `POST /api/me/profile` replaces the whole profile, with `activities: []` meaning none. The person comes from the verified session. Unknown or forbidden fields (email, role, badges, stats, another id) get a 400 and nothing is saved. The last save wins.
- **Names on read:**
  - Roster and person reads return each account holder's current name and `profileId`, still only to the viewers who can already see that roster.
  - Emails read the current name when they're sent.
  - New records still store a name copy, but nothing displays it while the account exists.
- **No new infrastructure:** no storage bucket or upload. It's one migration, plus updates to the read functions that return names.

## Constraints

- Follow D-13 copy rules and the accessibility rules (labels, focus, 44px targets, clear errors).
- Authorization is enforced on the server, and all test data is synthetic.
- Tests must cover:
  - a rename showing on an old roster, a new roster and the next email
  - a public profile returning only its page fields
  - one person unable to change another's profile
  - an unknown profile id
- Use the adopted checks: `pnpm check` and the `node --test` suite against the local app.
- Record the accepted part of D-06 in the PRD: public profile pages, with the owner's chosen content and names linking to them.

## Left to the builder

The table and function shapes, how names are resolved in SQL (for example, one shared helper used by the read functions), the exact layouts within the existing design tokens and components, and how profile links fit each roster's markup.

## Builder's calls (open to owner correction)

- Visitors see the same profile content as the owner, including stats and earned badges, without the editing controls.
- Profile links use a new random id, never the account id.
- An untouched Google name stays linked to the account rather than being saved as a copy.
- Up to 3 custom activities (40 characters each) and 10 in total. The levels are Beginner, Intermediate and Advanced, and are optional.
- The last save wins. There's no edit-conflict warning between two devices.
- Guests keep plain-text names, with no profile.
