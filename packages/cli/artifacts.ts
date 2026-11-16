import {
  mkdir,
  writeFile,
  mkdtemp,
  rename,
  rm,
  readFile,
  readdir,
  unlink,
  rmdir,
} from "node:fs/promises";
import { dirname, basename, join } from "node:path";
import { digest } from "../fixtures/manifest.ts";
export async function publish(
  dir: string,
  files: Record<string, string>,
  provenance?: Record<string, unknown>,
) {
  await mkdir(dirname(dir), { recursive: true });
  const stage = await mkdtemp(join(dirname(dir), ".shadowlab-stage-"));
  try {
    const hashes: Record<string, string> = {};
    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(stage, name), content, { flag: "wx" });
      hashes[name] = digest(content);
    }
    await writeFile(
      join(stage, "manifest.json"),
      JSON.stringify(
        {
          format: "shadowlab/1",
          createdAt: new Date().toISOString(),
          hashes,
          provenance,
        },
        null,
        2,
      ),
    );
    await rename(stage, dir);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
export async function prune(root: string, days: number) {
  if (!Number.isInteger(days) || days < 0) throw Error("Invalid retention");
  let removed = 0;
  async function visit(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true });
    if (entries.some((e) => e.name === "manifest.json" && e.isFile())) {
      const manifest = JSON.parse(
        await readFile(join(dir, "manifest.json"), "utf8"),
      );
      const names = Object.keys(manifest.hashes ?? {});
      if (
        manifest.format !== "shadowlab/1" ||
        !(Date.parse(manifest.createdAt) <= Date.now() - days * 86400000) ||
        !names.length
      )
        return;
      if (
        names.some(
          (n) =>
            ![
              "report.md",
              "report.json",
              "scenario.json",
              "evidence.json",
            ].includes(n) || basename(n) !== n,
        )
      )
        return;
      if (
        entries.some(
          (e) =>
            !e.isFile() ||
            (!names.includes(e.name) && e.name !== "manifest.json"),
        )
      )
        return;
      for (const n of names)
        if (digest(await readFile(join(dir, n), "utf8")) !== manifest.hashes[n])
          return;
      for (const n of [...names, "manifest.json"]) await unlink(join(dir, n));
      await rmdir(dir);
      removed++;
      return;
    }
    for (const e of entries)
      if (e.isDirectory() && !e.name.startsWith("."))
        await visit(join(dir, e.name));
  }
  await visit(root);
  return removed;
}
