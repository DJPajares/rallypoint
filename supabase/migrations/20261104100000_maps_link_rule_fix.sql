-- Fixes the Maps link rule on sessions (P-17) for hosted databases. Migrations
-- are applied there with the schema names rewritten as plain text (the schema
-- called app becomes rallypoint), and that rewrite also changed the host inside
-- the rule's pattern: maps.app.goo.gl became maps.rallypoint.goo.gl, so the rule
-- refused every Google Maps share link. Here the host is spelled a[p]{2} so the
-- rewrite no longer sees the word; it matches exactly the same text. Local
-- databases don't rewrite, which is why only the hosted one showed it.
--
-- Recovery: none needed. The rule is a backstop; the API checks the link first.

alter table app.sessions drop constraint if exists sessions_maps_link_check;
alter table app.sessions add constraint sessions_maps_link_check check (
  not (details ? 'mapsLink') or (
    jsonb_typeof(details->'mapsLink')='string'
    and length(details->>'mapsLink') between 1 and 2048
    and details->>'mapsLink' ~ '^https://(www\.google\.com/maps([/?#]|$)|maps\.google\.com([/?#]|$)|maps\.a[p]{2}\.goo\.gl/[^/?#]|goo\.gl/maps/[^/?#])'));
