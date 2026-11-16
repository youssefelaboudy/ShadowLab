# coupon-quantity

**REGRESSION** · baseline → stale

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
| `$.discount` | `2000` | `1000` | value |
| `$.total` | `18000` | `19000` | value |

Money amounts are integer CAD cents.

Fixture: `carts-basic-v1` · Clock: `2026-01-15T10:00:00.000Z`

Baseline commit: `aef63ebd83ab6ec9f43dda5762f598c2153bfdff` · Candidate commit: `aef63ebd83ab6ec9f43dda5762f598c2153bfdff`

Run: 2026-11-16T15:44:19.264Z → 2026-11-16T15:44:19.313Z

Scenario SHA-256: `8338aa6f946e1fc585592c8cf7da42ea06e880aa3a3aba94d4f3a10dc6eed93a`
