import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { startApi, type Mode } from "../apps/demo-api/server.ts";
import { compare, missing } from "../packages/core/compare.ts";
import { validate } from "../packages/core/schema.ts";
import {
  exchange,
  replay,
  recordScenario,
  localTarget,
} from "../packages/core/replay.ts";
const s = validate(
  JSON.parse(readFileSync("scenarios/coupon-quantity.json", "utf8")),
);
async function targets(
  mode: Mode,
  fn: (a: string, b: string) => Promise<void>,
) {
  const a = await startApi("baseline"),
    b = await startApi(mode);
  try {
    await fn(a.url, b.url);
  } finally {
    await Promise.all([a.close(), b.close()]);
  }
}
test("IDs bind independently and concurrent fixtures stay isolated", () =>
  targets("fixed", async (a, b) => {
    const results = await Promise.all([replay(s, a, b), replay(s, a, b)]);
    assert.equal(results[0].status, "PASS");
    assert.deepEqual(results[0].steps, results[1].steps);
    assert.equal(results[0].steps[0].baseline.body.id, "${cart_id}");
  }));
test("stale coupon first diverges on summary and repeats across clean fixtures", () =>
  targets("stale", async (a, b) => {
    const r = await replay(s, a, b);
    assert.equal(r.first, "summary");
    assert.deepEqual(
      r.steps[4].differences.map((d) => [d.path, d.baseline, d.candidate]),
      [
        ["$.discount", 2000, 1000],
        ["$.total", 18000, 19000],
      ],
    );
    assert.deepEqual(r.steps, (await replay(s, a, b)).steps);
  }));
for (const [mode, path] of [
  ["missing", "$.currency"],
  ["error", "$status"],
] as const)
  test(mode + " revision reports " + path, () =>
    targets(mode, async (a, b) => {
      const result = await replay(s, a, b);
      assert.equal(result.first, "summary");
      assert.equal(result.steps[4].differences[0].path, path);
    }),
  );
test("ignores only approved volatile fields", () => {
  assert.deepEqual(
    compare({ generatedAt: 1 }, { generatedAt: 2 }, s.ignore),
    [],
  );
  assert.throws(() => validate({ ...s, ignore: ["$"] }));
});
test("missing differs from null", () =>
  assert.deepEqual(compare({ x: null }, {}), [
    { path: "$.x", baseline: null, candidate: missing, reason: "presence" },
  ]));
test("object order is immaterial", () =>
  assert.deepEqual(compare({ x: 1, y: 2 }, { y: 2, x: 1 }), []));
test("array order matters", () =>
  assert.equal(compare([1, 2], [2, 1])[0].path, "$[0]"));
test("unknown fixture or reference rejected", () => {
  assert.throws(() => validate({ ...s, fixture: "unknown" }));
  assert.throws(
    () => validate({ ...s, steps: s.steps.slice(1) }),
    /Unknown variable/,
  );
});
test("rejects redirects, arbitrary routes and external targets", () => {
  assert.throws(() => localTarget("http://example.com:80"));
  assert.throws(() =>
    validate({
      ...s,
      steps: [{ name: "escape", method: "GET", path: "/__fixture" }],
    }),
  );
});
test("recording round trips through the replay engine", () =>
  targets("fixed", async (a, b) => {
    const captured = await recordScenario(a, s);
    assert.equal(captured.steps.length, 5);
    assert.equal((await replay(captured, a, b)).status, "PASS");
  }));
test("recorder omits cookies, auth headers, unknown request fields and raw IDs", () =>
  targets("fixed", async (a) => {
    const {
      body: { run },
    } = await exchange(a, "/__fixture", "POST", {
      fixture: s.fixture,
      clock: s.clock,
      record: true,
    });
    const raw = await fetch(a + "/test/carts", {
      method: "POST",
      headers: {
        "x-shadowlab-run": run,
        Authorization: "Bearer secret-canary",
        Cookie: "session=secret-canary",
      },
      body: JSON.stringify({ address: "secret-canary" }),
    });
    const { id } = await raw.json();
    const saved = (await exchange(a, "/__record", "GET", undefined, run)).body;
    assert.equal(saved.steps.length, 1);
    assert.doesNotMatch(
      JSON.stringify(saved),
      /secret-canary|authorization|cookie|address/i,
    );
    assert.ok(!JSON.stringify(saved).includes(id));
  }));
test("duplicate coupons have observable isolated notification counts", () =>
  targets("fixed", async (a, b) => {
    const steps = [
      ...s.steps.slice(0, 3),
      { ...s.steps[2], name: "duplicate" },
      ...s.steps.slice(3),
    ];
    const result = await replay({ ...s, steps }, a, b);
    assert.equal(result.steps[3].baseline.body.notifications, 2);
    assert.equal(
      (await replay(s, a, b)).steps[2].baseline.body.notifications,
      1,
    );
  }));
test("API denies writes without a fixture lease", () =>
  targets("fixed", async (a) => {
    assert.equal((await exchange(a, "/test/carts", "POST")).status, 403);
  }));
test("timeout, oversized response and failed fixture handshake are infrastructure errors", async () => {
  const srv = createServer((req, res) => {
    if (req.url === "/slow") return;
    res.end(req.url === "/big" ? "a".repeat(70000) : "{}");
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + (srv.address() as { port: number }).port;
  try {
    await assert.rejects(
      exchange(url, "/slow", "GET", undefined, undefined, 100),
      { name: "TimeoutError" },
    );
    await assert.rejects(exchange(url, "/big", "GET"), /size limit/);
    await assert.rejects(replay(s, url, url), /handshake/);
  } finally {
    srv.closeAllConnections();
    await new Promise<void>((r) => srv.close(() => r()));
  }
});
