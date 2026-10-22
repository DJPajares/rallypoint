import { test } from "node:test";
import assert from "node:assert/strict";
const base = process.env.RALLYPOINT_TEST_URL ?? "http://127.0.0.1:3000";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
test("public home is usable HTML before client JavaScript runs", async () => {
  const response = await fetch(base);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.ok(
    html.includes("Good company.") &&
      html.includes("Great sessions.") &&
      html.includes("<main"),
  );
});
test("native page deep links render without server-side browser globals", async () => {
  for (const path of [
    "/home",
    "/sessions",
    "/dues",
    "/workspace",
    "/groups/new",
    "/groups/11111111-1111-4111-8111-111111111111",
    "/groups/11111111-1111-4111-8111-111111111111/sessions/new",
    "/sessions/11111111-1111-4111-8111-111111111111/edit",
    "/s/11111111-1111-4111-8111-111111111111",
    "/sign-in?next=/s/example",
    "/auth/callback",
  ]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get("content-type"), /text\/html/);
  }
});
test("missing pages return HTTP 404 and keep a useful navigation fallback", async () => {
  const response = await fetch(base + "/this-page-does-not-exist");
  assert.equal(response.status, 404);
  assert.ok((await response.text()).includes("Back to home"));
});
test("manifest and icons retain their public URLs", async () => {
  const response = await fetch(base + "/manifest.webmanifest");
  assert.equal(response.status, 200);
  const manifest = await response.json();
  assert.equal(manifest.name, "RallyPoint");
  for (const icon of manifest.icons) {
    const asset = await fetch(base + icon.src);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get("content-type"), /image\/png/);
  }
});
