import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { fixture, validate, type Step } from "../../packages/core/schema.ts";

import {
  defaults,
  fixtureHash,
  revision,
} from "../../packages/fixtures/manifest.ts";
import { SyntheticEffects, placeholders } from "./adapters.ts";
export type Mode = "baseline" | "stale" | "fixed" | "missing" | "error";
export function startApi(mode: Mode, port = 0, host = "127.0.0.1") {
  const commit = revision();
  const sessions = new Map<string, ReturnType<typeof seed>>();
  function seed(clock: string, record: boolean) {
    const db = new DatabaseSync(":memory:");
    db.exec(
      "CREATE TABLE cart(id TEXT PRIMARY KEY, coupon INTEGER DEFAULT 0, snapshot INTEGER DEFAULT 0); CREATE TABLE item(id TEXT PRIMARY KEY, cart TEXT, qty INTEGER);",
    );
    return {
      db,
      clock,
      record,
      steps: [] as Step[],
      aliases: new Map<string, string>(),
      effects: new SyntheticEffects(),
      mask: placeholders(),
      recorded: [] as unknown[],
      pending: new Set<string>(),
    };
  }
  async function payload(req: IncomingMessage) {
    let bytes = 0,
      chunks = [];
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > 8192) throw Error("size");
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString() || "{}");
  }
  const server = createServer(async (req, res) => {
    function send(status: number, body: unknown) {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    }
    try {
      const path = req.url || "",
        method = req.method || "",
        body = await payload(req);
      if (path === "/__fixture" && method === "POST") {
        if (
          body.fixture !== fixture ||
          !Number.isFinite(Date.parse(body.clock))
        )
          return send(400, { error: "fixture" });
        if (sessions.size >= 64) return send(503, { error: "capacity" });
        const run = randomUUID();
        sessions.set(run, seed(body.clock, body.record === true));
        return send(201, {
          protocol: "shadowlab/1",
          run,
          revision: mode,
          commit,
          fixtureHash: fixtureHash(defaults),
        });
      }
      const token = String(req.headers["x-shadowlab-run"]),
        state = sessions.get(token);
      if (!state) return send(403, { error: "session" });
      const { db, clock, steps, aliases, record } = state;
      if (path === "/__fixture" && method === "DELETE") {
        db.close();
        sessions.delete(token);
        return send(200, { closed: true });
      }
      if (path === "/__evidence" && method === "GET" && record)
        return send(200, state.recorded);
      if (path === "/__record" && method === "GET" && state.record)
        return send(
          200,
          validate({
            name: "recorded-cart",
            version: 1,
            fixture,
            clock,
            ignore: ["$.generatedAt"],
            steps,
          }),
        );
      const [, prefix, resource, cart, action, item] = path.split("/");
      if (prefix !== "test" || resource !== "carts")
        return send(404, { error: "route" });
      const rows = (id: string) =>
        Number(
          db
            .prepare("SELECT COALESCE(SUM(qty),0) AS n FROM item WHERE cart=?")
            .get(id)?.n,
        );
      // Record only successful, recognized operations and synthetic contract values.
      function success(
        status: number,
        name: string,
        response: Record<string, unknown>,
        json?: Step["json"],
        capture?: string,
      ) {
        if (record) {
          const template = path
            .split("/")
            .map((p) => (aliases.has(p) ? "${" + aliases.get(p) + "}" : p))
            .join("/");
          const step: Step = {
            name: name + "_" + (steps.length + 1),
            method,
            path: template,
          };
          if (json) step.json = json;
          if (capture) {
            step.capture = capture + "_" + (steps.length + 1);
            aliases.set(String(response.id), step.capture);
          }
          steps.push(step);
          const safe = { ...response };
          if (capture) {
            safe.id = "${" + step.capture + "}";
            if (safe.entity) safe.entity = { id: safe.id };
          }
          if (Array.isArray(safe.items))
            safe.items = safe.items.map((x) => ({
              id: "${" + aliases.get(x.id) + "}",
              quantity: x.quantity,
            }));
          state!.recorded.push({
            step: step.name,
            method,
            path: template,
            request: {
              ...json,
              ...(typeof body.customerRef === "string"
                ? { customerRef: state!.mask(body.customerRef) }
                : {}),
            },
            status,
            response: safe,
          });
        }
        send(status, response);
      }
      if (path === "/test/carts" && method === "POST") {
        const id = randomUUID();
        db.prepare("INSERT INTO cart(id) VALUES(?)").run(id);
        return success(201, "cart", { id, entity: { id } }, undefined, "cart");
      }
      const c = db.prepare("SELECT * FROM cart WHERE id=?").get(cart || "");
      if (!c) return send(404, { error: "cart" });
      if (
        path === "/test/carts/" + cart + "/coupons" &&
        method === "POST" &&
        body.code === "SAVE10"
      ) {
        db.prepare("UPDATE cart SET coupon=1,snapshot=? WHERE id=?").run(
          rows(cart),
          cart,
        );
        state.effects.notify();
        state.pending.add(cart);
        return success(
          200,
          "coupon",
          {
            applied: true,
            notifications: state.effects.events.filter(
              (e) => e.kind === "notification",
            ).length,
          },
          { code: "SAVE10" },
        );
      }
      if (
        action === "items" &&
        Number.isInteger(body.quantity) &&
        body.quantity >= 1 &&
        body.quantity <= 99
      ) {
        if (
          path === "/test/carts/" + cart + "/items" &&
          method === "POST" &&
          body.sku === "SHOE-001"
        ) {
          const id = randomUUID();
          db.prepare("INSERT INTO item VALUES(?,?,?)").run(
            id,
            cart,
            body.quantity,
          );
          return success(
            201,
            "item",
            { id },
            { sku: "SHOE-001", quantity: body.quantity },
            "item",
          );
        }
        if (
          path === "/test/carts/" + cart + "/items/" + item &&
          item &&
          method === "PATCH"
        ) {
          const changed = db
            .prepare("UPDATE item SET qty=? WHERE cart=? AND id=?")
            .run(body.quantity, cart, item);
          if (changed.changes)
            return success(
              200,
              "quantity",
              { quantity: body.quantity },
              { quantity: body.quantity },
            );
        }
      }
      if (path === "/test/carts/" + cart + "/settled" && method === "GET") {
        const wait = state.pending.delete(cart);
        return success(200, "settled", { ready: !wait });
      }
      if (path === "/test/carts/" + cart + "/checkout" && method === "POST") {
        const units = rows(cart),
          discount = c.coupon
            ? ((Number(c.snapshot)) *
                defaults.unitPrice *
                defaults.discountPercent) /
              100
            : 0;
        const total = units * defaults.unitPrice - discount;
        state.effects.receipt(total);
        return success(201, "checkout", {
          total,
          emailCount: state.effects.events.filter((e) => e.kind === "email")
            .length,
          paymentCount: state.effects.events.filter((e) => e.kind === "payment")
            .length,
        });
      }
      if (path === "/test/carts/" + cart + "/summary" && method === "GET") {
        if (mode === "error")
          return send(500, { error: "summary_unavailable" });
        const units = rows(cart),
          subtotal = units * defaults.unitPrice;
        const discount = c.coupon
          ? ((Number(c.snapshot)) *
              defaults.unitPrice *
              defaults.discountPercent) /
            100
          : 0;
        return success(200, "summary", {
          subtotal,
          discount,
          total: subtotal - discount,
          ...(mode === "missing" ? {} : { currency: defaults.currency }),
          items: db
            .prepare(
              "SELECT id,qty AS quantity FROM item WHERE cart=? ORDER BY rowid",
            )
            .all(cart),
          generatedAt: clock,
        });
      }
      send(400, { error: "invalid_request" });
    } catch {
      if (!res.headersSent) send(400, { error: "invalid_request" });
    }
  });
  server.on("close", () => {
    for (const s of sessions.values()) s.db.close();
  });
  return new Promise<{ url: string; close: () => Promise<void> }>(
    (resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => {
        const address = server.address();
        if (!address || typeof address === "string")
          throw Error("Expected TCP");
        resolve({
          url: "http://127.0.0.1:" + address.port,
          close: () =>
            new Promise<void>((done, fail) =>
              server.close((e) => (e ? fail(e) : done())),
            ),
        });
      });
    },
  );
}
if (import.meta.main) {
  const mode = process.env.SHADOWLAB_MODE || "baseline";
  if (!["baseline", "stale", "fixed", "missing", "error"].includes(mode))
    throw Error("Unknown revision");
  await startApi(
    mode as Mode,
    Number(process.env.PORT || 4101),
    process.env.HOST || "127.0.0.1",
  );
}

