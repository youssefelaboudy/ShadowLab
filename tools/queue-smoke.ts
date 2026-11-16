import assert from "node:assert/strict";
import {
  db,
  claim,
  enqueue,
  finish,
  migrate,
  retry,
} from "../packages/history/store.ts";
import { readScenario } from "../packages/scenario/format.ts";
import type { Report } from "../packages/core/replay.ts";
if (process.env.PGOPTIONS !== "-c search_path=queue_test")
  throw Error("Requires the isolated queue_test schema");
try {
  await db.query("CREATE SCHEMA IF NOT EXISTS queue_test");
  await migrate();
  const s = await readScenario("scenarios/coupon-quantity.yaml");
  const ids = await Promise.all([enqueue(s, "fixed"), enqueue(s, "error")]);
  const [one, two] = await Promise.all([claim(), claim()]);
  assert.ok(one && two && one.id !== two.id);
  assert.ok(ids.includes(one.id) && ids.includes(two.id));
  assert.equal(await claim(), undefined);
  await assert.rejects(
    enqueue({ ...s, steps: s.steps.slice(0, 2) }, "fixed"),
    /different content/,
  );
  await db.query(
    "UPDATE jobs SET expires=now()-interval '1 minute' WHERE id=$1",
    [one.id],
  );
  const recovered = await claim();
  assert.equal(recovered?.id, one.id);
  assert.notEqual(recovered?.lease, one.lease);
  await assert.rejects(finish(one.id, one.lease, {} as Report), /Lost lease/);
  await retry(one.id, recovered!.lease);
  const third = await claim();
  await retry(one.id, third!.lease);
  assert.equal(
    (await db.query("SELECT state FROM jobs WHERE id=$1", [one.id])).rows[0]
      .state,
    "failed",
  );
  console.log(
    "Verified bounded retries, exclusive claims, recovery and stale-worker fencing.",
  );
} finally {
  await db.end();
}
