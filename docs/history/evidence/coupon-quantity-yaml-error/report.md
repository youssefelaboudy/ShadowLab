# coupon-quantity-yaml

**REGRESSION** · baseline → error

First divergence: summary

| Step | Request | Result |
|---|---|---|
| 1. create_cart | `POST /test/carts` | MATCH |
| 2. add_item | `POST /test/carts/${cart_id}/items` | MATCH |
| 3. apply_coupon | `POST /test/carts/${cart_id}/coupons` | MATCH |
| 4. change_quantity | `PATCH /test/carts/${cart_id}/items/${item_id}` | MATCH |
| 5. summary | `GET /test/carts/${cart_id}/summary` | DIFF |

## summary

| Path | Reference | Candidate | Check |
|---|---:|---:|---|
| `$status` | `200` | `500` | status |
| `$.currency` | `"CAD"` | `{"missing":true}` | presence |
| `$.discount` | `2000` | `{"missing":true}` | presence |
| `$.error` | `{"missing":true}` | `"summary_unavailable"` | presence |
| `$.items` | `[{"id":"${item_id}","quantity":2}]` | `{"missing":true}` | presence |
| `$.subtotal` | `20000` | `{"missing":true}` | presence |
| `$.total` | `18000` | `{"missing":true}` | presence |
| `$.currency` | `"CAD"` | `{"missing":true}` | assertion |

Money amounts are integer CAD cents.

Fixture: `carts-basic-v1` · Clock: `2026-01-15T10:00:00.000Z`

Baseline commit: `aef63ebd83ab6ec9f43dda5762f598c2153bfdff` · Candidate commit: `aef63ebd83ab6ec9f43dda5762f598c2153bfdff`

Run: 2026-11-16T15:44:18.500Z → 2026-11-16T15:44:18.519Z

Scenario SHA-256: `e0fb4870127918e9c5917bd70dd1f1bc9a409ef5426bbb6a50e992ad3bb5f4ab`
