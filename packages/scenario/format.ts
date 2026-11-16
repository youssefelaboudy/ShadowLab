import { readFile } from "node:fs/promises";
import { parseDocument } from "yaml";
import { validate, object } from "../core/schema.ts";
export function at(body: unknown, path: string): unknown {
  let value = body;
  for (const key of path.slice(2).split(".")) {
    if (!object(value) || !Object.hasOwn(value, key)) return undefined;
    value = value[key];
  }
  return value;
}
export function decode(input: unknown) {
  if (!object(input) || !Array.isArray(input.steps)) return validate(input);
  if (!input.steps.some((s) => object(s) && "request" in s))
    return validate(input);
  const { comparison, steps, ...rest } = input;
  if (
    !object(comparison) ||
    Object.keys(comparison).some(
      (k) =>
        !["ignore_paths", "compare_numeric_exactly", "ordered_sets"].includes(
          k,
        ),
    )
  )
    throw Error("Invalid comparison");
  const transformed = steps.map((s) => {
    if (
      !object(s) ||
      !object(s.request) ||
      Object.keys(s).some(
        (k) =>
          ![
            "name",
            "request",
            "capture",
            "assertions",
            "poll",
            "timeout_ms",
          ].includes(k),
      ) ||
      Object.keys(s.request).some(
        (k) => !["method", "path", "json"].includes(k),
      )
    )
      throw Error("Invalid step");
    return {
      name: s.name,
      ...s.request,
      ...(s.capture ? { captures: s.capture } : {}),
      ...(s.assertions ? { assertions: s.assertions } : {}),
      ...(s.poll ? { poll: s.poll } : {}),
      ...(s.timeout_ms ? { timeout_ms: s.timeout_ms } : {}),
    };
  });
  return validate({
    ...rest,
    clock:
      typeof rest.clock === "string" && Number.isFinite(Date.parse(rest.clock))
        ? new Date(rest.clock).toISOString()
        : rest.clock,
    steps: transformed,
    ignore: comparison.ignore_paths ?? [],
    exact: comparison.compare_numeric_exactly ?? [],
    sets: comparison.ordered_sets ?? {},
  });
}
export async function readScenario(file: string) {
  const raw = await readFile(file, "utf8");
  if (Buffer.byteLength(raw) > 262144) throw Error("Scenario size limit");
  if (file.endsWith(".json")) return decode(JSON.parse(raw));
  // YAML core supports unquoted field names and scalars in the published examples.
  const source = parseDocument(raw, { uniqueKeys: true });
  if (source.errors.length) throw Error("Invalid YAML scenario");
  return decode(source.toJS({ maxAliasCount: 0 }));
}
