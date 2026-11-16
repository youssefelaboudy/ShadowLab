import { readFile } from "node:fs/promises";
import { startApi, type Mode } from "../apps/demo-api/server.ts";
import { replay } from "../packages/core/replay.ts";
const scenario = JSON.parse(
  await readFile("scenarios/coupon-quantity.json", "utf8"),
);
const baseline = await startApi("baseline");
try {
  const rows = [];
  for (const mode of ["fixed", "stale", "missing", "error"] as Mode[]) {
    const candidate = await startApi(mode);
    const durations: number[] = [];
    let signature: string | undefined;
    try {
      for (let i = 0; i < 10; i++) {
        const start = performance.now();
        const result = await replay(scenario, baseline.url, candidate.url);
        durations.push(performance.now() - start);
        const evidence = JSON.stringify(result.steps);
        if (signature !== undefined && evidence !== signature)
          throw Error("Inconsistent evidence");
        if (result.first !== (mode === "fixed" ? null : "summary"))
          throw Error("Unexpected divergence");
        signature = evidence;
      }
    } finally {
      await candidate.close();
    }
    durations.sort((a, b) => a - b);
    rows.push({
      revision: mode,
      runs: durations.length,
      expected: mode === "fixed" ? "PASS" : "REGRESSION",
      p50_ms: Math.round(durations[4]),
      p95_ms: Math.round(durations[9]),
    });
  }
  console.log(
    JSON.stringify(
      { node: process.version, platform: process.platform, rows },
      null,
      2,
    ),
  );
} finally {
  await baseline.close();
}
