import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
export const defaults = JSON.parse(
  readFileSync(
    new URL("../../fixtures/carts-basic-v1/fixture.json", import.meta.url),
    "utf8",
  ),
) as {
  id: string;
  sku: string;
  unitPrice: number;
  currency: string;
  coupon: string;
  discountPercent: number;
};
export const digest = (s: string) =>
  createHash("sha256").update(s).digest("hex");
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export function fixtureHash(data: typeof defaults) {
  return digest(
    JSON.stringify(
      Object.keys(defaults)
        .sort()
        .map((k) => data[k as keyof typeof defaults]),
    ),
  );
}
export function revision() {
  const supplied = process.env.SHADOWLAB_COMMIT || process.env.GITHUB_SHA;
  if (supplied && /^[a-f0-9]{40}$/.test(supplied)) return supplied;
  try {
    execFileSync(
      "git",
      [
        "diff",
        "--quiet",
        "HEAD",
        "--",
        "apps",
        "packages",
        "fixtures",
        "package.json",
        "package-lock.json",
      ],
      {
        cwd: fileURLToPath(new URL("../../", import.meta.url)),
        stdio: "ignore",
      },
    );
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}
