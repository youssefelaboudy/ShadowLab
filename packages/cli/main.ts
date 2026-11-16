import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { validate } from "../core/schema.ts";
import { replay, recordScenario, type Report } from "../core/replay.ts";
import { startApi } from "../../apps/demo-api/server.ts";

function markdown(r: Report) {
  const lines = [
    "# " + r.scenario,
    "",
    "**" + r.status + "** · " + r.baseline + " → " + r.candidate,
    "",
    "First divergence: " + (r.first ?? "none"),
    "",
    "| Step | Request | Result |",
    "|---|---|---|",
  ];
  for (const s of r.steps)
    lines.push(
      "| " +
        s.ordinal +
        ". " +
        s.name +
        " | `" +
        s.request.method +
        " " +
        s.request.path +
        "` | " +
        (s.blocked ? "BLOCKED" : s.differences.length ? "DIFF" : "MATCH") +
        " |",
    );
  for (const s of r.steps.filter((x) => x.differences.length)) {
    lines.push(
      "",
      "## " + s.name,
      "",
      "| Path | Reference | Candidate | Check |",
      "|---|---:|---:|---|",
    );
    for (const d of s.differences)
      lines.push(
        "| `" +
          d.path +
          "` | `" +
          JSON.stringify(d.baseline) +
          "` | `" +
          JSON.stringify(d.candidate) +
          "` | " +
          d.reason +
          " |",
      );
  }
  return [
    ...lines,
    "",
    "Money amounts are integer CAD cents.",
    "",
    "Fixture: `" + r.fixture + "` · Clock: `" + r.clock + "`",
    "",
    "Scenario SHA-256: `" + r.checksum + "`",
    "",
  ].join("\n");
}
async function save(dir: string, r: Report) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "report.json"), JSON.stringify(r, null, 2) + "\n");
  await writeFile(join(dir, "report.md"), markdown(r));
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
      ["scenario", "baseline", "candidate", "out", "format"].map((k) => [
        k,
        { type: "string" as const },
      ]),
    ),
  });
  const [command, sub, file] = positionals,
    opts = values as Record<string, string>;
  if (command === "report") {
    if (!sub || (opts.format && opts.format !== "markdown"))
      throw Error("Invalid format");
    console.log(
      markdown(JSON.parse(await readFile(join(sub, "report.json"), "utf8"))),
    );
    return 0;
  }
  const scenario = validate(
    JSON.parse(
      await readFile(
        opts.scenario || file || "scenarios/coupon-quantity.json",
        "utf8",
      ),
    ),
  );
  if (command === "scenario" && sub === "validate") {
    console.log("Valid: " + scenario.name);
    return 0;
  }
  const out = resolve(opts.out || join("artifacts", randomUUID()));
  if (command === "replay") {
    const r = await replay(scenario, opts.baseline, opts.candidate);
    await save(out, r);
    return r.first ? 1 : 0;
  }
  if (command !== "demo" && command !== "record")
    throw Error("Unknown command");
  const servers: Awaited<ReturnType<typeof startApi>>[] = [];
  try {
    const base = await startApi("baseline");
    servers.push(base);
    if (command === "record") {
      const result = await recordScenario(base.url, scenario);
      await mkdir(out, { recursive: true });
      await writeFile(
        join(out, "scenario.json"),
        JSON.stringify(result, null, 2) + "\n",
      );
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
  console.error(
    "ShadowLab setup error — " +
      (e instanceof Error && known.test(e.message)
        ? e.message
        : "check the scenario, target availability and output path"),
  );
  process.exitCode = 2;
}
