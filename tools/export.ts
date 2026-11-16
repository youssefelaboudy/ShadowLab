import { readFile, mkdir, writeFile } from "node:fs/promises";
import type { Report } from "../packages/core/replay.ts";
const folder = process.argv[2] || "artifacts/demo";
const reports: Report[] = await Promise.all(
  ["stale", "fixed"].map(async (m) =>
    JSON.parse(await readFile(folder + "/" + m + "/report.json", "utf8")),
  ),
);
const escape = (s: unknown) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const money = (v: unknown) =>
  new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    currencyDisplay: "code",
  }).format(Number(v) / 100);
function panel(r: Report) {
  const summary = r.steps.find((s) => s.name === "summary")!;
  return `<section class="panel ${escape(r.candidate)}"><div class="status">${escape(r.status)}</div>
  <h2>${r.first ? "The coupon used the previous quantity." : "The discount follows the quantity change."}</h2>
  <div class="totals"><div>Baseline total<strong>${money(summary.baseline.body.total)}</strong></div><div>Candidate total<strong>${money(summary.candidate?.body.total)}</strong></div></div>
  <h3>Request trace</h3>${r.steps
    .map(
      (
        s,
      ) => `<details ${s.name === "summary" ? "open" : ""}><summary><span class="ordinal">${s.ordinal}</span> ${escape(s.name.replaceAll("_", " "))} <small>${s.differences.length ? s.differences.length + " differences" : "match"}</small></summary>
  <code>${escape(s.request.method + " " + s.request.path)}</code>
  <div class="evidence">${[s.baseline, s.candidate].map((v, i) => `<div><b>${i ? "Candidate" : "Baseline"} · HTTP ${v?.status ?? "—"}</b><pre>${escape(JSON.stringify(v?.body, null, 2))}</pre></div>`).join("")}</div></details>`,
    )
    .join("")}
  <p>Fixture <code>${escape(r.fixture)}</code> · Recorded <time>${escape(r.startedAt)}</time></p></section>`;
}
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ShadowLab · Replay report</title>
<style>*{box-sizing:border-box}body{margin:0;background:#f6f5ef;color:#142d2a;font:16px/1.55 "Segoe UI",system-ui,sans-serif}main{max-width:840px;margin:auto;padding:28px 22px 65px}header,summary{display:flex;align-items:center;gap:.7em}header{justify-content:space-between;border-bottom:1px solid #a5b4ac;padding-bottom:18px}a{color:#1b5547}h1{font-size:clamp(42px,8vw,76px);letter-spacing:-.065em;line-height:1;margin:54px 0 15px}p{max-width:65ch}h2{font-size:clamp(24px,4vw,38px);letter-spacing:-.04em;line-height:1.12;margin:14px 0 25px}h3{margin:30px 0 10px}.switch{display:flex;gap:8px;align-items:center;margin:26px 0 14px}.switch label{cursor:pointer;padding:8px}.panel{border:1px solid #bec9bd;border-top:4px solid #ab4931;background:#fffefa;padding:clamp(14px,4vw,32px);border-radius:5px}.panel.fixed{border-top-color:#236857}.status,small,.ordinal,code,pre{font-family:Consolas,monospace}.status{color:#94371f;letter-spacing:.12em;font-weight:bold}.fixed .status{color:#236857}.totals,.evidence{display:grid;grid-template-columns:1fr 1fr;gap:12px}.totals div,.evidence div{min-width:0;background:#f1f3ec;padding:16px}.totals strong{display:block;font-size:clamp(20px,4vw,32px)}details{border-top:1px solid #cdd6cc;padding:12px 0}summary{cursor:pointer;text-transform:capitalize;font-weight:600}summary:before{content:'▸'}details[open]>summary:before{content:'▾'}summary small{margin-left:auto;color:#4b6458}.ordinal{color:#65746e}code{overflow-wrap:anywhere}details>code{display:block;margin:12px 0}.evidence pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}.panel>p{font-size:13px;margin:18px 0 0}main:has(#stale:checked) .fixed,main:has(#fixed:checked) .stale{display:none}@media(max-width:550px){.evidence{grid-template-columns:1fr}.switch{gap:0}}</style>
<main><header><b>ShadowLab</b><a href="https://github.com/youssefelaboudy/ShadowLab">View source ↗</a></header><h1>Coupon replay</h1>
<p>A shopper applies a 10% coupon, then doubles the quantity. Inspect the same five HTTP requests against two backend revisions.</p>
<div class="switch" role="group" aria-label="Candidate revision"><input type="radio" name="rev" id="stale" checked><label for="stale">Seeded regression</label><input type="radio" name="rev" id="fixed"><label for="fixed">Verified fix</label></div>${reports.map(panel).join("")}</main></html>`;
await mkdir("docs", { recursive: true });
await writeFile("docs/index.html", html);
