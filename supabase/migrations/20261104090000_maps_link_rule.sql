-- Re-asserts the Maps link rule on sessions (P-17). Production refused a valid
-- share link (https://maps.app.goo.gl/...) that the code and a local database
-- both accept, so its copy of this rule differed from the reviewed one. The
-- definition below is the one from 20261024150000_session_maps_link.sql; it is
-- dropped and added again so every database ends up with exactly this rule.
--
-- Recovery: none needed. The rule is a backstop; the API checks the link first.
-- To undo, drop the constraint and add back the previous definition.

alter table app.sessions drop constraint if exists sessions_maps_link_check;
alter table app.sessions add constraint sessions_maps_link_check check (
  not (details ? 'mapsLink') or (
    jsonb_typeof(details->'mapsLink')='string'
    and length(details->>'mapsLink') between 1 and 2048
    and details->>'mapsLink' ~ '^https://(www\.google\.com/maps([/?#]|$)|maps\.google\.com([/?#]|$)|maps\.app\.goo\.gl/[^/?#]|goo\.gl/maps/[^/?#])'));
