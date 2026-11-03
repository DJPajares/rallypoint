import { test } from "node:test";
import assert from "node:assert/strict";
import { matchmake } from "../apps/web/scheduled.ts";

function fakeDatabase(error = null) {
  const calls = { rpc: [], closed: 0 };
  const open = () => ({
    async rpc(name, args) {
      calls.rpc.push([name, args]);
      if (error) throw error;
      return { data: { ran: true, proposed: 0, expired: 0 }, error: null };
    },
    async close() {
      calls.closed++;
    },
  });
  return { calls, open };
}

test("matchmake runs one bounded pass and closes the connection", async () => {
  const { calls, open } = fakeDatabase();
  await matchmake({ DATABASE_URL: "postgres://synthetic" }, open);
  assert.deepEqual(calls.rpc, [["run_matchmaking", { p_limit: 50 }]]);
  assert.equal(calls.closed, 1);
});

test("matchmake does nothing without a database", async () => {
  const { calls, open } = fakeDatabase();
  await matchmake({}, open);
  assert.deepEqual(calls.rpc, []);
  assert.equal(calls.closed, 0);
});

test("a failed pass is swallowed and the connection still closes", async () => {
  const { calls, open } = fakeDatabase(new Error("secret detail"));
  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args.join(" "));
  try {
    await matchmake({ DATABASE_URL: "postgres://synthetic" }, open);
  } finally {
    console.error = original;
  }
  assert.equal(calls.closed, 1);
  assert.deepEqual(logged, ["matchmaking failed"]);
});
