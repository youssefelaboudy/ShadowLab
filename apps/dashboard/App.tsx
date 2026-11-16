import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Report } from "../../packages/core/replay.ts";
type Data = {
  runs: { id: string; report: Report }[];
  hasMore: boolean;
  scenarios: string[];
  jobs: { id: string; state: string; priority: number; name: string }[];
  artifacts: {
    run_id: string;
    format: string;
    uploaded: boolean;
    checksum: string;
  }[];
};
const live = document.documentElement.dataset.mode === "live";
function Dashboard() {
  const [data, setData] = useState<Data>(),
    [error, setError] = useState(""),
    [selected, select] = useState(""),
    [page, turn] = useState(0),
    [view, setView] = useState("Runs"),
    [scenario, setScenario] = useState(""),
    [candidate, setCandidate] = useState("stale"),
    [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const res = await fetch(
          live ? "/api/history?offset=" + page * 40 : "./history.json",
        );
        if (!res.ok) throw Error();
        const result = await res.json();
        if (active) {
          setData(result);
          setError("");
        }
      } catch {
        if (active) setError("Unable to load replay history.");
      }
    }
    void refresh();
    const timer = live ? setInterval(refresh, 2200) : undefined;
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [page]);
  if (!data)
    return (
      <main>
        <h1>Replay history</h1>
        <p>{error || "Loading runs…"}</p>
      </main>
    );
  const runs = data.runs,
    chosen = runs.find((x) => x.id === selected) ?? runs[0];
  const groups = new Map<
    string,
    { count: number; scenario: string; step: string; path: string; id: string }
  >();
  const coverage = new Map<
    string,
    { runs: number; diffs: number; fields: Set<string> }
  >();
  const days = new Map<string, { pass: number; fail: number }>();
  for (const run of runs) {
    const r = run.report,
      day = r.startedAt.slice(0, 10),
      counts = days.get(day) ?? { pass: 0, fail: 0 };
    counts[r.first ? "fail" : "pass"]++;
    days.set(day, counts);
    for (const s of r.steps) {
      const k = s.request.method + " " + s.request.path,
        route = coverage.get(k) ?? {
          runs: 0,
          diffs: 0,
          fields: new Set<string>(),
        };
      if (s.candidate) {
        route.runs++;
        for (const f of Object.keys(s.candidate.body)) route.fields.add(f);
      }
      if (s.differences.length) route.diffs++;
      coverage.set(k, route);
      for (const diff of s.differences) {
        const key = JSON.stringify([
          r.scenario,
          s.name,
          diff.path,
          diff.reason,
        ]);
        const entry = groups.get(key) ?? {
          count: 0,
          scenario: r.scenario,
          step: s.name,
          path: diff.path,
          id: run.id,
        };
        entry.count++;
        groups.set(key, entry);
      }
    }
  }
  async function queue() {
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenario: scenario || data!.scenarios[0],
          candidate,
        }),
      });
      if (!res.ok) throw Error();
      setNotice("Queued for replay.");
    } catch {
      setNotice("Could not queue this replay.");
    }
  }
  return (
    <main>
      <header>
        <a className="brand" href={live ? "/" : "../"}>
          ShadowLab
        </a>
        <a href="https://github.com/youssefelaboudy/ShadowLab">Source ↗</a>
      </header>
      <h1>Replay history</h1>
      <p>
        {live
          ? "Inspect worker runs and schedule a comparison."
          : "Explore recorded HTTP comparisons from the synthetic commerce API."}
      </p>
      {error && <p role="alert">{error}</p>}
      <nav aria-label="History views">
        {["Runs", "Regressions", "Trends", "Coverage"].map((name) => (
          <button
            key={name}
            aria-pressed={view === name}
            onClick={() => setView(name)}
          >
            {name}
          </button>
        ))}
      </nav>
      {live && (
        <details>
          <summary>Schedule replay</summary>
          <div className="controls">
            <label>
              Scenario
              <select
                value={scenario || data.scenarios[0]}
                onChange={(e) => setScenario(e.target.value)}
              >
                {data.scenarios.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label>
              Candidate
              <select
                value={candidate}
                onChange={(e) => setCandidate(e.target.value)}
              >
                {["stale", "fixed", "missing", "error"].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <button onClick={queue}>Queue run</button>
          </div>
          <p role="status">{notice}</p>
          {data.jobs.map((j) => (
            <p key={j.id}>
              {j.name} · {j.state} · priority {j.priority}
            </p>
          ))}
        </details>
      )}
      {view === "Runs" && (
        <div className="layout">
          <aside>
            {runs.map(({ id, report: r }) => (
              <button
                className={id === chosen?.id ? "active" : ""}
                key={id}
                onClick={() => select(id)}
              >
                <strong>{r.scenario}</strong>
                <span>
                  {r.candidate} · {r.status}
                </span>
              </button>
            ))}
            {!runs.length && <p>No completed runs yet.</p>}
          </aside>
          {chosen && (
            <article key={chosen.id}>
              <small>{chosen.report.status}</small>
              <h2>
                {chosen.report.first
                  ? "First divergence at " + chosen.report.first
                  : "All steps match"}
              </h2>
              <p>
                {chosen.report.baseline} → {chosen.report.candidate} ·{" "}
                {chosen.report.startedAt}
              </p>
              {chosen.report.steps.map((s) => (
                <details key={s.ordinal} open={s.name === chosen.report.first}>
                  <summary>
                    {s.ordinal}. {s.name}{" "}
                    <b>
                      {s.blocked
                        ? "Blocked"
                        : s.differences.length + " differences"}
                    </b>
                  </summary>
                  <code>
                    {s.request.method} {s.request.path}
                  </code>
                  {s.differences.map((d, i) => (
                    <p key={i}>
                      <code>{d.path}</code> · {JSON.stringify(d.baseline)} →{" "}
                      {JSON.stringify(d.candidate)}
                    </p>
                  ))}
                  <div className="pair">
                    {[s.baseline, s.candidate].map((v, i) => (
                      <div key={i}>
                        <small>
                          {i ? "Candidate" : "Baseline"} ·{" "}
                          {v?.status ?? "blocked"}
                        </small>
                        <pre>{JSON.stringify(v?.body, null, 2)}</pre>
                      </div>
                    ))}
                  </div>
                </details>
              ))}
              <h3>Artifacts</h3>
              {data.artifacts
                .filter((a) => a.run_id === chosen.id)
                .map((a) => (
                  <p key={a.format}>
                    <a
                      href={
                        live
                          ? "/api/artifacts/" + chosen.id + "/" + a.format
                          : "./evidence/" + chosen.id + "/report." + a.format
                      }
                    >
                      {a.format.toUpperCase()} report
                    </a>{" "}
                    ·{" "}
                    {live
                      ? a.uploaded
                        ? "S3 archived"
                        : "upload pending"
                      : "snapshot"}
                    <br />
                    <code>{a.checksum}</code>
                  </p>
                ))}
            </article>
          )}
        </div>
      )}
      {view === "Regressions" && (
        <article>
          <h2>Grouped differences</h2>
          {[...groups.values()]
            .sort((a, b) => b.count - a.count)
            .map((g, i) => (
              <p key={i}>
                <button
                  onClick={() => {
                    select(g.id);
                    setView("Runs");
                  }}
                >
                  {g.scenario} / {g.step} / {g.path}
                </button>{" "}
                · {g.count} occurrence(s)
              </p>
            ))}
          {!groups.size && <p>No differences on this page.</p>}
        </article>
      )}
      {view === "Trends" && (
        <article>
          <h2>Runs by day</h2>
          {[...days].sort().map(([day, c]) => (
            <div key={day} className="trend">
              <strong>{day}</strong>
              <div className="bar">
                <i style={{ flex: c.pass }} />
                <i style={{ flex: c.fail }} />
              </div>
              <span>
                {c.pass} pass · {c.fail} regression
              </span>
            </div>
          ))}
        </article>
      )}
      {view === "Coverage" && (
        <article>
          <h2>Compared routes and fields</h2>
          {[...coverage].map(([route, c]) => (
            <section key={route}>
              <code>{route}</code>
              <p>
                {c.runs} compared · {c.diffs} with differences
              </p>
              <small>{[...c.fields].sort().join(", ")}</small>
            </section>
          ))}
        </article>
      )}
      <footer>
        {runs.length} runs on this page{" "}
        {page > 0 && <button onClick={() => turn(page - 1)}>Previous</button>}
        {data.hasMore && <button onClick={() => turn(page + 1)}>Next</button>}
      </footer>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Dashboard />);
