import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { validate } from "../core/schema.ts";
import { replay, recordEvidence, type Report } from "../core/replay.ts";
import { startApi } from "../../apps/demo-api/server.ts";

import { markdown } from "./markdown.ts";
import { publish, prune } from "./artifacts.ts";
import { readScenario } from "../scenario/format.ts";
import { defaults, fixtureHash } from "../fixtures/manifest.ts";
import { flushTraces } from "../observability/tracing.ts";
async function save(dir: string, r: Report) {
  await publish(dir, {
    "report.json": JSON.stringify(r, null, 2) + "\n",
    "report.md": markdown(r),
  });
  console.log(
    r.baseline +
      " → " +
      r.candidate +
      "   " +
      r.status +
      "   " +
      (r.first ?? "all steps match"),
  );
  for (const d of r.steps.find((s) => s.name === r.first)?.differences ?? [])
    console.log(
      "  " +
        d.path +
        "   " +
        JSON.stringify(d.baseline) +
        " → " +
        JSON.stringify(d.candidate),
    );
  console.log("  " + join(dir, "report.md"));
}
async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: Object.fromEntries(
      [
        "scenario",
        "baseline",
        "candidate",
        "out",
        "format",
        "fixtures",
        "targets",
        "days",
        "baseline-ref",
        "candidate-ref",
      ].map((k) => [k, { type: "string" as const }]),
    ),
  });
  const [command, sub, file] = positionals,
    opts = values as Record<string, string>;
  if (command === "prune") {
    console.log(
      (await prune(resolve(sub || "artifacts"), Number(opts.days ?? 14))) +
        " runs removed",
    );
    return 0;
  }
  if (command === "report") {
    if (!sub || (opts.format && opts.format !== "markdown"))
      throw Error("Invalid format");
    console.log(
      markdown(JSON.parse(await readFile(join(sub, "report.json"), "utf8"))),
    );
    return 0;
  }
  const scenario = await readScenario(
    opts.scenario || file || "scenarios/coupon-quantity.json",
  );
  if (opts.fixtures) {
    const supplied = JSON.parse(
      await readFile(join(opts.fixtures, "fixture.json"), "utf8"),
    );
    if (
      supplied.id !== scenario.fixture ||
      fixtureHash(supplied) !== fixtureHash(defaults)
    )
      throw Error("Unknown fixture content");
  }
  if (command === "scenario" && sub === "validate") {
    console.log("Valid: " + scenario.name);
    return 0;
  }
  const out = resolve(opts.out || join("artifacts", randomUUID()));
  if (command === "replay") {
    const targets = JSON.parse(
      await readFile(
        opts.targets || new URL("../../config/targets.json", import.meta.url),
        "utf8",
      ),
    );
    if (
      targets.testMode !== true ||
      (opts.baseline && opts.baseline !== targets.baseline) ||
      (opts.candidate && opts.candidate !== targets.candidate)
    )
      throw Error("Target outside test configuration");
    const r = await replay(scenario, targets.baseline, targets.candidate);
    await save(out, r);
    return r.first ? 1 : 0;
  }
  if (command === "revisions") {
    const { compareRefs } = await import("./revisions.ts");
    const report = await compareRefs(
      scenario,
      opts["baseline-ref"],
      opts["candidate-ref"],
    );
    await save(out, report);
    return report.first ? 1 : 0;
  }
  if (command !== "demo" && command !== "record")
    throw Error("Unknown command");
  const servers: Awaited<ReturnType<typeof startApi>>[] = [];
  try {
    const base = await startApi("baseline");
    servers.push(base);
    if (command === "record") {
      const result = await recordEvidence(base.url, scenario);
      await publish(out, {
        "scenario.json": JSON.stringify(result.scenario, null, 2),
        "evidence.json": JSON.stringify(result.evidence, null, 2),
      });
      console.log(join(out, "scenario.json"));
      return 0;
    }
    for (const mode of ["stale", "fixed"] as const) {
      const app = await startApi(mode);
      servers.push(app);
      const r = await replay(scenario, base.url, app.url);
      await save(join(out, mode), r);
      if ((mode === "stale") !== Boolean(r.first))
        throw Error("Unexpected demonstration outcome");
    }
    return 0;
  } finally {
    await Promise.all(servers.map((s) => s.close()));
  }
}
try {
  process.exitCode = await main();
} catch (e) {
  const known =
    /^(Fixture (handshake|cleanup) failed|Invalid reference at [a-z0-9_]+|Expected loopback demo target|Response size limit|Unknown variable|Route outside demo contract|Invalid name, version or fixture)$/;
  const diagnostic =
    e instanceof Error && e.name === "TimeoutError"
      ? "HTTP step timed out"
      : e instanceof Error &&
          /^Polling limit at [a-z0-9_]+$|^Target outside test configuration$|^Unknown fixture content$|^Invalid YAML scenario$|^Invalid JSON response$/.test(
            e.message,
          )
        ? e.message
        : undefined;
  console.error(
    "ShadowLab setup error — " +
      (diagnostic ??
        (e instanceof Error && known.test(e.message)
          ? e.message
          : "check the scenario, target availability and output path")),
  );
  process.exitCode = 2;
} finally {
  await flushTraces();
}
