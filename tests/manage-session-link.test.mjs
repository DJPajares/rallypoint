import { test } from "node:test";
import assert from "node:assert/strict";
import { cohostFixture, request } from "./helpers/cohost-fixtures.mjs";

// P-33: the session page links its organizers to the editor. The session id
// the editor needs reaches organizers and co-hosts only. Synthetic accounts.
test("only the session's organizers get the id the editor needs", async (t) => {
  const f = await cohostFixture(t);
  assert.equal(
    (await f.change(f.owner, f.member.profileId, "add", "0")).status,
    200,
  );
  const path = `/api/registrations/${f.session.slug}`;
  const read = async (actor) => {
    const r = await request(path, actor);
    assert.equal(r.status, 200);
    return (await r.json()).registration;
  };
  assert.equal((await read(f.owner)).sessionId, f.session.id);
  assert.equal((await read(f.member)).sessionId, f.session.id);
  for (const actor of [f.newcomer, f.outsider])
    assert.equal("sessionId" in (await read(actor)), false);
  const shared = await (
    await request(`/api/shared/${f.session.slug}`, null)
  ).json();
  assert.ok(!JSON.stringify(shared).includes(f.session.id));
  // The editor's own read still refuses anyone who can't manage it.
  for (const actor of [f.newcomer, f.outsider])
    assert.equal(
      (await request(`/api/sessions/${f.session.id}`, actor)).status,
      403,
    );
});
