import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
const start = performance.now();
const frames: unknown[] = [
  {
    version: 2,
    width: 92,
    height: 16,
    timestamp: Math.floor(Date.now() / 1000),
    title: "ShadowLab · coupon replay",
  },
];
function emit(data: string) {
  frames.push([
    (performance.now() - start) / 1000,
    "o",
    data.replaceAll("\r\n", "\n").replaceAll("\n", "\r\n"),
  ]);
}
emit("$ node packages/cli/main.ts demo --out artifacts/demo\n");
const child = spawn(
  process.execPath,
  ["packages/cli/main.ts", "demo", "--out", "artifacts/demo"],
  { stdio: ["ignore", "pipe", "inherit"] },
);
for await (const data of child.stdout) {
  emit(
    String(data)
      .replaceAll(process.cwd() + "\\", "")
      .replaceAll(process.cwd() + "/", ""),
  );
}
const status =
  child.exitCode ??
  (await new Promise<number | null>((resolve) => child.once("close", resolve)));
if (status !== 0) throw Error("Demo failed");
await writeFile(
  "docs/terminal.cast",
  frames.map((v) => JSON.stringify(v)).join("\n") + "\n",
);
