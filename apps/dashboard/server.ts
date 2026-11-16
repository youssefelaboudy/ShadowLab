import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { db, migrate, enqueue } from "../../packages/history/store.ts";
import { readScenario } from "../../packages/scenario/format.ts";
const catalog = [
  "coupon-quantity.yaml",
  "quantity-before-coupon.json",
  "checkout.yaml",
  "missing-field.yaml",
];
const scenarios = await Promise.all(
  catalog.map((s) => readScenario("scenarios/" + s)),
);
await migrate();
createServer(async (req, res) => {
  const path = new URL(req.url || "/", "http://localhost");
  function json(status: number, body: unknown) {
    res.writeHead(status, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    res.end(JSON.stringify(body));
  }
  try {
    if (req.method === "POST" && path.pathname === "/api/jobs") {
      if (
        req.headers["content-type"] !== "application/json" ||
        (req.headers.origin &&
          new URL(req.headers.origin).host !== req.headers.host)
      )
        return json(403, { error: "Origin denied" });
      let raw = "";
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 2048) return json(413, { error: "Too large" });
      }
      const input = JSON.parse(raw),
        s = scenarios.find((s) => s.name === input.scenario);
      if (
        !s ||
        !["fixed", "stale", "missing", "error"].includes(input.candidate)
      )
        return json(400, { error: "Unknown scenario or candidate" });
      return json(202, { id: await enqueue(s, input.candidate) });
    }
    if (req.method !== "GET") return json(405, { error: "Method" });
    if (path.pathname === "/api/history") {
      const limit = 40;
      const offset = Number(path.searchParams.get("offset") || 0);
      if (!Number.isSafeInteger(offset) || offset < 0)
        return json(400, { error: "Invalid offset" });
      const runs = (
        await db.query(
          "SELECT id,report FROM runs ORDER BY completed_at DESC,id LIMIT $1 OFFSET $2",
          [limit + 1, offset],
        )
      ).rows;
      const jobs = (
        await db.query(
          "SELECT j.id,j.state,j.priority,j.candidate,s.name FROM jobs j JOIN scenarios s ON s.id=j.scenario_id WHERE state!='done' ORDER BY j.priority DESC,created_at LIMIT 30",
        )
      ).rows;
      const artifacts = (
        await db.query(
          "SELECT run_id,format,checksum,uploaded FROM artifacts WHERE run_id=ANY($1::uuid[])",
          [runs.slice(0, limit).map((r) => r.id)],
        )
      ).rows;
      return json(200, {
        runs: runs.slice(0, limit),
        hasMore: runs.length > limit,
        jobs,
        artifacts,
        scenarios: scenarios.map((s) => s.name),
      });
    }
    const m = path.pathname.match(
      /^\/api\/artifacts\/([a-f0-9-]{36})\/(json|md)$/,
    );
    if (m) {
      const a = (
        await db.query(
          "SELECT content FROM artifacts WHERE run_id=$1 AND format=$2",
          m.slice(1),
        )
      ).rows[0];
      if (!a) return json(404, {});
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-disposition": 'attachment; filename="report.' + m[2] + '"',
      });
      return res.end(a.content);
    }
    const file = (
      {
        "/": "index.html",
        "/app.js": "app.js",
        "/style.css": "style.css",
      } as Record<string, string>
    )[path.pathname];
    if (!file) return json(404, { error: "Unknown path" });
    res.writeHead(200, {
      "content-type": file.endsWith(".js")
        ? "application/javascript"
        : file.endsWith(".css")
          ? "text/css"
          : "text/html",
    });
    const source = await readFile("docs/history/" + file);
    res.end(
      file === "index.html"
        ? source.toString().replace('data-mode="snapshot"', 'data-mode="live"')
        : source,
    );
  } catch {
    if (!res.headersSent)
      return json(500, { error: "Dashboard request failed" });
    res.end();
  }
}).listen(Number(process.env.PORT || 4200), process.env.HOST || "127.0.0.1");
