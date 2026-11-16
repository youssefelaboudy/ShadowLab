import { setTimeout as delay } from "node:timers/promises";
import { at } from "../scenario/format.ts";
import { orderedSets } from "../scenario/sets.ts";
import { span } from "../observability/tracing.ts";
import { defaults, fixtureHash, canonical } from "../fixtures/manifest.ts";
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
  try {
    return {
      status: response.status,
      body: JSON.parse(Buffer.concat(chunks).toString()),
    };
  } catch {
    if (response.status >= 400)
      return { status: response.status, body: { error: "non_json_error" } };
    throw Error("Invalid JSON response");
  }
}
const numeric = [
  "quantity",
  "notifications",
  "subtotal",
  "discount",
  "total",
  "emailCount",
  "paymentCount",
];
const knownErrors = [
  "cart",
  "session",
  "invalid_request",
  "summary_unavailable",
  "non_json_error",
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
    if (k === "entity" && object(v))
      result[k] = { id: ids.get(String(v.id)) || "[unbound id]" };
    if (k === "items" && Array.isArray(v))
      result[k] = v.map((x) => ({
        id: ids.get(String(x?.id)) || "[unbound id]",
        quantity: Number.isSafeInteger(x?.quantity) ? x.quantity : null,
      }));
    if (k === "ready")
      result[k] = typeof v === "boolean" ? v : "[invalid flag]";
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
  const durations: number[] = [];
  try {
    if (setup.body.fixtureHash !== fixtureHash(defaults))
      throw Error("Fixture handshake failed");
    for (const step of s.steps) {
      if (
        [...step.path.matchAll(variable)].some(([, key]) => !bindings.has(key))
      )
        break;
      const path = step.path.replace(variable, (_, key) => bindings.get(key)!);
      const begin = performance.now();
      const { status, body } = await span(
        "replay.step",
        { step: step.name, method: step.method },
        async () => {
          let attempts = 0;
          while (true) {
            const response = await exchange(
              url,
              path,
              step.method,
              step.json,
              run,
              step.timeout_ms,
            );
            attempts++;
            if (
              !step.poll ||
              response.status >= 400 ||
              at(response.body, step.poll.path) === step.poll.equals
            )
              return response;
            if (attempts >= step.poll.max_attempts)
              throw Error("Polling limit at " + step.name);
            await delay(step.poll.interval_ms);
          }
        },
      );
      durations.push(Math.round((performance.now() - begin) * 100) / 100);
      for (const [key, rule] of Object.entries(captureRules(step))) {
        const id = at(body, rule.path);
        if (
          status < 300 &&
          typeof id === "string" &&
          /^[a-f0-9-]{36}$/.test(id)
        ) {
          bindings.set(key, id);
          if (!ids.has(id)) ids.set(id, "${" + key + "}");
        }
      }
      samples.push({ status, body: orderedSets(evidence(body, ids), s.sets) });
    }
    const recording = record
      ? validate((await exchange(url, "/__record", "GET", undefined, run)).body)
      : undefined;
    return {
      samples,
      bindings,
      durations,
      recordedEvidence: record
        ? (await exchange(url, "/__evidence", "GET", undefined, run)).body
        : undefined,
      commit: /^[a-f0-9]{40}$/.test(setup.body.commit)
        ? String(setup.body.commit)
        : null,
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
function captureRules(step: Step) {
  return step.capture
    ? { [step.capture]: { path: "$.id" } }
    : (step.captures ?? {});
}
export async function recordEvidence(url: string, input: unknown) {
  const r = await execute(url, validate(input), true);
  return { scenario: r.recording!, evidence: r.recordedEvidence };
}
export async function recordScenario(url: string, input: unknown) {
  return (await execute(url, validate(input), true)).recording!;
}
function violations(step: Step, x: Sample, exact: string[] = []) {
  const issues: Difference[] = [];
  for (const path of exact) {
    const value = at(x.body, path);
    if (value !== undefined && !Number.isSafeInteger(value))
      issues.push({
        path,
        baseline: "integer minor units",
        candidate: value,
        reason: "numeric contract",
      });
  }
  for (const [key, value] of Object.entries(step.assert || {}))
    if (x.body[key] !== value)
      issues.push({
        path: "$." + key,
        baseline: value,
        candidate: Object.hasOwn(x.body, key) ? x.body[key] : missing,
        reason: "assertion",
      });
  for (const r of step.assertions ?? [])
    if (at(x.body, r.path) !== r.equals)
      issues.push({
        path: r.path,
        baseline: r.equals,
        candidate:
          at(x.body, r.path) === undefined ? missing : at(x.body, r.path),
        reason: "assertion",
      });
  for (const [key, rule] of Object.entries(captureRules(step)))
    if (x.status < 300 && !String(at(x.body, rule.path)).startsWith("${"))
      issues.push({
        path: rule.path,
        baseline: "bound identifier",
        candidate: at(x.body, rule.path) ?? missing,
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
  const a = await span("replay.baseline", { scenario: s.name }, () =>
    execute(baseline, s, false),
  );
  const b = await span("replay.candidate", { scenario: s.name }, () =>
    execute(candidate, s, false),
  );
  const steps = s.steps.map((step, i) => {
    const before = a.samples[i],
      after = b.samples[i];
    if (
      !before ||
      (step.expect_status !== undefined
        ? before.status !== step.expect_status
        : before.status >= 400) ||
      violations(step, before, s.exact).length
    )
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
        ...violations(step, after, s.exact),
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
    scenarioVersion: s.version,
    definition: s,
    baselineCommit: a.commit,
    candidateCommit: b.commit,
    fixtureChecksum: fixtureHash(defaults),
    normalized: {
      distinctBoundIds: [...a.bindings].filter(
        ([key, id]) => b.bindings.has(key) && b.bindings.get(key) !== id,
      ).length,
      volatileFields: steps.reduce(
        (n, step) =>
          n +
          (step.candidate
            ? s.ignore.filter(
                (path) =>
                  at(step.baseline.body, path) !==
                  at(step.candidate!.body, path),
              ).length
            : 0),
        0,
      ),
    },
    durations: { baseline: a.durations, candidate: b.durations },
    checksum: createHash("sha256").update(canonical(s)).digest("hex"),
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
