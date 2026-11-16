import { object } from "./schema.ts";
export type Difference = {
  path: string;
  baseline: unknown;
  candidate: unknown;
  reason: string;
};
export const missing = { missing: true };
export function compare(
  a: unknown,
  b: unknown,
  ignore: string[] = [],
  path = "$",
): Difference[] {
  if (ignore.includes(path) || Object.is(a, b)) return [];
  if ((object(a) && object(b)) || (Array.isArray(a) && Array.isArray(b))) {
    const left = a as Record<string, unknown>,
      right = b as Record<string, unknown>;
    const differences: Difference[] = [];
    for (const key of [
      ...new Set([...Object.keys(left), ...Object.keys(right)]),
    ].sort()) {
      const child = Array.isArray(a)
        ? path + "[" + key + "]"
        : path + "." + key;
      if (ignore.includes(child)) continue;
      if (!Object.hasOwn(left, key) || !Object.hasOwn(right, key)) {
        differences.push({
          path: child,
          baseline: Object.hasOwn(left, key) ? left[key] : missing,
          candidate: Object.hasOwn(right, key) ? right[key] : missing,
          reason: "presence",
        });
      } else differences.push(...compare(left[key], right[key], ignore, child));
    }
    return differences;
  }
  return [{ path, baseline: a, candidate: b, reason: "value" }];
}
