import { readFile } from "node:fs/promises";
import type { Report } from "../packages/core/replay.ts";
const r: Report = JSON.parse(await readFile(process.argv[2], "utf8"));
const escape = (s: string) =>
  s.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
for (const step of r.steps)
  for (const d of step.differences) {
    const file = escape(process.argv[3])
      .replaceAll(",", "%2C")
      .replaceAll(":", "%3A");
    console.log(
      "::error file=" +
        file +
        ",title=ShadowLab " +
        step.name +
        "::" +
        escape(
          d.path +
            " " +
            JSON.stringify(d.baseline) +
            " → " +
            JSON.stringify(d.candidate),
        ),
    );
  }
