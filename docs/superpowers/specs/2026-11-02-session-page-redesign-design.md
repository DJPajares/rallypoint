# Session page redesign

**Owner request, 2026-11-02:** "improve the session page too. I can see bad layouts and not following the uiux design principles. If you feel the need to redesign it, please do so." The owner approved the proposal ("Continue").

## What was wrong

- **Organizer:** People (their real job) sat at the bottom, under a full join form and an empty "Invited · Nobody invited yet". On desktop a shared grid left a big gap between the date card and the details.
- **Visitor:** spots, the join form and the details were scattered, and loose Refresh links sat around the page.
- **Booked player:** on desktop everything sat in the left column, and a "3 of 8 coming" card repeated the spots.
- **Hero:** it didn't match Home's Up next or the other tabs.

## Design (D-15 "Quiet, not boring")

- **One hero in every state:**
  - the brand date tile;
  - "Hosted by … · Activity";
  - the title at display size;
  - "Friday, November 6 · 7:00 PM – 9:00 PM";
  - the place with Open in Google Maps;
  - pills for Hosting and Private;
  - the spots meter, plus a waiting note.
- **Body:** two independent columns on wider screens and one on phones. The side column is "Your place" (it comes first when reading and on phones, and sits on the right on desktop). The main column holds the details and Good to know. Neither column sizes the other, so there are no gaps.
- **Host:**
  - a "You're hosting" card with Share (the one orange action), Manage session and Invite people;
  - "Join as a player" as a quiet link that reveals the join form;
  - Refresh as an icon in the card header;
  - the host's tools (People, requests, the split, invites sent) are drawn into the main column with a React portal, so they lead the page. Their state stays in RegistrationPanel.
  - "Nobody invited yet" no longer shows.
- **Visitor:** the join form is the Your place card on wider screens. On phones it stays in the sticky bar's sheet.
- **Booked player:** the status banner, a "See who's coming" link, the fee and pay block, and More. The duplicate count card is gone.
- **Refresh:** a small link for non-hosts on wider screens, an icon in the host card, and hidden on phones.

## Unchanged

Every join, waitlist, request, payment, guest, withdraw, remove, invite, check-in and split rule, plus its wording, recovery ("Check result"), URLs and API.
