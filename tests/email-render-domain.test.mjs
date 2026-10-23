import { test } from "node:test";
import assert from "node:assert/strict";
import { renderEmail } from "../packages/email/src/render.ts";
import { mailpitProvider, resendProvider } from "../packages/email/src/provider.ts";

const base = {
  title: "Friday Pickleball",
  startsAt: "2027-05-09T02:00:00Z",
  timeZone: "Asia/Manila",
  link: "https://example.test/s/abc",
  firstName: "Sam",
  queuePosition: null,
  cutoffAt: "2027-05-08T02:00:00Z",
};
const when = (iso, timeZone) =>
  new Intl.DateTimeFormat("en", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));

test("every email kind has its copy, local time, link and sign-off", () => {
  const cutoff = when(base.cutoffAt, base.timeZone);
  const cases = [
    ["joined_confirmed", "Your RallyPoint place", "You’re in for Friday Pickleball.", {}],
    [
      "joined_waitlisted",
      "Your RallyPoint place",
      "You’re on the waitlist for Friday Pickleball, number 3 in line.",
      { queuePosition: 3 },
    ],
    [
      "joined_waitlisted",
      "Your RallyPoint place",
      "You’re on the waitlist for Friday Pickleball.",
      { queuePosition: null },
    ],
    ["promoted", "Your RallyPoint place", "A place opened: you’re now in for Friday Pickleball.", {}],
    [
      "released",
      "Your RallyPoint place",
      `Your spot for Friday Pickleball went to the waitlist because it wasn’t marked paid by ${cutoff}.`,
      {},
    ],
    ["cancelled", "Session update", "Friday Pickleball was cancelled.", {}],
    ["instructions_changed", "Session update", "How to pay for Friday Pickleball has changed.", {}],
    ["reminder", "Session reminder", "Friday Pickleball starts in about 24 hours.", {}],
  ];
  for (const [kind, subject, first, extra] of cases) {
    const out = renderEmail({ ...base, kind, ...extra });
    assert.equal(out.subject, subject, kind);
    const lines = out.text.split("\n").filter((l) => l !== "");
    assert.equal(lines[0], first, kind);
    assert.equal(lines[1], when(base.startsAt, base.timeZone), kind);
    assert.equal(lines[2], `See your current status: ${base.link}`, kind);
    assert.equal(lines[3], "RallyPoint", kind);
    assert.equal(lines.length, 4, kind);
    assert.ok(out.html.includes(`<a href="${base.link}">`), kind);
    assert.equal((out.html.match(/<a /g) ?? []).length, 1, kind);
    assert.ok(!/<img|pixel|track/i.test(out.html), kind);
  }
});

test("html escapes the title while text keeps it raw", () => {
  const out = renderEmail({ ...base, kind: "joined_confirmed", title: `<b>&"` });
  assert.ok(out.text.includes(`You’re in for <b>&".`));
  assert.ok(out.html.includes("You’re in for &lt;b&gt;&amp;&quot;."));
  assert.ok(!out.html.includes("<b>"));
});

const msg = {
  from: "RallyPoint <no-reply@auth.example.test>",
  to: "sam@example.test",
  subject: "Your RallyPoint place",
  text: "hello",
  html: "<p>hello</p>",
  idempotencyKey: "job-1",
};
const reply = (status, body, headers = {}) => async () =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers });
const send = (fetch, extra = {}) =>
  resendProvider({ apiKey: "k", fetch, ...extra }).send(msg);

test("Resend outcomes are classified", async () => {
  assert.deepEqual(await send(reply(200, { id: "re_1" })), { outcome: "accepted", id: "re_1" });
  assert.equal((await send(reply(500, {}))).outcome, "transient");
  assert.deepEqual(await send(reply(429, {}, { "retry-after": "120" })), {
    outcome: "transient",
    code: "rate_limited",
    retryAfterSeconds: 120,
  });
  const noHeader = await send(reply(429, {}));
  assert.equal(noHeader.outcome, "transient");
  assert.equal(noHeader.retryAfterSeconds, undefined);
  assert.deepEqual(await send(reply(429, { name: "daily_quota_exceeded" })), {
    outcome: "quota",
    code: "daily_quota",
  });
  assert.deepEqual(await send(reply(429, { name: "monthly_quota_exceeded" })), {
    outcome: "quota",
    code: "monthly_quota",
  });
  assert.equal(
    (await send(reply(409, { name: "concurrent_idempotent_requests" }))).outcome,
    "transient",
  );
  assert.equal(
    (await send(reply(409, { name: "invalid_idempotent_request" }))).outcome,
    "permanent",
  );
  assert.equal((await send(reply(422, { name: "validation_error" }))).outcome, "permanent");
  assert.deepEqual(await send(() => new Promise(() => {}), { timeoutMs: 50 }), {
    outcome: "ambiguous",
    code: "timeout",
  });
  assert.deepEqual(
    await send(async () => {
      throw new TypeError("fetch failed");
    }),
    { outcome: "ambiguous", code: "network" },
  );
});

test("Resend request carries the key, idempotency key and only the five mail fields", async () => {
  let seen;
  const fetch = async (url, init) => {
    seen = { url, init };
    return new Response(JSON.stringify({ id: "re_2" }), { status: 200 });
  };
  await send(fetch);
  assert.equal(seen.url, "https://api.resend.com/emails");
  assert.equal(seen.init.method, "POST");
  assert.equal(seen.init.headers.Authorization, "Bearer k");
  assert.equal(seen.init.headers["Idempotency-Key"], "job-1");
  assert.deepEqual(JSON.parse(seen.init.body), {
    from: msg.from,
    to: msg.to,
    subject: msg.subject,
    text: msg.text,
    html: msg.html,
  });
  seen = null;
  await send(fetch, { baseUrl: "http://localhost:9/" });
  assert.equal(seen.url, "http://localhost:9/emails");
});

test("Mailpit adapter posts to the local send API", async () => {
  let seen;
  const provider = mailpitProvider({
    baseUrl: "http://127.0.0.1:54324",
    fetch: async (url, init) => {
      seen = { url, init };
      return new Response(JSON.stringify({ ID: "m1" }), { status: 200 });
    },
  });
  assert.deepEqual(await provider.send(msg), { outcome: "accepted", id: "m1" });
  assert.equal(seen.url, "http://127.0.0.1:54324/api/v1/send");
  assert.equal(seen.init.method, "POST");
  assert.deepEqual(JSON.parse(seen.init.body), {
    From: { Email: "no-reply@auth.example.test", Name: "RallyPoint" },
    To: [{ Email: "sam@example.test" }],
    Subject: msg.subject,
    Text: msg.text,
    HTML: msg.html,
  });
  const failing = mailpitProvider({
    baseUrl: "http://127.0.0.1:54324",
    fetch: async () => new Response("no", { status: 500 }),
  });
  assert.equal((await failing.send(msg)).outcome, "transient");
});
