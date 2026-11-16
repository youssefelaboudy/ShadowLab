import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { db, expire } from "../packages/history/store.ts";
import { digest } from "../packages/fixtures/manifest.ts";
const url = "http://127.0.0.1:4200";
const jobs = await Promise.all(
  ["stale", "fixed", "missing", "error"].map(async (candidate) => {
    const r = await fetch(url + "/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenario: "coupon-quantity-yaml", candidate }),
    });
    assert.equal(r.status, 202);
    return (await r.json()).id as string;
  }),
);
const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: "us-east-1",
  forcePathStyle: true,
});
try {
  let ready = false;
  for (let i = 0; i < 120; i++) {
    const { rows } = await db.query(
      "SELECT count(*) AS n FROM artifacts WHERE uploaded AND run_id=ANY($1::uuid[])",
      [jobs],
    );
    if (Number(rows[0].n) === 8) {
      ready = true;
      break;
    }
    await sleep(500);
  }
  assert.ok(ready, "Timed out waiting for committed runs and S3 uploads");
  const data = await (await fetch(url + "/api/history")).json();
  for (const id of jobs) {
    const run = data.runs.find((x: { id: string }) => x.id === id);
    assert.equal(
      run.report.status,
      run.report.candidate === "fixed" ? "PASS" : "REGRESSION",
    );
    assert.match(run.report.baselineCommit, /^[0-9a-f]{40}$/);
    const { rows } = await db.query("SELECT * FROM artifacts WHERE run_id=$1", [
      id,
    ]);
    for (const a of rows) {
      assert.ok(
        a.created_at instanceof Date && Number.isFinite(a.created_at.getTime()),
      );
      const result = await s3.send(
        new GetObjectCommand({
          Bucket: process.env.S3_BUCKET,
          Key: a.object_key,
        }),
      );
      assert.equal(digest(await result.Body!.transformToString()), a.checksum);
      assert.equal(
        digest(
          await (
            await fetch(url + "/api/artifacts/" + id + "/" + a.format)
          ).text(),
        ),
        a.checksum,
      );
    }
  }
  assert.equal(
    (
      await db.query(
        "SELECT count(*) FROM step_results WHERE run_id=ANY($1::uuid[])",
        [jobs],
      )
    ).rows[0].count,
    "40",
  );
  // Run this destructive retention check only in the dedicated disposable integration stack.
  if (process.env.SHADOWLAB_DISPOSABLE_TEST === "1") {
    assert.ok((await expire(0)) >= 4);
    assert.equal(
      (
        await db.query("SELECT count(*) FROM runs WHERE id=ANY($1::uuid[])", [
          jobs,
        ])
      ).rows[0].count,
      "0",
    );
  }
  console.log(
    "Verified four queued jobs, forty step results and eight checksummed S3 objects.",
  );
} finally {
  await db.end();
  s3.destroy();
}
