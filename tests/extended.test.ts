import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { startApi } from "../apps/demo-api/server.ts";
import { readScenario, decode } from "../packages/scenario/format.ts";
import { recordEvidence, exchange, replay } from "../packages/core/replay.ts";
import { orderedSets } from "../packages/scenario/sets.ts";
import { prune, publish } from "../packages/cli/artifacts.ts";
const coupon = await readScenario("scenarios/coupon-quantity.yaml");
test("YAML contract resolves nested captures and polls to bounded completion", async () => {
  const s = await readScenario("scenarios/checkout.yaml"),
    api = await startApi("fixed");
  try {
    const r = await replay(s, api.url, api.url);
    assert.equal(r.status, "PASS");
    assert.deepEqual(r.steps.at(-1)?.baseline.body, {
      total: 18000,
      emailCount: 1,
      paymentCount: 1,
    });
    assert.equal(r.durations.baseline.length, 5);
    const broken = structuredClone(s);
    broken.steps[3].poll!.max_attempts = 1;
    await assert.rejects(replay(broken, api.url, api.url), /Polling limit/);
  } finally {
    await api.close();
  }
});
test("recorder stores sanitized original responses and scope-limited pseudonyms", async () => {
  const api = await startApi("fixed");
  try {
    const r = await recordEvidence(api.url, coupon);
    assert.equal(r.provenance.fixture, coupon.fixture);
    assert.equal(r.provenance.clock, coupon.clock);
    assert.match(r.provenance.scenarioChecksum, /^[0-9a-f]{64}$/);
    assert.match(r.provenance.fixtureChecksum, /^[0-9a-f]{64}$/);
    assert.equal(r.evidence[4].response.total, 18000);
    assert.equal(r.evidence[0].response.id, "${cart_1}");
    const masks = [];
    for (let i = 0; i < 2; i++) {
      const run = (
        await exchange(api.url, "/__fixture", "POST", {
          fixture: coupon.fixture,
          clock: coupon.clock,
          record: true,
        })
      ).body.run;
      for (let j = 0; j < 2; j++)
        await fetch(api.url + "/test/carts", {
          method: "POST",
          headers: {
            "x-shadowlab-run": run,
            authorization: "Bearer secret-canary",
          },
          body: JSON.stringify({
            customerRef: "private-canary",
            address: "secret-canary",
          }),
        });
      const evidence = (
        await exchange(api.url, "/__evidence", "GET", undefined, run)
      ).body;
      assert.doesNotMatch(
        JSON.stringify(evidence),
        /canary|authorization|address/i,
      );
      assert.equal(
        evidence[0].request.customerRef,
        evidence[1].request.customerRef,
      );
      masks.push(evidence[0].request.customerRef);
    }
    assert.notEqual(masks[0], masks[1]);
  } finally {
    await api.close();
  }
});
test("checkout traps an attempted email and payment even with unreachable delivery endpoints configured", async () => {
  let hits = 0;
  const external = createServer((req, res) => {
    hits++;
    res.end();
  });
  external.listen(0, "127.0.0.1");
  await once(external, "listening");
  const port = (external.address() as { port: number }).port;
  const api = await startApi("fixed");
  try {
    const lease = (
      await exchange(api.url, "/__fixture", "POST", {
        fixture: coupon.fixture,
        clock: coupon.clock,
      })
    ).body.run;
    const cart = (await exchange(api.url, "/test/carts", "POST", {}, lease))
      .body.id;
    const r = await exchange(
      api.url,
      "/test/carts/" + cart + "/checkout",
      "POST",
      {
        emailEndpoint: "http://127.0.0.1:" + port,
        paymentEndpoint: "http://127.0.0.1:" + port,
      },
      lease,
    );
    assert.equal(r.body.emailCount, 1);
    assert.equal(r.body.paymentCount, 1);
    assert.equal(hits, 0);
  } finally {
    await api.close();
    external.close();
  }
});
test("ordered sets match moved identities and reject ambiguous keys", () => {
  const items = [
    { id: "b", quantity: 1 },
    { id: "a", quantity: 2 },
  ];
  assert.deepEqual(
    orderedSets({ items }, { "$.items": "id" }).items,
    [...items].reverse(),
  );
  assert.throws(
    () => orderedSets({ items: [items[0], items[0]] }, { "$.items": "id" }),
    /Ambiguous/,
  );
});
test("concurrent publication retains one complete checksummed artifact; retention respects unrelated files", async () => {
  const root = await mkdtemp(join(tmpdir(), "shadowlab-evidence-"));
  try {
    const p = join(root, "run");
    const outcomes = await Promise.allSettled(
      ["one", "two"].map((v) => publish(p, { "report.json": v })),
    );
    assert.equal(outcomes.filter((x) => x.status === "fulfilled").length, 1);
    assert.ok(
      JSON.parse(await readFile(join(p, "manifest.json"), "utf8")).hashes[
        "report.json"
      ],
    );
    assert.equal(await prune(root, 14), 0);
    assert.equal(await prune(root, 0), 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("bad capture paths, unsafe assertions, invalid fixture clocks and mutable requests in polling are rejected", () => {
  for (const patch of [
    { captures: { x: { from: "response.body", path: "$.token" } } },
    { timeout_ms: 999999 },
    {
      poll: { path: "$.ready", equals: true, max_attempts: 1, interval_ms: 1 },
    },
    { assertions: [{ path: "$.credentials", equals: "secret" }] },
  ])
    assert.throws(() =>
      decode({ ...coupon, steps: [{ ...coupon.steps[0], ...patch }] }),
    );
});
test("OTLP receives real spans without replay payloads", async () => {
  const payloads: Buffer[] = [];
  const collector = createServer(async (req, res) => {
    for await (const c of req) payloads.push(c);
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  });
  collector.listen(0, "127.0.0.1");
  await once(collector, "listening");
  const dir = await mkdtemp(join(tmpdir(), "shadowlab-trace-"));
  try {
    const endpoint =
      "http://127.0.0.1:" +
      (collector.address() as { port: number }).port +
      "/v1/traces";
    const child = spawn(
      process.execPath,
      ["packages/cli/main.ts", "demo", "--out", dir],
      {
        env: { ...process.env, OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: endpoint },
        stdio: "ignore",
      },
    );
    assert.equal((await once(child, "close"))[0], 0);
    const body = Buffer.concat(payloads).toString();
    assert.match(body, /replay.step/);
    assert.doesNotMatch(body, /SHOE-001|SAVE10/);
  } finally {
    collector.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a declared reference error is replayable; an unexpected reference failure is diagnosed", async () => {
  const a = await startApi("error"),
    b = await startApi("error");
  try {
    const s = structuredClone(coupon);
    s.steps[4].expect_status = 500;
    s.steps[4].assertions = [
      { path: "$.error", equals: "summary_unavailable" },
    ];
    assert.equal((await replay(s, a.url, b.url)).status, "PASS");
    await assert.rejects(
      replay(coupon, a.url, b.url),
      /Invalid reference at summary/,
    );
  } finally {
    await Promise.all([a.close(), b.close()]);
  }
});
test("CLI reports configuration failure separately from product differences", async () => {
  for (const args of [
    ["replay", "--candidate", "https://example.com"],
    [
      "scenario",
      "validate",
      "scenarios/checkout.yaml",
      "--fixtures",
      "fixtures/absent",
    ],
  ]) {
    const child = spawn(process.execPath, ["packages/cli/main.ts", ...args], {
      stdio: "ignore",
    });
    assert.equal((await once(child, "close"))[0], 2);
  }
});
