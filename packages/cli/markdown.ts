import type { Report } from "../core/replay.ts";
export function markdown(r: Report) {
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
    "Baseline commit: `" +
      (r.baselineCommit ?? "unavailable") +
      "` · Candidate commit: `" +
      (r.candidateCommit ?? "unavailable") +
      "`",
    "",
    "Run: " + r.startedAt + " → " + r.completedAt,
    "",
    "Scenario SHA-256: `" + r.checksum + "`",
    "",
  ].join("\n");
}
