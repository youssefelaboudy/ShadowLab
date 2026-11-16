import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { replay } from "../core/replay.ts";
import type { Scenario } from "../core/schema.ts";
const exec = promisify(execFile);
export async function compareRefs(
  s: Scenario,
  baseline: string,
  candidate: string,
) {
  const root = await mkdtemp(join(tmpdir(), "shadowlab-refs-")),
    children: ChildProcess[] = [];
  async function checkout(ref: string, role: string) {
    if (!ref || !/^[a-zA-Z0-9][a-zA-Z0-9._/~^-]*$/.test(ref))
      throw Error("Invalid git reference");
    const sha = (
      await exec("git", [
        "rev-parse",
        "--verify",
        "--end-of-options",
        ref + "^{commit}",
      ])
    ).stdout.trim();
    const cwd = join(root, role),
      archive = cwd + ".tar";
    await mkdir(cwd);
    await exec("git", ["archive", "--format=tar", "--output", archive, sha]);
    await exec("tar", ["-xf", archive, "-C", cwd]);
    if (process.platform === "win32")
      await exec(
        "cmd.exe",
        ["/d", "/c", "npm.cmd ci --omit=dev --ignore-scripts"],
        { cwd, timeout: 120000 },
      );
    else
      await exec("npm", ["ci", "--omit=dev", "--ignore-scripts"], {
        cwd,
        timeout: 120000,
      });
    const code =
      "import {startApi} from './apps/demo-api/server.ts';const api=await startApi('baseline');process.send(api.url);process.on('disconnect',async()=>{await api.close();process.exit()})";
    const child = spawn(
      process.execPath,
      ["--input-type=module", "--eval", code],
      {
        cwd,
        env: { ...process.env, SHADOWLAB_COMMIT: sha },
        stdio: ["ignore", "ignore", "inherit", "ipc"],
      },
    );
    children.push(child);
    return await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error("Revision startup timed out")),
        10000,
      );
      child.once("message", (v) => {
        clearTimeout(timer);
        resolve(String(v));
      });
      child.once("exit", () => {
        clearTimeout(timer);
        reject(Error("Revision exited"));
      });
      child.once("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
    });
  }
  try {
    const a = await checkout(baseline, "baseline"),
      b = await checkout(candidate, "candidate");
    return await replay(s, a, b);
  } finally {
    for (const child of children)
      if (child.exitCode === null && child.signalCode === null) {
        const closed = once(child, "close");
        child.kill();
        await closed;
      }
    await rm(root, { recursive: true, force: true, maxRetries: 3 });
  }
}
