# summary-contract

**REGRESSION** · baseline → missing

First divergence: empty_summary

| Step | Request | Result |
|---|---|---|
| 1. cart | `POST /test/carts` | MATCH |
| 2. empty_summary | `GET /test/carts/${cart_id}/summary` | DIFF |

## empty_summary

| Path | Reference | Candidate | Check |
|---|---:|---:|---|
| `$.currency` | `"CAD"` | `{"missing":true}` | presence |
| `$.currency` | `"CAD"` | `{"missing":true}` | assertion |

Money amounts are integer CAD cents.

Fixture: `carts-basic-v1` · Clock: `2026-01-15T10:00:00.000Z`

Baseline commit: `aef63ebd83ab6ec9f43dda5762f598c2153bfdff` · Candidate commit: `aef63ebd83ab6ec9f43dda5762f598c2153bfdff`

Run: 2026-11-16T15:44:18.413Z → 2026-11-16T15:44:18.422Z

Scenario SHA-256: `d9c9cc03acacb700194df83ffe7f9114b9731966d4f6e3925132eb681f7d5ffd`
