export type Step = {
  name: string;
  method: string;
  path: string;
  json?: Record<string, unknown>;
  capture?: string;
  captures?: Record<string, { from: "response.body"; path: string }>;
  assertions?: { path: string; equals: string | number | boolean | null }[];
  timeout_ms?: number;
  poll?: {
    path: string;
    equals: string | number | boolean;
    max_attempts: number;
    interval_ms: number;
  };
  assert?: Record<string, unknown>;
};
export type Scenario = {
  name: string;
  version: number;
  fixture: string;
  clock: string;
  steps: Step[];
  ignore: string[];
  exact?: string[];
  sets?: Record<string, string>;
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
routes.push(
  {
    method: "GET",
    path: new RegExp("^/test/carts/" + ref + "/settled$"),
    fields: [],
  },
  {
    method: "POST",
    path: new RegExp("^/test/carts/" + ref + "/checkout$"),
    fields: [],
  },
);
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
      keys(input, [
        "name",
        "version",
        "fixture",
        "clock",
        "steps",
        "ignore",
        "exact",
        "sets",
      ]),
    "Invalid scenario shape",
  );
  check(
    typeof input.name === "string" &&
      /^[a-z][a-z0-9-]{0,63}$/.test(input.name) &&
      Number.isSafeInteger(input.version) &&
      Number(input.version) > 0 &&
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
  const semanticPath = (x: unknown) =>
    typeof x === "string" &&
    /^\$\.(?:id|entity\.id|subtotal|discount|total|currency|ready|quantity|notifications|applied|error)$/.test(
      x,
    );
  check(
    !input.exact ||
      (Array.isArray(input.exact) &&
        input.exact.every((k) =>
          ["$.subtotal", "$.discount", "$.total"].includes(k),
        )),
    "Invalid exact path",
  );
  check(
    !input.sets ||
      (object(input.sets) &&
        Object.entries(input.sets).every(
          ([k, v]) => k === "$.items" && v === "id",
        )),
    "Invalid ordered set",
  );
  const names = new Set(),
    bindings = new Set();
  for (const s of input.steps) {
    check(
      object(s) &&
        keys(s, [
          "name",
          "method",
          "path",
          "json",
          "capture",
          "assert",
          "captures",
          "assertions",
          "timeout_ms",
          "poll",
        ]),
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
    if (s.captures !== undefined) {
      check(
        !s.capture && object(s.captures) && Object.keys(s.captures).length > 0,
        "Invalid captures",
      );
      for (const [key, rule] of Object.entries(s.captures)) {
        check(
          identifier.test(key) &&
            !bindings.has(key) &&
            object(rule) &&
            keys(rule, ["from", "path"]) &&
            rule.from === "response.body" &&
            ["$.id", "$.entity.id"].includes(String(rule.path)),
          "Invalid capture path",
        );
        bindings.add(key);
      }
    }
    if (s.assertions !== undefined)
      check(
        Array.isArray(s.assertions) &&
          s.assertions.every(
            (r) =>
              object(r) &&
              keys(r, ["path", "equals"]) &&
              semanticPath(r.path) &&
              (r.equals === null ||
                ["number", "string", "boolean"].includes(typeof r.equals)),
          ),
        "Invalid path assertion",
      );
    if (s.timeout_ms !== undefined)
      check(
        Number.isInteger(s.timeout_ms) &&
          Number(s.timeout_ms) > 0 &&
          Number(s.timeout_ms) <= 10000,
        "Invalid timeout",
      );
    if (s.poll !== undefined) {
      const p = s.poll;
      check(
        s.method === "GET" &&
          object(p) &&
          keys(p, ["path", "equals", "max_attempts", "interval_ms"]) &&
          semanticPath(p.path) &&
          ["string", "number", "boolean"].includes(typeof p.equals) &&
          Number.isInteger(p.max_attempts) &&
          Number(p.max_attempts) >= 1 &&
          Number(p.max_attempts) <= 10 &&
          Number.isInteger(p.interval_ms) &&
          Number(p.interval_ms) >= 1 &&
          Number(p.interval_ms) <= 500,
        "Invalid poll",
      );
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
