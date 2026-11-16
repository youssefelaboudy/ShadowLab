import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { startApi, type Mode } from "../apps/demo-api/server.ts";
import { readScenario } from "../packages/scenario/format.ts";
import { replay, type Report } from "../packages/core/replay.ts";
import { canonical, digest } from "../packages/fixtures/manifest.ts";
const saved = JSON.parse(
  await readFile("docs/history/history.json", "utf8"),
) as { runs: { report: Report }[] };
let normalizedIds = 0;
for (const { report } of saved.runs) {
  const base = await startApi("baseline"),
    candidate = await startApi(report.candidate as Mode);
  try {
    const result = await replay(report.definition, base.url, candidate.url);
    assert.equal(result.status, report.status);
    assert.equal(canonical(result.steps), canonical(report.steps));
    normalizedIds += result.normalized.distinctBoundIds;
    console.log(
      result.scenario,
      result.candidate,
      digest(canonical(result.steps)),
    );
  } finally {
    await Promise.all([base.close(), candidate.close()]);
  }
}
assert.ok(normalizedIds > 0);
console.log(
  "Matched " +
    saved.runs.length +
    " recorded runs. Normalized " +
    normalizedIds +
    " independently generated bindings.",
);
