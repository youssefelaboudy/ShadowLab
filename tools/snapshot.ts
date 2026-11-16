import { mkdir, writeFile } from "node:fs/promises";
import { startApi, type Mode } from "../apps/demo-api/server.ts";
import { readScenario } from "../packages/scenario/format.ts";
import { replay, type Report } from "../packages/core/replay.ts";
import { markdown } from "../packages/cli/markdown.ts";
import { digest } from "../packages/fixtures/manifest.ts";
const root = "docs/history";
const runs: { id: string; report: Report }[] = [],
  artifacts = [];
const a = await startApi("baseline");
try {
  for (const [file, rev] of [
    ["coupon-quantity.yaml", "stale"],
    ["coupon-quantity.yaml", "fixed"],
    ["quantity-before-coupon.json", "stale"],
    ["missing-field.yaml", "missing"],
    ["coupon-quantity.yaml", "error"],
    ["checkout.yaml", "fixed"],
  ]) {
    const b = await startApi(rev as Mode);
    try {
      const r = await replay(
        await readScenario("scenarios/" + file),
        a.url,
        b.url,
      );
      const id = r.scenario + "-" + rev;
      runs.unshift({ id, report: r });
      await mkdir(root + "/evidence/" + id, { recursive: true });
      for (const [format, content] of [
        ["json", JSON.stringify(r, null, 2)],
        ["md", markdown(r)],
      ]) {
        artifacts.push({
          run_id: id,
          format,
          checksum: digest(content),
          uploaded: false,
        });
        await writeFile(
          root + "/evidence/" + id + "/report." + format,
          content,
        );
      }
    } finally {
      await b.close();
    }
  }
} finally {
  await a.close();
}
await writeFile(
  root + "/history.json",
  JSON.stringify({
    runs,
    artifacts,
    hasMore: false,
    jobs: [],
    scenarios: [...new Set(runs.map((x) => x.report.scenario))],
  }),
);
