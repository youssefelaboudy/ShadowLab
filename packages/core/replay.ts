import { createHash } from "node:crypto";
import {
  validate,
  variable,
  object,
  type Scenario,
  type Step,
} from "./schema.ts";
import { compare, missing, type Difference } from "./compare.ts";

export function localTarget(url: string) {
  if (
    !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(url) ||
    Number(new URL(url).port) > 65535
  )
    throw Error("Expected loopback demo target");
  return url;
}
export async function exchange(
  url: string,
  path: string,
  method: string,
  json?: unknown,
  run?: string,
  timeout = 4000,
) {
  const response = await fetch(localTarget(url) + path, {
    method,
    redirect: "error",
    signal: AbortSignal.timeout(timeout),
    headers: {
      "content-type": "application/json",
      ...(run ? { "x-shadowlab-run": run } : {}),
    },
    body: json === undefined ? undefined : JSON.stringify(json),
  });
  const chunks = [];
  let size = 0;
  for await (const c of response.body!) {
    size += c.length;
    if (size > 65536) throw Error("Response size limit");
    chunks.push(c);
  }
  return {
    status: response.status,
    body: JSON.parse(Buffer.concat(chunks).toString()),
  };
}
const numeric = ["quantity", "notifications", "subtotal", "discount", "total"];
const knownErrors = [
  "cart",
  "session",
  "invalid_request",
  "summary_unavailable",
  "route",
];
function evidence(body: unknown, ids: Map<string, string>) {
  if (!object(body)) throw Error("Expected demo response object");
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (numeric.includes(k))
      result[k] =
        v === null || Number.isSafeInteger(v) ? v : "[invalid number]";
    if (k === "currency")
      result[k] = ["CAD", "USD", "EUR", null].includes(v as string)
        ? v
        : "[unknown currency]";
    if (k === "applied")
      result[k] = typeof v === "boolean" ? v : "[invalid flag]";
    if (k === "id") result[k] = ids.get(String(v)) || "[unbound id]";
    if (k === "generatedAt")
      result[k] =
        typeof v === "string" && Number.isFinite(Date.parse(v))
          ? new Date(v).toISOString()
          : "[invalid time]";
    if (k === "error")
      result[k] = knownErrors.includes(v as string) ? v : "[unknown error]";
  }
  return result;
}
type Sample = { status: number; body: Record<string, unknown> };
async function execute(url: string, s: Scenario, record: boolean) {
  const setup = await exchange(url, "/__fixture", "POST", {
    clock: s.clock,
    fixture: s.fixture,
    record,
  });
  if (
    setup.status !== 201 ||
    setup.body.protocol !== "shadowlab/1" ||
    !/^[a-f0-9-]{36}$/.test(setup.body.run)
  )
    throw Error("Fixture handshake failed");
  const run = setup.body.run,
    bindings = new Map<string, string>(),
    ids = new Map<string, string>();
  const samples: Sample[] = [];
  try {
    for (const step of s.steps) {
      if (
        [...step.path.matchAll(variable)].some(([, key]) => !bindings.has(key))
      )
        break;
      const path = step.path.replace(variable, (_, key) => bindings.get(key)!);
      const { status, body } = await exchange(
        url,
        path,
        step.method,
        step.json,
        run,
      );
      if (
        step.capture &&
        status < 300 &&
        typeof body?.id === "string" &&
        /^[a-f0-9-]{36}$/.test(body.id)
      ) {
        bindings.set(step.capture, body.id);
        ids.set(body.id, "${" + step.capture + "}");
      }
      samples.push({ status, body: evidence(body, ids) });
    }
    const recording = record
      ? validate((await exchange(url, "/__record", "GET", undefined, run)).body)
      : undefined;
    return {
      samples,
      recording,
      revision: ["baseline", "stale", "fixed", "missing", "error"].includes(
        setup.body.revision,
      )
        ? setup.body.revision
        : "custom",
    };
  } finally {
    if (
      (await exchange(url, "/__fixture", "DELETE", undefined, run)).status !==
      200
    )
      throw Error("Fixture cleanup failed");
  }
}
export async function recordScenario(url: string, input: unknown) {
  return (await execute(url, validate(input), true)).recording!;
}
function violations(step: Step, x: Sample) {
  const issues: Difference[] = [];
  for (const [key, value] of Object.entries(step.assert || {}))
    if (x.body[key] !== value)
      issues.push({
        path: "$." + key,
        baseline: value,
        candidate: Object.hasOwn(x.body, key) ? x.body[key] : missing,
        reason: "assertion",
      });
  if (step.capture && x.status < 300 && x.body.id !== "${" + step.capture + "}")
    issues.push({
      path: "$.id",
      baseline: "bound identifier",
      candidate: x.body.id ?? missing,
      reason: "capture",
    });
  if (step.path.endsWith("/summary") && x.status === 200) {
    const { total, discount, subtotal } = x.body;
    if (
      ![total, discount, subtotal].every(Number.isSafeInteger) ||
      total !== Number(subtotal) - Number(discount)
    )
      issues.push({
        path: "$.total",
        baseline: "subtotal − discount",
        candidate: total ?? missing,
        reason: "invariant",
      });
  }
  return issues;
}
export async function replay(
  input: unknown,
  baseline: string,
  candidate: string,
) {
  const s = validate(input);
  const startedAt = new Date().toISOString();
  const a = await execute(baseline, s, false),
    b = await execute(candidate, s, false);
  const steps = s.steps.map((step, i) => {
    const before = a.samples[i],
      after = b.samples[i];
    if (!before || before.status >= 400 || violations(step, before).length)
      throw Error("Invalid reference at " + step.name);
    const differences: Difference[] = [];
    if (after) {
      if (before.status !== after.status)
        differences.push({
          path: "$status",
          baseline: before.status,
          candidate: after.status,
          reason: "status",
        });
      differences.push(
        ...compare(before.body, after.body, s.ignore),
        ...violations(step, after),
      );
    }
    return {
      ordinal: i + 1,
      name: step.name,
      request: { method: step.method, path: step.path, json: step.json },
      baseline: before,
      candidate: after ?? null,
      blocked: !after,
      differences,
    };
  });
  const first = steps.find((x) => x.differences.length);
  return {
    scenario: s.name,
    checksum: createHash("sha256").update(JSON.stringify(s)).digest("hex"),
    fixture: s.fixture,
    clock: s.clock,
    startedAt,
    completedAt: new Date().toISOString(),
    commit: /^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA || "")
      ? process.env.GITHUB_SHA
      : null,
    baseline: a.revision,
    candidate: b.revision,
    status: first ? "REGRESSION" : "PASS",
    first: first?.name ?? null,
    ignore: s.ignore,
    steps,
  };
}
export type Report = Awaited<ReturnType<typeof replay>>;
