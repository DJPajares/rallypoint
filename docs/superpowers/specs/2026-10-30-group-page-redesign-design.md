# Group page redesign

**Owner request, 2026-10-30:** "redesign the group page. The current layout is not designed properly, doesn't follow the uiux design principles, and it looks boring." The owner approved the proposal below ("Proceed").

## What was wrong
- Stacked headings of equal weight ("Requests (0)", "Invited", "Members"), with buttons floating at different sizes beside them.
- Empty sections took the most room ("No requests waiting.", "Nobody invited yet.").
- Members were tall cards with an orange Remove link on each one. That breaks D-15: repeated items should be list rows, actions belong in a sheet, and orange is kept for one action.
- Nothing gave the group an identity. It read like a settings form.

## The design (D-15 "Quiet, not boring")
- **The one bold element:**
  - a group crest: the group's initials on one of the six existing avatar gradients, chosen from the group id so it never changes;
  - the members' faces overlapping beside the member count.
- **Header:** the name at display size, plus one quiet line with Private/Public and a "You're the admin" or "You're a member" pill.
- **One action in the brand colour per viewer:**
  - **Admin:** Invite people, with Edit as a quiet icon beside it. The invite sheet starts with the invite link and then lists people you know as rows with a small Invite button, so there's no wall of orange buttons. This also applies to session invites.
  - **Visitor:** Join this group or Ask to join. A waiting request shows as a banner with Cancel.
  - **Member:** nothing loud. Leave group sits quietly at the bottom.
- **Lists that appear only when they have something in them:**
  - requests: "N people want to join", with Accept and Decline under the name;
  - Coming up;
  - Members, where tapping someone opens a sheet with their profile and, for the admin, Remove;
  - invites already sent.
- **Coming up (new data):** members see up to five upcoming sessions an organizer opened to the group through a private session's access list (P-36). Each shows title, activity and start only. No one outside the group gets them (`api.read_group` adds `upcoming` only when the viewer has a role).

## Unchanged
Join, request, accept/decline, remove, leave and invite rules and their API; the concealed private-group view; URLs; tokens only; 44px targets; keyboard and screen-reader names.
