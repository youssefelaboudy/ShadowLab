export type Step = {
  name: string;
  method: string;
  path: string;
  json?: Record<string, unknown>;
  capture?: string;
  assert?: Record<string, unknown>;
};
export type Scenario = {
  name: string;
  version: 1;
  fixture: string;
  clock: string;
  steps: Step[];
  ignore: string[];
};
export const fixture = "carts-basic-v1";
export const identifier = /^[a-z][a-z0-9_]{0,39}$/;
export const variable = /\$\{([a-z][a-z0-9_]*)\}/g;
const ref = "\\$\\{[a-z][a-z0-9_]*\\}";
export const routes = [
  { method: "POST", path: /^\/test\/carts$/, fields: [] },
  {
    method: "POST",
    path: new RegExp("^/test/carts/" + ref + "/items$"),
    fields: ["sku", "quantity"],
  },
  {
    method: "POST",
    path: new RegExp("^/test/carts/" + ref + "/coupons$"),
    fields: ["code"],
  },
  {
    method: "PATCH",
    path: new RegExp("^/test/carts/" + ref + "/items/" + ref + "$"),
    fields: ["quantity"],
  },
  {
    method: "GET",
    path: new RegExp("^/test/carts/" + ref + "/summary$"),
    fields: [],
  },
];
export function object(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}
function keys(x: Record<string, unknown>, allowed: string[]) {
  return Object.keys(x).every((k) => allowed.includes(k));
}
function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw Error(message);
}
export function validate(input: unknown): Scenario {
  check(
    object(input) &&
      keys(input, ["name", "version", "fixture", "clock", "steps", "ignore"]),
    "Invalid scenario shape",
  );
  check(
    typeof input.name === "string" &&
      /^[a-z][a-z0-9-]{0,63}$/.test(input.name) &&
      input.version === 1 &&
      input.fixture === fixture,
    "Invalid name, version or fixture",
  );
  check(
    typeof input.clock === "string" &&
      Number.isFinite(Date.parse(input.clock)) &&
      new Date(input.clock).toISOString() === input.clock,
    "Expected UTC fixture clock",
  );
  check(
    Array.isArray(input.ignore) &&
      input.ignore.every((p) => p === "$.generatedAt"),
    "Unsupported ignore rule",
  );
  check(
    Array.isArray(input.steps) &&
      input.steps.length > 0 &&
      input.steps.length <= 100,
    "Expected 1–100 steps",
  );
  const names = new Set(),
    bindings = new Set();
  for (const s of input.steps) {
    check(
      object(s) &&
        keys(s, ["name", "method", "path", "json", "capture", "assert"]),
      "Invalid step shape",
    );
    check(
      typeof s.name === "string" &&
        identifier.test(s.name) &&
        !names.has(s.name),
      "Invalid or repeated step name",
    );
    names.add(s.name);
    check(typeof s.path === "string", "Invalid route");
    const route = routes.find(
      (r) => r.method === s.method && r.path.test(String(s.path)),
    );
    check(route, "Route outside demo contract");
    for (const [, key] of s.path.matchAll(variable))
      check(bindings.has(key), "Unknown variable");
    const body = s.json === undefined ? {} : s.json;
    check(
      object(body) &&
        keys(body, route.fields) &&
        route.fields.every((k) => Object.hasOwn(body, k)),
      "Invalid request fields",
    );
    if ("sku" in body) check(body.sku === "SHOE-001", "Unknown fixture SKU");
    if ("code" in body) check(body.code === "SAVE10", "Unknown fixture coupon");
    if ("quantity" in body)
      check(
        Number.isInteger(body.quantity) &&
          Number(body.quantity) >= 1 &&
          Number(body.quantity) <= 99,
        "Invalid quantity",
      );
    if (s.capture !== undefined) {
      check(
        (route === routes[0] || route === routes[1]) &&
          typeof s.capture === "string" &&
          identifier.test(s.capture) &&
          !bindings.has(s.capture),
        "Invalid capture",
      );
      bindings.add(s.capture);
    }
    if (s.assert !== undefined)
      check(
        object(s.assert) &&
          keys(s.assert, ["currency"]) &&
          s.assert.currency === "CAD",
        "Invalid assertion",
      );
  }
  return input as Scenario;
}
