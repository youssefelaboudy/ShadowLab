# ShadowLab

[![Replay verification](https://github.com/youssefelaboudy/ShadowLab/actions/workflows/ci.yml/badge.svg)](https://github.com/youssefelaboudy/ShadowLab/actions/workflows/ci.yml)

A shopper adds a CAD 100 item, applies a 10% coupon, then doubles the quantity. Every request succeeds. The candidate charges **CAD 190**. The baseline charges **CAD 180**. ShadowLab replays the journey against both revisions and traces the extra CAD 10 to the summary response.

[Explore the recorded replay](https://youssefelaboudy.github.io/ShadowLab/) · [Read the actual diff](docs/example-report.md) · [Inspect the five-step scenario](scenarios/coupon-quantity.json)

## Reproduce it

From a clean checkout with Node.js 24.12 or newer:

```sh
npm run demo -- --out artifacts/demo
```

The demo starts three temporary HTTP servers and runs the same scenario twice. Open `artifacts/demo/stale/report.md` for the failed comparison and `artifacts/demo/fixed/report.md` for the repair. Both directories contain machine-readable JSON. On Windows, double-click **Open Demo.cmd** to run the comparison and open the saved report viewer.

## What happens at step five

| Response field | Baseline | Candidate |
|---|---:|---:|
| Subtotal | CAD 200 | CAD 200 |
| Discount | CAD 20 | CAD 10 |
| Total | CAD 180 | CAD 190 |

The faulty revision saves the item count when the coupon is applied. The repaired revision reads the current quantity when building the summary. Both totals balance internally. Detecting this defect requires comparing the business outcome across versions.

## How replay works

1. **Validate the scenario.** The JSON contract requires a fixture, UTC clock, ordered steps and known demo routes. Variables must be captured before use.
2. **Create isolated state.** Each fixture handshake allocates a fresh in-memory SQLite database, clock and local notification sink. The runner releases that lease in a cleanup block. Overlapping replays have separate databases.
3. **Resolve identities independently.** Each revision creates random cart and item IDs. The runner substitutes that revision’s IDs into later paths and represents the IDs by their capture names in evidence.
4. **Compare the responses.** Status codes, known response fields, missing values, currency assertions and integer-cent totals are compared. A configured timestamp can be ignored. Array ordering is significant in the comparator.
5. **Keep the evidence.** Reports retain sanitized request templates, both response projections, the first divergent step, subsequent differences, fixture clock and scenario checksum. CI includes the checkout SHA.

## Commands

```sh
node packages/cli/main.ts scenario validate scenarios/coupon-quantity.json
npm run record -- --out artifacts/recording
npm run coverage
node tools/export.ts artifacts/demo
```

Recording is opt-in on the owned synthetic API. Successful requests become replayable templates with named captures. Only recognized fixture fields are copied. Headers and unknown fields never enter the recording. The response projection retains typed demo fields. Extending the demo to a new response field requires extending that projection and its tests.

To exercise separate processes, run `docker compose up --build --wait`, then:

```sh
docker compose exec baseline node packages/cli/main.ts replay --scenario scenarios/coupon-quantity.json --baseline http://127.0.0.1:4101 --candidate http://127.0.0.1:4102 --out /tmp/evidence
docker compose cp baseline:/tmp/evidence artifacts/run-001
node packages/cli/main.ts report artifacts/run-001 --format markdown
docker compose down
```

Replay exits **0** for a match, **1** for a regression, and **2** for invalid input, infrastructure failure or an unusable baseline. The guided demo exits zero after verifying the expected failure and repair.

## Verification and scope

The test suite exercises three seeded failures (stale discount, missing currency and HTTP 500), recorder privacy, replayable recordings, concurrent isolation, duplicate notification effects and bounded HTTP failures. The coverage command measures the schema, replay engine and comparator with an 85% line-coverage gate. CI also builds both containers, verifies the regression exit code and uploads reports for 14 days.

This implementation supports a single owned commerce API and sequential JSON workflows. SQLite keeps the one-command demo self-contained. The Compose services use a shared loopback namespace with external networking disabled. Notifications are local events. The runner accepts literal IPv4 loopback origins, rejects redirects, and caps each response at 64 KiB and four seconds. The report viewer is a read-only export of real runs. Rebuild it after changing the scenario using the demo and export commands above.


